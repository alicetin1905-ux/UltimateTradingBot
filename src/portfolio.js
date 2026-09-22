#!/usr/bin/env node
// Pooled-balance paper account — a second, separate account next to the
// per-coin one run.js manages. Same signals (ATLAS score, GoldenRatio
// confluence, CRUCIBLE liquidity refinement, scaled T1/T2/T3 exit), but:
//   - ONE shared balance (config.PORTFOLIO.STARTING_BALANCE) for all coins
//   - risk config.PORTFOLIO.RISK_PCT of that current balance per trade
//   - at most config.PORTFOLIO.MAX_OPEN_POSITIONS open at once; when more
//     coins qualify than there are free slots, the strongest |score| wins
//   - each position's margin is capped at balance / MAX_OPEN_POSITIONS (and
//     at whatever margin is still free) so every slot can always be funded
// State lives in state/portfolio/*.json, fully independent of state/*.json.
//
//   node src/portfolio.js          run once (scheduled by bot.yml)
//   node src/portfolio.js --reset  back to the starting balance, all flat
'use strict';

const fs = require('fs');
const path = require('path');
const config = require('../config');
const marketData = require('./okx');
const atlasScore = require('./atlasScore');
const strategy = require('./strategy');
const { sizeFor } = require('./risk');

const P = config.PORTFOLIO;
const DIR = path.join(__dirname, '..', 'state', 'portfolio');

/* ---------------- persistence ---------------- */

function readJson(name, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(DIR, name + '.json'), 'utf8')); } catch (e) { return fallback; }
}
function writeJson(name, data) {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(path.join(DIR, name + '.json'), JSON.stringify(data, null, 2) + '\n');
}
function freshAccount() {
  return { balance: P.STARTING_BALANCE, startingBalance: P.STARTING_BALANCE, riskPct: P.RISK_PCT, leverage: P.LEVERAGE, maxOpenPositions: P.MAX_OPEN_POSITIONS };
}
function loadState() {
  return {
    account: readJson('account', null) || freshAccount(),
    positions: readJson('positions', {}),
    trades: readJson('trades', []),
    flipEntries: readJson('flipEntries', {}),
    scores: readJson('scores', {}),
  };
}
function saveState(st) {
  // Settings are re-stamped every run so the dashboard always shows the live rules.
  st.account.riskPct = P.RISK_PCT;
  st.account.leverage = P.LEVERAGE;
  st.account.maxOpenPositions = P.MAX_OPEN_POSITIONS;
  st.account.updatedAt = Date.now();
  for (const k of ['account', 'positions', 'trades', 'flipEntries', 'scores']) writeJson(k, st[k]);
}

/* ---------------- one run ---------------- */

// Margin still tied up by open positions (scaled down as targets fill).
function usedMargin(positions) {
  return Object.values(positions).reduce((sum, p) => sum + p.margin * (p.qtyRemaining / p.qtyTotal), 0);
}

// Replays candles closed since the position opened against its stop/targets,
// then applies the signal-flip exit — same rules as strategy.runSymbol step 1.
function manageOpenPosition(symbol, data, analysis, st, events) {
  const openPos = st.positions[symbol];
  const closedSince = data.candles[config.ENTRY_TF].slice(0, -1).filter(c => c.t > openPos.openedAt);
  const outcome = strategy.simulatePositionOutcome(openPos, closedSince);
  const closedAt = closedSince.length ? closedSince[closedSince.length - 1].t : openPos.openedAt;
  for (const ev of outcome.events) {
    events.push(ev);
    st.trades.push({
      symbol, bias: openPos.bias, entry: openPos.entry, exit: ev.price, pnl: ev.pnl,
      reason: ev.reason, openedAt: openPos.openedAt, closedAt, score: openPos.score,
    });
  }
  st.account.balance += outcome.realizedDelta;
  if (outcome.closed) delete st.positions[symbol];
  else st.positions[symbol] = outcome.position;

  const pos = st.positions[symbol];
  if (pos && analysis.bias !== 0 && analysis.bias !== pos.bias) {
    const pnl = (analysis.price - pos.entry) * pos.bias * pos.qtyRemaining;
    st.account.balance += pnl;
    st.trades.push(strategy.closeTradeRecord(pos, analysis.price, pos.qtyRemaining, pnl, 'signal-flip', analysis.closedAt));
    events.push({ symbol, type: 'exit', reason: 'score flipped against open position', pnl, price: analysis.price });
    delete st.positions[symbol];
  }
}

async function run() {
  const st = loadState();
  const events = [];
  const candidates = [];

  // Pass 1: every coin — score it, manage anything open, collect entry candidates.
  for (const symbol of config.SYMBOLS) {
    try {
      const data = await marketData.loadSymbolData(symbol, config.MTF_TFS, config.ENTRY_TF);
      const analysis = atlasScore.analyse({
        symbol, candles: data.candles, ticker: data.ticker, oi: data.oi, ratio: data.ratio,
        book: data.book, tape: data.tape, entryTf: config.ENTRY_TF, mtfTfs: config.MTF_TFS,
        flipStore: st.flipEntries, account: st.account.balance, riskPct: P.RISK_PCT,
        leverage: P.LEVERAGE, scoreThreshold: config.SCORE_THRESHOLD,
      });
      if (!analysis) { events.push({ symbol, type: 'skip', reason: 'not enough candle history yet' }); continue; }
      st.scores[symbol] = { score: analysis.score, bias: analysis.bias, at: Date.now() };

      if (st.positions[symbol]) manageOpenPosition(symbol, data, analysis, st, events);

      if (st.positions[symbol]) continue;
      if (analysis.bias === 0 || !analysis.plan) {
        events.push({ symbol, type: 'flat', reason: analysis.bias === 0 ? 'score inside the stand-aside band' : 'no plan', score: analysis.score });
        continue;
      }
      const check = strategy.entryFilters({ symbol, data, analysis });
      if (!check.ok) { events.push({ symbol, type: 'hold', reason: check.reason, score: analysis.score }); continue; }
      candidates.push({ symbol, data, analysis, fibCheck: check.fibCheck });
    } catch (err) {
      events.push({ symbol, type: 'error', reason: err.message });
    }
  }

  // Pass 2: fill free slots, strongest conviction first, sized off the
  // balance as it stands after this run's exits.
  candidates.sort((a, b) => Math.abs(b.analysis.score) - Math.abs(a.analysis.score));
  for (const c of candidates) {
    const open = Object.keys(st.positions).length;
    if (open >= P.MAX_OPEN_POSITIONS) {
      events.push({ symbol: c.symbol, type: 'hold', reason: `all ${P.MAX_OPEN_POSITIONS} position slots in use`, score: c.analysis.score });
      continue;
    }
    const balance = st.account.balance;
    const freeMargin = balance - usedMargin(st.positions);
    const plan = sizeFor({
      symbol: c.symbol, equity: balance, bias: c.analysis.bias, entry: c.analysis.plan.entry, stop: c.analysis.plan.stop,
      riskPct: P.RISK_PCT, leverage: P.LEVERAGE,
      maxMargin: Math.max(0, Math.min(freeMargin, balance / P.MAX_OPEN_POSITIONS)),
    });
    const opened = strategy.openEntry({ symbol: c.symbol, data: c.data, analysis: c.analysis, plan, fibCheck: c.fibCheck });
    if (!opened.position) { events.push({ symbol: c.symbol, type: 'hold', reason: opened.reason, score: c.analysis.score }); continue; }
    st.positions[c.symbol] = opened.position;
    events.push(opened.event);
  }

  saveState(st);
  printSummary(events, st);
}

function reset() {
  const st = loadState();
  st.account = freshAccount();
  st.positions = {};
  st.flipEntries = {};
  st.scores = {};
  saveState(st); // trade history is kept, same as src/reset.js
  console.log(`Portfolio reset to ${P.STARTING_BALANCE} USDT — all positions closed, no trades recorded.`);
}

/* ---------------- output ---------------- */

function printSummary(events, st) {
  console.log(`\n=== Portfolio (${P.STARTING_BALANCE} USDT pool, ${P.LEVERAGE}x, ${P.RISK_PCT}% risk, max ${P.MAX_OPEN_POSITIONS}) @ ${new Date().toISOString()} ===\n`);
  for (const ev of events) {
    if (ev.type === 'enter') {
      console.log(`[${ev.symbol}] ENTER ${ev.bias === 1 ? 'LONG' : 'SHORT'} @ ${fmt(ev.entry)} | score ${ev.score} | SL ${fmt(ev.stop)} T1 ${fmt(ev.t1)} T2 ${fmt(ev.t2)} T3 ${fmt(ev.t3)} | qty ${ev.qty} margin $${fmt(ev.margin)} risk $${fmt(ev.riskAmt)}`);
    } else if (ev.type === 'partial' || ev.type === 'exit') {
      console.log(`[${ev.symbol}] ${ev.type === 'exit' ? 'EXIT — ' : ''}${ev.reason} | pnl ${money(ev.pnl)}${ev.price ? ' @ ' + fmt(ev.price) : ''}`);
    } else {
      console.log(`[${ev.symbol}] ${ev.type} — ${ev.reason}${ev.score != null ? ` (score ${ev.score})` : ''}`);
    }
  }
  const open = Object.values(st.positions);
  console.log(`\nbalance $${fmt(st.account.balance)} (started $${fmt(st.account.startingBalance)}) · ${open.length}/${P.MAX_OPEN_POSITIONS} open · margin used $${fmt(usedMargin(st.positions))}`);
  for (const p of open) console.log(`  ${p.symbol.padEnd(9)} ${p.bias === 1 ? 'long ' : 'short'} @ ${fmt(p.entry)}  SL ${fmt(p.stop)}  margin $${fmt(p.margin)}`);
}
function fmt(x) { return (Math.round(x * 100) / 100).toLocaleString('en-US'); }
function money(x) { return `${x < 0 ? '-' : '+'}$${fmt(Math.abs(x))}`; }

if (process.argv.includes('--reset')) {
  reset();
} else {
  run().catch((err) => { console.error(err); process.exit(1); });
}
