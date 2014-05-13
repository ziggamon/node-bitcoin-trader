var _ = require('lodash');
var Promise = require('bluebird');
var request = Promise.promisify(require('request'));

module.exports = function(conf, trader){
    _.extend(this, conf);
    var self = this;

    var initDeferred = Promise.defer();
    this.initialized = initDeferred.promise;

    this.pollingInterval = 500;

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


    self.tradeCommand = function(options){
        var typeMapper = {
            'buy'  : 'bid',
            'sell' : 'ask'
        };
        return self._doRequest('orders', 'POST', {
            market : 'BTC'+options.currency,
            type : typeMapper[options.buySell],
            amount : options.volume.toString(),
            price : options.price.toString()
        });
    };

    self.getOrders = function(){
        return self._doRequest('orders');
    };
    self.getOrderHistory = function(){
        return self._doRequest('orders/history');
    };
    self.cancel = function(id){
        return self._doRequest('orders/'+id, 'DELETE');
    };

    self.idExtractor = function(response){
        if(response.message){
            throw new Error('justcoin trade error: ' + response.message);
        }
        if( ! response.id){
            throw new Error('justcoin unknown trade error: ' + response);
        }

        console.log('justcoin order id: ', response.id);
        this.id = response.id;
        this.retries = 0;
        return response;
    };

    self.tradeChecker = function(){
        console.log('tradecheck justcoin: ', this.id);
        return self.getOrders()
            .bind(this)
            .then(self.responseProcessor)
            .then(self.tradeCheckLooper);
    }

    self.responseProcessor = function(response){
        var myOrder = _.find(response, {id:this.id});

        if( ! myOrder){ // order is not remaining, either complete or rejected
            return self.getOrderHistory().bind(this).then(function(orders){
                var myOrder = _.find(orders, {id:this.id});
                if(!myOrder){// not in history, rejecting
                    throw new Error('order ' + this.id + ' cancelled');
                } else {
                    return {
                        success : true,
                        response: myOrder
                    }
                }
            });
        } else {
            return false;
        }
    };

    
    // these can be generalized, broken out

    self.tradeValidator = function(options){
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

    self.trade = function(options){
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

    this.getBalance = function(){
        return self._doRequest('balances').then(function(data){
            self.balance = balanceMapper(data);
            return self.balance;
        })
    }
    self.getBalance().then(function(data){
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