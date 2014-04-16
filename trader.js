// var Promise = require('Promise');
// var request = require('request');
var Promise = require('bluebird');
var _  = require('lodash');
var jf = require('jsonfile'); // shoud be gone
var fx = require('money'); // should be gone

_.extend(fx, jf.readFileSync('rates.json'));

// console.log(fx(1).from('EUR').to('SEK') + ';');


var EventEmitter = require("events").EventEmitter;
var trader = new EventEmitter();

var RawSpreads = {
    'EUR' : [],
    'USD' : []
};
var FeeAdjustedSpreads = {};

trader.getSpread = function(exchangeName, currency){
    var self = this;
    return this.exchanges[exchangeName].getSpread(currency).then(function(data){
        return storeAndProcessData(data, exchangeName)        
    });
}

function storeAndProcessData(data, exchange){
    data.exchange = exchange;
    var adjustedData = adjust_to_fee(data, trader.exchanges[exchange].fee);

    // store data globally
    RawSpreads[exchange] = data;
    FeeAdjustedSpreads[exchange] = adjustedData;

    return adjustedData
}

trader.init = function(conf){
    conf = conf || require('./config.js');

    var self = this;
    self.exchanges = {};
    _.forOwn(conf, function(exchangeConfig, exchangeName){
        if(!exchangeConfig.enabled){
            return;
        }

        var Lib = require('./' + exchangeName + '.js');
        self.exchanges[exchangeName] = new Lib(exchangeConfig, self);
        self.exchanges[exchangeName].watch = self.exchanges[exchangeName].watch || generalWatchFunction;
    });

    return Promise.all(_.pluck(self.exchanges, 'initialized'));
}


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

function buying_cost(amount, fee){
    return amount * (1 + fee);
}
function selling_rev(amount, fee){
    return amount * (1 - fee);   
}

function arbitrage_possibilities(from, to){
    if(Array.isArray(from)){ // handle pairform as well
        to = from[1];
        from = from[0];
    }

    // console.log(from, to);
    // buying in from market, selling in to-market
    // console.log(from.exchange, 'asks: ', from.asks.length, to.exchange, 'bids: ', to.bids.length, 'to fee', to.fee, 'from fee', from.fee);
    var lowest_ask = from.asks[0][0];
    var highest_bid = to.bids[0][0];

    return(selling_rev(highest_bid, to.fee) > selling_rev(lowest_ask, from.fee) + 1.01); // add 1% requirement margin
}

function detectArbitrageFor(spread){
    // var arbitragePossibilities = [];
    var spreadPairs = [];


    var everyOther = _.values(_.omit(RawSpreads[spread.currency], spread.exchange));

    everyOther.forEach(function(otherExchange){
        spreadPairs.push([spread, otherExchange]);
        spreadPairs.push([otherExchange, spread]);
        console.log('adding pair: ', spread.exchange, otherExchange.exchange, 'fees: ', spread.fee, otherExchange.fee);
    });

    var arbitragePossibilities = _.filter(spreadPairs, arbitrage_possibilities);

    if(arbitragePossibilities.length > 0){
        arbitragePossibilities.forEach(processArbitrage);
    } else {
        console.log('no arbitrage possible on ' + spread.exchange);
    }


    return arbitragePossibilities;

}

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

function processArbitrage(from, to){
    if(Array.isArray(from)){ // handle pairform as well
        to = from[1];
        from = from[0];
    }

    console.log('processing arbitrage', from.exchange, to.exchange);

    var asks = _.cloneDeep(from.asks);
    var bids = _.cloneDeep(to.bids);

    var lowest_ask = asks.shift();
    var highest_bid = bids.shift();

    console.log('THEORETICAL best trade: ', lowest_ask[0], highest_bid[0]);

    var mixed_fees = (1+from.fee)*(1+to.fee);

    var buyingBalance = trader.exchanges[from.exchange].balance[from.currency];
    var sellingAmount = trader.exchanges[to.exchange].balance['BTC'];

    console.log('buying balance: ', buyingBalance, 'selling amount: ', sellingAmount);

    if(buyingBalance < 1){
        console.log('Dont have fiat on ', from.exchange.toUpperCase());
        return false;
    }
    if(sellingAmount < 0.001){
        console.log('Dont have crypto on ', to.exchange.toUpperCase());
        return false;
    }

    var buyingAffordance = buyingBalance / buying_cost(lowest_ask[0], from.fee);

    var amount, profit, margin, buyCost, sellRev;
    var totalAmount = 0, totalProfit = 0, totalCost = 0, totalRevenue = 0, totalMargin = 0;

    while (lowest_ask && highest_bid && lowest_ask[0]*mixed_fees < highest_bid[0]){ // while it's still profitable
        buyCost = buying_cost(lowest_ask[0], from.fee);
        sellRev = selling_rev(highest_bid[0], to.fee);

        amount = Math.min(sellingAmount, buyingAffordance, lowest_ask[1], highest_bid[1]);

        lowest_ask[1]   -= amount;
        highest_bid[1]  -= amount;
        sellingAmount -= amount;
        buyingAffordance  -= amount;

        profit = (amount * (highest_bid[0] - lowest_ask[0])).toFixed(3);
        margin = (((highest_bid[0] / lowest_ask[0]) - 1) * 100).toFixed(2);

        if(amount === 0){
            // console.log(from.asks, to.bids);
            throw 'ZeroAmount, something went wrong!';
        }
        console.log('buy ' + amount + ' @ ' + from.exchange + ' à ' +lowest_ask[0] + ', sell @' + to.exchange + ' à ' + highest_bid[0] + ', profit: ' + profit + ', margin: ' + margin + '%');

        totalCost += (amount * lowest_ask[0]);
        totalRevenue += (amount * highest_bid[0]);


        if(lowest_ask[1] == 0){
            console.log('full buy');
            lowest_ask = asks.shift();
        } 
        if(highest_bid[1] == 0){
            console.log('full sell');
            highest_bid = bids.shift();
        } 
        if(sellingAmount == 0){
            console.log('no more coins to sell');
            break;
        }
        if(buyingAffordance == 0){
            console.log('no more funds to buy');
            break;
        }
    }
    totalProfit = totalRevenue - totalCost;
    totalMargin = (((totalRevenue / totalCost) - 1) * 100).toFixed(2);

    console.log('trade cost : ' + totalCost + ', revenue: ' + totalRevenue + ', profit : ' + totalProfit + ', margin : ' + totalMargin+ '%');

}

function generalWatchFunction(currency, eventEmitter){
    var self = this;
    var rate = this.pollingRate || 1000;
    setInterval(function(){
        self.getSpread(currency);
    }, rate);
}


trader.getArbitragePossibilities = function(currency){
    currency = currency || 'USD' ;
    trader.getAllSpreads(currency).then(function(results){
        var arbitragePossibilities = detectArbitragePossibilities(results);
    });
}


function extractBuySell(spread){
    return {
        ask : spread.asks[0][0],
        bid : spread.bids[0][0],
        spread: (spread.asks[0][0] - spread.bids[0][0]).toFixed(2),
        percent : ((spread.asks[0][0] - spread.bids[0][0]) * 100 / spread.asks[0][0] ).toFixed(2)
    };
}

trader.getBestBuy = function(currency){
    trader.getAllSpreads(currency).then(function(results){
        var outdata = {};
        results.forEach(function(result){
            var buySell = extractBuySell(result);
            buySell.bid = buySell.bid + ' | ' + fx(buySell.bid).from(currency).to('SEK').toFixed(0);
            buySell.ask = buySell.ask + ' | ' + fx(buySell.ask).from(currency).to('SEK').toFixed(0);
            outdata[result.exchange] = buySell;
        });

        console.log(currency, outdata); 

    });
}
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
    
    trader.on('spread_data', function(spread){
        // console.log('trader got spread data for', spread.exchange);
        spread.fee = trader.exchanges[spread.exchange].fee;
        if(_.isEqual(spread, RawSpreads[spread.currency][spread.exchange])){
            // console.log('SPREADS ARE EQUAL!!');
            return;
        }
        // console.log('different spreads. old: ', RawSpreads[spread.currency][spread.exchange], 'new: ', spread);
        RawSpreads[spread.currency][spread.exchange] = spread;
        trader.emit('updated_spread_data', spread);
    });
    trader.on('updated_spread_data', function(spread){
        console.log('spread data is updated for ', spread.exchange.toUpperCase());
        detectArbitrageFor(spread);
    });
};

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





module.exports = trader;