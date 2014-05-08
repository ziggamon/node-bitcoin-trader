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
        return this.client.promiseApi('CancelOrder', {txid: id});
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

        return this.client.promiseApi('AddOrder', orderOptions).then(function(response){
            var result = response.result;
            console.log('add order sent: ', result);
            return result;
        });
    }

    this.trade = function(options, timeout){
        var tradeResolver = Promise.defer();

        var neededOptions = ['currency', 'buySell', 'price', 'volume'];
        for (var i = neededOptions.length - 1; i >= 0; i--) {
            if(!_.has(options, neededOptions[i])){
                return tradeResolver.throw('Input data error').promise;
            }
        };

        this.tradeCommand(options).then(function(result){
            var ids = result.txid; // this is an array, a bit unclear why, perhaps it can handle multiple orders
            var id = ids[0];
            var i = 0;
            function tradeChecker(){
                if(tradeResolver.promise.isResolved()){ return ; } // quit the loop    
                self.client.promiseApi('QueryOrders', {txid: id}).then(function(response){
                    // console.log(response);
                    var result = response.result[id];
                    if(result.status == 'closed'){ 
                        tradeResolver.resolve(result);
                        return true;
                    } else if(result.status == 'canceled' || result.status == 'expired'){ 
                        tradeResolver.reject(result);
                        return false;
                    }
                    console.log('order ', id, 'is ', result.status, 'iteration', i++);
                    Promise.delay(5000).then(tradeChecker); // keep looping this baby
                });
            }
            Promise.delay(300).then(tradeChecker);

            if(options.timeout && _.isNumber(options.timeout)){
                setTimeout(function(){
                    if( ! tradeResolver.promise.isResolved()) {
                        self.cancel(id).then(function(){
                            tradeResolver.reject('Trade timeout: ' + id);
                        });
                    }
                }, options.timeout);
            }

        });

        return tradeResolver.promise;
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
            console.error('kraken error .catch() ', e);
        }).error(function(e){
            console.error('kraken error .error() ', e);
        }).catch(function(e){
            console.error('kraken general purpose catch()', e);
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