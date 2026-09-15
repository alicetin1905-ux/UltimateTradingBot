#!/usr/bin/env node
// Resets every coin back to its starting balance and drops all open
// positions, without recording trades for them — same as the old per-coin
// dashboard reset, just applied to the whole account at once. Trade history
// (trades.json) is left alone. Run via .github/workflows/reset.yml
// (workflow_dispatch), which commits the result the same way bot.yml does.
'use strict';

const config = require('../config');
const state = require('./state');

function main() {
  const st = state.loadState(config);

  st.equity = Object.fromEntries(config.SYMBOLS.map(s => [s, config.BALANCE_PER_SYMBOL]));
  st.positions = {};
  st.flipEntries = {};
  st.scores = {};

  state.saveState(st);

  console.log(`Reset all ${config.SYMBOLS.length} coins to $${config.BALANCE_PER_SYMBOL} — all positions closed, no trades recorded.`);
}

main();
