// Binance USDⓈ-M futures public REST client. Exports the same shape
// (getKlines/getTicker/getOpenInterest/getAccountRatio/getOrderbook/
// getRecentTrades/loadSymbolData) that strategy.js/atlasScore.js/fib.js/
// liquidity.js consume, so none of them know or care which exchange the
// data came from. Originally built against Bybit, but Bybit's API blocks
// GitHub Actions' hosted runners (CloudFront geo-block, confirmed against a
// real run's logs) — this is the swap-in.
'use strict';

const BASE = 'https://fapi.binance.com';
const INTERVAL = { '30': '30m', '60': '1h', '240': '4h', 'D': '1d' };

async function api(path) {
  const r = await fetch(BASE + path);
  const d = await r.json();
  // A real klines/depth/etc response is always an array or a plain data
  // object with no "msg" field; an error response (including the region
  // block below) always carries one, regardless of what "code" holds —
  // some of Binance's own block responses use code:0, which `code < 0`
  // alone would miss entirely.
  if (d && typeof d === 'object' && !Array.isArray(d) && typeof d.msg === 'string') {
    throw new Error(`${path} -> ${d.msg}`);
  }
  return d;
}

async function getKlines(symbol, interval, limit) {
  const iv = INTERVAL[interval] || interval;
  const rows = await api(`/fapi/v1/klines?symbol=${symbol}&interval=${iv}&limit=${limit}`);
  // Binance returns oldest-first already: [openTime,open,high,low,close,volume,...]
  return rows.map(k => ({ t: +k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] }));
}

async function getTicker(symbol) {
  const r = await api(`/fapi/v1/premiumIndex?symbol=${symbol}`);
  return { fundingRate: r.lastFundingRate, lastPrice: r.markPrice };
}

async function getOpenInterest(symbol) {
  const rows = await api(`/futures/data/openInterestHist?symbol=${symbol}&period=1h&limit=24`);
  // Already oldest-first, matching what atlasScore.js expects (oi[0] oldest, oi[last] newest).
  return rows.map(r => ({ openInterest: r.sumOpenInterest, timestamp: String(r.timestamp) }));
}

async function getAccountRatio(symbol) {
  const rows = await api(`/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=1h&limit=1`);
  const r = rows[rows.length - 1];
  if (!r) return null;
  return { buyRatio: r.longAccount, sellRatio: r.shortAccount };
}

async function getOrderbook(symbol) {
  const r = await api(`/fapi/v1/depth?symbol=${symbol}&limit=100`);
  return { b: r.bids, a: r.asks };
}

async function getRecentTrades(symbol) {
  const rows = await api(`/fapi/v1/trades?symbol=${symbol}&limit=500`);
  return rows.map(t => ({ S: t.isBuyerMaker ? 'Sell' : 'Buy', v: t.qty }));
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
