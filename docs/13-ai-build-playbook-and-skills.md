# 13 — AI Build Playbook & Agent Skills

How to build BizFlow fast and correctly with AI coding agents (Claude Code / Cowork, ChatGPT/Codex, Cursor). The rule: **give the agent this documentation set as context, build phase by phase, and make it run the tests after each phase.**

## 1. Recommended agent skills

Skills are packaged instructions that make coding agents follow best practices. Directory: [skills.sh](https://www.skills.sh/). Install with `npx skills add <owner/repo>` (works for Claude Code, Cursor, Codex and others).

| Need | Skill (repo) | Install | Use in phase |
|---|---|---|---|
| Expo app, Router, native UI, data fetching, EAS | **Expo skills** (`expo/skills`) — e.g. `expo-router`, `expo-ui`, `building-native-ui`, `native-data-fetching`, `expo-tailwind-setup`, `eas-update`, `eas-workflows` | `claude plugin install expo@claude-plugins-official` (Claude Code) or `npx skills add expo/skills` | P0, P2–P5, P8–P10 |
| React Native performance & patterns | `vercel-react-native-skills`, `vercel-react-best-practices`, `vercel-composition-patterns` (`vercel-labs/agent-skills`) | `npx skills add vercel-labs/agent-skills` | P2–P5, P8 |
| Web UI quality (admin, receipt page) | `web-design-guidelines` (`vercel-labs/agent-skills`) | same as above | P3, P9 |
| Supabase & Postgres (RLS, indexes, functions) | `supabase`, `supabase-postgres-best-practices` (`supabase/agent-skills`) | `npx skills add supabase/agent-skills` | P1, P3, P8 |
| Distinctive UI design | `frontend-design` (`anthropics/skills`) | `npx skills add anthropics/skills` | P2, P10 |
| UI/UX system & tokens | `ui-ux-pro-max` (`nextlevelbuilder/ui-ux-pro-max-skill`) | `npx skills add nextlevelbuilder/ui-ux-pro-max-skill` | P2 |
| Mobile design patterns | `sleek-design-mobile-apps` (`sleekdotdesign/agent-skills`) | `npx skills add sleekdotdesign/agent-skills` | P2, P4 |
| Test-driven development | `tdd` (`mattpocock/skills`) | `npx skills add mattpocock/skills` | P1, P6, P10 |
| Plan stress-test / requirement interview | `grill-me`, `grill-with-docs` (`mattpocock/skills`) | same | before P0 |
| Code review | `code-review` (`mattpocock/skills`) | same | end of each phase |
| Find more skills | `find-skills` (`vercel-labs/skills`) | `npx skills add vercel-labs/skills` | any time |

Skills already available in this Claude (Cowork) workspace and useful for deliverables: **frontend-design**, **ui-design-system**, **dataviz** (charts), **pptx** (pitch deck as PowerPoint if needed), **xlsx** (economics calculator), **pdf**, **docx**.

> Review any third-party skill before installing (it is code/instructions run by your agent). Prefer official repos (expo, vercel-labs, supabase, anthropics).

## 2. `CLAUDE.md` / `AGENTS.md` for the repo (copy to repo root)

```markdown
# BizFlow — agent instructions

## Product
upay BizFlow: Bangla-first mobile app for upay merchants & agents. Payments from any
Bangla QR app → automatic books, receipts, daily closing, agent float audit, offers, AI advice.
Docs: /docs/00-README.md … 13 (source of truth). Read the relevant doc before each task.

## Non-negotiables
- Money = bigint poisha. Never floats.
- Ledger is double-entry & append-only. Corrections = reversal + replacement. No UPDATE/DELETE.
- All writes through Postgres RPC (SECURITY DEFINER, role check, idempotency key).
- RLS on every table. Never trust business_id from the client.
- AI never moves money or edits records. LLM never computes numbers: facts JSON → text → validator.
- No secrets in the app. Service keys only in Edge Functions / AI service env.
- UI: Bangla strings via i18n, ≤ 3 actions per screen, ≤ 1 AI card per screen, status = icon+word+colour.

## Stack
Expo SDK 56 (RN 0.85, React 19.2), Expo Router, TypeScript strict, NativeWind, TanStack Query, Zustand,
Zod, expo-sqlite outbox, Supabase (Postgres, Auth OTP, RLS, Realtime, Edge Functions, pg_cron, pgmq),
FastAPI + LightGBM AI service, LLM gateway.

## Commands
pnpm dev | pnpm test | pnpm lint | supabase start | supabase test db | pnpm demo:reset | (ai) uv run pytest

## Definition of done per task
Types pass, tests added & passing (pgTAP for DB), Bangla strings added, no new lint warnings,
security checklist items untouched or improved, docs updated if behaviour changed.
```

## 3. Phase prompts (paste one at a time)

Each prompt assumes the docs are in `/docs` and the agent has read `CLAUDE.md`.

**P0 — Setup**
> Read docs 00, 05 and 13. Create a pnpm + Turborepo monorepo exactly as in 05 §3: Expo SDK 56 app with Expo Router, TypeScript strict, NativeWind, i18next (bn default, en), TanStack Query; `packages/shared` (Zod, money utils with tests), `packages/ui` (tokens from 04 §5); Supabase folder initialised; FastAPI service with `/v1/health`. Add GitHub Actions: lint, typecheck, unit tests. Run everything and show me the app on web.

**P1 — Data core**
> Read docs 06 and 09. Write Supabase migrations for all tables in 06 §3, the chart of accounts seeding function (06 §4), posting RPCs following 06 §5, deferred balanced-entry trigger, append-only triggers, RLS policies and helper functions (06 §9). Write pgTAP tests for 06 §8 rules and 11 §2 T-03..T-06. Then write the synthetic seed (06 §11) for 12 merchants and 6 agents, 180 days. Run `supabase test db`.

**P2 — Auth & shell**
> Read docs 02 and 04. Implement phone OTP login (test OTP in dev), PIN setup with expo-local-authentication, `/me` membership fetch, route groups (merchant/agent/staff/admin) with guards, Shop⇄Agent switch, bottom tabs per 04 §3 with raised QR button, components MoneyText, StatusPill, AICard, ActionList, AmountKeypad. All strings in bn.json.

**P3 — Payments & receipts**
> Read 03 (M2, M3, M19) and 07 §13–14. Implement Edge Function `payment-webhook` (HMAC + timestamp, idempotent insert, pgmq enqueue, `post_payment` RPC), `simulator/pay`, Realtime subscription with banner + sound, Transactions inbox with filters and separate statuses, dynamic QR screen, public receipt page `/r/[token]`. Add tests T-01, T-02, T-17.

**P4 — Merchant books**
> Read 03 (M4–M8). Build quick cash sale, expense, baki, suppliers & payables, review queue (exact match), and the daily closing flow with preview, counted cash, variance, blockers, exception reason, versioned closing receipt and reopen with re-auth. Offline outbox for manual entries (05 §6). Tests T-07, T-08, T-09.

**P5 — Agent**
> Read 03 (M9) and 06 §5 agent posting rules. Build the agent book with type chips, manual other-wallet entries labelled Manual, float screen (verified vs manual), day-end audit for cash + each wallet, commission view.

**P6 — Predictive AI**
> Read 08 §4–§9, §12–§13. In `apps/ai-service`: synthetic data generator + DATA_DICTIONARY.md; baselines; global LightGBM quantile models for sales7d and float24h with conformal calibration; rolling-origin backtest producing the metrics table in 08 §12.3; match scorer; anomaly rules + IsolationForest with Bangla reason codes; endpoints from 07 §16; DB jobs that store results in forecast tables and `ai_outputs`. Implement SQL fallbacks. Fail CI if quality gates in 11 §3 fail.

**P7 — Language AI**
> Read 08 §11. Implement the LLM gateway with facts builders (SQL views), placeholder-based generation and number validator; briefing; assistant with read-only tools under the user's JWT, citations, refusals; voice/text parse with a Bangla number normalizer (half/thousand/lakh word forms and Bangla digits) and tests; expense categorizer; report builder with enum intents and CSV/XLSX export; KPI explanations. Add the 100-question Bangla assistant test set and prompt-injection tests (T-12, T-13, T-14, T-15).

**P8 — Planner & offers**
> Read 08 §6, §10 and 03 (M10, M11). Implement safe-to-withdraw RPC using the lowest-projected-day algorithm and buffer rules, `/planner/simulate`, Planner UI with band chart and visible formula; offers CRUD, receipt rendering, stamp cards with consent, budget cap auto-pause (T-16), offer advisor and results with difference-in-differences.

**P9 — Admin web**
> Read 02 and 04 §7. Build `/admin` (web only): portfolio KPIs (12 §4), support cases with SLA timers from config (09 §6), case-scoped access grants with access_log, AI health dashboard, feature flags & kill switches (T-10, T-18), simulator panel.

**P10 — Harden & demo**
> Run the security checklist (09 §9) and all tests in 11 §2; fix failures. Add empty/error/offline states, performance pass on a low-end Android profile, `pnpm demo:reset` (10 §A.4), and walk through the demo script (12 §8) twice; list anything that fails.

## 4. Working method with AI agents

1. **One phase per session**; start each with "read docs X, Y" and end with tests + a short changelog.
2. **Ask for a plan first**, approve, then implement.
3. **Never accept money code without tests** (pgTAP for DB rules).
4. **Use `grill-me`** before P0 to find gaps; use `code-review` after each phase.
5. Keep **`/docs` updated** when decisions change — agents read them every session.
6. Commit after each green phase; tag `demo-ready` after P10.

## 5. Deliverables checklist for submission

- [ ] Repo with README, CLAUDE.md, docs/ (this set)
- [ ] Live web link + Android dev build/APK
- [ ] 3-minute demo video
- [ ] Pitch deck (10–12 slides) following 12 §7
- [ ] AI evaluation report (metrics table, model cards)
- [ ] Economics calculator (sheet or in-app)
- [ ] Architecture diagram + security one-pager
