# 14 - Role separation and the AI insights layer

This document records a design decision that refines, but does not replace, the product in
docs 00-13. It is the spec for two pieces of work: making the Merchant and Agent experiences
two independent role-based systems under one upay platform, and turning the AI from a set of
endpoints into a visible "Today's Insights" layer that greets the user after login.

Nothing here is a rebuild. It reuses the existing ledger, RPCs, RLS, and AI service; it
organises and scopes them by role, and assembles the signals that already exist into a
role-specific daily briefing on the home screen.

## 1. Principle

Two independent role-based experiences under one upay ecosystem.

- A person is either a Merchant or an Agent. One account is one role; a person is never both,
  so there is no Shop/Agent switch.
- An Agent is a upay service provider with their own upay customers (cash-in, cash-out, send
  money). A Merchant is a shop; upay customers pay into the shop.
- A Merchant account must never see or reach an Agent feature, and the reverse. This holds at
  three layers: navigation (a wrong-role screen redirects home), data (RLS scopes every row
  to the business), and AI (each role gets only its own engine's output).
- Shared infrastructure stays shared: the authentication framework, the database, the model
  serving, and genuinely common screens (receive QR, the transaction list base). Shared does
  not mean identical: the same transaction list shows sales for a Merchant and cash-in/out for
  an Agent, with different filters and labels.

## 2. Login

Today there is one login screen (`app/(auth)/login.tsx`): phone OTP, with the role resolved
from membership after sign-in. This becomes two separate entrances under one auth backend.

```
                       Landing
            +-------------------------------+
            |   Merchant door | Agent door  |
            +--------+-----------------+-----+
                     |                 |
              Merchant OTP        Agent OTP      (same OTP mechanism)
                     |                 |
              role matches?      role matches?   (an agent number used at the
                     |                 |          merchant door is told to use
               Merchant app       Agent app       the agent entrance)
```

- The two doors differ in copy and branding, not in the auth mechanism.
- After OTP, the account's actual role (from `me()`) is checked against the chosen door. A
  mismatch shows a clear message pointing the user to the correct entrance, rather than
  signing them into the wrong experience.
- The server remains the source of truth for role; the door is a front-of-house choice.

## 3. Feature separation

| Area | Merchant | Agent | Shared |
|---|---|---|---|
| Home | sales and business overview | float and cash overview | - |
| Receive (QR) | - | - | yes |
| Transactions | sales, expense, baki rows | cash-in/out, send, commission rows | base list, role-specific filters and labels |
| Cash sale, expense, baki | yes | - | - |
| Suppliers and payables | yes | - | - |
| Daily closing | yes | - | - |
| Planner / safe-to-withdraw | yes | - | - |
| Review queue, refund | yes | - | - |
| Manual other-wallet entry | - | yes | - |
| Day-end float audit | - | yes | - |
| Commission | - | yes | - |
| Offers | yes (shop offers) | yes (agent-funded only) | component shared, scope per role |

Enforcement: role-specific screens are wrapped so a wrong-role account is redirected home
(`components/RoleGuard.tsx`); the server still checks role on every RPC, so the guard is
navigation hygiene, not the security boundary.

## 4. AI as an intelligence layer, not a chatbot

The AI is not a chat product and there is no "Ask AI" button. After login the home screen is
a "Today's Insights" feed: the AI analyses the business's own data and explains, in Bangla,
what matters today, what may happen, what needs attention, and what to prepare for. The AI
makes no decisions and moves no money; the owner decides.

Hard rule, unchanged from docs 08 and CLAUDE.md: the AI never computes a number. Every figure
in an insight comes from the ledger or a facts view; the text only phrases it. For the demo
the phrasing is deterministic Bangla templates, so it is reliable and works with no LLM key.

### 4.1 Merchant insights (examples)

| Card | Source (already in the project) |
|---|---|
| Sales prediction for today | `forecast_runs` sales7d / `/forecast/sales` |
| Cash-flow and upcoming supplier payments | `get_safe_to_withdraw`, supplier payables |
| Sales trend (for example digital share rising) | `v_llm_kpi_facts` / `/ai/kpi-explain` |
| Customer activity change | baki `customer_balances`, distinct payers |
| Attention: pending reconciliation | `review_queue` |
| Yesterday summary | `v_llm_daily_summary` / `/ai/briefing` |

### 4.2 Agent insights (examples)

| Card | Source |
|---|---|
| Cash and e-float demand for today | `forecast_runs` float24h / `/forecast/float` |
| Liquidity read: can current cash meet expected demand | `v_llm_float_facts` + float forecast |
| Peak-hour expectation (new, section 6) | hourly transaction history |
| Customer activity change | distinct payer hashes over time |
| Attention: unusual activity | `ai_anomaly_flags` / `/anomaly` |
| Pending settlement or status review | `review_queue` |
| Yesterday summary | daily float and transaction totals |

Each insight is a card with an icon name (not an emoji), a severity (good, warn, bad, info),
a Bangla title and body, and an optional action route into the relevant screen.

## 5. Customer and payer activity (approximate)

An Agent's and a Merchant's own customers are described only in aggregate, because payer
identity is not stored: a payer is a per-merchant opaque token, hashed with a secret salt
(docs 09). So the insight can report "about N distinct customers, M active this week, K new"
by counting distinct payer hashes over time windows; it cannot show names or profiles, except
the Merchant's named baki customers. This is honest and privacy-preserving, and it improves
with real data (the demo seed carries few payer tokens today).

## 6. New work

Almost everything above reuses existing signals. The genuinely new pieces are:

1. `today_insights(business_id)` - a server-side aggregator that gathers the role's existing
   signals (forecast, anomaly flags, pending, KPIs, float or cash-flow) and returns a
   prioritised list of insight cards. Deterministic; numbers come from facts.
2. Agent peak-hour prediction - a simple model over the agent's hourly transaction history
   that estimates busy periods (for example high 5pm-8pm), surfaced as one insight card.

Out of scope for now (considered and dropped): AI chatbot, agent e-float auto-rebalancing
advice, merchant baki reminder scoring, and any cross-role AI (a Merchant never receives an
Agent prediction and the reverse).

## 7. Implementation phases (each must keep the project runnable)

After every phase: `pnpm typecheck`, `pnpm lint`, `pnpm test`, pgTAP, and a web bundle build
must pass, and `pnpm demo:up` plus `pnpm --filter mobile dev` must still work.

1. Separate login (landing with two doors, role verification).
2. `today_insights` aggregator RPC (role-scoped), with pgTAP.
3. Home becomes the Today's Insights feed, merchant and agent variants.
4. Role-scope the existing AI so no cross-role output is possible.
5. Agent peak-hour predictor, surfaced as an insight.
6. Documentation updates in docs 03 and 08 to point at this layer.

## 8. Relationship to the existing docs

- docs 02 (roles): one account is one role here; the permission matrix is unchanged.
- docs 04 (UI): the home screen's "one AI card" becomes the Today's Insights feed; the
  at-most-three-actions and status-as-icon-plus-word-plus-colour rules still hold.
- docs 08 (AI/ML): the forecast, anomaly, briefing, assistant and parse capabilities are
  unchanged; this document scopes them by role and adds the aggregator and peak-hour.
- docs 09 (security): payer anonymity and the no-fabricated-numbers validator are the reason
  section 5 is aggregate-only and section 4 keeps numbers in facts.
