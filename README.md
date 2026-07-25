# Kolam Tuyul Notifier

Discord notifier for Uniswap LP positions on Robinhood Chain mainnet.

The bot is read-only. It does not need a wallet private key or seed phrase.

## Features

- Tracks Uniswap v3 and v4 LP positions from a public wallet address.
- Discovers v4 positions from the current Robinhood Blockscout NFT ownership API, with a shared Turso cache and recent Transfer-log fallback.
- Posts a Discord portfolio report every five minutes by default.
- Shows one styled embed per open position.
- Shows initial deposit, current LP value, claimed fees, unclaimed fees, total result, and profit/loss.
- Shows deposited value, current LP value, fees, total result, and profit/loss in the pair quote token.
- Profit/loss uses the deposited-token HODL benchmark internally and therefore represents standard impermanent loss plus fees without exposing a separate IL field.
- Portfolio totals aggregate those same position-native IL and fee metrics at each quote token's live USDG price.
- Non-USDG position values keep their pair quote-token amount and append a live USDG equivalent, for example `0.000426 ETH ($0.85)`.
- LP Value includes a per-token breakdown with each token's live USDG contribution and a non-partial total.
- Position embeds use full-width composition, fee, and performance sections, and preserve significant digits for very small pair prices.
- Position details are grouped into three mobile-first sections (Position, Value, and Status), with compact Discord subtext for secondary data.
- Shows position age from the original mint timestamp.
- Sends a separate red alert when a position transitions from `IN RANGE` to `OUT OF RANGE`.
- Keeps showing out-of-range duration in regular reports after 15 minutes.
- Includes a `Refresh Now` Discord button with a 30-second global cooldown.
- Stores sync/accounting/out-of-range state in Turso.

## Setup

```bash
npm install
cp .env.example .env
```

Fill `.env`:

```dotenv
DISCORD_BOT_TOKEN=
DISCORD_GUILD_ID=
DISCORD_CHANNEL_ID=
WALLET_ADDRESS=
ROBINHOOD_RPC_URL=https://rpc.mainnet.chain.robinhood.com
TURSO_DATABASE_URL=libsql://your-database.turso.io
TURSO_AUTH_TOKEN=your-token
```

The app automatically uses the bundled official Robinhood Chain v3/v4 deployments and USDG token address.

## Run

```bash
npm run dev
```

Production:

```bash
npm run db:migrate
npm run build
npm start
```

## Verify

```bash
npm run typecheck
npm test
npm run lint
```

## Notes

- Turso stores shared public-chain state so notifier and dashboard restarts do not rescan completed historical accounting blocks.
- The dashboard carries the same migration history. Do not run both production migration jobs concurrently.
- Public Robinhood RPC may rate-limit historical scans. For production, use an Alchemy Robinhood RPC URL.
- The bundled v3 and v4 deployment metadata follows the official Uniswap deployment documentation for Robinhood Chain.
- Profit/loss is shown only after position accounting history is synchronized. Unsupported hook accounting or unavailable historical RPC state is displayed as `Unavailable`, never as a fabricated zero.
- Position valuation prefers a direct USDG pool and can route through one intermediate token using discovered v3/v4 pools. Positions without a safe route remain visible but make portfolio totals partial.
- Reference-price discovery automatically searches liquid Uniswap v3 pools for the active position tokens, USDG, and trusted intermediate tokens. Native ETH and canonical WETH are treated as the same routing asset.
- `PRICE_POOL_CACHE_MINUTES` controls how often reference pools are refreshed (default: 60). `PRICE_ROUTE_INTERMEDIATE_TOKENS` may contain additional comma-separated token addresses. A real liquid on-chain route is always required; the bot never fabricates a token price.
- Full historical accounting requires an RPC that supports historical `eth_call`. The public Robinhood endpoint currently works for recent history; Alchemy is recommended for production reliability.
