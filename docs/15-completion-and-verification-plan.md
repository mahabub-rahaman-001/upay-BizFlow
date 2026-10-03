# 15 - Completion and verification plan

Status reference as of 2026-10-03. This document is the single source of truth for the
remaining work to take BizFlow from "all code written and unit/pgTAP green" to "runs
end to end on a developer PC and demos cleanly". It breaks the remaining work into parts
with explicit tasks, acceptance criteria, and run-safety checks. No work starts until the
relevant part here is agreed. Do the parts in order; each part must leave the project in a
runnable state.

## 1. Current state (what is already done)

Verified green in this repository:

- Build phases P0 through P8: data core, auth and shell, payments and receipts, merchant
  books, agent float audit, predictive AI, language AI, planner and offers.
- Role separation (one account = one role) and the proactive "Today's Insights" layer.
  Specified in `docs/14-role-separation-and-ai-insights.md`.
- Feature phases A through E:
  - A: agent commission summary, agent wallet breakdown.
  - B: merchant baki reminder draft (consent gated), receipt link.
  - C: shared settings and history (closing history, audit history).
  - D: re-authentication (server-side 5-minute window, injected into refund, reversal,
    reopen, and export).
  - E: deterministic ledger reports and audited CSV export.
- Database: 19 pgTAP files, 207 assertions, all passing. All migrations plus seed apply
  cleanly with `supabase db reset`.
- Mobile: TypeScript strict passes, lint clean, unit and happy-path tests pass, web bundle
  builds.
- Admin web console already exists as an Expo Router web route at
  `apps/mobile/app/admin/index.web.tsx` (portfolio, support cases, AI health, feature
  flags with maker-checker, audit log, demo simulator, email login, and MFA). The native
  route `apps/mobile/app/admin/index.tsx` is the non-web placeholder. P9 is therefore built;
  it has not been exercised end to end in a running stack in this environment.

So the remaining work is not "build missing features". It is: prove the system runs end to
end on a PC, polish the demo, and optionally extend exports.

## 2. Part P10-A - End-to-end run on a developer PC (highest value)

Goal: a developer can start every service on their own machine and complete the core
journeys without errors.

### Services and configuration

- Supabase local stack: `pnpm db:start`, then `pnpm demo:reset` to apply migrations and seed.
- AI service: `cd apps/ai-service && uvicorn app.main:app --reload` (default port 8000).
- Mobile and admin web: `pnpm dev` in `apps/mobile` (Expo). Admin console is the `/admin`
  route rendered on web.
- Environment variables the app reads (confirm each is documented in a `.env.example` and
  actually consumed):
  - `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` (lib/supabase.ts)
  - `EXPO_PUBLIC_AI_SERVICE_URL` (lib/api.ts, components/VoiceButton.tsx; default
    `http://localhost:8000`)
  - `EXPO_PUBLIC_DEMO_MODE` (demo login buttons on merchant/agent/admin login)

### Tasks

1. Confirm the AI service starts on the target Python version and responds to a health
   check and to `POST /ai/report-builder`. Record the exact start command and any
   dependency install step in the run guide.
2. Confirm the mobile app points at the local Supabase and AI service through the
   `EXPO_PUBLIC_*` variables, and that a `.env.example` lists them with local defaults.
3. Walk the merchant journey against the running stack: demo login, receive a simulated QR
   payment, see it booked, view a receipt, run daily closing, open the reports screen,
   preview a report, re-authenticate, export CSV.
4. Walk the agent journey: demo login, view commission summary and wallet breakdown, view
   peak-hour insight, view audit history.
5. Walk the admin journey on web: demo admin login, MFA, portfolio, open a support case,
   grant time-boxed access, read case transactions, propose and approve a feature flag,
   run the payment simulator.
6. Capture every error found as a separate fix task. Fixes must keep pgTAP, typecheck,
   lint, and the web bundle green.

### Acceptance criteria

- All three journeys complete with no unhandled error in the app or service logs.
- The run guide (see Part P10-C) reproduces the setup from a clean checkout.
- `supabase db reset` then the full pgTAP suite still passes.

### Run-safety

After any fix: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `npx supabase test db`,
`npx expo export --platform web`. Heavy or device tests only on request.

## 3. Part P10-B - Demo data and reset polish

Goal: `pnpm demo:reset` yields a believable, self-consistent Bangladeshi dataset that makes
every screen show meaningful content, so a demo never lands on an empty state.

### Tasks

1. Review `supabase/seed/seed.sql` so that each demo business has: recent QR payments,
   cash sales, expenses, baki given and collected, at least one refund, a closed day and a
   reopened day, agent float events with commission, and enough 90-day history for the
   forecast and insights to produce output.
2. Ensure demo accounts exist for merchant owner, agent owner, and the three admin roles,
   and that the demo login buttons map to them.
3. Confirm reports return non-empty rows for the default 7-day window for the demo merchant,
   and that the agent commission and wallet reports return rows for the demo agent.

### Acceptance criteria

- Every primary screen shows real content immediately after `demo:reset`.
- No screen shows an error or a permanently empty state in demo mode.

## 4. Part P10-C - Run guide and docs refresh

Goal: a new developer can go from clone to running in one pass.

### Tasks

1. Update `docs/00-README.md` (or add a short `RUNNING.md`) with the exact ordered commands
   for Supabase, AI service, and the app, including the Windows notes (Docker Desktop must
   be running; relaunch if it stops).
2. Add or verify `.env.example` for `apps/mobile` and `apps/ai-service`.
3. Update `docs/11-testing-qa-devops.md` with the current test commands and the pgTAP count.
4. Keep English only and no emojis per CLAUDE.md.

### Acceptance criteria

- Following the guide on a clean checkout reaches all three running journeys.

## 5. Part P10-D - Security and hardening pass (lightweight)

Goal: confirm the security posture in `docs/09-security-privacy-compliance.md` holds after
phases A through E, without adding new surface.

### Tasks

1. Spot-check that every new RPC from phases A through E has `revoke execute ... from
   public, anon` and the correct role or owner gate (report_rows, log_export, commission
   and wallet summaries, baki reminder, receipt link, history, reauth).
2. Confirm no new table is missing RLS.
3. Confirm no secret is read into the app bundle; service keys stay in the AI service and
   Edge Functions.
4. Confirm the re-auth gate is present on every sensitive RPC named in `docs/09` section 9
   (refund, reversal, reopen, export).

### Acceptance criteria

- The security checklist in `docs/09` is unchanged or improved; pgTAP still proves the
  role, RLS, and reauth gates.

## 6. Part P10-E - Export expansion (optional, future)

`docs/07-api-specification.md` describes exports in `json|csv|xlsx|pdf` with a short-lived
signed URL and an audit row. The shipped Phase E does CSV with an in-app share and a 24-hour
`exports` audit record. The following is deferred and only done if asked:

### Tasks

1. XLSX output (a workbook per report), generated either client side or in the AI service
   as a pure formatter over rows that still come from `report_rows` (numbers never computed
   by the AI).
2. Optional PDF summary for the daily closing report.
3. Supabase Storage upload with a 15-minute signed URL, replacing or supplementing the
   in-app share, with the signed URL recorded against the `exports` row.

### Acceptance criteria

- Any new format reuses `report_rows` as the single source of numbers.
- Storage access is owner-only and the signed URL expires.

## 7. Sequencing

1. P10-A end-to-end run (prove it works), fixing issues as found.
2. P10-B demo polish, so the working system also demos well.
3. P10-C run guide, so others can reproduce it.
4. P10-D security spot-check, as a gate before calling it done.
5. P10-E export expansion, only if requested.

Each part is agreed before it starts, and no part is considered complete until the
run-safety checks in Part P10-A pass.

## 8. Part P9-plus - Optional admin console enhancements

These are additions to the existing admin web console
(`apps/mobile/app/admin/index.web.tsx`), not fixes. The console today has six sections:
Portfolio, Support, Health, Flags, Audit, Simulator. All admin writes already go through
one RPC, `admin_command(p_action, p_body, p_request_id)`, which enforces: a reason of 3 to
240 characters, an idempotency key, maker-checker on flag approval, and an audit row in
`admin_audit_events`. Any enhancement below must keep these same guarantees and must not let
the admin move money or edit the ledger. Numbers shown to the admin come from the database,
never computed in the client or by the AI.

Grounding (what exists now):

- `admin_dashboard()` returns portfolio, activity, closing, AI health, evaluations, support
  cases, feature flags, pending flag requests, businesses, and audit, in one payload.
- `admin_command()` accepts exactly four actions: `grant`, `resolve`, `propose_flag`,
  `approve_flag`. `propose_flag` whitelists only the keys `ai.forecast` and `ai.assistant`.
- `admin_case_transactions()` reads a business's transactions only while a support grant is
  active (60-minute window), and every read is written to `access_log`.
- Case access is time-boxed through `admin_access_grants` and `access_log`.
- Risk signals exist today only per business, through `review_queue(business_id)`; there is
  no platform-wide risk view.
- Exports have an established pattern from Phase E: a deterministic `report_rows` source plus
  an audited `log_export` and an `exports` record.

How the work is done, for every item below:

- Database first: add a `security definer` RPC with `set search_path`, an admin-role check
  via `private.admin_role('upay_admin')`, and `revoke execute ... from public, anon` then
  `grant execute ... to authenticated`. Any write action is routed through `admin_command`
  as a new `p_action`, so it inherits reason, idempotency, maker-checker where needed, and
  the audit row. Read-only views can be their own RPC or folded into `admin_dashboard()`.
- Tests next: a pgTAP file proving the role gate, the audit row, and (for writes) idempotency
  and maker-checker, before any UI.
- UI last: a new section or panel in the existing web console, using the current `adminRpc`
  and `useAdminCommand` helpers and the existing Bangla and English locale keys pattern.
- Run-safety after each item: `pnpm typecheck`, `pnpm lint`, `pnpm test`,
  `npx supabase test db`, `npx expo export --platform web`. One item at a time; each leaves
  the project runnable.

### 8.1 Platform-wide risk oversight (recommended, highest value)

- What: one screen listing the riskiest items across all businesses in the last window, so
  an admin sees platform risk at a glance. Signal types, each already definable from the
  ledger: large pending settlements, refund spikes, agent float variance, and large daily
  closing variance. Each row shows business, signal type, amount or magnitude, and age.
  Read-only; opening a business for detail still requires a support case and a grant.
- How: a new read-only RPC, for example `admin_risk_signals(p_limit int)`, that unions the
  signal queries bounded to a recent window and ordered by severity, admin-only. Optionally
  surface the top few in `admin_dashboard()` for a Portfolio badge. No new write path.
- Acceptance: the list is admin-only (pgTAP proves a non-admin is refused), every number
  traces to journal or settlement data, and the window and row cap are bounded.

### 8.2 Admin CSV export of audit and portfolio (recommended, low risk)

- What: let an admin export the admin audit log and the portfolio KPI snapshot as CSV for
  compliance and reporting.
- How: reuse the Phase E pattern. A deterministic read (the audit rows, or the portfolio
  aggregate) plus a new `admin_command` action, for example `export_audit`, that writes an
  `exports` row and an `admin_audit_events` row, so the export itself is audited. CSV is
  built client side from the returned rows, as the merchant reports screen already does.
- Acceptance: export is admin-only, the export action is itself audited, and the CSV
  contents match the on-screen rows.

### 8.3 Portfolio drill-down per business (bonus, read-only)

- What: clicking a business in Portfolio opens a read-only panel with that business's KPIs,
  its open support cases, and its last activity date. Transaction-level detail stays behind a
  support grant.
- How: extend `admin_dashboard()` output, or add `admin_business_overview(p_business_id)`,
  admin-only and read-only. No new write path.
- Acceptance: admin-only, read-only, and no transaction detail is shown without an active
  grant.

### 8.4 Support SLA metrics (bonus, low risk)

- What: show overdue open-case count and average resolution time on Portfolio or Health.
- How: compute from `support_cases` timestamps inside `admin_dashboard()`; no new write path.
- Acceptance: numbers come from case timestamps and match the case list.

### 8.5 AI output review (optional)

- What: a panel listing recent insight and forecast outputs with their facts JSON, where an
  admin can mark an output wrong. This closes the loop with the "wrong feedback" count the
  Health section already shows.
- How: a read-only RPC over the existing AI output and facts tables, plus a new
  `admin_command` action to record the wrong-mark, audited. The AI is not invoked; this only
  reviews stored outputs.
- Acceptance: admin-only, the mark is audited, and the Health count reflects new marks.

### 8.6 Generalize feature flags

- What: let the Flags section manage more keys than `ai.forecast`, for example `ai.insights`,
  `offers`, and `baki_reminder`, so an admin can turn a capability off per business or
  globally.
- How: extend the `propose_flag` whitelist in `admin_command` to the agreed key list, seed
  the new keys in `feature_flags`, and render them in the Flags UI from the dashboard payload
  instead of hard-coding `ai.forecast`. Maker-checker and audit are unchanged.
- Caveat: `ai.assistant` stays hidden. The product direction is proactive insights, not a
  chatbot, so that key is not surfaced in the UI even though the flag row exists.
- Acceptance: each new key proposes and approves through the same maker-checker path, pgTAP
  proves the gate and audit, and the UI lists every managed key.

### 8.7 Admin user management

- What: an admin section to invite a new admin and to suspend one, with role selection.
- How: new `admin_command` actions, for example `invite_admin` and `suspend_admin`, each
  requiring `upay_admin`, a reason, an idempotency key, maker-checker (a second admin
  approves), and an audit row. Operate on the admin-user table the console already reads;
  never touch merchant or agent memberships. MFA remains required to reach the console.
- Acceptance: non-admin refused, the second-admin approval is enforced, every change is
  audited, and a suspended admin can no longer pass `private.admin_role`.

### 8.8 Broadcast notice

- What: let an admin publish a short platform notice shown as a banner to merchants or
  agents, and retire it later.
- How: a new `notices` table with RLS (everyone reads active notices for their role, only the
  RPC writes), a new `admin_command` action to publish or retire a notice (reason,
  idempotency, audit), and a small banner surface in the mobile app. No money, no ledger.
- Acceptance: publish and retire are admin-only and audited, the banner shows only active
  notices for the viewer's role, and reads are RLS-scoped.

### Sequencing for Part P9-plus

All eight items are in scope. Build order, cheapest and safest first, each as its own chunk
(database, then pgTAP, then UI), with the run-safety checks passing before the next:

1. 8.2 Admin CSV export (reuses the Phase E pattern).
2. 8.4 Support SLA metrics (dashboard-only).
3. 8.3 Portfolio drill-down (read-only).
4. 8.1 Platform-wide risk oversight (read-only; migration already drafted).
5. 8.5 AI output review.
6. 8.6 Generalize feature flags.
7. 8.7 Admin user management (sensitive; maker-checker and MFA).
8. 8.8 Broadcast notice.

Each item is agreed before it starts. Part P10-A end-to-end verification can run in parallel
or after, as preferred.

---

## 9. Update: October 2026 UI redesign - verification

| Check | How | Status |
|---|---|---|
| Typecheck | `pnpm --filter mobile typecheck`, `packages/ui` `tsc --noEmit` | pass |
| Lint | `eslint app components lib` (mobile), `eslint src` (ui) | pass, 0 warnings |
| Unit tests | `pnpm --filter mobile test` (17 tests incl. PIN and demo ledger), `packages/shared` (money incl. taka sign) | pass |
| Merchant screens render | web demo, 375 x 812, all 16 merchant routes | pass |
| Agent screens render | web demo, all agent routes | pass |
| Login, PIN create, wrong PIN, unlock | web demo | pass |
| Native device check (Android/iOS), 200% font, reduced motion | real devices | pending |
| Live backend with new UI | `pnpm demo:up` + `pnpm --filter mobile dev` | pending (see docs/10 section C) |
