// Persistence for the paper broker. GitHub Actions runners are ephemeral, so
// everything the bot needs to remember between runs lives in state/*.json,
// and the workflow commits the changed files back to the repo after each run.
'use strict';

const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'state');
const FILES = {
  equity: 'equity.json',
  positions: 'positions.json',
  trades: 'trades.json',
  flipEntries: 'flipEntries.json',
  scores: 'scores.json',
};

function readJson(name, fallback) {
  const p = path.join(DIR, FILES[name]);
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    return fallback;
  }
}
function writeJson(name, data) {
  const p = path.join(DIR, FILES[name]);
  fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\n');
}

function loadState(config) {
  const equity = readJson('equity', null) || Object.fromEntries(config.SYMBOLS.map(s => [s, config.BALANCE_PER_SYMBOL]));
  const positions = readJson('positions', {}); // keyed by symbol -> position object or absent
  const trades = readJson('trades', []);        // append-only closed-trade log
  const flipEntries = readJson('flipEntries', {});
  const scores = readJson('scores', {});         // keyed by symbol -> latest {score, bias, at}, every run
  return { equity, positions, trades, flipEntries, scores };
}

function saveState(state) {
  writeJson('equity', state.equity);
  writeJson('positions', state.positions);
  writeJson('trades', state.trades);
  writeJson('flipEntries', state.flipEntries);
  writeJson('scores', state.scores);
}

module.exports = { loadState, saveState, DIR };
