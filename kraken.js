var _ = require('lodash');
var Promise = require('bluebird');
var KrakenClient = require('kraken-api');    

module.exports = function(conf, trader){
    _.extend(this, conf);
    var self = this;

    var initDeferred = Promise.defer();
    this.initialized = initDeferred.promise;


    this.client = new KrakenClient(this.key, this.secret);

    this.client.promiseApi = Promise.promisify(this.client.api);

    this.pollingInterval = 5000;
    // this.checkTrade = function(){ // not working
    //     console.log('checktrade kraken');
    //     var deferred = Promise.defer();
    //     var ids = 'OETGUJ-I42O4-TDEM7B';
    //     // funking depth

    //     // currency, buy/sell, ordertype, price, volume, 

    //     self.client.api('QueryOrders', {txid: ids}, function(error, data) {
    //         if(error) {
    //             console.log(error);
    //             return deferred.reject(error);
    //         }
    //         deferred.resolve(data);
    //     });

    //     return deferred.promise;
    // };
/*
    this.placeTrade = function(options){
        var orderPlacementResolver = Promise.defer();
        self.client.api('AddOrder', options, function(error, data) {
            if(error) {
                console.log(error);
                return orderPlacementResolver.reject(error);
            }
            var data = data.result[market];
            _.extend(data, {exchange: 'kraken', currency: currency});
            trader.emit('spread_data', data);
            orderPlacementResolver.resolve(data);
        });
        return orderPlacementResolver.promise;
    }
*/
    this.cancel = function(id){
        return self.client.promiseApi('CancelOrder', {txid: id});
    };

    this.tradeCommand = function(options){
        // funking depth
        var orderOptions = {
            pair : 'XXBTZ'+options.currency,
            type : options.buySell.toLowerCase(),
            ordertype : options.ordertype || 'limit',
            price : options.price,
            volume : options.volume + ""
            // validate : true // TODO: Remove this line for badassness!
        };

        console.log('executing kraken trade: ', orderOptions);

        return self.client.promiseApi('AddOrder', orderOptions).then(function(response){
            var result = response.result;
            console.log('add order sent: ', result);
            return result;
        });
    }


    self.idExtractor = function(response){
        console.log('kraken order id: ', response.txid[0]);
        this.id = response.txid[0];
        this.retries = 0;
        return response;
    };

    self.tradeChecker = function(){
        console.log('tradecheck kraken: ', this.id);
        return self.client.promiseApi('QueryOrders', {txid: this.id})
            .bind(this)
            .then(self.responseProcessor)
            .then(self.tradeCheckLooper);
    }

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

    self.responseProcessor = function(response){
        console.log('this.id: ', this.id);
        console.log('resposne: ', response);
        var result = response.result[this.id];
        console.log(result);
        if(result.status == 'closed'){ 
            console.log('order is completed!');
            return {
                success : true,
                response : response
            };
        } else if (result.status == 'open'){ 
            return false; // test more
        } else if(result.status == 'canceled' || result.status == 'expired'){ 
            console.log('order is cancelled!');
            throw new Error('order is cancelled!', response);
        }
        throw new Error('Unclear trade situation: ', response);
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

    this.getSpread = function(currency){
        currency = currency || 'EUR';
        
        // funking depth
        var market = 'XXBTZ'+currency;

        return self.client.promiseApi('Depth', {pair: market, count: 5}).then(function(data){
            var data = data.result[market];
            _.extend(data, {exchange: 'kraken', currency: currency});
            trader.emit('spread_data', data);
            return data;
        }).catch(Error, function(e){
            console.error('kraken error .catch()', e.name);
        }).catch(function(e){
            console.error('kraken general purpose catch()', (_.isObject(e) ? _.keys(e) : e ));
        });
    };

    var balanceMapper = function(data){
        return {
            'EUR' : parseFloat(data.result.ZEUR || 0),
            'USD' : parseFloat(data.result.ZUSD || 0),
            'BTC' : parseFloat(data.result.XXBT || 0),
        };
    };

    this.getBalance = function(){
        return self.client.promiseApi('Balance', null).then(function(data){
            data = balanceMapper(data);
            self.balance = data;
            return data;
        });
    }

    this.getBalance().then(function(){
        console.log('KRAKEN balance: ', self.balance);
        initDeferred.resolve();

        // var options = {
        //     currency : 'EUR',
        //     buySell : 'sell',
        //     price : 999,
        //     volume : 0.01
        // };

        // var orderOptions = {
        //     pair : 'XXBTZ'+options.currency,
        //     type : options.buySell,
        //     ordertype : options.ordertype || 'limit',
        //     price : options.price,
        //     volume : options.volume + "",
        //     validate : true // TODO: Remove this line for badassness!
        // };

        // self.trade(options).then(function(response){
        //     console.log('trade closed!', response);
        // }).error(function(response){
        //     console.log('trade failed somehow', response);
        // }).catch(console.error);


        // self.cancel('OFEY5V-ZQNTT-MEAKUE').then(console.log);



    });

}