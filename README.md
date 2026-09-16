# COD Profit Tracker & Creative Winner Attribution

A full-stack dashboard for a Cash-On-Delivery e-commerce operation. It joins
front-end Meta ad spend to back-end fulfilment reality (MDM Express) and Shopify
orders, and answers the only question that matters in COD: **which ad creative
actually produces delivered, profitable orders?**

Cash is collected on delivery, not on checkout, so ROAS measured at the order
level lies. This app measures everything against **delivered** orders.

## What it computes

| Metric | Definition |
| --- | --- |
| **True CPD** | Ad spend ÷ orders actually *delivered* (not orders placed) |
| **Breakeven CPD** | `sellingPrice − COGS − confirmationFee − deliveryFee − COD gateway fee`. The most you can pay to acquire one delivered order before losing money |
| **Net profit** | Collected revenue − ad spend − COGS − confirmation/delivery/return fees − COD gateway fee − allocated operating expenses |
| **Contribution margin** | Net profit before ad spend and fixed operating costs |
| **Breakeven status** | `PROFITABLE` → `WARNING` (true CPD within 85% of breakeven) → `LOSS` |
| **Confirmation / delivery / return rate** | Funnel conversion at each COD stage |
| **Projection** | Where the period lands if in-flight orders settle at the observed delivery rate |
| **Inventory runway** | Units left, daily burn rate, and a reorder date that accounts for production lead time |

### Accounting rules

These assumptions are encoded in `src/lib/profit-engine.ts` and covered by unit
tests. Change them there and every view follows.

- **Revenue is recognised on delivery only.** A confirmed order has collected nothing.
- **COGS is charged on delivered units.** Units on returned orders come back to
  stock, so they cost a return fee rather than their goods value. Stock that never
  comes back is tracked separately as `deadStockUnits`.
- **Confirmation fees are charged on every confirmed order**, whether or not it
  eventually delivers — the call centre is paid either way.
- **Operating expenses** are normalised to a daily run rate and allocated across
  products and creatives by their share of collected revenue.

## Architecture

```
Meta Marketing API ──► /api/sync/meta  ──► AdCreative + AdCreativeDailyStat (spend by ad, by day)
Shopify webhook    ──► /api/webhooks/shopify ──► Order (attributed via utm_content)
MDM Express API    ──► /api/sync/mdm   ──► Order.orderStatus (delivery lifecycle)
                                    │
                                    ▼
                          src/lib/profit-engine.ts   (pure, tested unit economics)
                                    │
                          src/lib/reporting.ts       (aggregation + alerts)
                                    │
                          Dashboard / Creatives / Products / Orders / Expenses
```

- **Next.js 15** (App Router, React 19, server components) + **Tailwind CSS**
- **Prisma 6** on **PostgreSQL**
- **Recharts** for the spend/revenue/profit time series
- Session auth: stateless HMAC-SHA256 cookie signed with `NEXTAUTH_SECRET`, using
  Web Crypto so the same verification runs in middleware (Edge) and route
  handlers (Node)

### Attribution chain

1. An ad carries `utm_content` in its URL tags (Meta's default is the ad id).
2. Shopify records it on the order's `landing_site`; the webhook also falls back
   to `referring_site` and `note_attributes`.
3. `utm_content` is matched against `AdCreative.utmContent`, then against `adId`.
4. The creative's campaign determines the product, and therefore the unit economics.

An order whose SKU matches no product is skipped rather than stored with wrong
numbers — it will show in the sync log with a reason.

## Setup

```bash
npm install                # also runs `prisma generate` via postinstall
cp .env.example .env       # fill in real credentials
npm run prisma:migrate     # creates the schema
npm run db:seed            # admin user + demo data
npm run dev
```

On Windows PowerShell, use `copy .env.example .env`.

Visit http://localhost:3000 and sign in with `SEED_ADMIN_EMAIL` /
`SEED_ADMIN_PASSWORD`.

Set `SEED_DEMO_DATA=false` to seed only the admin user, with no demo rows.

### Environment

See `.env.example` for the full list. Use `.env`: the Prisma CLI reads only
`.env`, while Next.js reads `.env.local` first and then `.env`. Both are
gitignored — never commit live credentials. Each integration's variables are validated independently, so a
missing MDM key degrades that one sync instead of breaking the app; `/api/health`
and the Settings page report exactly which keys are missing.

### Shopify webhook

Register these topics against `POST https://your-domain/api/webhooks/shopify`:

`orders/create`, `orders/updated`, `orders/paid`, `orders/fulfilled`, `orders/cancelled`

Copy the signing secret Shopify displays into `SHOPIFY_WEBHOOK_SECRET`. Requests
are rejected with 401 unless the HMAC over the raw body matches. Transient
failures return 500 so Shopify retries; unusable payloads return 200 so it does not.

MDM Express owns the delivery lifecycle: once an order has an `mdmOrderId`, a
later Shopify webhook cannot drag it back to `NEW`. Only a Shopify cancellation
or refund overrides an in-flight status.

### Scheduling syncs

Set `CRON_SECRET` and call the sync endpoints with a bearer token:

```bash
curl -X POST "https://your-domain/api/sync/meta?range=7d"  -H "Authorization: Bearer $CRON_SECRET"
curl -X POST "https://your-domain/api/sync/mdm?range=30d" -H "Authorization: Bearer $CRON_SECRET"
```

A 15-minute Meta sync and an hourly MDM sync keep the dashboard close to live.
Both are idempotent — re-running a window overwrites that window's rows rather
than double-counting. The MDM window is wider because an order placed today may
not deliver for a week.

## API

| Endpoint | Purpose |
| --- | --- |
| `GET /api/metrics/dashboard?range=7d` | Every KPI, series, alert and ranking in one payload |
| `GET /api/creatives?range=30d` | Creative leaderboard, filterable by product or status |
| `GET/POST /api/products`, `GET/PATCH/DELETE /api/products/:id` | Products and fulfilment rates |
| `GET/POST /api/expenses`, `PATCH/DELETE /api/expenses/:id` | Operating expenses |
| `GET /api/campaigns`, `PATCH /api/campaigns/:id` | Campaign → product mapping |
| `GET/PATCH /api/orders` | Order list; PATCH manually overrides status or attribution |
| `POST /api/sync/meta`, `POST /api/sync/mdm` | Trigger a sync |
| `GET /api/sync/status`, `GET /api/health` | Integration and database health |

Range parameters accept either a preset (`today`, `7d`, `14d`, `30d`, `90d`) or
explicit `since`/`until` dates in `YYYY-MM-DD`.

## Testing

```bash
npm test         # 41 unit tests: profit engine, HMAC, attribution, status mapping, dates
npm run typecheck
npm run lint
```

The profit engine is pure and has no database or network dependency, so the
accounting rules are tested directly.

## Troubleshooting

**`@prisma/client did not initialize yet. Please run "prisma generate"`**

The generated client lives in `node_modules`, so it never arrives with a clone.
`postinstall` generates it, but that is skipped by `npm install --ignore-scripts`
and by some CI caches. Fix it directly:

```bash
npx prisma generate
```

**`Environment variable not found: DATABASE_URL`**

The Prisma CLI reads `.env` only — not `.env.local`. Make sure `.env` exists at
the repository root (`cp .env.example .env`) and contains `DATABASE_URL`.

**`Can't reach database server at localhost:5432`**

Postgres is not running, or `DATABASE_URL` points somewhere else. The database
in the URL must already exist; Prisma creates tables, not the database itself:

```bash
createdb cod_tracker
```

**MDM sync returns 404**

Orders are read through `POST /api/v2/orders/search`, with the date range and
paging in the JSON body. Set `MDM_API_BASE_URL` to the host only
(`https://api.mdm.express`) — the client appends the path. A base URL that
already ends in `/api/v2` is also accepted and not doubled.

**MDM sync returns 401 or 403**

The endpoint exists but rejected the key. A 401 does not say which credential
shape was expected, so probe for it instead of guessing:

```bash
npm run mdm:probe
```

It tries each supported scheme against the live search endpoint and prints the
one that works, ready to paste into `.env`:

```env
MDM_AUTH_SCHEME="x-auth-token"
```

If every scheme returns 401, the key itself is invalid or not enabled for this
endpoint — check it in the MDM dashboard.

**Meta or MDM sync returns an error**

Check the Settings page — every sync attempt is recorded with its error message.
A 403 from Meta usually means an expired token or one lacking `ads_read` on the
ad account.

## Deployment notes

- `npm run build` runs `prisma generate` first, then builds.
- Run `npm run prisma:deploy` against the production database before starting.
- Set `NEXTAUTH_SECRET` to a strong random value (`openssl rand -base64 32`).
  Session cookies are `secure` in production, so serve over HTTPS.
- Meta spend is stored per ad per day, so re-syncing a window is safe and
  historical figures stay stable even as Meta's attribution window settles.
