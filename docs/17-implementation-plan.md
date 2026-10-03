# 17 - Implementation plan: frontend and backend after the UI redesign

This plan lists every remaining piece of work across the mobile app, the database and Edge
Functions, the AI service and the admin web. It is built from the code as it stands on
4 October 2026 (`apps/mobile`, `supabase/migrations`, `supabase/functions`,
`apps/ai-service`), not from the earlier plans, and it says for each item what exists, what
is missing and exactly how to build it so the backend fits the redesigned UI (docs/16).

Status legend: **Done** = built and verified · **Partial** = exists but not wired or not
complete · **Missing** = not built · **Demo only** = works on the sample-data source only.

---

## 1. Ground rules for every item

1. **Contract first.** For each RPC change: write the migration, then update
   `packages/shared` (schema + args helper), then `apps/mobile/lib/api.ts`, then the demo
   client `apps/mobile/lib/demo/client.ts` with the same shape and error codes, then the
   screen. The demo and the live backend must never disagree.
2. **Ledger rules do not move.** Integer poisha, double-entry, append-only, corrections by
   reversal, every write through a `SECURITY DEFINER` RPC that checks role and takes an
   idempotency key, RLS on every new table, no client-supplied `business_id` trusted.
3. **Definition of done** (CLAUDE.md plus docs/16): types pass, pgTAP for every DB rule,
   Vitest for client logic, Bangla + English strings in `locales/experience.ts`, no lint
   warnings, verified/manual source visible on money rows, one amber button per screen,
   motion only where docs/16 section 8.2 allows it, demo client updated.
4. **Verification per item:** `pnpm db:test`, `pnpm --filter mobile typecheck test lint`,
   then the screen checked twice: once on `web:demo`, once on the live local stack
   (`pnpm demo:up` + `pnpm --filter mobile dev`).

---

## 2. Where everything stands

### 2.1 Mobile app (frontend)

| Area | Status | Notes |
|---|---|---|
| Design tokens, icon set, UI kit, motion, feedback | Done | `packages/ui`, `components/kit.tsx`, `motion.tsx`, `lib/feedback.ts` |
| Welcome, OTP, device PIN, forgot PIN, lock now | Done | Verified on web demo; native device check pending |
| Shell, tab bar, Home (merchant, agent) | Done | |
| Transactions (digital / manual tabs, detail sheet, reversal) | Done | |
| Receive QR, sample payment confirmation | Done / Demo only | Live payments do not reach the screen yet (no Realtime) |
| Cash sale, expense, other wallet, baki, baki entry, suppliers | Done | Other-wallet **cash-in** fails on live backend (no `p_direction`) |
| Closing (3 steps, note counter), agent audit, history | Done | Uses `cash_lines` / `opening_cash_minor` only when present |
| Planner, review, refund, commission, reports, offers | Done | Review cannot resolve a flag yet; offers cannot be redeemed at the counter |
| Settings, notifications, onboarding | Done / Partial | Notifications are derived from insights |
| Staff experience (staff tabs, my shift) | Missing | docs/04 section 5 |
| Business health / KPI screen | Missing | docs/03 M12 |
| Disputes, "who viewed my data" | Missing | docs/03 M16, Flow H |
| Dark mode, 200% font QA, native haptics/sound | Missing / Partial | |
| Admin web redesign | Missing | `app/admin/index.web.tsx` still old style |
| Onboarding extras (show QR now, practice payment, 30 s video) | Missing | docs/04 section 14 |

### 2.2 Backend (Supabase, Edge Functions, AI service)

| Area | Status | Notes |
|---|---|---|
| Ledger, posting RPCs, idempotency, RLS | Done | 0001-0002, pgTAP |
| Payment ingress webhook + simulator + receipt page | Done | `payment-webhook`, `simulator-pay`, `receipt` |
| Baki, closing, reopen, history | Done | |
| Agent float audit, commission, wallet breakdown | Done | |
| Suppliers and payables incl. `confirm_payable`, `cancel_payable` | Done | UI uses create/pay only |
| Refunds, `refundable_remaining`, review queue, `resolve_anomaly_flag` | Done / Partial | `review_queue` lacks `flag_id` and `blocker` |
| Offers, `redeem_offer`, `stamp_progress`, results | Done | Redemption not used by the UI |
| Forecast, safe-to-withdraw, what-if (withdrawal only), insights, peak hours | Done | |
| Reports, exports, re-auth window | Done | |
| Admin console RPCs, access grants, `access_log`, support cases | Done | Owner-facing view of `access_log` missing |
| `post_manual_wallet` direction | Missing | Needed by the new other-wallet screen |
| Notifications table / read API | Missing | |
| Realtime for live payments | Missing | Client subscription and publication setup |
| Staff invite, permissions, shifts | Missing | Memberships hold `role` and `permissions`, no RPCs to manage them |
| Disputes for merchants | Missing | Support cases exist on the admin side only |
| Suggested payment matching (M7) | Missing | Only flags and settlement review exist |
| What-if beyond withdrawal (move a bill, sales -/+%) | Missing | |

---

## 3. Phase A - Make the new UI fully live (contract alignment)

Goal: every screen of the redesign works against the real backend exactly as on the demo.
Do this first; nothing later depends on new product decisions.

### A1. Other-wallet direction (Missing, S)

- **Backend:** new migration `post_manual_wallet` with `p_direction text default 'cash_out'`
  (check `in ('cash_out','cash_in')`, else `22023 WALLET_DIRECTION_INVALID`). Lines:
  cash_out = Dr 1030 / Cr 1000 (today), cash_in = Dr 1000 / Cr 1030. Write the direction
  into `transactions.category` (`cash_out` / `cash_in`) so lists can label it; include it
  in the idempotency hash. Drop and re-grant the old signature. Guard: cash-in may not take
  a wallet below zero (`INSUFFICIENT_WALLET`).
- **pgTAP:** both postings balanced; replay with the same `client_uuid` returns the first
  row; cash-in larger than the wallet balance is refused; staff without `can_add_entries`
  refused.
- **Frontend:** `rpc.ts` already sends `p_direction` for cash-in; add the two error codes to
  `bn.json` / `en.json`. `lib/view.ts` already reads `category` for the label.
- **Done when:** a cash-in entry on the live stack shows "গ্রাহক নগদ দিল" with the drawer up.

### A2. Closing preview fields (Partial, S)

- **Backend:** extend `closing_preview` with `opening_cash_minor` (drawer balance at the
  start of the business day) and `cash_lines` (signed sum of `1000` movements per kind for
  the day). Keep `lines` for compatibility.
- **pgTAP:** `opening + sum(cash_lines) = expected_cash_minor`.
- **Frontend:** none (the closing screen already prefers these fields); remove the
  `CASH_KINDS` fallback filter once live data always has them.

### A3. Review queue that can be acted on (Partial, S)

- **Backend:** add `flag_id`, `blocker boolean` (unmatched payment above the business
  threshold, default Tk 2,000, matching closing's rule) and `reason_en` to `review_queue`.
  `resolve_anomaly_flag(p_flag_id)` already exists; add a `p_note text` overload that
  writes an `audit_events` row.
- **Frontend:** review card gets two buttons: "ঠিক আছে, মিলিয়েছি" (resolve, with an
  optional note in a sheet) and "সাহায্য নিন" (opens support, see C2). After resolving:
  success toast, list and Home to-do refresh, closing blockers disappear.
- **Demo client:** add `resolve_anomaly_flag` and remove the flag.
- **Done when:** the Tk 2,450 settlement blocker can be cleared and closing then needs no
  exception reason.

### A4. Live "payment received" (Missing, M)

- **Backend:** add `transactions` to the `supabase_realtime` publication. RLS already
  limits rows to members. No payload change.
- **Frontend:** a `usePaymentStream()` hook in `lib/api.ts`, mounted once in
  `app/(app)/_layout.tsx`: subscribe to `INSERT` on `transactions` filtered by
  `business_id`, `source = verified`, kind `QR_PAYMENT` (merchant) or the agent kinds.
  On event: invalidate `transactions`, `balances`, `today-insights`, then show the
  existing `SuccessSheet` (payment variant) with `feedback("success")`. Debounce bursts;
  never show amounts in OS notifications (docs/03 M18).
- **Demo client:** emit the same event from `simulator-pay` so the code path is shared.
- **Done when:** a payment from the simulator or webhook pops the confirmation on any
  screen within 2 s.

### A5. Notifications (Missing, M)

- **Backend:** table `notifications(id, business_id, kind, severity, title_bn, title_en,
  body_bn, body_en, route, created_at, read_at)` with RLS by membership; writers:
  payment ingest (count only, no amount), review flag creation, payable due tomorrow
  (pg_cron 08:00), day not closed by closing time + 1 h (pg_cron), offer auto-paused.
  RPCs `list_notifications(p_business_id, p_limit)`, `mark_notifications_read(p_business_id, p_ids uuid[])`.
- **Frontend:** `app/notifications.tsx` switches from insights to `list_notifications`
  (insights stay as the first section); bell badge = unread count; mark read on open.
- **Done when:** badge counts drop after viewing; pgTAP covers RLS and the cron writers.

### A6. Settlement status on rows (Partial, S)

- **Today:** a pending settlement is only visible as `wallet = 'pending'`.
- **Backend:** expose `settlement_status` (`settled` / `pending`) in a view
  `v_transactions_ui` used by the list query, so the UI does not depend on the wallet text.
- **Frontend:** `useTransactions` reads the view; the detail sheet's Settlement pill uses
  the field.

### A7. Live-stack pass (S)

Run every screen on `pnpm demo:up` with the seeded accounts, compare against `web:demo`,
and fix any shape differences in one place (`lib/api.ts`). Record results in docs/15.

---

## 4. Phase B - Wire backend features that already exist

### B1. Offer redemption at the counter (Partial, M)

- **Exists:** `redeem_offer`, `stamp_progress`, `stamp_cards`, `offer_redemptions`.
- **Frontend:** after a cash sale or in the payment confirmation, when an active offer
  applies, show one line "অফার প্রযোজ্য: ৳30 ছাড়" with "প্রয়োগ করুন"; for stamp cards,
  "স্ট্যাম্প দিন" with the customer's phone or receipt token. Show progress `৩/৫`.
- **Backend:** add `applicable_offers(p_business_id, p_amount_minor)` that returns offers
  the amount qualifies for (no client-side rule evaluation).
- **Done when:** a redemption updates the offer's budget bar and auto-pause works.

### B2. Bills: confirm draft, cancel, partial history (Partial, S)

- **Exists:** `confirm_payable`, `cancel_payable`, `payable_payments`.
- **Frontend:** supplier sheet shows draft bills (from recurring cycles) with "নিশ্চিত"
  and "বাতিল (কারণসহ)"; a bill row opens its payment history.

### B3. Refund limits (Partial, S)

- **Exists:** `refundable_remaining`.
- **Frontend:** refund screen shows "সর্বোচ্চ ফেরত ৳X" and caps the keypad; already-
  refunded payments show a "আংশিক ফেরত" pill in the detail sheet.

### B4. Agent float forecast chart (Partial, S)

- **Exists:** `get_forecast('float24h')` with hourly p50/p90.
- **Frontend:** on the Float tab, an hourly bar row for the rest of today with one
  takeaway line ("বিকাল ৫-৮টা নগদ বেশি লাগবে, অন্তত ৳40,000 রাখুন"). Same chart component
  as the planner.

### B5. Business health screen (Missing UI, M)

- **Exists:** `v_llm_kpi_facts`, `llm_facts_kpis`, AI `/ai/kpi-explain`.
- **Backend:** `business_health(p_business_id)` returning the docs/03 M12 KPIs with
  formula, value and rule-based status (good/watch/alert), no hidden score.
- **Frontend:** new route `app/health.tsx` (owner/manager), tile on Home in place of
  Reports for merchants without exports, each KPI a row with icon + word + colour and a
  "কীভাবে হিসাব?" sheet with the formula.

### B6. Receipt preview inside the app (Partial, S)

- **Exists:** `get_receipt`, the public `receipt` function.
- **Frontend:** "রসিদ দেখুন" in the detail sheet renders the receipt card in-app (same
  content as the web page) before sharing.

---

## 5. Phase C - New features (backend and frontend together)

### C1. Staff and shifts (Missing, L) - docs/03 M17, docs/04 section 5

- **Backend:** `invite_staff(p_business_id, p_phone, p_role, p_permissions)` creating a
  pending membership claimed on that phone's first sign-in; `update_staff_permissions`,
  `revoke_staff` (kills sessions, keeps history); `shifts(id, business_id, user_id,
  opened_at, closed_at, opening_cash_minor, counted_cash_minor)` with `start_shift`,
  `end_shift` (same variance posting as closing, scoped to the staff member's rows).
  pgTAP for every permission path.
- **Frontend:** owner: Settings -> "স্টাফ" list, invite sheet, permission toggles.
  Staff: their own tab set (Receive, My transactions, Add cash sale, My shift) built from
  the existing kit; the Home grid already hides tiles by permission.

### C2. Disputes for merchants (Missing, M) - docs/03 M16, Flow E

- **Backend:** reuse `support_cases`; add owner RPCs `open_dispute(p_business_id,
  p_transaction_id, p_reason)`, `list_disputes`, `add_dispute_evidence` (storage bucket
  with RLS), deadline from `support_sla_rules`.
- **Frontend:** "সমস্যা জানান" in the detail sheet; `app/disputes.tsx` with a countdown
  pill (icon + word + colour) and status timeline.

### C3. Suggested matches (Missing, L) - docs/03 M7

- **Backend:** `matches` table and `suggest_matches` job: exact reference match ->
  auto-matched; otherwise score by amount, time proximity and partial reference against
  open payables / baki; `accept_match`, `reject_match` RPCs with audit.
- **Frontend:** review cards gain "এটি কি Invoice #1048? (৯২%)" with Accept / Reject.

### C4. What-if extensions (Missing, M) - docs/03 M10

- **Backend:** `simulate_plan(p_business_id, p_withdraw_minor, p_move_payable_id,
  p_move_to, p_sales_pct)` reusing the safe-to-withdraw formula; still pure calculation.
- **Frontend:** planner what-if becomes a sheet with three inputs; the result keeps the
  single takeaway line plus the lowest-day figure.

### C5. "Who viewed my data" (Partial backend, S) - Flow H

- **Backend:** owner RPC `my_access_log(p_business_id)` over `access_log` (support views
  with case id, scope and time).
- **Frontend:** Settings -> নিরাপত্তা -> "কে আমার তথ্য দেখেছে".

### C6. Onboarding value moment (Missing, S) - docs/04 section 14

- **Frontend:** after `create_business`, show the QR immediately and a "practice payment"
  that calls the simulator in demo deployments only, labelled "অনুশীলন, আসল টাকা নয়".
- **Backend:** none beyond `simulator-pay` (already gated by `DEMO_MODE`).

---

## 6. Phase D - Platform quality

| ID | Item | How |
|---|---|---|
| D1 | Native haptics and sound | Clean `pnpm install` (the copied `node_modules` blocks adding packages), `npx expo install expo-haptics expo-audio`, fill the two drivers in `lib/feedback.ts`; short bundled sound files under `assets/sounds` |
| D2 | Dark mode | Add `tokens.dark` for every colour role, a `useTheme()` in the kit, then audit contrast (docs/04 section 6.3) |
| D3 | 200% font and narrow phones | Run every screen at 360 x 640 with font scale 2; FeatureGrid already drops to 3 columns; fix truncation in hero and lists |
| D4 | Reduced motion | Verify on device that sheets fade, numbers jump, success remains |
| D5 | Offline UX | Show queued entries in the Manual tab with a "সিঙ্ক হয়নি" pill from the outbox store; retry button already in the banner |
| D6 | Performance | `FlatList` windowing for 400+ rows, memoised rows (done for TxnItem), move `useTransactions(400)` to paginated reads |
| D7 | Metro watcher | Move the repo off OneDrive or enable polling (`CHOKIDAR_USEPOLLING=1`) so edits hot-reload |
| D8 | Time format | Bangla day-part words ("সকাল/দুপুর/রাত") instead of AM/PM in `useFormatters` |

## 7. Phase E - Admin web

Rebuild `app/admin/index.web.tsx` on shared tokens (not the mobile kit): left nav,
KPI cards, data tables with filters, status badges (icon + word + colour), SLA timers.
Split the 800-line file into routes per page (portfolio, support, campaigns, AI health,
flags, audit). Backend RPCs already exist.

## 8. Phase F - Release hardening

| ID | Item | How |
|---|---|---|
| F1 | Demo source off in production | Build-time check in `scripts/security-check.mjs`: fail if `EXPO_PUBLIC_DATA_SOURCE` is set or the Supabase URL is missing for a production profile |
| F2 | End-to-end tests | Maestro (or Detox) flows: sign in + PIN, cash sale, closing, agent audit, refund with re-auth |
| F3 | CI | Add `web:demo` smoke test (load each route, fail on console errors) and the new Vitest files to `.github/workflows/ci.yml` |
| F4 | Security checklist | docs/09 section 10 items: PIN storage, FLAG_SECURE on PIN screens, lock-screen privacy |
| F5 | Docs | Update docs/15 status table after each phase |

---

## 9. Order and rough size

| Order | Items | Size | Why this order |
|---|---|---|---|
| 1 | A1, A2, A3, A6, A7 | S each | Small contract fixes that make the redesign fully live |
| 2 | A4, A5 | M | The two "alive" features users notice most |
| 3 | B1-B6 | S-M | Backend already exists; mostly frontend work |
| 4 | D1, D3, D4, D7, D8 | S-M | Device quality before more features |
| 5 | C1 (staff) | L | Biggest new capability for real shops |
| 6 | C2, C4, C5, C6 | S-M | Trust and planning features |
| 7 | C3 (matching) | L | Needs real payment references to tune |
| 8 | D2, D5, D6, E, F | M | Polish, admin and release |

S = up to half a day, M = one to two days, L = three days or more, for one developer
with the AI build playbook (docs/13).

## 10. Per-item checklist (copy into each PR)

- [ ] Migration + pgTAP (RLS, role, idempotency, balanced lines)
- [ ] `packages/shared` schema and args helper
- [ ] `lib/api.ts` hook with cache invalidation
- [ ] `lib/demo/client.ts` same shape and errors
- [ ] Screen built from the kit; Bangla + English copy in `locales/experience.ts`
- [ ] Verified/manual source shown where money appears
- [ ] Motion and sound only per docs/16 section 8
- [ ] Checked on `web:demo` and on the live local stack
- [ ] docs/15 status row updated
