// var Promise = require('Promise');
// var request = require('request');
var _  = require('lodash');
var jf = require('jsonfile');
var fx = require('money');
_.extend(fx, jf.readFileSync('rates.json'));

var trader = require('./trader.js');


trader.init().then(function () {
    console.log('inited trader!');

    trader.watch('USD');
    // trader.getBestBuy('EUR');
    // trader.getBestBuy('USD');
    // trader.getArbitragePossibilities('USD'); 
    // trader.getArbitragePossibilities('EUR');
});
