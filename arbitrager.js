// var Promise = require('Promise');
// var request = require('request');
var _  = require('lodash');
var jf = require('jsonfile');
var fx = require('money');
_.extend(fx, jf.readFileSync('rates.json'));

var trader = require('./trader.js');


/*
    Two functions to take into account fees.
*/
function buying_cost(amount, fee){
    return amount * (1 + fee);
}
function selling_rev(amount, fee){
    return amount * (1 - fee);   
}

/*
    Filter function that basically returns if two spreads have a profitable
    arbitrage oportunity.   
*/
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

    return(selling_rev(highest_bid, to.fee) > selling_rev(lowest_ask, from.fee) * 1.01); // add 1% requirement margin
}


/*
    Compares a given spread data for an exchange with all other exchanges spread data
    stored, returns array of which spreads an arbitrage oportunity exists between. 
*/
function detectArbitrageFor(spread){
    // var arbitragePossibilities = [];
    var spreadPairs = [];


    var everyOther = _.values(_.omit(trader.RawSpreads[spread.currency], spread.exchange));

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


/*
    Either simulates or trades on two exchanges if arbitrage possibilities
    arise. This is where things like fees and balances are taken into account.
*/
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


trader.init().then(function () {
    console.log('inited trader!');

    trader.watch('EUR');


	/*
	    When trader has received spread data that is different than what was previously stored.
	*/
	trader.on('updated_spread_data', detectArbitrageFor);

    // trader.getBestBuy('EUR');
    // trader.getBestBuy('USD');
    // trader.getArbitragePossibilities('USD'); 
    // trader.getArbitragePossibilities('EUR');
});
