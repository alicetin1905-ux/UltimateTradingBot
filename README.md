# UltimateTradingBot

A paper-trading bot for BTC, ETH, SOL, XRP, BNB and DOGE perps that combines
the signal logic already built and shipped across three dashboards in this
account into one entry/stop/take-profit decision per coin:

- **[ATLAS](https://github.com/alicetin1905-ux/atlas)** — the primary
  signal. Its ~25-indicator weighted score (trend, momentum, structure,
  order-flow, funding, multi-timeframe alignment), Chandelier Exit stop and
  flip-triggered entry are ported here verbatim (`src/indicators.js`,
  `src/atlasScore.js`) — this bot's "best entry" is exactly what ATLAS's own
  trade plan panel would show for that coin.
- **[GoldenRatio](https://github.com/alicetin1905-ux/goldenratio)** —
  confluence filter. Its impulse detector and Fibonacci retracement math
  (`src/fib.js`) check that GoldenRatio's own read of the chart agrees with
  ATLAS's bias before a trade is taken; a contradicting impulse holds the
  trade back.
- **[CRUCIBLE](https://github.com/alicetin1905-ux/liquidations)** —
  stop/target refinement. Its liquidation-cluster model (`src/liquidity.js`)
  nudges a stop off a dense cluster it's sitting on top of, and pulls a
  target in short of one that would likely act as a price magnet.
- **[BTCLiveBoard](https://github.com/alicetin1905-ux/btcliveboard)** — same
  six coins, same 1H ATLAS score; this bot is effectively that board's
  signal running unattended instead of on a screen.

## This is paper trading only

**No API keys, no exchange account, no real orders.** The bot reads Binance
futures' public market-data endpoints, decides what it *would* do, and
tracks the result in `state/*.json` against a simulated balance. Nothing in
this repo can place, modify, or cancel a real order. Treat every number here
as a research/backtest read on the strategy, not investment advice — past
performance of a scoring heuristic on historical candles doesn't guarantee
anything about future ones.

The scoring/entry/exit logic itself was ported from ATLAS/GoldenRatio/
CRUCIBLE, which read Bybit client-side in the user's own browser. This bot
runs unattended on GitHub Actions instead, and Bybit's API blocks GitHub
Actions' hosted runners outright (a CloudFront geo-block, confirmed against
a real run's logs) — so it reads the same kind of data from Binance futures
instead. Prices/funding/OI move together closely across major exchanges on
these six coins, but they won't be bit-for-bit identical to what the other
four dashboards show at any given instant.

## Rules

- Six independent $2,000 paper balances, one per coin — a losing streak on
  one coin never eats into another's size.
- Risk 25% of that coin's *current* balance on every trade's stop distance
  (so risk shrinks with the balance after a loss, grows after a win).
- 10x leverage cap on position size (so a very tight stop can't size into a
  bigger position than 10x the balance would allow as margin).
- Entries decided on closed 1H candles only — nothing repaints intrabar.
- Scaled exit: 40% off at T1 (1R), 35% at T2 (2R), 25% at T3 (3R), with the
  stop moved to breakeven the moment T1 fills.
- One open position per coin at a time.

## Running it

```
npm install    # no dependencies today — this just validates package.json
node src/run.js
```

Requires Node 18+ (for native `fetch`). It reads `state/*.json`, fetches
fresh Binance futures data for all six coins, runs the strategy, prints a
summary, and writes the updated state back to those same files.

## Automation

`.github/workflows/bot.yml` runs `node src/run.js` every hour a few minutes
after the 1H candle close, then commits the changed `state/*.json` files
back to this repo — GitHub Actions runners are ephemeral, so that commit is
how the bot remembers open positions and balances between runs. No secrets
or credentials are needed for any of this.

## Layout

```
config.js              all the knobs above, in one place
src/indicators.js       math kit ported from ATLAS (ema/rsi/macd/atr/chandelier/...)
src/atlasScore.js       ATLAS's analyse(): score, bias, flip-entry, SL/TP plan
src/fib.js              GoldenRatio's impulse + fib retracement, as a confluence check
src/liquidity.js        CRUCIBLE's liquidation-cluster model, for SL/TP refinement
src/risk.js             position sizing (risk % of balance, capped by leverage)
src/binance.js          Binance futures public REST client (no API key)
src/strategy.js         combines all of the above into one decision per coin
src/state.js            reads/writes state/*.json
src/run.js              entry point — loops all six coins, prints the run summary
state/                  equity, open positions, closed-trade log, flip-entry memory
```

## Changing the risk parameters

Everything in the **Rules** section above is a value in `config.js` —
`BALANCE_PER_SYMBOL`, `RISK_PCT`, `LEVERAGE`, `TARGET_SPLIT`, the score
threshold, the fib thresholds per coin, and so on.
