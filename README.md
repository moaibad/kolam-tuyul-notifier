# Kolam Tuyul Notifier

Discord notifier for Uniswap LP positions on Robinhood Chain mainnet.

The bot is read-only. It does not need a wallet private key or seed phrase.

## Features

- Tracks Uniswap v3 and v4 LP positions from a public wallet address.
- Discovers v4 positions from the current Robinhood Blockscout NFT ownership API, with a SQLite cache and recent Transfer-log fallback.
- Posts a Discord portfolio report every five minutes by default.
- Shows one styled embed per open position.
- Shows initial deposit, current LP value, claimed fees, unclaimed fees, total result, and profit/loss.
- Does not show HODL comparison.
- Shows position age from the original mint timestamp.
- Sends a separate red alert when a position transitions from `IN RANGE` to `OUT OF RANGE`.
- Keeps showing out-of-range duration in regular reports after 15 minutes.
- Includes a `Refresh Now` Discord button with a 30-second global cooldown.
- Stores sync/accounting/out-of-range state in SQLite.

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
```

The app automatically uses the bundled official Robinhood Chain v3/v4 deployments and USDG token address.

## Run

```bash
npm run dev
```

Production:

```bash
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

- `STATE_DATABASE_PATH=./data/notifier.sqlite` stores local public-chain state so restarts do not rescan all historical logs or reset out-of-range timers.
- Public Robinhood RPC may rate-limit historical scans. For production, use an Alchemy Robinhood RPC URL.
- The bundled v3 and v4 deployment metadata follows the official Uniswap deployment documentation for Robinhood Chain.
- Profit/loss is shown only after position accounting history is synchronized. Unsupported hook accounting or unavailable historical RPC state is displayed as `Unavailable`, never as a fabricated zero.
- Position valuation prefers a direct USDG pool and can route through one intermediate token using discovered v3/v4 pools. Positions without a safe route remain visible but make portfolio totals partial.
- Full historical accounting requires an RPC that supports historical `eth_call`. The public Robinhood endpoint currently works for recent history; Alchemy is recommended for production reliability.
