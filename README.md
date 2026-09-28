# BNY Staking Monitor

Local Ethereum mainnet validator watchlist and evidence-first dashboard. The three supplied public keys are seeded with neutral names. A verified public Beacon API is configured by default. On 2026-09-28, it returned `unknown validator` for all three, so the live dashboard intentionally has no balances, indices, or performance figures yet.

## Start

Requirements: Node.js 24+, Docker Desktop with a running daemon, and npm. From this folder:

```sh
cp .env.example .env
docker compose up -d
npm install
npm run migrate
npm run doctor
npm run dev
```

Open [http://127.0.0.1:3001](http://127.0.0.1:3001). In a **second terminal**, start the independent long-lived collector:

```sh
npm run collector
```

`npm run dev` builds the React UI and serves it with the API. `npm run build` checks TypeScript and produces the UI bundle. `npm test` runs provider parsing, exact-unit, authentication and rate-limit tests. After code edits, restart `npm run dev` to rebuild. In this environment the live API and UI preview can run, but saved data requires PostgreSQL.

## Credentials and sources

`DATABASE_URL` is the PostgreSQL connection string. `BEACON_API_BASE_URL` defaults to the documented public PublicNode Beacon endpoint. To switch to NodeReal, [create an account](https://nodereal.io/) and obtain an ETH Beacon Chain mainnet API key, then put its documented full key-bearing base URL into `BEACON_API_BASE_URL` in local `.env` or your secret manager. `BEACON_API_AUTH_HEADER` is for providers that use an authorization header. Never use a `VITE_`/browser variable for credentials. Run `npm run doctor` after changing a provider; it checks mainnet genesis, headers, and all three lookups without printing the key.

`BEACONCHAIN_API_KEY` and `FIGMENT_API_KEY` are reserved for future authorized indexed feeds. Setting them currently does not enable rewards. See [DATA_SOURCES.md](DATA_SOURCES.md) for tested coverage and limits.

The app does not load upstream APIs on each visitor request. The collector writes observations; the UI reads PostgreSQL and refreshes its snapshot every 30 seconds. A manual refresh runs one collection cycle and is limited to once per minute per API process. `POLL_INTERVAL_MS` controls the worker interval, with a 60-second minimum. `STALE_AFTER_MS` controls the stale marker and alert, also with a 60-second minimum; ten minutes is the prototype default. For deployment, run `npm run collector` as a separate persistent worker; a serverless web process does not provide a durable two-minute scheduler. No public deployment is configured.

## Screens and data treatment

Overview, validator detail, incidents, and data connections are available. Add validators by public key, edit their names, copy keys, and open explorer pages. The historical plot shows only locally collected finalized observations. Unsupported rewards and duties have explicit unavailable states. The demo toggle uses separate sample public keys and never stores sample values against the real watchlist.

Incidents persist for observed slashing, finalized lifecycle changes, configured approved-destination mismatches, stale data and collection failures; acknowledgment in this prototype has no authenticated user identity. The collector records unrecovered polling gaps. No client, Galaxy/Figment operator, revenue, fees, net return, or ownership mapping is inferred. This local prototype has no authentication and must be placed behind your organization's access controls before shared deployment.

## Current verification

- `npm run build` succeeded.
- `npm run doctor` verified mainnet genesis and head/finalized headers. All three supplied keys returned `unknown validator`.
- PostgreSQL could not be started here because Docker's daemon was unavailable; persistent collection across cycles has not been verified.
- The default adapter does not provide observed duties, rewards, proposals, withdrawals, or historic backfill. Figment and Beaconcha.in require authorized setup.
