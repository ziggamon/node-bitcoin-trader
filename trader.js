var Promise = require('bluebird');
var _  = require('lodash');
// var jf = require('jsonfile'); // shoud be gone
// var fx = require('money'); // should be gone

// _.extend(fx, jf.readFileSync('rates.json'));

var fs = require('fs');

var EventEmitter = require("events").EventEmitter;
var trader = new EventEmitter();

var RawSpreads = {
    'EUR' : [],
    'USD' : []
};
trader.RawSpreads = RawSpreads; // export this.

//var FeeAdjustedSpreads = {};

/*
    Gets spread for a given exchange and then stores it.
*/
trader.getSpread = function(exchangeName, currency){
    var self = this;
    return this.exchanges[exchangeName].getSpread(currency).then(function(data){
        return storeSpread(data, exchangeName)        
    }).catch(function(e){
        console.error('Error in getSpread', exchangeName, currency, e);
    });
}

/*
    Stores spread data.
*/
function storeSpread(data, exchange){
    data.exchange = exchange;


    // store data globally
    RawSpreads[exchange] = data;

    // var adjustedData = adjust_to_fee(data, trader.exchanges[exchange].fee);
    // FeeAdjustedSpreads[exchange] = adjustedData;

    return data;
}

/*
    Load all enabled exchanges
*/
trader.init = function(conf){
    conf = conf || require('./config.js');

    var self = this;
    self.exchanges = {};
    _.forOwn(conf.exchanges, function(exchangeConfig, exchangeName){
        if(!exchangeConfig.enabled){
            return;
        }

        var Lib = require('./' + exchangeName + '.js');
        self.exchanges[exchangeName] = new Lib(exchangeConfig, self);
        self.exchanges[exchangeName].watch = self.exchanges[exchangeName].watch || generalWatchFunction;
    });

    return Promise.all(_.pluck(self.exchanges, 'initialized'));
}

/*
Gets all spreads for given currency, or default 'EUR'
*/
trader.getAllSpreads = function(currency){
    var self = this;
    currency = currency || 'EUR';

    var promises = [];

    _.forOwn(this.exchanges, function(exchange, exchangeName){
        if(_.contains(exchange.currencies, currency)){
            promises.push(self.getSpread(exchangeName, currency));
        }
    });

    return Promise.all(promises);
}

/*
    Default watch function to be used in exchange classes,
    Basically keeps polling for spreads every second,
    and emits 'spread_data' on trader when something new is received.
*/
function generalWatchFunction(currency, eventEmitter){
    var self = this;
    var rate = this.pollingRate || 1000;
    setInterval(function(){
        self.getSpread(currency);
    }, rate);
}

/*
    Return highest bid, lowest ask, spread in currency units, and percentage of the spread
*/
trader.extractBuySell = function(spread){
    return {
        ask : spread.asks[0][0],
        bid : spread.bids[0][0],
        spread: (spread.asks[0][0] - spread.bids[0][0]).toFixed(2),
        percent : ((spread.asks[0][0] - spread.bids[0][0]) * 100 / spread.asks[0][0] ).toFixed(2)
    };
}

function logifyTrade(tradeOptions){
    tradeOptions.datetime = (new Date()).toString();
    return _.template('${ datetime }: ${ buySell } @ ${ exchange }, ${ volume } at ${ price } \n', tradeOptions);
}

/*
    Wrapper command to send trades.
*/
trader.trade = function(options){
    options.volume = options.volume || options.amount; // handle both types of indata, both volume and amount    
    fs.appendFile('./opened_trades.txt', logifyTrade(options));
    return trader.exchanges[options.exchange].trade(options).then(function(){
        console.log('trade closed! ', logifyTrade(options))
        fs.appendFile('./closed_trades.txt', logifyTrade(options));
    }).error(function(error){
        console.log('trade aborted: ', error);
        fs.appendFile('./closed_trades.txt', '-- ' +error + " " + logifyTrade(options));
    }).catch(function(error){
        console.log('error in trade: ', error);
        fs.appendFile('./closed_trades.txt', '!! ' +error + " " + logifyTrade(options));
    });
}

/*
    Update all balances
*/

trader.getBalances = function(){
    return Promise.map(_.values(trader.exchanges), function(exchange){
        return exchange.getBalance();
    });
}

/*
    Poll or otherwise listen to updated market spread data for all exchanges
    that deal in selected currency. 
*/
trader.watch = function(currency){
    var self = this;
    var exchangesToWatch = [];
    _.forOwn(this.exchanges, function(exchange, exchangeName){
        if(_.contains(exchange.currencies, currency)){
            exchangesToWatch.push(exchange);
        }
    });

    // start them up a bit asynchronously
    var avgWaitingTime = Math.round(1000 / exchangesToWatch.length);
    for (var i = exchangesToWatch.length - 1; i >= 0; i--) {
        exchangesToWatch[i].watch(currency, self);
    };
};

/*
    When trader receives a new spread data for a given exchange
*/

function checkForSpreadUpdates(spread){
    // console.log('trader got spread data for', spread.exchange);
    spread.fee = trader.exchanges[spread.exchange].fee;
    if(_.isEqual(spread, RawSpreads[spread.currency][spread.exchange])){
        // console.log('SPREADS ARE EQUAL!!');
        return;
    }
    // console.log('different spreads. old: ', RawSpreads[spread.currency][spread.exchange], 'new: ', spread);
    RawSpreads[spread.currency][spread.exchange] = spread;
    trader.emit('updated_spread_data', spread);
}

trader.on('spread_data', checkForSpreadUpdates);


// EVERYTHING BELOW THIS LINE IS DEPRECATED

/*
from array of [a, b, c] 
returns array of arrays 
[ 
    [a,b], 
    [a,c], 
    [b,c] 
]
*/
function getPairs(singles){
    var pairs = [];
    do {
        first = singles.shift();
        for (var i = 0; i < singles.length; i++) {
            pairs.push([first, singles[i]]);
        };
    } while (singles.length > 1);

    return pairs;
}

/*
from array of [a, b, c] 
returns array of arrays 
[ 
    [a,b], 
    [b,a], 
    [a,c] 
    ... etc ... 
]
*/
function getPairsInBothOrders(singles){
    var pairs = [];
    do {
        first = singles.shift();
        for (var i = 0; i < singles.length; i++) {
            pairs.push([first, singles[i]]);
            pairs.push([singles[i], first]);
        };
    } while (singles.length > 1);

    return pairs;
}

/*
    Deprecated in favor of detectArbitrageFor(). 
*/
/*
function detectArbitragePossibilities(spreads){
    var arbitragePossibilities = [];
    var spreadPairs = getPairsInBothOrders(spreads);

    spreadPairs.forEach(function(pair){
        if(arbitrage_possibilities(pair)){
            arbitragePossibilities.push(pair);
        }
    });

    if(arbitragePossibilities.length > 0){
        arbitragePossibilities.forEach(processArbitrage);
    } else {
        console.log('no arbitrage');
    }

    return arbitragePossibilities;
}
*/


/*
  Deprecated. Find all arbitrage possibilities available at this moment.
  Superceded by new structure with events, and to be removed soon.  
*/
/*
trader.getArbitragePossibilities = function(currency){
    currency = currency || 'USD' ;
    trader.getAllSpreads(currency).then(function(results){
        var arbitragePossibilities = detectArbitragePossibilities(results);
    });
}
*/
/*
    Deprecated. 
    Calculate de facto costs of buying / selling in a spread,
    with regard to current fees (as loaded from API or pre-set in config)
*/
/*
function adjust_to_fee(spread, fee){
    var oldAsks = spread.asks;
    var oldBids = spread.bids;
    var newSpread = {};
    newSpread.exchange = spread.exchange;
    newSpread.currency = spread.currency;
    newSpread.asks = [];
    newSpread.bids = [];
    oldAsks.forEach(function(row){
        row[0] = (row[0] * (1+fee)).toFixed(4);
        newSpread.asks.push(row);
    });
    oldBids.forEach(function(row){
        row[0] = (row[0] * (1-fee)).toFixed(4);
        newSpread.bids.push(row);
    });
    return newSpread;
};

*/



module.exports = trader;