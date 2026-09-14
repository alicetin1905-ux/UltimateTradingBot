// Bybit V5 public REST client — the exact same unauthenticated endpoints
// ATLAS / GoldenRatio / CRUCIBLE / BTCLiveBoard already read client-side.
// No API key needed: this bot never places real orders (see README).
'use strict';

const config = require('../config');

async function api(path) {
  const r = await fetch(config.API_BASE + path);
  const d = await r.json();
  if (d.retCode !== 0) throw new Error(`${path} -> ${d.retMsg || 'Bybit API error'}`);
  return d.result;
}

async function getKlines(symbol, interval, limit) {
  const r = await api(`/v5/market/kline?category=linear&symbol=${symbol}&interval=${interval}&limit=${limit}`);
  return r.list
    .map(k => ({ t: +k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] }))
    .sort((a, b) => a.t - b.t);
}

async function getTicker(symbol) {
  const r = await api(`/v5/market/tickers?category=linear&symbol=${symbol}`);
  return r.list[0] || null;
}

async function getOpenInterest(symbol) {
  const r = await api(`/v5/market/open-interest?category=linear&symbol=${symbol}&intervalTime=1h&limit=24`);
  return r.list.slice().reverse();
}

async function getAccountRatio(symbol) {
  const r = await api(`/v5/market/account-ratio?category=linear&symbol=${symbol}&period=1h&limit=1`);
  return r.list[0] || null;
}

async function getOrderbook(symbol) {
  return api(`/v5/market/orderbook?category=linear&symbol=${symbol}&limit=200`);
}

async function getRecentTrades(symbol) {
  const r = await api(`/v5/market/recent-trade?category=linear&symbol=${symbol}&limit=500`);
  return r.list;
}

// Fetches everything analyse() needs for one symbol in one go.
async function loadSymbolData(symbol, mtfTfs, entryTf) {
  const tfSet = Array.from(new Set([...mtfTfs, entryTf, 'D']));
  const klineEntries = await Promise.all(
    tfSet.map(async (tf) => [tf, await getKlines(symbol, tf, 500)])
  );
  const candles = Object.fromEntries(klineEntries);
  const [ticker, oi, ratio, book, tape] = await Promise.all([
    getTicker(symbol).catch(() => null),
    getOpenInterest(symbol).catch(() => []),
    getAccountRatio(symbol).catch(() => null),
    getOrderbook(symbol).catch(() => null),
    getRecentTrades(symbol).catch(() => null),
  ]);
  return { symbol, candles, ticker, oi, ratio, book, tape };
}

module.exports = { api, getKlines, getTicker, getOpenInterest, getAccountRatio, getOrderbook, getRecentTrades, loadSymbolData };
