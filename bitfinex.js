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
                'USD' : parseFloat(_.find(data, {type: 'exchange', currency :'usd'}).available),
                'BTC' : parseFloat(_.find(data, {type: 'exchange', currency :'btc'}).available)
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
        return this.client.cancel_order(id);
    };

    this.tradeCommand = function(options){
        console.log('executing bitfinex trade: ', options);

        return this.client.new_order('btcusd', options.volume.toString(), options.price.toString(), 'all', options.buySell.toLowerCase(), 'limit').then(function(response){
            console.log('add order sent: ', response);
            return response;
        });
    };

    this.trade = function(options){
        var tradeResolver = Promise.defer();

        var neededOptions = ['currency', 'buySell', 'price', 'volume'];
        for (var i = neededOptions.length - 1; i >= 0; i--) {
            if(!_.has(options, neededOptions[i])){
                return tradeResolver.throw('Input data error').promise;
            }
        };

        this.tradeCommand(options).then(function(response){
            var id = response.order_id;
            var i = 0;

            console.log('bitfinex order id: ', id);

            function tradeChecker(response){
                if(tradeResolver.promise.isResolved()){ return ; } // quit the loop 

                if(response.remaining_amount == 0){
                    console.log('order is completed!');
                    tradeResolver.resolve(response);
                    return true;
                } else if (response.is_cancelled){
                    console.log('order is cancelled!');
                    tradeResolver.reject(response);
                    return false;
                } else if(response.is_live){
                    console.log('order ', id, 'is still running, iteration', i++);
                    Promise.delay(1000).then(function(){
                        return self.client.order_status(id); // here is where the request happens
                    }).then(tradeChecker); // keep looping this baby                    
                } else {
                    throw new Error('Unclear bitfinex trade situation: ', response);
                }
            }
            tradeChecker(response); // verify original response
        });

        return tradeResolver.promise;
    };
    
    this.getBalance().then(function(){
        initDeferred.resolve();    
    });

}
