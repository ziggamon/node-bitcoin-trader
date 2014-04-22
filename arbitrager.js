
var _  = require('lodash');
var jf = require('jsonfile');
var fx = require('money');

var Promise = require('bluebird');
var request = Promise.promisify(require('request'));
var config = require('./config.js');




var baseCurrency = 'USD';

var ratesPromise = request('http://openexchangerates.org/api/latest.json?app_id=' + config.rates.app_id, {json:true}).spread(function(request, data){
	_.extend(fx, data);
	// console.log('testväxlar: ', fx.convert(1000, {from : "USD", to: "EUR"}));

	// console.log('got data: ', data);
});


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

//    console.log(from.exchange, from.currency, to.exchange, to.currency);
    // console.log(from, to);
    // buying in from market, selling in to-market
    // console.log(from.exchange, 'asks: ', from.asks.length, to.exchange, 'bids: ', to.bids.length, 'to fee', to.fee, 'from fee', from.fee);
    var lowest_ask = fx.convert(from.asks[0][0], {
    	from: from.currency,
    	to : baseCurrency
    });
    var highest_bid = fx.convert(to.bids[0][0], {
    	from : to.currency,
    	to: baseCurrency
    });

    return(selling_rev(highest_bid, to.fee) > buying_cost(lowest_ask, from.fee) * 1); // add 1% requirement margin
}

/*
    Compares a given spread data for an exchange with all other exchanges spread data
    stored, returns array of which spreads an arbitrage oportunity exists between. 
*/
function detectCrossCurrencyArbitrageForSpread(spread){
    // var arbitragePossibilities = [];
    var spreadPairs = [];

	var allSpreads = [];

	_.forOwn(trader.RawSpreads, function(currencyIndex) { 
		_.forOwn(currencyIndex, function(oneSpread){
			allSpreads.push(oneSpread);
		});
	});


    allSpreads.forEach(function(otherExchange){
    	if(_.isEqual(spread, otherExchange)){return;} // don't compare with self.

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

var combinedSpreads = {
	bids : [],
	asks : []
};

/**
* The merge part of the merge sort algorithm.
*
* @param {function} comparatorFn The comparator function.
* @param {array} arr1 The first sorted array.
* @param {array} arr2 The second sorted array.
* @returns {array} The merged and sorted array.
*/
function merge(comparatorFn, arr1, arr2) {
var result = [], left1 = arr1.length, left2 = arr2.length;
while (left1 > 0 && left2 > 0) {
  if (comparatorFn(arr1[0], arr2[0]) <= 0) {
    result.push(arr1.shift());
    left1--;
  } else {
    result.push(arr2.shift());
    left2--;
  }
}
if (left1 > 0) {
  result.push.apply(result, arr1);
} else {
  result.push.apply(result, arr2);
}
return result;
}
function equivComparatorAsc(a, b){
	return (a.deFactoPrice - b.deFactoPrice);
}
function equivComparatorDesc(a, b){
	return (b.deFactoPrice - a.deFactoPrice);
}

var currentCurrency, currentExchange, currentFee, currencyMultiplier, feeMultiplier, deFactoMultiplier;
function objectifySpreadItem(item){
	return {
		price : item[0],
		amount : item[1],
		exchange : currentExchange,
		currency : currentCurrency, 
		equivPrice :  (item[0] * currencyMultiplier).toFixed(1), 
		deFactoPrice : (item[0] * deFactoMultiplier).toFixed(1)
	};
}
function addToEquivIndex(spread){
	console.log('updated spread data 	', spread.exchange);

	// clear out previous data for this exchange/currency combo, we'll add new ones now!
	_.remove(combinedSpreads.asks, {exchange:spread.exchange, currency: spread.currency});
	_.remove(combinedSpreads.bids, {exchange:spread.exchange, currency: spread.currency});


	// weird workaround, should probably just pass it in as an object...
	currentCurrency = spread.currency;
	currentExchange = spread.exchange;
	currentFee = spread.fee;
	currencyMultiplier = fx(1).from(currentCurrency).to(baseCurrency)

	// for buying
	feeMultiplier = buying_cost(1, currentFee);
	deFactoMultiplier = feeMultiplier * currencyMultiplier;

	combinedSpreads.asks = _.first(merge(equivComparatorAsc, combinedSpreads.asks, _.map(spread.asks, objectifySpreadItem)), 20);

	// for selling
	feeMultiplier = selling_rev(1, currentFee);
	deFactoMultiplier = feeMultiplier * currencyMultiplier;
	combinedSpreads.bids = _.first(merge(equivComparatorDesc, combinedSpreads.bids, _.map(spread.bids, objectifySpreadItem)), 20);

	// console.log('merged asks: ', combinedSpreads.asks);
	// console.log('merged bids: ', combinedSpreads.bids);
}

var balances;

function initBalances(){
	// leaving this
	if(balances){
		return;
	}
	balances = {};

	_.each(trader.exchanges, function(exchange, name){
		balances[name] = _.cloneDeep(exchange.balance);
	});
}

// much spaghetti in here... :/
function affordedTradeAmount(buySell, nextTrade, neededAmount){
	initBalances();

	var maxAffordedAmount;
	// TODO: only taking fees in account when buying, not when selling (fees normally charged in fiat). Is that right?
	if(buySell.toLowerCase() === 'buy'){
		var fee = trader.exchanges[nextTrade.exchange].fee;
		maxAffordedAmount = balances[nextTrade.exchange][nextTrade.currency] / buying_cost(nextTrade.price,fee);
	} else { // sell
		maxAffordedAmount = balances[nextTrade.exchange]['BTC'];
	}

	if(_.isNaN(maxAffordedAmount)){
		throw "Something went wrong with calculating maxAffordedAmount" + JSON.stringify(nextTrade);
	}

	
	var comparedAmounts = [maxAffordedAmount, nextTrade.amount];
	if(neededAmount){ // sometimes I just want to get whatever
		comparedAmounts.push(neededAmount);
	}

	// this is what will be returned
	var actualTradeAmount = _.min(comparedAmounts);

	if(actualTradeAmount == 0) {
		return 0;
	}

	// update balances object.
	if(buySell.toLowerCase() === 'buy'){
		balances[nextTrade.exchange][nextTrade.currency] -= actualTradeAmount * buying_cost(nextTrade.price,fee);
	} else {
		balances[nextTrade.exchange]['BTC'] -= actualTradeAmount;
	}

	return actualTradeAmount;
}

function theoreticalTradeAmount(nextTrade, neededAmount){
	return _.min([nextTrade.amount, neededAmount]);
}


function bestTrade(buySell, neededAmount, theoretical){
	var availableTrades = _.cloneDeep( (buySell.toLowerCase() === 'buy') ? combinedSpreads.asks : combinedSpreads.bids );
	var tradeAmount, nextTrade;
	var outputTrades = [], possibleAmounts = [];
	while(neededAmount > 0 && (nextTrade = availableTrades.shift())){
		// figure out how much I can trade
		tradeAmount = theoretical ? theoreticalTradeAmount(nextTrade, neededAmount) : affordedTradeAmount(buySell, nextTrade, neededAmount);

		if(tradeAmount === 0){ // this trade can't be done, prolly broke on exchange
			console.log('cannot afford to make trade on ', nextTrade.exchange)
			continue;
		}

		neededAmount -= tradeAmount;
		nextTrade.amount = tradeAmount;
		outputTrades.push(nextTrade);
	}
	return outputTrades;
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
function spitArbitrage(gtfo, theoretical){
	var arbitrades = [];
    var asks = _.cloneDeep(combinedSpreads.asks);
    var bids = _.cloneDeep(combinedSpreads.bids);

    var lowAsk = asks.shift();
    var highBid = bids.shift();

    gtfo = gtfo || 1;

    var buyingAffordance, sellingAffordance, tradeAmount;

    console.log('best prices: 	buy ', 
    	lowAsk.exchange, lowAsk.price, parseFloat(lowAsk.deFactoPrice).toFixed(2), lowAsk.amount, '	sell ', highBid.exchange, highBid.price, parseFloat(highBid.deFactoPrice).toFixed(2), highBid.amount);

    while ( lowAsk && highBid && lowAsk.deFactoPrice * gtfo < highBid.deFactoPrice ){
    	if( theoretical ) {
    		buyingAffordance = lowAsk.amount;
    		sellingAffordance = highBid.amount;
    	} else {
	    	// getting a realistic buy and sell
	    	buyingAffordance = affordedTradeAmount('buy', lowAsk);
	    	if( buyingAffordance == 0 ){
	    		lowAsk = asks.shift();
	    		continue;
	    	}
	    	sellingAffordance = affordedTradeAmount('sell', highBid);
	    	if( sellingAffordance == 0 ){
	    		highBid = bids.shift();
	    		continue;
	    	}
    	}
		lowAsk.buySell = 'buy';
		highBid.buySell = 'sell';

    	// we're in magic land now, buy and sell can happen and they're more than gtfo apart! Yey!
    	tradeAmount = _.min([buyingAffordance, sellingAffordance]);

    	console.log('searching for infinity: ', tradeAmount, buyingAffordance, sellingAffordance);

    	if(tradeAmount === buyingAffordance){
    		arbitrades.push(lowAsk);
    		highBid.amount -= tradeAmount;
    		arbitrades.push(highBid);
    		lowAsk = asks.shift();
    	} else {
    		arbitrades.push(highBid);
    		lowAsk.amount -= tradeAmount;
    		arbitrades.push(lowAsk);
    		highBid = bids.shift();
    	}
    }
    return arbitrades;
}

function combineArbitrades(arbitrades){
	// compress arbitrades so multiple on same exchange with same price get combined.
	var processedArbitrades = [], combinations = [];

	while(arbitrades.length > 0){
		item = arbitrades.shift();
		combinations = arbitrades.remove(_.pick(item, ['buySell', 'deFactoPrice', 'exchange', 'currency']));
		_.each(combinations, function(comboItem){
			item.amount += comboItem.amount;
		});
		processedArbitrades.push(item);
	}
    return processedArbitrades;
}

function processArbitrage(from, to){
    if(Array.isArray(from)){ // handle pairform as well
        to = from[1];
        from = from[0];
    }

    console.log('processing arbitrage', from.exchange, from.currency, to.exchange, to.currency);

    var asks = _.cloneDeep(from.asks);
    var bids = _.cloneDeep(to.bids);

    var lowest_ask = asks.shift();
    var highest_bid = bids.shift();

    console.log('THEORETICAL best trade: ', fx(lowest_ask[0]).from(from.currency).to(baseCurrency), fx(highest_bid[0]).from(to.currency).to(baseCurrency));

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
	trader.on('updated_spread_data', function(spread){
		addToEquivIndex(spread);
		var possibleArbitrages = spitArbitrage(1, true);
		if(possibleArbitrages.length > 0){
			console.log('possible arbitrage: ', possibleArbitrages);
		}
	});

	ratesPromise.then(function(){
	    trader.watch('EUR');
	    trader.watch('USD');

	 //    console.log('inited trader!');
	 //    // console.log();

		// Promise.all(_.map(_.keys(trader.RawSpreads), trader.getAllSpreads, trader)).then(function(){
		// 	console.log('got all spreads')

		// 	console.log(bestTrade('sell', 20));

		// });

	});
});
