// Ties the three ported engines together into one entry/exit decision per
// symbol, and runs the paper broker (no real orders — see README):
//   - atlasScore  -> primary signal: weighted score, bias, entry/stop/targets
//   - fib         -> confluence filter: does GoldenRatio's own impulse agree?
//   - liquidity   -> refines stop/T2 away from / short of dense liq clusters
// Then simulates fills candle-by-candle since the position was opened
// (not just "is price past X right now"), with a scaled T1/T2/T3 exit and
// stop moved to breakeven once T1 fills.
'use strict';

const atlasScore = require('./atlasScore');
const fib = require('./fib');
const liquidity = require('./liquidity');
const config = require('../config');

function runSymbol({ symbol, data, state }) {
  const analysis = atlasScore.analyse({
    symbol,
    candles: data.candles,
    ticker: data.ticker,
    oi: data.oi,
    ratio: data.ratio,
    book: data.book,
    tape: data.tape,
    entryTf: config.ENTRY_TF,
    mtfTfs: config.MTF_TFS,
    flipStore: state.flipEntries,
    account: state.equity[symbol],
    riskPct: config.RISK_PCT,
    leverage: config.LEVERAGE,
    scoreThreshold: config.SCORE_THRESHOLD,
  });

  const events = [];
  if (!analysis) { events.push({ symbol, type: 'skip', reason: 'not enough candle history yet' }); return events; }

  // Recorded every run regardless of what happens below, so the dashboard
  // can show how close each coin is to the entry threshold even while
  // nothing is open and no trade fires.
  state.scores[symbol] = { score: analysis.score, bias: analysis.bias, at: Date.now() };

  const openPos = state.positions[symbol];

  // 1) Manage an existing position: replay every candle that closed since
  //    it opened, in order, against its stop and remaining targets.
  if (openPos) {
    const closedSince = data.candles[config.ENTRY_TF]
      .slice(0, -1)
      .filter(c => c.t > openPos.openedAt);
    const outcome = simulatePositionOutcome(openPos, closedSince);
    events.push(...outcome.events);
    for (const ev of outcome.events) {
      if (ev.type === 'partial' || ev.type === 'exit') {
        state.trades.push({
          symbol, bias: openPos.bias, entry: openPos.entry, exit: ev.price, pnl: ev.pnl,
          reason: ev.reason, openedAt: openPos.openedAt, closedAt: closedSince.length ? closedSince[closedSince.length - 1].t : openPos.openedAt,
          score: openPos.score,
        });
      }
    }
    if (outcome.closed) {
      delete state.positions[symbol];
    } else {
      state.positions[symbol] = outcome.position;
    }
    state.equity[symbol] += outcome.realizedDelta;

    // A live position also gets a signal-exit if the score has firmly
    // flipped against it (independent of whether SL/TP already fired above).
    if (state.positions[symbol] && analysis.bias !== 0 && analysis.bias !== state.positions[symbol].bias) {
      const pos = state.positions[symbol];
      const exitPrice = analysis.price;
      const pnl = (exitPrice - pos.entry) * pos.bias * pos.qtyRemaining;
      state.equity[symbol] += pnl;
      state.trades.push(closeTradeRecord(pos, exitPrice, pos.qtyRemaining, pnl, 'signal-flip', analysis.closedAt));
      events.push({ symbol, type: 'exit', reason: 'score flipped against open position', pnl });
      delete state.positions[symbol];
    }
  }

  // 2) No open position and the score wants one: check confluence, sizing
  //    sanity, and liquidity-refine the plan before opening it on paper.
  if (!state.positions[symbol] && analysis.bias !== 0 && analysis.plan) {
    const plan = analysis.plan;

    const fibCheck = fib.confluence({
      candles1h: data.candles[config.ENTRY_TF],
      thresholdPct: config.FIB_THRESHOLD[symbol] ?? 2,
      windowN: config.FIB_WINDOW,
      bias: analysis.bias,
    });
    if (!fibCheck.agrees) {
      events.push({ symbol, type: 'hold', reason: `ATLAS wants ${dirName(analysis.bias)} but GoldenRatio's last impulse still points the other way`, score: analysis.score });
      return events;
    }

    const chaseDist = Math.abs(analysis.price - plan.entry);
    if (chaseDist > config.MAX_CHASE_ATR * analysis.atr) {
      events.push({ symbol, type: 'hold', reason: 'price has drifted too far from the flip entry to still take it', score: analysis.score });
      return events;
    }

    if (plan.qty <= 0 || plan.belowMin) {
      events.push({ symbol, type: 'hold', reason: 'position size rounds to zero at this risk/entry/stop', score: analysis.score });
      return events;
    }

    const clusters = liquidity.estimateClusters(
      data.candles[config.ENTRY_TF].slice(0, -1),
      config.LEV_TIERS,
      config.LIQ_MMR,
    );
    const refined = liquidity.refinePlan(plan, clusters);

    const position = openPositionFromPlan(symbol, refined, analysis, fibCheck);
    state.positions[symbol] = position;
    events.push({
      symbol, type: 'enter', bias: analysis.bias, score: analysis.score,
      entry: refined.entry, stop: refined.stop, t1: refined.t1, t2: refined.t2, t3: refined.t3,
      qty: refined.qty, margin: refined.margin, riskAmt: refined.riskAmt,
      fibNote: fibCheck.impulse ? `${fibCheck.impulse.dir} impulse agrees${fibCheck.inPocket ? ', price in golden pocket' : ''}` : 'no recent GoldenRatio impulse (neutral)',
      liqNote: refined.liqClusterNote,
    });
  } else if (!state.positions[symbol]) {
    events.push({ symbol, type: 'flat', reason: analysis.bias === 0 ? 'score inside the stand-aside band' : 'no plan', score: analysis.score });
  }

  return events;
}

function dirName(bias) { return bias === 1 ? 'long' : bias === -1 ? 'short' : 'flat'; }

function openPositionFromPlan(symbol, plan, analysis, fibCheck) {
  const split = config.TARGET_SPLIT;
  return {
    symbol,
    bias: plan.bias,
    entry: plan.entry,
    stop: plan.stop,
    initialStop: plan.stop,
    t1: plan.t1, t2: plan.t2, t3: plan.t3,
    qtyTotal: plan.qty,
    qtyRemaining: plan.qty,
    qtyT1: plan.qty * split[0],
    qtyT2: plan.qty * split[1],
    qtyT3: plan.qty * split[2],
    margin: plan.margin,
    notional: plan.notional,
    riskAmt: plan.riskAmt,
    filled: { t1: false, t2: false, t3: false },
    breakeven: false,
    openedAt: analysis.closedAt,
    score: analysis.score,
    fibImpulse: fibCheck.impulse ? fibCheck.impulse.dir : null,
    liqClusterNote: plan.liqClusterNote,
  };
}

function closeTradeRecord(pos, exitPrice, qty, pnl, reason, closedAt) {
  return {
    symbol: pos.symbol, bias: pos.bias, entry: pos.entry, exit: exitPrice, qty, pnl,
    reason, openedAt: pos.openedAt, closedAt, score: pos.score,
  };
}

// Walks candles chronologically; on each one, checks in this order: stop
// first (conservative — assumes the worst if both stop and a target are
// inside the same candle's range), then any remaining targets low-to-high
// of distance from entry. Moves stop to breakeven once T1 fills.
function simulatePositionOutcome(position, candles) {
  const pos = { ...position, filled: { ...position.filled } };
  let realizedDelta = 0;
  const events = [];

  for (const c of candles) {
    const hitStop = pos.bias === 1 ? c.l <= pos.stop : c.h >= pos.stop;
    if (hitStop) {
      const pnl = (pos.stop - pos.entry) * pos.bias * pos.qtyRemaining;
      realizedDelta += pnl;
      events.push({ symbol: pos.symbol, type: 'exit', reason: pos.breakeven ? 'breakeven stop hit' : 'stop hit', pnl, price: pos.stop });
      return { closed: true, position: pos, realizedDelta, events };
    }

    if (!pos.filled.t1) {
      const hitT1 = pos.bias === 1 ? c.h >= pos.t1 : c.l <= pos.t1;
      if (hitT1) {
        const pnl = (pos.t1 - pos.entry) * pos.bias * pos.qtyT1;
        realizedDelta += pnl;
        pos.qtyRemaining -= pos.qtyT1;
        pos.filled.t1 = true;
        pos.stop = pos.entry; // move to breakeven
        pos.breakeven = true;
        events.push({ symbol: pos.symbol, type: 'partial', reason: 'T1 hit, stop moved to breakeven', pnl, price: pos.t1 });
      }
    }
    if (pos.filled.t1 && !pos.filled.t2) {
      const hitT2 = pos.bias === 1 ? c.h >= pos.t2 : c.l <= pos.t2;
      if (hitT2) {
        const pnl = (pos.t2 - pos.entry) * pos.bias * pos.qtyT2;
        realizedDelta += pnl;
        pos.qtyRemaining -= pos.qtyT2;
        pos.filled.t2 = true;
        events.push({ symbol: pos.symbol, type: 'partial', reason: 'T2 hit', pnl, price: pos.t2 });
      }
    }
    if (pos.filled.t2 && !pos.filled.t3) {
      const hitT3 = pos.bias === 1 ? c.h >= pos.t3 : c.l <= pos.t3;
      if (hitT3) {
        const pnl = (pos.t3 - pos.entry) * pos.bias * pos.qtyT3;
        realizedDelta += pnl;
        pos.qtyRemaining -= pos.qtyT3;
        pos.filled.t3 = true;
        events.push({ symbol: pos.symbol, type: 'exit', reason: 'T3 hit, position closed', pnl, price: pos.t3 });
        return { closed: true, position: pos, realizedDelta, events };
      }
    }
  }
  return { closed: false, position: pos, realizedDelta, events };
}

module.exports = { runSymbol, simulatePositionOutcome };
