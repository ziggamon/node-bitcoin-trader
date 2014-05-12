
var _  = require('lodash');
var jf = require('jsonfile');
var fx = require('money');

var fs = require('fs');

var Promise = require('bluebird');
var request = Promise.promisify(require('request'));
var config = require('./config.js');

var baseCurrency = 'USD';

function getRates(){
	return request('http://openexchangerates.org/api/latest.json?app_id=' + config.rates.app_id, {json:true}).spread(function(request, data){
		console.log('got new currency rates!');
		_.extend(fx, data);
	});
}
setInterval(getRates, 30*60*1000);

// for the init procedures, get rates right away!
var ratesPromise = getRates();


var trader = require('./trader.js');


function getFee(param){
	if(_.isNumber(param)){
		return param;
	}
	if(_.isString(param)){
		return trader.exchanges[param].fee;
	}
	if(_.isObject(param) && param.exchange){
		return trader.exchanges[param.exchange].fee;
	}
	throw new Error('Unknown param to getFee: ', param);
}

function getGtfo(param, buySell){
	buySell = buySell || param.buySell;
	if( ! buySell ){ throw new Error('no buySell in getGtfo'); }

	var raw; 

	if(_.isNumber(param)){
		raw = param;
	}
	else if(_.isString(param)){
		raw = trader.exchanges[param].arbitrageCutoff[buySell];
	}
	else if(_.isObject(param) && param.exchange){
		raw = trader.exchanges[param.exchange].arbitrageCutoff[buySell];
	} else {
		throw new Error('Unknown param to getFee: ', param);	
	}
	return (raw / 100) + 1;
}

/*
    Two functions to take into account fees.
*/
function buying_cost(amount, feeParam){
    return amount * (1 + getFee(feeParam));
}
function selling_rev(amount, feeParam){
    return amount * (1 - getFee(feeParam));   
}

var combinedSpreads = {
	bids : [],
	asks : []
};

var bestBid, bestAsk;

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

var currentCurrency, currentExchange, currentFee, currencyMultiplier, feeMultiplier, deFactoMultiplier, currentBuySell, currentGtfo;

var lastReceivedExchange;

function objectifySpreadItem(item){
	return {
		price : parseFloat(item[0]),
		amount : parseFloat(item[1]),
		exchange : currentExchange,
		currency : currentCurrency,
		buySell : currentBuySell,
		gtfo : currentGtfo,
		equivPrice :  parseFloat(item[0] * currencyMultiplier), 
		deFactoPrice : parseFloat(item[0] * deFactoMultiplier)
	};
}

/*
	Maintains a sorted of best trades available in the system
*/
function addToEquivIndex(spread){
	lastReceivedExchange = spread.exchange;
	// console.log('updated spread data 	', spread.exchange); // commenting out

	// clear out previous data for this exchange/currency combo, we'll add new ones now!
	_.remove(combinedSpreads.asks, {exchange:spread.exchange, currency: spread.currency});
	_.remove(combinedSpreads.bids, {exchange:spread.exchange, currency: spread.currency});


	// weird workaround, should probably just pass it in as an object...
	currentCurrency = spread.currency;
	currentExchange = spread.exchange;

	currencyMultiplier = fx(1).from(currentCurrency).to(baseCurrency)

	// for buying
	feeMultiplier = buying_cost(1, spread);
	deFactoMultiplier = feeMultiplier * currencyMultiplier;
	currentBuySell = 'buy';
	currentGtfo = getGtfo(currentExchange, currentBuySell);

	combinedSpreads.asks = _.first(merge(equivComparatorAsc, combinedSpreads.asks, _.map(spread.asks, objectifySpreadItem)), 20);

	// for selling
	feeMultiplier = selling_rev(1, spread);
	deFactoMultiplier = feeMultiplier * currencyMultiplier;
	currentBuySell = 'sell';
	currentGtfo = getGtfo(currentExchange, currentBuySell);
	combinedSpreads.bids = _.first(merge(equivComparatorDesc, combinedSpreads.bids, _.map(spread.bids, objectifySpreadItem)), 20);



	if( !_.isEqual(bestAsk, combinedSpreads.asks[0]) ){
		console.log('new best Ask!', spread.exchange);
		bestAsk = _.cloneDeep(combinedSpreads.asks[0]);
		trader.emit('updated_best_trade');
	} else if( !_.isEqual(bestBid, combinedSpreads.bids[0]) ){
		console.log('new best Bid!', spread.exchange);
		bestBid = _.cloneDeep(combinedSpreads.bids[0]);
		trader.emit('updated_best_trade');
	}

	// console.log('merged asks: ', combinedSpreads.asks);
	// console.log('merged bids: ', combinedSpreads.bids);
}

var balances;

function initBalances(){
	// leaving this
	if(balances){
		return;
	}
	balances = getBalances();
}
function getBalances(){
	var balances = {};
	_.each(trader.exchanges, function(exchange, name){
		balances[name] = _.cloneDeep(exchange.balance);
	});
	return balances;
}

// much spaghetti in here... :/
function affordedTradeAmount(buySell, nextTrade, neededAmount){
	// TODO: Pass this into individual exchanges...
	var maxAffordedAmount;
	// TODO: only taking fees in account when buying, not when selling (fees normally charged in fiat). Is that right?
	if(buySell.toLowerCase() === 'buy'){
		maxAffordedAmount = balances[nextTrade.exchange][nextTrade.currency] / buying_cost(nextTrade.price,nextTrade);
	} else { // sell
		maxAffordedAmount = balances[nextTrade.exchange]['BTC'];
	}

	if(_.isNaN(maxAffordedAmount) || typeof maxAffordedAmount == 'undefined'){
		throw "Something went wrong with calculating maxAffordedAmount" + JSON.stringify(nextTrade);
	}

	if(maxAffordedAmount < 0.01){
		return 0;
	}

	var comparedAmounts = [maxAffordedAmount, nextTrade.amount];
	if(neededAmount){ // sometimes I just want to get whatever
		comparedAmounts.push(neededAmount);
	}
	return _.min(comparedAmounts);
}

function theoreticalTradeAmount(nextTrade, neededAmount){
	return _.min([nextTrade.amount, neededAmount]);
}

/*
	Gives you the best trades to buy or sell neededAmount or BTC. 
	Either practically (takes into account balances) or theoretically.
*/
function bestTrade(buySell, neededAmount, theoretical){
	var availableTrades = _.cloneDeep( (buySell.toLowerCase() === 'buy') ? combinedSpreads.asks : combinedSpreads.bids );
	var tradeAmount, nextTrade;
	var outputTrades = [], possibleAmounts = [];
	initBalances();

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
    Either simulates or trades on two exchanges if arbitrage possibilities
    arise. This is where things like fees and balances are taken into account.
*/
function spitArbitrage(theoretical){
	var arbitrades = [];
    var asks = _.cloneDeep(combinedSpreads.asks);
    var bids = _.cloneDeep(combinedSpreads.bids);
	balances = getBalances();

    var lowAsk = asks.shift();
    var highBid = bids.shift();

    var buyingAffordance, sellingAffordance, tradeAmount;

    console.log((new Date()).toISOString() + ' best prices: 	buy ', 
    	lowAsk.exchange, lowAsk.price.toFixed(2), lowAsk.deFactoPrice.toFixed(2), lowAsk.amount.toFixed(3), '	sell ', highBid.exchange, highBid.price.toFixed(2), highBid.deFactoPrice.toFixed(2), highBid.amount.toFixed(3));

    while ( lowAsk && highBid && lowAsk.deFactoPrice < highBid.deFactoPrice ){

    	// cutoff for gtfo
    	gtfo = _.max([lowAsk.gtfo, highBid.gtfo]);
		if(lowAsk.deFactoPrice * gtfo >= highBid.deFactoPrice){
			console.log('not doing trade because of cutoff point, ', gtfo);
			// within gtfo, shift one of the two
			if( gtfo == lowAsk.gtfo ){
				lowAsk = asks.shift();
			} else {
				highBid = bids.shift();
			}
			continue;
		}

    	if( theoretical ) {
    		buyingAffordance = lowAsk.amount;
    		sellingAffordance = highBid.amount;
    	} else {
	    	// getting a realistic buy and sell
	    	buyingAffordance = affordedTradeAmount('buy', lowAsk);
	    	sellingAffordance = affordedTradeAmount('sell', highBid);

    	}
    	if( buyingAffordance <= 0 ){
    		lowAsk = asks.shift();
    		continue;
    	}
    	if( sellingAffordance <= 0 ){
    		highBid = bids.shift();
    		continue;
    	}
    	// we're in magic land now, buy and sell can happen and they're more than gtfo apart! Yey!

    	// this needs to deal with affordances better!!
    	tradeAmount = _.min([buyingAffordance, sellingAffordance]);

		arbitrades.push(_.extend(_.cloneDeep(highBid), {amount: tradeAmount}));
		highBid.amount -= tradeAmount;

		arbitrades.push(_.extend(_.cloneDeep(lowAsk), {amount: tradeAmount}));
		lowAsk.amount -= tradeAmount;

		balances[lowAsk.exchange][lowAsk.currency] -= ( tradeAmount * buying_cost(lowAsk.price,lowAsk) );
		balances[highBid.exchange]['BTC'] -= tradeAmount;

    }
    return arbitrades;
}

/*
	Compress arbitrades so multiple on same exchange with same price get combined.
*/
function combineArbitrades(arbitrades){
	console.log('precombines arbitrades: ', arbitrades);
	var processedArbitrades = [], combinations = [];

	// first, find the item that came from the lastReceivedExchange. 
	var item = _.find(arbitrades, {exchange : lastReceivedExchange});
	if(!item){
		throw new Error('Shouldnt happen; Couldnt find an item from the last received exchange: ', lastReceivedExchange);
	}
	_.remove(arbitrades,item);

	// do this until break
	do{
		// filters out each trade that has the exact same buySell, deFactoPrice, exchange and currency.
		combinations = _.remove( arbitrades, _.pick(item, ['buySell', 'deFactoPrice', 'exchange', 'currency']));
		_.each(combinations, function(comboItem){
			item.amount += comboItem.amount;
		});
		processedArbitrades.push(item);

		// stop if we're empty
		if(arbitrades.length == 0){ break;}

	} while(item = arbitrades.shift());
    return processedArbitrades;
}

var tradingInProgress = false;

function performArbitrageTrades(trades){
	_.each(trades, function(trade){
		trade.timeout = 5000;
	});

	var firstCriticalTrade = trades.shift();

	trader.trade(firstCriticalTrade).then(function(){
		console.log('did first trade, now doing rest');
		return Promise.map(trades, trader.trade); // do the other trades
	}).then(function(){
		console.log('trades done!');
		return trader.getBalances();
	}).catch(function(e){
		// catchall, something went wrong.
		console.log('trades aborted, ', e);
	}).finally(function(){
		tradingInProgress = false;
        console.log('Stopped trading, setting tradingInProgress to false');
	});
}

trader.init().then(function () {
	trader.on('updated_spread_data', addToEquivIndex);

	trader.on('updated_best_trade', function(){
		if(tradingInProgress){
			console.log('trading in progress, so not doing arbitrage');
			return;
		}
		// console.log('buy: ', bestTrade('buy', 1));
		// console.log('sell: ', bestTrade('sell', 1));

		var possibleArbitrages = spitArbitrage(false);
		if(possibleArbitrages.length > 0){
			var combined = combineArbitrades(possibleArbitrages);
			tradingInProgress = true;
			performArbitrageTrades(combined);



/*
			var buys = _.remove(combined, {buySell:'buy'})
			var totalBuys = _.reduce(buys, function(sum, item){
				return sum + (item.deFactoPrice * item.amount)
			}, 0);

			var totalSells = _.reduce(combined, function(sum, item){
				return sum + (item.deFactoPrice * item.amount)
			}, 0);

			console.log('Buy for ', totalBuys.toFixed(2), ' sell for ', totalSells.toFixed(2), ' profit: ', (totalSells-totalBuys).toFixed(2), ' percent: ', (100*(totalSells-totalBuys) / totalSells).toFixed(2), '%');
			fs.appendFile('./log.txt', (new Date()).toTimeString() + ' Buy @ ' + buys[0].exchange + ' for ' + totalBuys.toFixed(2) + ' sell @ ' + combined[0].exchange +  ' for ' + totalSells.toFixed(2) + ' profit: ' + (totalSells-totalBuys).toFixed(2) + ' percent: ' + (100*(totalSells-totalBuys) / totalSells).toFixed(2) + '% \n');
*/
		}

	});

	ratesPromise.then(function(){
	    trader.watch('EUR');
	    trader.watch('USD');
	});
});
