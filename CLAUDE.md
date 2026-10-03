# BizFlow - agent instructions

## Product
upay BizFlow: Bangla-first mobile app for upay merchants and agents. Payments from any
Bangla QR app become automatic books, receipts, daily closing, agent float audit, offers
and AI advice. Full specs live in /docs (00-README through 13). Read the relevant doc
before each task.

## Non-negotiables
- Money is stored as integer poisha (bigint). 1 taka = 100 poisha. Never use floats for money.
- The ledger is double-entry and append-only. Corrections are a reversal plus a replacement.
  Never UPDATE or DELETE posted financial rows.
- All writes go through Postgres RPC (SECURITY DEFINER) that check role and take an idempotency key.
- Row Level Security on every table. Never trust a business_id sent by the client.
- AI never moves money or edits records. The LLM never computes numbers: facts JSON then text,
  then a validator confirms every number came from the facts.
- No secrets in the app bundle. Service keys live only in Edge Functions / the AI service env.
- No emojis anywhere in code or docs. All docs in English. UI ships Bangla-first via i18n.
- UI rule: at most 3 action items and 1 AI card per screen; status is icon plus word plus color.

## Stack
Expo SDK 56 (React Native 0.85, React 19.2), Expo Router, TypeScript strict, NativeWind,
TanStack Query, Zustand, Zod, expo-sqlite outbox, Supabase (Postgres, Auth OTP, RLS,
Realtime, Edge Functions, pg_cron, pgmq), FastAPI + LightGBM AI service, provider-agnostic
LLM gateway.

## Commands
pnpm dev | pnpm test | pnpm lint | pnpm typecheck
pnpm db:start | pnpm db:push | pnpm demo:reset
AI service: cd apps/ai-service && uvicorn app.main:app --reload

## Definition of done per task
Types pass, tests added and passing (pgTAP for DB rules), Bangla strings added to locales,
no new lint warnings, security checklist untouched or improved, docs updated if behaviour changed.

## Build order (see docs/13)
P0 setup, P1 data core, P2 auth and shell, P3 payments and receipts, P4 merchant books,
P5 agent, P6 predictive AI, P7 language AI, P8 planner and offers, P9 admin web, P10 harden and demo.
This scaffold covers P0 and the start of P1. Continue phase by phase.
