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
    ['orderbook'/*, 'wallet_balances'*/].forEach(function(command){
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
        return self.client.orderbook('btcusd').spread(function(response, body){
            var data = self.spreadAdapter(JSON.parse(body));
            _.extend(data, {exchange: 'bitfinex', currency: currency});
            trader.emit('spread_data', data);
            return data;
        });
    }

    this.getBalance = function(){
        console.log('getting bitfinex balance');

        // keeping this function intact in case I forget how deferreds work ;) / SK. 21 mars
        var deferred = Promise.defer();
        
        self.client.wallet_balances(function(error, result, body) {
            if(error) {
                console.error(error);
                return deferred.reject(error);
            }
            var data = JSON.parse(body);

            self.balance = {
                'USD' : parseFloat(_.find(data, {type: 'exchange', currency :'usd'}).available),
                'BTC' : parseFloat(_.find(data, {type: 'exchange', currency :'btc'}).available)
            };

            deferred.resolve(self.balance);
        });

        return deferred.promise;
    }
    
    this.getBalance().then(function(){
        initDeferred.resolve();    
    });

}
