# Data sources and definitions

Verified on **2026-09-28 16:14 UTC**. No API key was used in the read-only checks.

## Beacon API

The default is PublicNode's documented public Ethereum Beacon API, `https://ethereum-beacon-api.publicnode.com`. [PublicNode lists Ethereum mainnet and a Beacon API](https://ethereum.publicnode.com/). The [Ethereum Beacon API specification](https://github.com/ethereum/beacon-APIs) defines the state validator lookup, genesis and headers. The public endpoint returned the expected mainnet genesis time `1606824023` and root `0x4b363d…1bfe95`. Head and finalized header calls returned numeric slots. Targeted `/eth/v1/beacon/states/head/validators/{pubkey}` calls returned HTTP 404 `unknown validator` for **each of the three supplied keys**. This proves neither ownership nor inactivity; they may not yet be registered or the provider may not recognize them. The app therefore displays no indices or balances for them.

The adapter requests each key directly; it never downloads the validator registry. It also requests `finalized` and `head` separately, stores the response finality flag and slot, and refuses to treat a purported finalized response lacking `finalized=true` as final. Provider data and collection errors remain distinct from the last saved observation. Query URLs are not logged, since a configured provider URL may contain a key.

| Capability | Default adapter | Verified live result |
| --- | --- | --- |
| Mainnet identity | Genesis root/time | Passed |
| Lifecycle, index, balance, effective balance, withdrawal credentials, slashing | Standard targeted state validator lookup | Endpoint works; all three keys returned unknown, so parsing of real records remains unverified |
| Head versus finalized | Header and response flag | Header requests passed; validator finality unverified because keys were not found |
| Duty assignments | Not collected | Unsupported; assignments would not prove participation |
| Observed participation, proposals, withdrawals | No indexed feed | Unsupported |
| Rewards, execution income, fees, APR/APY | No verified feed | Unsupported |
| Historical retention | Local observations from first successful collection only | No archive guarantee or backfill |

Exact balance units: Beacon API balances are integer Gwei; the app divides by `1,000,000,000` using `BigInt` for ETH display and sums. Effective balance is distinct from actual balance. Neither a balance change nor active lifecycle status is called a reward or uptime measure. UTC is used for stored and displayed timestamps. A `0x01` credential yields an execution address from its last 20 bytes; `0x02` is labeled compounding and likewise yields its address. No owner, partner, or operator is inferred.

## Optional providers

[NodeReal advertises a freemium Beacon API](https://nodereal.io/api-marketplace/eth-beacon-chain) with 100 million monthly CUs and 300 CUPS on its listed free tier. [Its genesis endpoint documentation](https://docs.nodereal.io/reference/getgenesis-1) shows a key embedded in the server URL. No NodeReal account or key was configured, so its actual access, per-method CU costs, and validator responses were **not** tested. Configure `BEACON_API_BASE_URL` server-side with the account's documented base URL to use this adapter; run `npm run doctor` before collection. Do not assume the advertised tier covers a production polling cadence.

[Beaconcha.in API documentation](https://docs.beaconcha.in/) and pricing should be checked during onboarding; it is not a permanent free dependency. `BEACONCHAIN_API_KEY` is reserved, but no Beaconcha.in adapter is claimed as working. [Figment's rewards overview](https://docs.figment.io/docs/rewards-overview) says Ethereum data is Figment-only, daily, UTC, and can arrive within three hours. `FIGMENT_API_KEY` is reserved; no authorization or feed coverage was available to verify an implementation. The UI marks duties, rewards, execution income and indexed events unavailable instead of inventing them.

## Operational limits

Polling defaults to two minutes, with a 60-second minimum. HTTP calls have 10-second timeouts and up to three bounded attempts; `429` honors a capped `Retry-After`. A PostgreSQL advisory lock prevents overlapping jobs; uniqueness by validator/source/state/slot makes repeated observations idempotent. The collector records runs and failures. It does not yet backfill missed intervals or reconcile chain reorganizations beyond retaining separate head and finalized observations. Database persistence across cycles was **not** verified in this workspace because Docker's daemon was unavailable.
