var _ = require('lodash');
module.exports = {
    exchanges : {
        'kraken' : {
            enabled: false,
            fee : 0.2 / 100, // best case: 0.05, worst case: 0.3 (USD), 0.2 (EUR)
            key : '', 
            secret: '',
            currencies : ['BTC', 'EUR', 'USD']
        },
        'bitstamp' : {
            enabled: false,
            fee : 0.5 / 100, // best case: 0.2, worst case: 0.5. Bitstamp fee will auto update
            key : '', 
            secret: '', 
            customer_id: '',
            currencies : ['BTC', 'USD']
        },
        'justcoin' : {
            enabled: false,
            key : '',
            fee : 0.5 / 100, // best case : 0, worst case: 0.5,
            currencies : ['BTC', 'EUR', 'USD']
        },
        'bitfinex' : {
            enabled : false,
            balance : { // still manual at this point.
                'BTC' : 0.0,
                'USD' : 0.0,
            },
            fee : 0.15 / 100, // best case: 0.1
            key:'', 
            secret: '',
            currencies : ['BTC', 'USD']
        }
    },
    rates : {
        app_id : '',
        interval : 3600 * 1000
    }
};
/*
// uncomment to calculate on zero fees
_.merge(module.exports, {
    'kraken' : {
        fee : 0
    },
    'bitstamp' : {
        fee : 0
    },
    'justcoin' : {
        fee : 0
    },
    'bitfinex' : {
        fee : 0
    }
});
*/