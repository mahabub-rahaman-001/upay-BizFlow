# upay BizFlow

> **Merchant & Agent Business Operating Platform** — a hackathon build (P0–P10) on Supabase + Expo + FastAPI.

Full design and specs: see the `docs/` folder (14 documents). Start with [`docs/00-README.md`](docs/00-README.md).

---

## What is built (P0 – P10 complete)

| Phase | Contents |
|---|---|
| **P0 Setup** | pnpm/Turbo monorepo, Expo SDK 56, Supabase local, FastAPI stub, CI |
| **P1 Data core** | 13 migrations — tenancy, double-entry ledger (append-only), RLS on every table, RPCs, pgTAP tests |
| **P2 Auth & shell** | Phone OTP, PIN, membership routing, tab bars, design tokens, MoneyText, StatusPill, AICard |
| **P3 Payments** | Edge Function webhook (HMAC + idempotent), payment simulator, Realtime banner + sound, receipt page |
| **P4 Merchant books** | Cash-sale keypad, expense, baki (gave/received), suppliers & payables, review queue, daily closing |
| **P5 Agent** | Agent book (type chips), float screen, day-end audit (cash + per-wallet), commission view |
| **P6 Predictive AI** | LightGBM quantile model (sales7d + float24h), conformal calibration, match scorer, anomaly rules + IsolationForest, forecast_runs/ai_outputs |
| **P7 Language AI** | LLM gateway, Bangla assistant with citations, voice/STT parse + number normalizer, report builder (CSV/XLSX), KPI explanations |
| **P8 Planner & Offers** | Safe-to-withdraw RPC, what-if simulate, Planner UI; Offers CRUD (PERCENT_OFF / AMOUNT_OFF / BUY_X_GET_Y / STAMP_LOYALTY), budget cap with row-lock auto-pause, DiD results |
| **P9 Admin web** | Portfolio KPIs, support case list + SLA timers, access grants, AI health metrics, feature flags & kill switches |
| **P10 Harden & Demo** | Offline outbox (auto-sync on reconnect), OfflineBanner, VoiceButton (hold-to-talk + confirm modal), EmptyState / ErrorState on all screens, security checklist script, demo:reset, full README |

---

## Project structure

```text
bizflow/
  apps/
    mobile/           Expo app (iOS · Android · Web)
      app/            Expo Router screens
        (app)/        Authenticated merchant/agent tabs
          index.tsx   Home (balances, forecast, AI card)
          transactions.tsx
          receive.tsx (QR)
          books.tsx   (closing, baki, suppliers, review)
          offers.tsx  3-step wizard + offers list
        admin/        Admin web console (web-only)
      components/
        OfflineBanner.tsx   Offline queue status bar
        VoiceButton.tsx     Hold-to-talk + confirm modal
        EmptyState.tsx      EmptyState / ErrorState / NetworkErrorState
        MoneyEntryScreen.tsx
      lib/
        api.ts         All Supabase hooks — every money write through RPCs
        outbox.ts      Offline outbox (AsyncStorage + NetInfo auto-flush)
        session.ts     Zustand session (active business, role)
        supabase.ts    Supabase client
      locales/         bn.json + en.json (full coverage P0–P10)
    ai-service/       FastAPI — forecast, assistant, voice/STT, anomaly
    models/           LightGBM notebooks + calibration
  packages/
    shared/           money utils, zod schemas, RPC arg builders, tests
    ui/               design tokens, TxnRow, Card, ActionList, MoneyText, StatusPill, AICard
  supabase/
    migrations/       0001–0013 SQL migrations
    seed/             seed.sql — demo merchant + agent + 180-day synthetic data
    tests/            0001–0014 pgTAP test files (149 tests)
    functions/        Edge Functions (payment-webhook, simulator/pay, receipt)
  scripts/
    demo-reset.mjs    pnpm demo:reset — wipe + reseed + validate + print credentials
    security-check.mjs  pnpm security:check — 13 automated checks from docs/09 §9
  docs/               14 specification documents
```

---

## Prerequisites

| Tool | Version | Why |
|---|---|---|
| Node.js | 20+ | runtime |
| pnpm | 9+ | workspace manager (`npm i -g pnpm@9`) |
| Docker Desktop | latest | local Postgres for Supabase |
| Supabase CLI | devDependency | `npx supabase …` |
| Python | 3.12–3.14 | AI service |
| Expo Go (phone) or emulator | – | mobile app |

---

## Run the demo (easy path)

Docker Desktop must be running. From the project root:

```bash
pnpm install        # first time only
pnpm demo:up        # starts Supabase, seeds the demo, builds the AI service
pnpm --filter mobile dev   # the app, on http://localhost:8081
```

Open http://localhost:8081 and tap a demo login (or use a number below, OTP `123456`).

| Who | Phone |
|---|---|
| Merchant (Karim Store) | 01700000001 |
| Agent (Rahim Agent Point) | 01700000002 |
| Staff | 01700000003 |
| Admin console (`/admin`) | 01700000004 / 005 / 006 |

### AI service (voice + live forecast)

Easiest, works everywhere (no Docker Hub needed) - run it on the host in its own terminal:

```bash
pnpm ai
```

It sets up the Python virtualenv the first time, then serves on http://localhost:8000. The
app also works without it - the forecast card falls back to seeded data.

Prefer Docker? `pnpm demo:up` builds and starts the AI container automatically when Docker
Hub is reachable; stop it with `pnpm demo:down`.

## Setup

```bash
# 1. Install JS deps
pnpm install

# 2. Start local Supabase (Postgres :54322, Studio :54323)
pnpm db:start

# 3. First-time reset — runs migrations + seed
pnpm db:reset

# 4. Copy env (paste anon key + URLs from `supabase start` output)
cp apps/mobile/.env.example apps/mobile/.env

# 5. Run the mobile app (web + QR for Expo Go)
pnpm --filter mobile dev

# 6. Run the AI service
cd apps/ai-service
python -m venv .venv && source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload   # http://localhost:8000/v1/health
```

---

## Demo

```bash
# Full demo reset (wipes DB, re-seeds, runs all tests, prints credentials)
pnpm demo:reset

# Security checklist only
pnpm security:check

# pgTAP DB tests only
pnpm db:test
```

### Demo accounts (OTP: `123456`)

| Role | Phone | Business |
|---|---|---|
| merchant_owner | `01700000001` | Karim Store (grocery) |
| agent_owner | `01700000002` | Rahim Agent Point |
| staff | `01700000003` | Karim Store (restricted) |

Admin console: `http://localhost:8081/admin`
Supabase Studio: `http://localhost:54323`

---

## Demo script (happy path)

1. **Login** as Karim (`01700000001`, OTP `123456`)
2. **Home** → see balance, 7-day forecast band, safe-to-withdraw amount
3. Open browser → `/simulator/pay` → send Tk 850 → **Realtime banner** appears + sound
4. **Cash sale** by voice (hold 🎙️, say *"৫০০ টাকা চাল বিক্রি"*) → confirm
5. **Expense** → enter supplier payment
6. **Closing** → preview → physical count → post (variance → account 9000)
7. **Offers** → create stamp loyalty card in 3 steps → publish
8. Switch to Rahim (`01700000002`) → **Agent book** → float audit → float advice
9. **Assistant** → ask 3 Bangla questions → see citations
10. **Admin console** (`/admin`) → toggle `ai.forecast` kill switch → app shows baseline label

---

## Available scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Start all apps in dev mode |
| `pnpm build` | Production build |
| `pnpm lint` | ESLint across all packages |
| `pnpm typecheck` | TypeScript strict check |
| `pnpm test` | Vitest unit tests |
| `pnpm db:start` | Start local Supabase |
| `pnpm db:reset` | Drop + re-migrate + seed |
| `pnpm db:test` | Run 149 pgTAP DB tests |
| `pnpm demo:reset` | Full demo reset + validate + print credentials |
| `pnpm security:check` | Run 13 automated security checks |

---

## Key design decisions

- **Offline-first outbox** — every posting mutation checks `NetInfo` before calling Supabase. If offline, the call is persisted to `AsyncStorage` with its idempotency key and auto-replayed when connectivity returns. The `OfflineBanner` shows count + manual retry.
- **Double-entry integrity** — all money writes go through Supabase RPCs. A DB trigger verifies every transaction balances (Σ debits = Σ credits) and rejects any UPDATE/DELETE on ledger tables.
- **AI never invents numbers** — the LLM reads read-only SQL views; a number validator cross-checks every figure in the LLM response against the DB before it reaches the UI.
- **Budget-capped offers** — `redeem_offer` uses `SELECT … FOR UPDATE` on the offer row so concurrent redemptions never exceed `budget_minor`. When `spent_minor` reaches the cap the offer auto-pauses.
- **RLS on every table** — cross-tenant access is impossible at the DB layer; the pgTAP suite verifies this on every migration.

---

## Docs index

| File | Topic |
|---|---|
| `docs/00-README.md` | Start here |
| `docs/01-product-vision.md` | Why BizFlow exists |
| `docs/04-ui-ux-design-system.md` | Screen specs, tokens |
| `docs/06-data-model-and-ledger.md` | Account codes, journal, RLS |
| `docs/08-ai-ml-specification.md` | Forecast, assistant, voice |
| `docs/09-security-privacy-compliance.md` | Security checklist |
| `docs/10-implementation-roadmap.md` | Phase plan |
| `docs/13-ai-build-playbook-and-skills.md` | AI coding guide |
