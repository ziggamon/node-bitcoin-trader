var _ = require('lodash');
var Promise = require('bluebird');
var Client = require('bitfinex');    
var util = require('util');

module.exports = function(conf, trader){
    _.extend(this, conf);
    var self = this;

    var initDeferred = Promise.defer();
    this.initialized = initDeferred.promise;

    this.client = new Client(this.key, this.secret);
    ['orderbook', 'new_order', 'order_status', 'cancel_order' /*, 'wallet_balances'*/].forEach(function(command){
        self.client[command] = Promise.promisify(self.client[command]);
    })

    this.pollingInterval = 1000;


    this.spreadAdapter = function(indata){
        var outdata = {
            exchange : 'bitfinex',
            bids : [],
            asks : []
        };

        var bids = indata.bids;
        var asks  = indata.asks;

        for (var i = 0; i < 5; i++) {
            outdata.bids.push([bids[i].price, bids[i].amount]);
            outdata.asks.push([asks[i].price, asks[i].amount]);
        };
        return outdata;
    };

    this.getSpread = function(currency){ // only USD ATM.
        return self.client.orderbook('btcusd').then(function(response){
            var data = self.spreadAdapter(response);
            _.extend(data, {exchange: 'bitfinex', currency: currency});
            trader.emit('spread_data', data);
            return data;
        });
    }

    this.getBalance = function(){

        // keeping this function intact in case I forget how deferreds work ;) / SK. 21 mars
        var deferred = Promise.defer();
        
        self.client.wallet_balances(function(error, data) {
            if(error) {
                console.error(error);
                return deferred.reject(error);
            }
            self.balance = {
                'USD' : Math.floor( parseFloat(_.find(data, {type: 'exchange', currency :'usd'}).available) * 1000) / 1000,
                'BTC' : Math.floor( parseFloat(_.find(data, {type: 'exchange', currency :'btc'}).available) * 1000) / 1000
            };
            console.log('bitfinex.balance: ', self.balance);
            if(_.isNaN(self.balance.USD) || _.isNaN(self.balance.BTC)){
                deferred.reject('Bitfinex balance isNaN');
            }
            deferred.resolve(self.balance);
        });

        return deferred.promise;
    }
    this.cancel = function(id){
        return self.client.cancel_order(id);
    };

    this.tradeCommand = function(options){
        console.log('executing bitfinex trade: ', options);

        return self.client.new_order('btcusd', options.volume.toString(), options.price.toString(), 'all', options.buySell.toLowerCase(), 'exchange limit').then(function(response){
            console.log('add order sent: ', response);
            return response;
        });
    };

    self.idExtractor = function(response){
        console.log('bitfinex order id: ', response.order_id);
        this.id = response.order_id;
        this.retries = 0;
        return response;
    };

    self.tradeChecker = function(){
        console.log('tradecheck bitfinex: ', this.id);
        return self.client.order_status(this.id)
            .bind(this)
            .then(self.responseProcessor)
            .then(self.tradeCheckLooper);
    }

    self.responseProcessor = function(response){
        if(response.original_amount == response.executed_amount ){
            console.log('order is completed!');
            return {
                success : true,
                response : response
            };
        } else if (response.is_cancelled){
            console.log('order is cancelled!');
            throw new Error('order is cancelled!', response);

        } else if(response.is_live){
            return false;
        } else {
            throw new Error('Unclear trade situation: ', response);
        }
    };

    
    // these can be generalized, broken out

    this.tradeValidator = function(options){
        return new Promise(function(resolve, reject){
            var neededOptions = ['currency', 'buySell', 'price', 'volume'];
            for (var i = neededOptions.length - 1; i >= 0; i--) {
                if(!_.has(options, neededOptions[i])){
                    reject("Trade doesn't have needed properties; 'currency', 'buySell', 'price', 'volume'");
                    return;
                }
            }
            resolve(options);
        });
    };

    self.tradeCheckLooper = function(finishedResponse){
        if(finishedResponse){
            return finishedResponse;
        }

        console.log('order ', this.id, 'is still running, iteration', this.retries++);

        // keep looping this baby
        if(this.retries <= 1){
            return Promise.bind(this).then(self.tradeChecker); // first retry do immediately
        } else {
            return Promise.delay(self.pollingInterval).bind(this).then(self.tradeChecker);
        }
    };

    this.trade = function(options){
        return self.tradeValidator(options)
            .then(self.tradeCommand)
            .bind({}) // create a shared this property
            .then(self.idExtractor)
            .then(function(response){
                if(options.timeout && _.isNumber(options.timeout)){
                    return Promise.bind(this).then(self.tradeChecker).timeout(options.timeout);

                } else {
                    return Promise.bind(this).then(self.tradeChecker);
                }
            }).catch(Promise.TimeoutError, function(e){
                console.log('Trade timeout, cancelling');
                self.cancel(this.id);
                throw e;
            });
    };
    
    this.getBalance().then(function(){
        initDeferred.resolve();    
    });

}
