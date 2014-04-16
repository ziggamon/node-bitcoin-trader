node-bitcoin-trader
===================

A rudimentary node package to to poll prices and depths from Bitcoin exchanges, and to do trading, thus making it easy to do arbitrage.

NOTE:
====

This is completely un-tested and work in progress. Consider this non-working at this point. If you use this, it is your own fault. 

Currently supports:
===

Polling:

* Bitfinex
* Bitstamp
* Justcoin
* Kraken

Trading:

* Justcoin
* Kraken

Supports automatically calculating arbitrage oportunities.


TODO: 
 
* Implement arbitrage mechanisms
* Implement more exchanges
* Unit tests

Install
=======

`npm install;`

`cp config.example.js config.js`

Fill in your keys etc into config.js

`node index.js`


THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.