# Medical Care Center — RCM Dashboard MVP

Minimum-overhead build: **no database server, no ORM, no native dependencies.**
Data lives in one JSON file (`data/db.json`) read/written by a tiny Express API.
This is enough to demo live filtering and nightly reconciliation now, and is a
straight swap to Postgres later — the query logic in `lib/store.js` is the only
place that would change.

## What's in here

```
server.js                    Express API — 6 endpoints, matches the spec doc
lib/store.js                 Loads/saves data/db.json, shared filter helpers
data/db.json                 The "database" — claims, denials, payments, bank feed
jobs/nightlyReconciliation.js  Batch job: matches payments to bank_feed, writes status
frontend/mcc_rcm_dashboard_live.jsx   Dashboard component wired to fetch() from the API
```

## Run it locally

```bash
npm install
npm start          # serves the API on http://localhost:4000
```

In another terminal, simulate the nightly reconciliation batch:
```bash
npm run reconcile
```
This reads `data/bank_feed` entries and updates each payment's
`reconciliation_status` (`matched` / `variance` / `pending`) in `db.json`.
In production this is a scheduled job (see below), not a manual command.

## Wiring up the frontend

Drop `frontend/mcc_rcm_dashboard_live.jsx` into your React app (or a fresh
Vite/Next project) alongside the other dashboard file. It reads the API base
URL from `process.env.REACT_APP_API_BASE`, defaulting to
`http://localhost:4000/api/v1` for local dev.

```bash
npm install recharts lucide-react
```

## Deploying with minimum overhead

Since there's no real database yet, the cheapest path is one small always-on
Node process rather than serverless (serverless functions reset their
filesystem between invocations, which breaks the JSON-file store).

| Piece | Suggested platform | Why |
|---|---|---|
| API (`server.js`) | **Render** or **Railway** free/hobby tier | One `npm start` service, persistent disk, built-in cron support for the nightly job |
| Nightly reconciliation | Render Cron Job / Railway Cron, calling `npm run reconcile` | No separate infra — same repo, scheduled trigger |
| Frontend | **Vercel** or **Netlify** | Deploy the React app; set `REACT_APP_API_BASE` to the Render/Railway API URL |

This gets you a live, filterable, nightly-reconciled dashboard with two free-tier
services and zero database administration.

## Path to production

When real claims volume arrives, swap `data/db.json` + `lib/store.js` for:
1. A hosted Postgres instance (Supabase or Render Postgres are the lowest-effort
   next step — both have a free tier and a BAA available on paid plans).
2. `lib/store.js`'s functions become SQL queries instead of array filters —
   the route handlers in `server.js` don't need to change.
3. The nightly job becomes a scheduled Postgres function or the same Node
   script pointed at Postgres instead of the JSON file.

**Compliance note:** once this touches real patient/billing data, whichever
host you pick needs a signed BAA (Business Associate Agreement) before go-live
— Render, Railway, Vercel, and Supabase all offer one on paid tiers, but it
has to be explicitly requested and signed, not assumed.
