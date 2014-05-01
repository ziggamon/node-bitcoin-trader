var _ = require('lodash');
var Promise = require('bluebird');
var Client = require('bitstamp');    

module.exports = function(conf, trader){
    _.extend(this, conf);
    var self = this;

    var initDeferred = Promise.defer();
    this.initialized = initDeferred.promise;

    this.client = new Client(this.key, this.secret, this.customer_id);

    // var commands = ['transactions', 'ticker', 'order_book', 'bitinstant', 'eur_usd',
    //                 'balance', 'user_transactions', 'open_orders', 'cancel_order', 'buy',
    //                 'sell', 'withdrawal_requests', 'bitcoin_withdrawal', 'bitcoin_deposit_address',
    //                 'unconfirmed_btc', 'ripple_withdrawal', 'ripple_address'
    // ];

    var commands = ['transactions', 'ticker', 'order_book', 'bitinstant', 'eur_usd',
                    'balance', 'user_transactions', 'open_orders', 'cancel_order', 'buy',
                    'sell'];


    commands.forEach(function(command){
        self.client[command] = Promise.promisify(self.client[command]);
    })

    this.getSpread = function(currency){ // only USD ATM.
        return self.client.order_book('btcusd').then(function(data){
            _.extend(data, {exchange: 'bitstamp', currency: currency});
            trader.emit('spread_data', data);
            return data;
        });

    };

    function balanceMapper(data){
        return {
            'BTC' : parseFloat(data.btc_available),
            'USD' : parseFloat(data.usd_available)
        };
    }
    this.watch = function(currency, eventEmitter){
        var Pusher = require('pusher-client');
        var socket = new Pusher('de504dc5763aeef9ff52');
        var channel = socket.subscribe('order_book');
        channel.bind('data', function(data) {
            _.extend(data, {exchange: 'bitstamp', currency: 'USD'});
            eventEmitter.emit('spread_data', data);
            // storeAndProcessData(data, 'bitstamp');
            // console.log('bitstamp_data');
            // detectArbitrageForExchange('bitstamp');
        });
    }
    this.getBalance = function(){
        return self.client.balance().then(function(data) {
            if(data.error){
                console.log('error in bitstamp balance; ', data.error);
                throw new Error('Bitstamp balance error', data.error);                
            }
            self.fee = data.fee / 100 || self.fee;
            self.balance = balanceMapper(data);
            if(_.isNaN(self.balance.USD) || _.isNaN(self.balance.BTC)){
                console.log('error in bitstamp balance; ', data);
                throw new Error('Data received for Bitstamp balance is NaN');
            }
            return data;
        });
    }
    this.getBalance().then(function(){
        initDeferred.resolve();
    }).catch(Error, function(e){
        console.log('bitstamp .catch Error()')
        initDeferred.reject(e);
    }).error(function(e){
        console.log('bitstamp .error()');
        initDeferred.reject(e);
    });

}
