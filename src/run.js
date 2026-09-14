#!/usr/bin/env node
// Entry point — fetches fresh data for all six coins, runs the strategy for
// each, persists state, and prints a run summary. Scheduled by
// .github/workflows/bot.yml; the workflow commits the changed state/*.json
// files back to the repo so the next run picks up where this one left off.
'use strict';

const config = require('../config');
const marketData = require('./okx');
const strategy = require('./strategy');
const state = require('./state');

async function main() {
  const st = state.loadState(config);
  const allEvents = [];

  for (const symbol of config.SYMBOLS) {
    try {
      const data = await marketData.loadSymbolData(symbol, config.MTF_TFS, config.ENTRY_TF);
      const events = strategy.runSymbol({ symbol, data, state: st });
      allEvents.push(...events);
    } catch (err) {
      allEvents.push({ symbol, type: 'error', reason: err.message });
    }
  }

  state.saveState(st);
  printSummary(allEvents, st);
}

function printSummary(events, st) {
  const ts = new Date().toISOString();
  console.log(`\n=== UltimateTradingBot run @ ${ts} ===\n`);

  for (const ev of events) {
    switch (ev.type) {
      case 'enter':
        console.log(`[${ev.symbol}] ENTER ${ev.bias === 1 ? 'LONG' : 'SHORT'} @ ${fmt(ev.entry)} | score ${ev.score} | SL ${fmt(ev.stop)} T1 ${fmt(ev.t1)} T2 ${fmt(ev.t2)} T3 ${fmt(ev.t3)} | qty ${ev.qty} margin $${fmt(ev.margin)} risk $${fmt(ev.riskAmt)}`);
        console.log(`   fib: ${ev.fibNote}`);
        if (ev.liqNote && (ev.liqNote.stopNear || ev.liqNote.targetNear)) {
          console.log(`   liquidity: stop near cluster ${fmt(ev.liqNote.stopNear)}, target near cluster ${fmt(ev.liqNote.targetNear)}`);
        }
        break;
      case 'partial':
        console.log(`[${ev.symbol}] ${ev.reason} | pnl ${money(ev.pnl)} @ ${fmt(ev.price)}`);
        break;
      case 'exit':
        console.log(`[${ev.symbol}] EXIT — ${ev.reason} | pnl ${money(ev.pnl)}${ev.price ? ' @ ' + fmt(ev.price) : ''}`);
        break;
      case 'hold':
        console.log(`[${ev.symbol}] hold — ${ev.reason} (score ${ev.score})`);
        break;
      case 'flat':
        console.log(`[${ev.symbol}] flat — ${ev.reason} (score ${ev.score})`);
        break;
      case 'skip':
        console.log(`[${ev.symbol}] skip — ${ev.reason}`);
        break;
      case 'error':
        console.log(`[${ev.symbol}] ERROR — ${ev.reason}`);
        break;
    }
  }

  console.log('\n--- equity ---');
  let total = 0;
  for (const symbol of config.SYMBOLS) {
    const eq = st.equity[symbol];
    total += eq;
    const pos = st.positions[symbol];
    console.log(`${symbol.padEnd(10)} $${fmt(eq)}${pos ? `  (open ${pos.bias === 1 ? 'long' : 'short'} @ ${fmt(pos.entry)})` : ''}`);
  }
  console.log(`${'TOTAL'.padEnd(10)} $${fmt(total)}  (started $${fmt(config.SYMBOLS.length * config.BALANCE_PER_SYMBOL)})`);
}

function fmt(x) { return (Math.round(x * 100) / 100).toLocaleString('en-US'); }
function money(x) { return `${x < 0 ? '-' : '+'}$${fmt(Math.abs(x))}`; }

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
