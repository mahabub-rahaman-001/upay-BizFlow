# 16 - Mobile UI redesign

This document is the plan and record for the full mobile UI redesign. It refines docs/04
(design system) and docs/14 (role separation); where they disagree, docs/04 rules still win
on principles (number first, status is icon plus word plus colour, one amber button per
screen, thumb zone) and this file wins on layout.

## 1. What was wrong (audit of the running app)

| Area | Problem | Effect on the user |
|---|---|---|
| Home | AI insight cards took a large block above the balance | The money (what the owner opens the app for) was pushed down |
| Home | Shortcuts were a long text list | Slow to scan; no familiar bKash/Rocket style grid |
| Shell | Tab icons were placeholder glyphs (`H`, `=`, `%`) | Looked unfinished; icons carried no meaning |
| Login | OTP only; a PIN component existed but was never wired | No familiar PIN unlock, no "Forgot PIN?" recovery path |
| Transactions | Hand-written entries (cash sale, expense, other-wallet) were mixed into the provider list | The owner could not tell proven money from typed money at a glance |
| Books / Float | Several equally large balance cards, then letter-icon action rows | No hierarchy; the day-end ritual was buried |
| Money entry | Keypad at the top, options below, Save far away | Thumb travel; position of Save not obvious |
| Suppliers / Baki | Add forms always open inline | Busy screens; list and form fought for space |
| Offers | Its own local colour tokens and emoji icons | Off-brand; emojis break the no-emoji rule |
| Everywhere | Inline styles per screen, `x` and `>` text as icons | No consistent design language |
| Without backend | Every screen called Supabase directly | With no backend running the app stopped at login |

## 2. Direction

- **Trust blue structure, amber action, traffic-light status.** Brand blue for headers and the
  balance hero, one amber primary button per screen, green/amber/red only for status and always
  with an icon and a word.
- **Two kinds of money, two looks.** Provider-verified records (QR payments, upay cash-in/out)
  use the white card with a blue check. Hand-written records use a warm paper tint with a pen
  mark and the word "হাতে লেখা". The two never share one undifferentiated list.
- **Compact intelligence.** AI insights live in one slim strip under the header (one line at a
  time, paged, with a count). Tapping opens the full list with "Why?" facts. No AI card is ever
  the biggest thing on a screen.
- **Familiar grid.** A 4 x 2 grid of feature tiles (3 columns on narrow phones or large fonts)
  mirrors the MFS apps the user already knows.
- **Thumb zone.** Keypads and the Save button sit at the bottom on every money screen.

## 3. Information architecture

```
(auth)  welcome (language, merchant/agent door) -> phone -> OTP -> set PIN
        returning device: PIN unlock -> "Forgot PIN?" -> OTP -> new PIN
(app)   tabs: Home | Transactions | [Receive QR] | Books (merchant) / Float (agent) | Offers
        Home -> notifications, settings, every feature tile
        Merchant: cash-sale, expense, baki (customer khata) -> baki-entry, suppliers,
                  closing, planner, review, refund, reports, history
        Agent:    manual-wallet, agent-audit, commission, history, reports
```

## 4. Screen plan

| Screen | Layout (top to bottom) |
|---|---|
| Welcome | Brand mark, language switch, two door cards (shop / agent point), trust note |
| Phone | Step 1 of 2, +88 prefix field, Send code |
| OTP | Six-digit boxes, 30 s resend timer, change number, demo code hint in demo mode |
| Set PIN | Five dots, own keypad, confirm step, mismatch error |
| PIN unlock | Shop name, five dots, keypad, wrong-PIN message with attempts left, "পিন ভুলে গেছেন? ->", lock after 5 tries, "অন্য নম্বরে প্রবেশ" |
| Home | Header (shop, verified, bell, profile) -> insight strip -> balance hero (hide/show, cash and digital split, today in/out) -> 4 x 2 feature grid -> "আজকের কাজ" (max 3) -> recent activity (3 rows, source marked) |
| Agent home | Same frame; hero shows e-float, drawer cash and other wallets with a liquidity bar; today counters (cash-in, cash-out, send money, commission) |
| Transactions | Segmented "ডিজিটাল (যাচাই করা)" / "হাতে লেখা খাতা"; per-segment in/out summary; search; filter chips; rows grouped by day; detail sheet with statuses, receipt share, correction |
| Receive | Blue stage, white QR card, verified name, "any app" chips, ask-for-amount sheet, share; demo payment shows the green "payment received" banner |
| Books (merchant) | Today strip (sales, expenses, baki due) -> 2 x 2 entry tiles -> closing status card -> baki and supplier due previews |
| Float (agent) | Three balances with source marks -> movement explainer -> audit status -> commission -> manual wallet breakdown |
| Money entry | Header with "record only" badge -> big amount -> chips and note -> keypad -> pinned Save |
| Closing / audit | Day summary -> count with denomination helper -> difference with status word -> note / exception -> Close; completion receipt |
| Baki | Total owed, customer list with search and remind, add customer sheet; tap a customer -> gave / received entry |
| Suppliers | Total due and overdue, supplier list, bill and pay sheets |
| Planner | Safe-to-withdraw hero with confidence, "Why?" formula, 7-day range bars with one takeaway, what-if, record a withdrawal |
| Offers | Status segments, offer cards with budget bar, 3-step wizard with receipt preview |
| Settings | Profile header, business, security (change PIN, lock app), language, reports and history, help, sign out, version |

## 5. Running without a backend (demo data source)

`EXPO_PUBLIC_DATA_SOURCE=demo` (or no Supabase URL) swaps `lib/supabase.ts` for
`lib/demo/client.ts`, an object with the same surface the app uses: `auth` (OTP sign-in,
session, sign-out), `rpc(name, args)` and `from(table)` reads. Behind it is
`lib/demo/ledger.ts`, an in-memory double-entry ledger seeded with realistic merchant and agent
data (integer poisha, append-only, reversals instead of edits). The screens do not know which
source they use; when the real backend is ready the flag is removed and nothing else changes.

Run it with `pnpm --filter mobile web:demo`. Demo login: any `01XXXXXXXXX` number, code
`123456`, then choose any five-digit PIN.

## 6. PIN model

The PIN is a device unlock on top of the OTP session, the way MFS apps work: OTP proves the
phone number once, the PIN unlocks the app on this device afterwards. It is stored only as a
salted, iterated SHA-256 hash (`lib/pin.ts`), five wrong attempts lock it and force an OTP
reset. Changing the PIN asks for the current PIN. Nothing about the PIN is sent to the server.

## 7. Backend gaps found while designing (to build later)

1. `post_manual_wallet` only records an other-wallet cash-out (wallet up, drawer down). The UI
   now asks for direction; cash-in (drawer up, wallet down) needs a `p_direction` parameter.
2. No notifications table: the bell lists today's insights and review items.
3. No realtime payment push to the app: the "payment received" banner is driven by the
   simulator today and should subscribe to Realtime on `transactions` later.
4. Server-side PIN (for a new device without SMS) is out of scope; reset always uses OTP.

## 8. Motion, interaction and sound

### 8.0 Philosophy

The app should feel modern, responsive and alive, but it is a financial business tool.
Target: **fast + calm + trustworthy + modern + responsive**. The user should notice "this
app responds immediately", not "this app has lots of animations". Premium through restraint.

**Do not add animation everywhere.** The pattern for every action is:

```text
tap -> tiny feedback -> action -> clear result -> optional subtle sound or haptic
```

Animation is allowed only to:

- confirm that an action happened
- explain a navigation or state change
- make the interface feel responsive
- give feedback during money actions

It must never slow down a workflow or pull attention from balances, transactions or the
primary action.

Avoid: bouncing, large screen transitions, continuous decorative animation, long loading
animations, animating every element, heavy gradients or glow, confetti in money flows.

Priority for every money action, in order:

```text
1. Correct information
2. Clear action
3. Immediate feedback
4. Subtle animation
5. Optional sound / haptic
```

Animation or sound must never hide, delay or confuse an amount, a balance, a transaction
status, an error, the verified/manual source or a payment completion.

### 8.1 Motion tokens (`tokens.motion`, used by every screen)

One central motion system; no screen defines its own timing.

| Token | Value | Use |
|---|---|---|
| `press` | 100 ms, scale 0.98 (primary CTA 0.97) | Button and tile press feedback (80-120 ms range) |
| `fast` | 150 ms | Small state changes: chips, segments, tab indicator (150-200 ms) |
| `standard` | 220 ms | Card or section change, number transition, toast, page change (200-300 ms) |
| `sheet` | 280 ms ease-out | Bottom sheet in, scrim fades with it (250-320 ms) |
| `success` | 350 ms | Success check and amount settle; whole sequence under 700 ms (250-400 ms) |

Easing: ease-out for entering elements, ease-in-out for state changes, spring only for
small interactive elements (the success check). Nothing loops except the skeleton shimmer.

### 8.2 Where motion is used (and only here)

| Moment | Motion |
|---|---|
| Any button | Normal -> pressed (scale 0.98, slight opacity/elevation change) -> released -> action feedback. Primary CTA reacts slightly more (0.97) than secondary buttons. Never a dramatic shrink or bounce |
| Quick-action tile (Cash sale, Expense, Float...) | The tapped tile compresses for 100-150 ms with a very small elevation change, then the screen opens. The grid itself never animates |
| Tab change | Active icon and label colour change and the small indicator moves, 150 ms. No page swiping; navigation feels instant |
| Page change | Default native push, 200-300 ms; no custom large transitions |
| Bottom sheet (transaction details, add supplier, baki payment, filters, AI "why", confirmation) | Slides up 280 ms ease-out over a subtle dimmed scrim |
| Amount being typed | The figure updates smoothly (`AnimatedMoney`, 220 ms), never jumps abruptly |
| Balance changed by an action | Eases from old to new value so the user sees "my balance changed because of this", e.g. `৳17,900 -> ৳18,400`. Used only on the balance hero, entry amount, today's sales, cash/float, commission and the closing difference. Never on list rows, never exaggerated counting |
| Payment received (QR) | `SuccessSheet`, see 8.3 |
| Cash sale / expense / baki saved (manual) | `SuccessSheet` in manual mode, see 8.3 |
| Day closing / agent audit done | `SuccessSheet` with the difference and its status word |
| New AI insight | Fade plus a 6 px rise when the strip first shows a card; at most one small icon pulse, once |
| Loading of a major screen | Skeleton blocks shaped like the content, soft shimmer only; inline spinner only for small operations |
| Pull to refresh (transactions, balance, notifications, offers) | Native control, then a quiet "Updated just now" line |

AI elements are quiet: never constant glow, repeated pulsing, spinning AI icons or large
gradient animation. The AI is a calm assistant, not an advertisement.

### 8.3 Success confirmations

Payment received (verified):

```text
        (check)
   Payment received
        +৳850
   bKash  [verified]
```

Manual entry:

```text
        (check)
   Cash sale added
        ৳500
   [hand-written]  Record only, no money moved
```

Sequence, all under ~700 ms: the check appears -> a very small scale-up -> the amount fades
and slides 8 px into place -> the state settles -> the screen returns or offers the next
action. The verified or manual badge is always visible. No confetti.

### 8.4 Haptics (`lib/feedback.ts`)

| Level | When |
|---|---|
| Light | Button press, toggle, filter selection, tab selection, tile tap |
| Medium | Successful payment, successful transaction, day closing complete |
| Warning | Failed payment, important mismatch, security warning, wrong PIN |

Never repeated or strong vibration.

### 8.5 Sound

A very small library of soft sounds, low volume, each under ~300 ms:

| Sound | When | Meaning |
|---|---|---|
| Very soft tap/click | Only important confirm actions (for example confirming a payment), not ordinary taps | "pressed" |
| Short soft chime/tick | Successful transaction, entry saved, day closed | "done" |
| Payment confirmation | Payment verified after a QR payment | "the money arrived" |
| Soft security tick | PIN accepted, PIN reset complete, signed in | "verified" |
| Low gentle tone | Error, failed payment, mismatch | "look again", never an alarm |

The sound should say "the action completed successfully", not "something exciting happened".

Never play sound for: scrolling, opening cards, tab navigation, keypad presses, list items,
background AI updates, passive notifications.

Settings has independent switches, both on by default and stored on the device, separate
from notification settings:

```text
Sound effects     ON
Haptic feedback   ON
```

Implementation today: every call goes through `feedback(event)` in `lib/feedback.ts`.
Haptics use React Native's built-in `Vibration` on Android and `navigator.vibrate` on web;
sounds are short synthesized tones (Web Audio) on web. Native sound and iOS haptics need
`expo-audio` and `expo-haptics`, which could not be added because the workspace
`node_modules` was copied from another folder; after a clean `pnpm install`, run
`npx expo install expo-haptics expo-audio` and fill in the two native drivers in that one file.

### 8.6 Reduced motion and accessibility

When the system "reduce motion" setting is on:

- decorative transitions are disabled and movement is reduced
- sheets and toasts fade instead of sliding
- numbers jump straight to the new value
- the success check appears without scaling, skeletons stop shimmering
- success and error feedback itself is never removed

The app must be fully usable with no animation at all.

## 9. Implementation status (2026-10-04)

Built and verified on web (demo data, 375 x 812, Bangla) for both roles:

| Area | Files |
|---|---|
| Tokens, motion, icons, kit | `packages/ui/src/tokens.ts`, `components/AppIcon.tsx`, `components/kit.tsx`, `components/motion.tsx`, `lib/feedback.ts` |
| Demo data source | `lib/demo/ledger.ts`, `lib/demo/client.ts`, `lib/supabase.ts`, `scripts/web-demo.mjs` |
| Auth and PIN | `app/(auth)/login.tsx`, `components/auth.tsx`, `lib/pin.ts`, lock gate in `app/_layout.tsx` |
| Shell and tabs | `app/(app)/_layout.tsx` |
| Screens | Home, Transactions, Receive, Books/Float, Offers, cash sale, expense, other wallet, baki, baki entry, suppliers, closing, agent audit, planner, review, refund, commission, history, reports, settings, notifications, onboarding |
| Tests | `__tests__/pin.test.ts` (SHA-256 vectors, weak PINs), `__tests__/demo-ledger.test.ts` (balanced, non-negative, realistic seed) |

Not redesigned: the desktop admin console (`app/admin/index.web.tsx`).

Note for local work: on this OneDrive folder the Metro file watcher does not pick up
edits; restart `pnpm --filter mobile web:demo` after changing code.

## 10. Phases

1. Tokens, icon set, shared kit, demo data source, PIN library.
2. Auth (welcome, OTP, PIN set, unlock, forgot PIN), shell and tab bar, Home (both roles).
3. Transactions (digital / manual split, detail sheet), Receive and payment banner.
4. Money entry screens, Baki khata, Suppliers.
5. Books and Float hubs, Closing, Agent audit, History.
6. Planner, Offers, Review, Refund, Commission, Reports.
7. Settings (including Sound effects and Haptic feedback switches), notifications, onboarding.
8. Motion pass: apply section 8 to every screen through the shared kit only, then check
   reduced motion.
9. QA: typecheck, lint, tests, web preview at 360 x 640 and 390 x 844, Bangla and English.
