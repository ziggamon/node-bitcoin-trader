var _ = require('lodash');
var Promise = require('bluebird');
var request = Promise.promisify(require('request'));

module.exports = function(conf, trader){
    _.extend(this, conf);
    var self = this;

    var initDeferred = Promise.defer();
    this.initialized = initDeferred.promise;

    this._url = function(path){
        return 'https://justcoin.com/api/v1/' + path +'?key=' + self.key;
    };
    this._doRequest = function(path, method, options){
        var requestOptions = {
            json : true
        };

        if(method){
            requestOptions.method = method;
        }
        if(options){
            requestOptions.body = options;
        }

        return request(this._url(path), requestOptions).spread(function(request, data){
            return data;
        });
    };


    this.getSpread = function(currency){
        currency = currency || 'EUR';
        return this._doRequest('markets/BTC' + currency + '/depth').then(function(data){
            _.extend(data, {exchange: 'justcoin', currency: currency});
            trader.emit('spread_data', data);
            return data;
        });
    };

    var balanceMapper = function(data){

        var balance = {};
        _.each(self.currencies, function(currency){
            balance[currency] = parseFloat(_.find(data, {currency: currency}).available)
        });

        // hard coding for now a fix so that justcoin balance in BTC _includes_ fees.
        balance['BTC'] *= (1-self.fee);

        return balance;
    };


    this.doTrade = function(options){
        var typeMapper = {
            'buy'  : 'bid',
            'sell' : 'ask'
        };
        return this._doRequest('orders', 'POST', {
            market : 'BTC'+options.currency,
            type : typeMapper[options.buySell],
            amount : options.volume.toString(),
            price : options.price.toString()
        });
    };

    this.getOrders = function(){
        return this._doRequest('orders');
    };
    this.getOrderHistory = function(){
        return this._doRequest('orders/history');
    };
    this.cancel = function(id){
        return this._doRequest('orders/'+id, 'DELETE');
    };

    this.trade = function(options){
        var tradeResolver = Promise.defer();

        var neededOptions = ['currency', 'buySell', 'price', 'volume'];
        for (var i = neededOptions.length - 1; i >= 0; i--) {
            if(!_.has(options, neededOptions[i])){
                return tradeResolver.throw('Input data error').promise;
            }
        };

        this.doTrade(options).then(function(result){
            console.log('justcoin trade sent: ', result);

            if(result.message){
                tradeResolver.reject('justcoin trade error: ' + result.message);
                return false;
            }
            if(!result.id){
                tradeResolver.reject('justcoin unknown trade error: ' + result);
                return false;
            }
            
            var id = result.id;

            var i = 0;
            function tradeChecker(){
                if(tradeResolver.promise.isResolved()){ return ; } // quit the loop    
                self.getOrders().then(function(orders){
                    var myOrder = _.find(orders, {id:id});

                    if(!myOrder){
                        self.getOrderHistory().then(function(orders){
                            var myOrder = _.find(orders, {id:id});
                            if(!myOrder){// not in history, rejecting
                                tradeResolver.reject('order ' + id + ' cancelled');
                            } else {
                                tradeResolver.resolve(myOrder);
                            }
                        });
                        return;
                    }
                    console.log('order ', id, 'is ', myOrder, 'iteration', i++);
                    Promise.delay(500).then(tradeChecker); // keep looping this baby
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
    }

    this.getBalance = function(){
        return this._doRequest('balances').then(function(data){
            self.balance = balanceMapper(data);
            return self.balance;
        })
    }
    this.getBalance().then(function(data){
        console.log('justcoin balance: ', data);
        initDeferred.resolve();
        // id: 2361955
        // var options = {
        //     currency : 'EUR',
        //     buySell : 'sell',
        //     price : 999,
        //     volume : 0.01
        // };
        // self.trade(options).then(console.log).error(console.error).catch(function(a,b){
        //     console.error(a, b);
        // });

        // self.getOrders().then(console.log);
    });

}