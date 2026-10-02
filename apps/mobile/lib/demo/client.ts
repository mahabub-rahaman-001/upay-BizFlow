/**
 * A stand-in for the Supabase client, used when the app runs without a backend
 * (EXPO_PUBLIC_DATA_SOURCE=demo, docs/16 section 5). It implements exactly the surface the
 * app calls - auth, rpc, from(table) reads and functions.invoke - on top of the demo
 * ledger, and answers with the same shapes and the same "CODE: message" errors as the real
 * RPCs, so screens cannot tell the difference.
 *
 * Nothing here talks to a network. It is sample data for UI work and demos only.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { formatMoney } from "@bizflow/shared";
import {
  AGENT_ID,
  DB_VERSION,
  MERCHANT_ID,
  addDays,
  balanceOf,
  createSeedDb,
  customerBalance,
  dhakaDate,
  linesFor,
  newId,
  postTxn,
  todayDhaka,
  type DemoDb,
  type Txn,
  type TxnKind,
} from "./ledger";

type Result<T = unknown> = { data: T | null; error: { message: string } | null };
type Session = { access_token: string; user: { id: string; phone: string } };

const DB_KEY = "bizflow.demo.db";
const SESSION_KEY = "bizflow.demo.session";
const USERS_KEY = "bizflow.demo.users";
export const DEMO_OTP = "123456";
export const DEMO_PHONES = { merchant: "+8801700000001", agent: "+8801700000002" } as const;

interface DemoUser { id: string; phone: string; business_id: string | null }

let db: DemoDb | null = null;
let session: Session | null = null;
let users: DemoUser[] = [];
let entranceHint: "MERCHANT" | "AGENT" | null = null;
const listeners = new Set<(event: string, session: Session | null) => void>();

let loading: Promise<void> | null = null;
/** Loads (or seeds) the demo on first use, so a live build never pays for it. */
function ready(): Promise<void> {
  loading ??= load();
  return loading;
}

async function load() {
  try {
    const [rawDb, rawSession, rawUsers] = await Promise.all([
      AsyncStorage.getItem(DB_KEY), AsyncStorage.getItem(SESSION_KEY), AsyncStorage.getItem(USERS_KEY),
    ]);
    const stored = rawDb ? (JSON.parse(rawDb) as DemoDb & { seeded_on?: string }) : null;
    // A demo seeded on an earlier day would show an empty "today", so it is re-seeded.
    db = stored && stored.version === DB_VERSION && stored.seeded_on === todayDhaka() ? stored : null;
    session = rawSession ? (JSON.parse(rawSession) as Session) : null;
    users = rawUsers ? (JSON.parse(rawUsers) as DemoUser[]) : [];
  } catch {
    db = null;
  }
  if (!db) {
    db = createSeedDb();
    persist();
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function persist() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void AsyncStorage.setItem(DB_KEY, JSON.stringify({ ...db, seeded_on: todayDhaka() })).catch(() => undefined);
    void AsyncStorage.setItem(USERS_KEY, JSON.stringify(users)).catch(() => undefined);
  }, 250);
}

/** Lets the login screen tell the demo which door the user chose, so a new number lands there. */
export function setDemoEntrance(entrance: "MERCHANT" | "AGENT" | null) {
  entranceHint = entrance;
}

/** Wipes the demo back to its seed. Settings offers this as "Restart demo". */
export async function resetDemoData() {
  await ready();
  db = createSeedDb();
  persist();
}

function fail(code: string, message = code): Result<never> {
  return { data: null, error: { message: `${code}: ${message}` } };
}
function ok<T>(data: T): Result<T> {
  return { data, error: null };
}
const delay = (ms = 160) => new Promise((resolve) => setTimeout(resolve, ms));

function currentUser(): DemoUser | null {
  if (!session) return null;
  return users.find((u) => u.id === session!.user.id) ?? null;
}

function bizOf(args: Record<string, unknown>) {
  const id = String(args.p_business_id ?? "");
  const user = currentUser();
  if (!user || user.business_id !== id) return null;
  return db!.businesses.find((b) => b.business_id === id) ?? null;
}

const bnMoney = (minor: number) => formatMoney(minor, { bangla: true, currency: "taka-sign" });
const enMoney = (minor: number) => formatMoney(minor, { currency: "Tk" });

function txnsOf(businessId: string) {
  return db!.txns.filter((t) => t.business_id === businessId);
}
function onDay(t: Txn, date: string) {
  return dhakaDate(t.occurred_at) === date;
}
const reversedIds = (businessId: string) => new Set(txnsOf(businessId).map((t) => t.reverses_txn_id).filter(Boolean) as string[]);

function postingResult(txn: Txn, replayed = false) {
  return { transaction_id: txn.id, entry_id: newId(), kind: txn.kind, amount_minor: txn.amount_minor, replayed };
}

/** Same client_uuid twice replays the first entry instead of posting a second one. */
function replay(businessId: string, clientUuid: unknown) {
  if (typeof clientUuid !== "string") return null;
  return db!.txns.find((t) => t.business_id === businessId && t.client_uuid === clientUuid) ?? null;
}

function post(businessId: string, kind: TxnKind, source: "verified" | "manual", amount: number, extra: Partial<Txn> & { paidFrom?: "cash" | "wallet"; direction?: "cash_out" | "cash_in" } = {}) {
  const { paidFrom, direction, ...rest } = extra;
  const txn = postTxn(db!, {
    business_id: businessId, kind, source, amount_minor: amount,
    wallet: null, category: null, note: null, reference: null, customer_id: null, reverses_txn_id: null, client_uuid: null,
    occurred_at: new Date().toISOString(),
    lines: linesFor(kind, amount, { paidFrom, direction }),
    ...rest,
  });
  persist();
  return txn;
}

function requireAmount(args: Record<string, unknown>) {
  const amount = Number(args.p_amount_minor);
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}

// ---------------------------------------------------------------------------
// Derived figures (all deterministic; nothing here is "AI")
// ---------------------------------------------------------------------------

const SALE_KINDS: TxnKind[] = ["QR_PAYMENT", "CASH_SALE", "BAKI_SALE"];
const AGENT_SERVICE: TxnKind[] = ["AGENT_CASH_IN", "AGENT_CASH_OUT", "AGENT_SEND_MONEY"];

function dailySales(businessId: string, date: string) {
  return txnsOf(businessId).filter((t) => onDay(t, date) && SALE_KINDS.includes(t.kind)).reduce((s, t) => s + t.amount_minor, 0);
}
function avgDaily(businessId: string, kinds: TxnKind[], days = 14) {
  const today = todayDhaka();
  let sum = 0;
  for (let i = 1; i <= days; i++) {
    const date = addDays(today, -i);
    sum += txnsOf(businessId).filter((t) => onDay(t, date) && kinds.includes(t.kind)).reduce((s, t) => s + t.amount_minor, 0);
  }
  return Math.round(sum / days);
}

function salesForecast(businessId: string) {
  const today = todayDhaka();
  const avg = avgDaily(businessId, SALE_KINDS);
  const days = Array.from({ length: 7 }, (_, i) => {
    const day = addDays(today, i);
    const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
    const factor = weekday === 5 ? 1.3 : weekday === 3 ? 0.82 : 1;
    const p50 = Math.round((avg * factor) / 10000) * 10000;
    return { day, p10_minor: Math.round(p50 * 0.78 / 10000) * 10000, p50_minor: p50, p90_minor: Math.round(p50 * 1.2 / 10000) * 10000 };
  });
  return {
    capability: "sales7d", cutoff_date: addDays(today, -1), model_version: "demo-baseline-1", confidence: "medium" as const,
    abstained: false, abstain_reason: null, days, hours: null,
    advice_en: "Wednesday is usually your slowest day.", advice_bn: "বুধবার সাধারণত সবচেয়ে কম বিক্রি হয়।",
  };
}

function floatForecast(businessId: string) {
  const today = todayDhaka();
  const avgCashOut = avgDaily(businessId, ["AGENT_CASH_OUT"]);
  const hours = [] as { date: string; hour: number; p50_minor: number; p90_minor: number }[];
  for (let hour = 9; hour <= 21; hour++) {
    const weight = hour >= 17 && hour <= 20 ? 0.13 : 0.045;
    const p50 = Math.round((avgCashOut * weight) / 10000) * 10000;
    hours.push({ date: today, hour, p50_minor: p50, p90_minor: Math.round(p50 * 1.35 / 10000) * 10000 });
  }
  return {
    capability: "float24h", cutoff_date: addDays(today, -1), model_version: "demo-baseline-1", confidence: "medium" as const,
    abstained: false, abstain_reason: null, days: [], hours,
    advice_en: "Cash-out is usually heaviest between 5 pm and 8 pm.", advice_bn: "বিকাল ৫টা থেকে রাত ৮টা ক্যাশ আউট সবচেয়ে বেশি হয়।",
  };
}

function openPayables(businessId: string) {
  return db!.payables.filter((p) => p.business_id === businessId && ["CONFIRMED", "PARTIALLY_PAID", "OVERDUE"].includes(p.status));
}

function safeToWithdraw(businessId: string) {
  const today = todayDhaka();
  const cleared = balanceOf(db!, businessId, "1000") + balanceOf(db!, businessId, "1010");
  const forecast = salesForecast(businessId);
  const avgExpense = avgDaily(businessId, ["EXPENSE"]);
  const dues = openPayables(businessId);
  let balance = cleared;
  let lowest = cleared;
  let lowestDay = today;
  let duesWeek = 0;
  for (const day of forecast.days) {
    // Bills due on this day; anything already overdue counts on the first day.
    const dueToday = dues.filter((p) => { const due = p.due_date ?? today; return due === day.day || (day.day === today && due < today); })
      .reduce((s, p) => s + p.amount_minor - p.paid_minor, 0);
    duesWeek += dueToday;
    balance += Math.round(day.p10_minor * 0.9) - avgExpense - dueToday;
    if (balance < lowest) { lowest = balance; lowestDay = day.day; }
  }
  const reserve = Math.max(1000000, avgExpense * 3);
  const buffer = Math.round(forecast.days.reduce((s, d) => s + (d.p50_minor - d.p10_minor), 0) * 0.25 / 10000) * 10000;
  const safe = Math.max(0, Math.floor((lowest - reserve - buffer) / 10000) * 10000);
  return {
    available: true, fallback: false, current_cleared_minor: cleared,
    forecast_inflow_p10_7d_minor: forecast.days.reduce((s, d) => s + Math.round(d.p10_minor * 0.9), 0),
    confirmed_expenses_7d_minor: avgExpense * 7, supplier_dues_7d_minor: duesWeek, dispute_refund_hold_minor: 0,
    lowest_projected_day: lowestDay, lowest_projected_balance_p10_minor: lowest, reserve_minor: reserve,
    uncertainty_buffer_minor: buffer, safe_to_withdraw_minor: safe, shortfall_minor: Math.max(0, reserve - lowest),
    confidence: "medium", model_version: "demo-baseline-1",
  };
}

function reviewItems(businessId: string) {
  const ids = new Set(txnsOf(businessId).map((t) => t.id));
  return db!.flags.filter((f) => ids.has(f.transaction_id)).map((f) => {
    const t = db!.txns.find((x) => x.id === f.transaction_id)!;
    return { transaction_id: t.id, amount_minor: t.amount_minor, occurred_at: t.occurred_at, reason_code: f.reason_code, reason_bn: f.reason_bn, blocker: f.blocker };
  });
}

function insightCards(businessId: string, type: "MERCHANT" | "AGENT") {
  const today = todayDhaka();
  const yesterday = addDays(today, -1);
  const cards: Record<string, unknown>[] = [];
  const card = (id: string, icon: string, severity: string, title_bn: string, body_bn: string, title_en: string, body_en: string, facts: Record<string, unknown>, action_route: string | null) =>
    cards.push({ id, icon, severity, title_bn, body_bn, title_en, body_en, facts, action_route });
  const review = reviewItems(businessId);
  if (type === "MERCHANT") {
    const dues = openPayables(businessId).filter((p) => (p.due_date ?? today) <= addDays(today, 7));
    const overdue = dues.filter((p) => (p.due_date ?? today) < today);
    const next = [...dues].sort((a, z) => (a.due_date ?? "").localeCompare(z.due_date ?? ""))[0];
    if (next) {
      const supplier = db!.suppliers.find((s) => s.id === next.supplier_id);
      const remaining = next.amount_minor - next.paid_minor;
      card("supplier-due", "calendar", overdue.length ? "bad" : "warn",
        overdue.length ? "সরবরাহকারীর বিল বাকি পড়েছে" : "সামনে সরবরাহকারীর বিল",
        `${supplier?.name ?? ""} পাবে ${bnMoney(remaining)}${overdue.length ? "; তারিখ পেরিয়ে গেছে।" : `, শেষ তারিখ ${next.due_date}।`}`,
        overdue.length ? "A supplier bill is overdue" : "Supplier bill coming up",
        `${supplier?.name ?? ""} is owed ${enMoney(remaining)}${overdue.length ? "; it is past due." : `, due ${next.due_date}.`}`,
        { amount_minor: remaining, due_date: next.due_date }, "/suppliers");
    }
    if (review.length) {
      card("review", "alert-triangle", "warn", "লেনদেন যাচাই করুন", `${review.length}টি পেমেন্ট দেখে নিশ্চিত করুন। এটি জালিয়াতির প্রমাণ নয়।`, "Payments need a look", `${review.length} payments need a quick check; this is not a finding of fraud.`, { count: review.length }, "/review");
    }
    const f = salesForecast(businessId).days[0]!;
    card("sales-forecast", "trending-up", "info", "আজকের বিক্রির পূর্বাভাস", `আজ আনুমানিক ${bnMoney(f.p10_minor)} থেকে ${bnMoney(f.p90_minor)} বিক্রি হতে পারে।`, "Today's sales estimate", `Estimated sales today: ${enMoney(f.p10_minor)} to ${enMoney(f.p90_minor)}.`, f, "/planner");
    const y = dailySales(businessId, yesterday);
    const count = txnsOf(businessId).filter((t) => onDay(t, yesterday) && SALE_KINDS.includes(t.kind)).length;
    card("yesterday", "calendar", "good", "গতকালের সারাংশ", `গতকাল ${count}টি বিক্রি; মোট ${bnMoney(y)}।`, "Yesterday's summary", `${count} sales yesterday, totaling ${enMoney(y)}.`, { amount_minor: y, count }, "/transactions");
  } else {
    const cash = balanceOf(db!, businessId, "1000");
    const float = balanceOf(db!, businessId, "1010");
    const demand = floatForecast(businessId).hours.filter((h) => h.hour >= new Date(Date.now() + 6 * 3600 * 1000).getUTCHours()).reduce((s, h) => s + h.p90_minor, 0);
    card("liquidity", "wallet", cash < demand ? "warn" : "good", "আজকের নগদ প্রস্তুতি",
      cash < demand ? `বাকি সময়ে নগদ লাগতে পারে ${bnMoney(demand)}; ড্রয়ারে আছে ${bnMoney(cash)}।` : `ড্রয়ারে ${bnMoney(cash)} আছে; বাকি সময়ের চাহিদার জন্য যথেষ্ট।`,
      "Cash readiness today", cash < demand ? `Cash needed for the rest of today may reach ${enMoney(demand)}; drawer has ${enMoney(cash)}.` : `Drawer has ${enMoney(cash)}, enough for the expected demand.`,
      { cash_minor: cash, efloat_minor: float, cash_demand_minor: demand }, "/books");
    card("peak-hours", "clock", "info", "ব্যস্ত সময়", "বিকাল ৫টা থেকে রাত ৮টা ক্যাশ আউট বেশি হতে পারে।", "Busy hours", "5 pm to 8 pm may be the busiest for cash-out.", { start_hour: 17, end_hour: 20 }, "/transactions");
    if (review.length) card("anomaly", "alert-triangle", "warn", "লেনদেন যাচাই করুন", `${review.length}টি অস্বাভাবিক লেনদেন দেখে নিন।`, "Transactions need a look", `${review.length} unusual transactions need a look.`, { count: review.length }, "/transactions");
    const yRows = txnsOf(businessId).filter((t) => onDay(t, yesterday) && AGENT_SERVICE.includes(t.kind));
    card("yesterday", "calendar", "good", "গতকালের সারাংশ", `গতকাল ${yRows.length}টি সেবা লেনদেন; মোট ${bnMoney(yRows.reduce((s, t) => s + t.amount_minor, 0))}।`, "Yesterday's summary", `${yRows.length} service transactions yesterday, totaling ${enMoney(yRows.reduce((s, t) => s + t.amount_minor, 0))}.`, { count: yRows.length }, "/transactions");
  }
  const order: Record<string, number> = { bad: 0, warn: 1, good: 2, info: 3 };
  const bnDigits = (text: unknown) => String(text).replace(/[0-9]/g, (d) => "০১২৩৪৫৬৭৮৯"[Number(d)]!);
  for (const card of cards) { card.title_bn = bnDigits(card.title_bn); card.body_bn = bnDigits(card.body_bn); }
  return cards.sort((a, z) => order[String(a.severity)]! - order[String(z.severity)]!);
}

// ---------------------------------------------------------------------------
// RPC handlers
// ---------------------------------------------------------------------------

type Handler = (args: Record<string, unknown>) => Result | Promise<Result>;

const handlers: Record<string, Handler> = {
  me: () => {
    const user = currentUser();
    if (!user) return fail("NOT_AUTHENTICATED");
    const business = db!.businesses.find((b) => b.business_id === user.business_id);
    return ok({ user_id: user.id, businesses: business ? [business] : [] });
  },

  create_business: (args) => {
    const user = currentUser();
    if (!user) return fail("NOT_AUTHENTICATED");
    const name = String(args.p_name ?? "").trim();
    if (!name) return fail("NAME_REQUIRED", "business name is required");
    const type = args.p_type === "AGENT" ? "AGENT" : "MERCHANT";
    const id = newId();
    db!.businesses.push({ business_id: id, type, name, category: String(args.p_category ?? "other"), upay_account_ref: `UP${type[0]}-${Math.floor(1000 + Math.random() * 8999)}-${Math.floor(1000 + Math.random() * 8999)}`, verified: false, status: "ACTIVE", role: type === "AGENT" ? "agent_owner" : "merchant_owner", permissions: {} });
    const cash = Number(args.p_opening_cash_minor ?? 0);
    const wallet = Number(args.p_opening_wallet_minor ?? 0);
    if (cash > 0) post(id, "OWNER_DEPOSIT", "manual", cash, { note: "Opening cash" });
    if (wallet > 0) post(id, "OWNER_DEPOSIT", "manual", wallet, { note: "Opening wallet", paidFrom: "wallet" });
    user.business_id = id;
    persist();
    return ok({ business_id: id });
  },

  request_reauth: () => ok({ ok: true, expires_in: 300 }),

  get_business_qr: (args) => {
    const b = bizOf(args);
    if (!b) return fail("NOT_A_MEMBER");
    const amount = args.p_amount_minor == null ? null : Number(args.p_amount_minor);
    const payload = `00020101021${amount ? "2" : "1"}26360012bd.upay.qr0116${b.upay_account_ref}5204541153030505802BD5913${b.name.slice(0, 13)}6005Dhaka${amount ? `5409${(amount / 100).toFixed(2)}` : ""}6304DEMO`;
    return ok({ account_ref: b.upay_account_ref, business_name: b.name, verified: b.verified, amount_minor: amount, reference: (args.p_reference as string) ?? null, payload });
  },

  post_cash_sale: (args) => {
    const b = bizOf(args); if (!b) return fail("NOT_A_MEMBER");
    if (b.type !== "MERCHANT") return fail("MERCHANT_BUSINESS_REQUIRED");
    const amount = requireAmount(args); if (!amount) return fail("AMOUNT_INVALID");
    const existing = replay(b.business_id, args.p_client_uuid); if (existing) return ok(postingResult(existing, true));
    return ok(postingResult(post(b.business_id, "CASH_SALE", "manual", amount, { category: (args.p_category as string) ?? null, note: (args.p_note as string) ?? null, client_uuid: String(args.p_client_uuid) })));
  },

  post_expense: (args) => {
    const b = bizOf(args); if (!b) return fail("NOT_A_MEMBER");
    const amount = requireAmount(args); if (!amount) return fail("AMOUNT_INVALID");
    const existing = replay(b.business_id, args.p_client_uuid); if (existing) return ok(postingResult(existing, true));
    const paidFrom = args.p_paid_from === "wallet" ? "wallet" : "cash";
    return ok(postingResult(post(b.business_id, "EXPENSE", "manual", amount, { category: String(args.p_expense_type ?? "other"), note: (args.p_note as string) ?? null, paidFrom, wallet: paidFrom === "wallet" ? "upay" : null, client_uuid: String(args.p_client_uuid) })));
  },

  post_manual_wallet: (args) => {
    const b = bizOf(args); if (!b) return fail("NOT_A_MEMBER");
    if (b.type !== "AGENT") return fail("AGENT_BUSINESS_REQUIRED");
    const amount = requireAmount(args); if (!amount) return fail("AMOUNT_INVALID");
    const wallet = String(args.p_wallet ?? "").trim(); if (!wallet) return fail("WALLET_REQUIRED");
    const existing = replay(b.business_id, args.p_client_uuid); if (existing) return ok(postingResult(existing, true));
    const direction = args.p_direction === "cash_in" ? "cash_in" : "cash_out";
    return ok(postingResult(post(b.business_id, "MANUAL_WALLET", "manual", amount, { wallet, category: direction, direction, note: (args.p_note as string) ?? null, client_uuid: String(args.p_client_uuid) })));
  },

  post_owner_withdrawal: (args) => {
    const b = bizOf(args); if (!b) return fail("NOT_A_MEMBER");
    const amount = requireAmount(args); if (!amount) return fail("AMOUNT_INVALID");
    const existing = replay(b.business_id, args.p_client_uuid); if (existing) return ok(postingResult(existing, true));
    const paidFrom = args.p_paid_from === "wallet" ? "wallet" : "cash";
    return ok(postingResult(post(b.business_id, "OWNER_WITHDRAWAL", "manual", amount, { paidFrom, note: (args.p_note as string) ?? null, client_uuid: String(args.p_client_uuid) })));
  },

  reverse_transaction: (args) => {
    const b = bizOf(args); if (!b) return fail("NOT_A_MEMBER");
    const original = db!.txns.find((t) => t.id === args.p_transaction_id && t.business_id === b.business_id);
    if (!original) return fail("TRANSACTION_NOT_FOUND");
    if (original.kind === "REVERSAL") return fail("ALREADY_A_REVERSAL");
    if (reversedIds(b.business_id).has(original.id)) return fail("ALREADY_REVERSED");
    if (String(args.p_reason ?? "").trim().length < 3) return fail("REASON_REQUIRED");
    const txn = postTxn(db!, { ...original, id: undefined, kind: "REVERSAL", reverses_txn_id: original.id, note: String(args.p_reason), client_uuid: String(args.p_client_uuid), occurred_at: new Date().toISOString(), lines: original.lines.map((l) => ({ code: l.code, debit: l.credit, credit: l.debit })) });
    persist();
    return ok(postingResult(txn));
  },

  customer_balances: (args) => {
    const b = bizOf(args); if (!b) return fail("NOT_A_MEMBER");
    return ok(db!.customers.filter((c) => c.business_id === b.business_id).map((c) => ({ customer_id: c.id, name: c.name, phone_last4: c.phone ? c.phone.slice(-4) : null, balance_minor: customerBalance(db!, c.id) }))
      .sort((a, z) => z.balance_minor - a.balance_minor));
  },

  create_customer: (args) => {
    const b = bizOf(args); if (!b) return fail("NOT_A_MEMBER");
    const name = String(args.p_name ?? "").trim(); if (!name) return fail("NAME_REQUIRED");
    const id = newId();
    db!.customers.push({ id, business_id: b.business_id, name, phone: (args.p_phone as string) || null, consent: !!args.p_consent_to_contact });
    persist();
    return ok({ customer_id: id });
  },

  post_baki_sale: (args) => {
    const b = bizOf(args); if (!b) return fail("NOT_A_MEMBER");
    const amount = requireAmount(args); if (!amount) return fail("AMOUNT_INVALID");
    const customer = db!.customers.find((c) => c.id === args.p_customer_id && c.business_id === b.business_id); if (!customer) return fail("CUSTOMER_NOT_FOUND");
    const existing = replay(b.business_id, args.p_client_uuid); if (existing) return ok(postingResult(existing, true));
    return ok(postingResult(post(b.business_id, "BAKI_SALE", "manual", amount, { customer_id: customer.id, note: (args.p_note as string) || customer.name, client_uuid: String(args.p_client_uuid) })));
  },

  post_baki_collection: (args) => {
    const b = bizOf(args); if (!b) return fail("NOT_A_MEMBER");
    const amount = requireAmount(args); if (!amount) return fail("AMOUNT_INVALID");
    const customer = db!.customers.find((c) => c.id === args.p_customer_id && c.business_id === b.business_id); if (!customer) return fail("CUSTOMER_NOT_FOUND");
    if (amount > customerBalance(db!, customer.id)) return fail("COLLECTION_EXCEEDS_BAKI");
    const existing = replay(b.business_id, args.p_client_uuid); if (existing) return ok(postingResult(existing, true));
    const paidFrom = args.p_received_in === "wallet" ? "wallet" : "cash";
    return ok(postingResult(post(b.business_id, "BAKI_COLLECTION", "manual", amount, { customer_id: customer.id, note: (args.p_note as string) || customer.name, paidFrom, client_uuid: String(args.p_client_uuid) })));
  },

  baki_reminder_draft: (args) => {
    const b = bizOf(args); if (!b) return fail("NOT_A_MEMBER");
    const customer = db!.customers.find((c) => c.id === args.p_customer_id && c.business_id === b.business_id); if (!customer) return fail("CUSTOMER_NOT_FOUND");
    if (!customer.consent) return fail("NO_CONSENT", "customer has not agreed to reminders");
    const balance = customerBalance(db!, customer.id);
    return ok({ customer_name: customer.name, phone: customer.phone, balance_minor: balance, pay_ref: b.upay_account_ref,
      message_bn: `আসসালামু আলাইকুম ${customer.name}, ${b.name}-এ আপনার বাকি ${bnMoney(balance)}। সুবিধামতো upay QR দিয়ে পরিশোধ করতে পারেন। ধন্যবাদ।`,
      message_en: `Hello ${customer.name}, your balance at ${b.name} is ${enMoney(balance)}. You can pay any time with the upay QR. Thank you.` });
  },

  closing_preview: (args) => {
    const b = bizOf(args); if (!b) return fail("NOT_A_MEMBER");
    const today = todayDhaka();
    const rows = txnsOf(b.business_id).filter((t) => onDay(t, today) && t.kind !== "REVERSAL");
    const lines: Record<string, number> = {};
    const cashLines: Record<string, number> = {};
    for (const t of rows) {
      lines[t.kind] = (lines[t.kind] ?? 0) + t.amount_minor;
      const cash = t.lines.filter((l) => l.code === "1000").reduce((s, l) => s + l.debit - l.credit, 0);
      if (cash !== 0) cashLines[t.kind] = (cashLines[t.kind] ?? 0) + cash;
    }
    const expected = balanceOf(db!, b.business_id, "1000");
    const opening = expected - Object.values(cashLines).reduce((s, v) => s + v, 0);
    const blockers = reviewItems(b.business_id).filter((r) => r.blocker).map((r) => ({ transaction_id: r.transaction_id, amount_minor: r.amount_minor, reason: r.reason_bn }));
    return ok({ period_date: today, expected_cash_minor: expected, tolerance_minor: 10000, already_closed: db!.closings.some((c) => c.business_id === b.business_id && c.period_date === today && c.status === "CLOSED"), lines, cash_lines: cashLines, opening_cash_minor: opening, blockers });
  },

  post_closing: (args) => {
    const b = bizOf(args); if (!b) return fail("NOT_A_MEMBER");
    const today = todayDhaka();
    if (db!.closings.some((c) => c.business_id === b.business_id && c.period_date === today && c.status === "CLOSED")) return fail("ALREADY_CLOSED");
    const blockers = reviewItems(b.business_id).filter((r) => r.blocker);
    if (blockers.length && !String(args.p_exception_reason ?? "").trim()) return fail("BLOCKERS_UNRESOLVED");
    const counted = Number(args.p_counted_cash_minor);
    const expected = balanceOf(db!, b.business_id, "1000");
    const variance = counted - expected;
    if (variance !== 0) {
      postTxn(db!, { business_id: b.business_id, kind: "CLOSING_VARIANCE", source: "manual", amount_minor: Math.abs(variance), wallet: null, category: null, note: null, reference: null, customer_id: null, reverses_txn_id: null, client_uuid: null, occurred_at: new Date().toISOString(),
        lines: variance < 0 ? [{ code: "9000", debit: -variance, credit: 0 }, { code: "1000", debit: 0, credit: -variance }] : [{ code: "1000", debit: variance, credit: 0 }, { code: "9000", debit: 0, credit: variance }] });
    }
    const version = db!.closings.filter((c) => c.business_id === b.business_id && c.period_date === today).length + 1;
    const closing = { closing_id: newId(), business_id: b.business_id, period_date: today, expected_cash_minor: expected, counted_cash_minor: counted, variance_minor: variance, version, status: "CLOSED" as const, created_at: new Date().toISOString(), note: (args.p_note as string) ?? null, exception_reason: (args.p_exception_reason as string) ?? null };
    db!.closings.push(closing);
    persist();
    return ok({ closing_id: closing.closing_id, version, expected_cash_minor: expected, counted_cash_minor: counted, variance_minor: variance });
  },

  closing_history: (args) => {
    const b = bizOf(args); if (!b) return fail("NOT_A_MEMBER");
    const rows = db!.closings.filter((c) => c.business_id === b.business_id).sort((a, z) => z.created_at.localeCompare(a.created_at));
    const latestDate = rows[0]?.period_date;
    return ok(rows.map((c) => ({ ...c, can_reopen: c.status === "CLOSED" && c.period_date === latestDate })));
  },

  reopen_closing: (args) => {
    const b = bizOf(args); if (!b) return fail("NOT_A_MEMBER");
    const closing = db!.closings.find((c) => c.closing_id === args.p_closing_id && c.business_id === b.business_id);
    if (!closing) return fail("CLOSING_NOT_FOUND");
    if (closing.status !== "CLOSED") return fail("NOT_CLOSED");
    if (!String(args.p_reason ?? "").trim()) return fail("REASON_REQUIRED");
    closing.status = "REOPENED";
    persist();
    return ok({ reopened_id: closing.closing_id, version: closing.version });
  },

  agent_audit_preview: (args) => {
    const b = bizOf(args); if (!b) return fail("NOT_A_MEMBER");
    const today = todayDhaka();
    const wallets = [...new Set(txnsOf(b.business_id).map((t) => (t.lines.some((l) => l.code === "1030") ? t.wallet : null)).filter(Boolean) as string[])];
    const commission = txnsOf(b.business_id).filter((t) => onDay(t, today) && t.kind === "AGENT_COMMISSION").reduce((s, t) => s + t.amount_minor, 0);
    return ok({ period_date: today, expected_cash_minor: balanceOf(db!, b.business_id, "1000"), expected_upay_minor: balanceOf(db!, b.business_id, "1010"), commission_minor: commission,
      wallets: wallets.map((w) => ({ wallet: w, expected_minor: balanceOf(db!, b.business_id, "1030", w), source: "manual" })),
      already_audited: db!.audits.some((a) => a.business_id === b.business_id && a.period_date === today) });
  },

  post_agent_audit: (args) => {
    const b = bizOf(args); if (!b) return fail("NOT_A_MEMBER");
    const today = todayDhaka();
    if (db!.audits.some((a) => a.business_id === b.business_id && a.period_date === today)) return fail("ALREADY_AUDITED");
    const expectedCash = balanceOf(db!, b.business_id, "1000");
    const expectedUpay = balanceOf(db!, b.business_id, "1010");
    const counted = Number(args.p_counted_cash_minor);
    const actualUpay = Number(args.p_actual_upay_minor);
    const commission = txnsOf(b.business_id).filter((t) => onDay(t, today) && t.kind === "AGENT_COMMISSION").reduce((s, t) => s + t.amount_minor, 0);
    const audit = { audit_id: newId(), business_id: b.business_id, period_date: today, expected_cash_minor: expectedCash, counted_cash_minor: counted, cash_variance_minor: counted - expectedCash, expected_upay_minor: expectedUpay, actual_upay_minor: actualUpay, upay_variance_minor: actualUpay - expectedUpay, commission_minor: commission, note: (args.p_note as string) ?? null, created_at: new Date().toISOString() };
    db!.audits.push(audit);
    persist();
    return ok({ audit_id: audit.audit_id, period_date: today, cash_variance_minor: audit.cash_variance_minor, upay_variance_minor: audit.upay_variance_minor });
  },

  audit_history: (args) => {
    const b = bizOf(args); if (!b) return fail("NOT_A_MEMBER");
    return ok(db!.audits.filter((a) => a.business_id === b.business_id).sort((a, z) => z.created_at.localeCompare(a.created_at)));
  },

  get_forecast: (args) => {
    const b = bizOf(args); if (!b) return fail("NOT_A_MEMBER");
    return ok(args.p_capability === "float24h" ? floatForecast(b.business_id) : salesForecast(b.business_id));
  },

  today_insights: (args) => {
    const b = bizOf(args); if (!b) return fail("NOT_A_MEMBER");
    return ok({ role: b.type, as_of: new Date().toISOString(), cards: insightCards(b.business_id, b.type) });
  },

  get_safe_to_withdraw: (args) => {
    const b = bizOf(args); if (!b) return fail("NOT_A_MEMBER");
    return ok(safeToWithdraw(b.business_id));
  },

  simulate_withdrawal: (args) => {
    const b = bizOf(args); if (!b) return fail("NOT_A_MEMBER");
    const s = safeToWithdraw(b.business_id);
    const w = Number(args.p_withdraw_minor);
    const lowest = s.lowest_projected_balance_p10_minor - w;
    return ok({ withdraw_minor: w, reserve_minor: s.reserve_minor, lowest_after_minor: lowest, below_reserve: lowest < s.reserve_minor, shortfall_minor: Math.max(0, s.reserve_minor - lowest), available: true });
  },

  supplier_balances: (args) => {
    const b = bizOf(args); if (!b) return fail("NOT_A_MEMBER");
    return ok(db!.suppliers.filter((s) => s.business_id === b.business_id).map((s) => {
      const open = openPayables(b.business_id).filter((p) => p.supplier_id === s.id);
      return { supplier_id: s.id, name: s.name, phone_last4: s.phone ? s.phone.slice(-4) : null, due_minor: open.reduce((sum, p) => sum + p.amount_minor - p.paid_minor, 0), open_count: open.length };
    }).sort((a, z) => z.due_minor - a.due_minor));
  },

  create_supplier: (args) => {
    const b = bizOf(args); if (!b) return fail("NOT_A_MEMBER");
    const name = String(args.p_name ?? "").trim(); if (!name) return fail("NAME_REQUIRED");
    const id = newId();
    db!.suppliers.push({ id, business_id: b.business_id, name, phone: (args.p_phone as string) || null, category: (args.p_category as string) || null });
    persist();
    return ok({ supplier_id: id });
  },

  create_payable: (args) => {
    const b = bizOf(args); if (!b) return fail("NOT_A_MEMBER");
    const amount = requireAmount(args); if (!amount) return fail("AMOUNT_INVALID");
    const id = newId();
    db!.payables.push({ id, business_id: b.business_id, supplier_id: String(args.p_supplier_id), amount_minor: amount, paid_minor: 0, invoice_ref: (args.p_invoice_ref as string) || null, due_date: (args.p_due_date as string) || null, status: "CONFIRMED", note: null });
    persist();
    return ok({ payable_id: id });
  },

  pay_payable: (args) => {
    const b = bizOf(args); if (!b) return fail("NOT_A_MEMBER");
    const payable = db!.payables.find((p) => p.id === args.p_payable_id && p.business_id === b.business_id);
    if (!payable) return fail("TRANSACTION_NOT_FOUND", "bill not found");
    const amount = requireAmount(args); if (!amount) return fail("AMOUNT_INVALID");
    const remaining = payable.amount_minor - payable.paid_minor;
    if (amount > remaining) return fail("AMOUNT_INVALID", "more than the bill");
    const existing = replay(b.business_id, args.p_client_uuid);
    if (!existing) {
      const supplier = db!.suppliers.find((s) => s.id === payable.supplier_id);
      post(b.business_id, "SUPPLIER_PAYMENT", "manual", amount, { paidFrom: args.p_paid_from === "wallet" ? "wallet" : "cash", note: supplier?.name ?? null, reference: payable.invoice_ref, client_uuid: String(args.p_client_uuid) });
      payable.paid_minor += amount;
      payable.status = payable.paid_minor >= payable.amount_minor ? "PAID" : "PARTIALLY_PAID";
      persist();
    }
    return ok({ status: payable.status, remaining_minor: payable.amount_minor - payable.paid_minor });
  },

  review_queue: (args) => {
    const b = bizOf(args); if (!b) return fail("NOT_A_MEMBER");
    return ok(reviewItems(b.business_id));
  },

  post_refund: (args) => {
    const b = bizOf(args); if (!b) return fail("NOT_A_MEMBER");
    const original = db!.txns.find((t) => t.id === args.p_original_transaction_id && t.business_id === b.business_id);
    if (!original || !["QR_PAYMENT", "CASH_SALE"].includes(original.kind)) return fail("TRANSACTION_NOT_FOUND");
    const amount = requireAmount(args); if (!amount) return fail("AMOUNT_INVALID");
    const refunded = txnsOf(b.business_id).filter((t) => t.kind === "REFUND" && t.reference === original.id).reduce((s, t) => s + t.amount_minor, 0);
    if (amount > original.amount_minor - refunded) return fail("AMOUNT_INVALID", "more than the refundable remaining");
    if (String(args.p_reason ?? "").trim().length < 3) return fail("REASON_REQUIRED");
    const fromCash = original.kind === "CASH_SALE";
    post(b.business_id, "REFUND", fromCash ? "manual" : "verified", amount, { reference: original.id, note: String(args.p_reason), client_uuid: String(args.p_client_uuid), lines: [{ code: "4010", debit: amount, credit: 0 }, { code: fromCash ? "1000" : "1010", debit: 0, credit: amount }] });
    return ok({ status: "SUCCEEDED", remaining_after_minor: original.amount_minor - refunded - amount });
  },

  list_offers: (args) => {
    const b = bizOf(args); if (!b) return fail("NOT_A_MEMBER");
    return ok(db!.offers.filter((o) => o.business_id === b.business_id && (!args.p_status || o.status === args.p_status)).map(({ business_id: _b, ...o }) => o));
  },

  create_offer: (args) => {
    const b = bizOf(args); if (!b) return fail("NOT_A_MEMBER");
    const title = String(args.p_title ?? "").trim(); if (!title) return fail("NAME_REQUIRED", "offer title is required");
    const budget = Number(args.p_budget_minor); if (!Number.isSafeInteger(budget) || budget <= 0) return fail("AMOUNT_INVALID");
    const id = newId();
    db!.offers.unshift({ id, business_id: b.business_id, type: args.p_type as "PERCENT_OFF", title, params: (args.p_params as Record<string, unknown>) ?? {}, budget_minor: budget, spent_minor: 0, starts_at: String(args.p_starts_at), ends_at: String(args.p_ends_at), audience: (args.p_audience as "all") ?? "all", status: "DRAFT", status_changed_at: new Date().toISOString(), redemption_count: 0, total_discount_minor: 0 });
    persist();
    return ok({ offer_id: id, status: "DRAFT" });
  },

  publish_offer: (args) => setOfferStatus(args, ["DRAFT"], "ACTIVE"),
  pause_offer: (args) => setOfferStatus(args, ["ACTIVE"], "PAUSED"),
  resume_offer: (args) => setOfferStatus(args, ["PAUSED"], "ACTIVE"),
  end_offer: (args) => {
    const result = setOfferStatus(args, ["ACTIVE", "PAUSED", "DRAFT"], "ENDED");
    const offer = db!.offers.find((o) => o.id === args.p_offer_id);
    if (!result.error && offer && !db!.offerResults.some((r) => r.offer_id === offer.id)) {
      db!.offerResults.push({ offer_id: offer.id, pre_sales_minor: 3820000, post_sales_minor: 4310000, net_lift_minor: 490000 - offer.total_discount_minor, redemption_count: offer.redemption_count, total_discount_minor: offer.total_discount_minor, computed_at: new Date().toISOString() });
    }
    return result;
  },
  redeem_offer: (args) => {
    const offer = db!.offers.find((o) => o.id === args.p_offer_id);
    if (!offer) return fail("TRANSACTION_NOT_FOUND");
    const discount = Number(args.p_discount_minor);
    offer.spent_minor += discount; offer.total_discount_minor += discount; offer.redemption_count += 1;
    if (offer.spent_minor >= offer.budget_minor) offer.status = "PAUSED";
    persist();
    return ok({ redemption_id: newId(), discount_minor: discount, spent_minor: offer.spent_minor, budget_minor: offer.budget_minor });
  },
  stamp_progress: () => ok({ stamps: 3, goal: 5, completed: false, reward_minor: null }),

  commission_summary: (args) => {
    const b = bizOf(args); if (!b) return fail("NOT_A_MEMBER");
    const today = todayDhaka();
    const sumOn = (date: string) => txnsOf(b.business_id).filter((t) => onDay(t, date) && t.kind === "AGENT_COMMISSION").reduce((s, t) => s + t.amount_minor, 0);
    const byDay = Array.from({ length: 7 }, (_, i) => { const date = addDays(today, i - 6); return { date, amount_minor: sumOn(date) }; });
    const month = Array.from({ length: Number(today.slice(8, 10)) }, (_, i) => sumOn(addDays(today, -i))).reduce((s, v) => s + v, 0);
    return ok({ today_minor: sumOn(today), count_today: txnsOf(b.business_id).filter((t) => onDay(t, today) && AGENT_SERVICE.includes(t.kind)).length, week_minor: byDay.reduce((s, d) => s + d.amount_minor, 0), month_minor: month, by_day: byDay });
  },

  wallet_breakdown: (args) => {
    const b = bizOf(args); if (!b) return fail("NOT_A_MEMBER");
    const today = todayDhaka();
    const wallets = [...new Set(txnsOf(b.business_id).filter((t) => t.lines.some((l) => l.code === "1030")).map((t) => t.wallet!).filter(Boolean))];
    return ok({ wallets: wallets.map((w) => ({ wallet: w, total_minor: balanceOf(db!, b.business_id, "1030", w), count: txnsOf(b.business_id).filter((t) => t.wallet === w && t.kind === "MANUAL_WALLET" && onDay(t, today)).length })) });
  },

  get_receipt_link: (args) => {
    const b = bizOf(args); if (!b) return fail("NOT_A_MEMBER");
    const txn = db!.txns.find((t) => t.id === args.p_transaction_id && t.business_id === b.business_id);
    if (!txn) return fail("TRANSACTION_NOT_FOUND");
    const has = txn.source === "verified" && txn.kind !== "AGENT_COMMISSION";
    return ok({ token: has ? txn.id.slice(0, 8).toUpperCase() : null, has_receipt: has });
  },

  report_rows: (args) => {
    const b = bizOf(args); if (!b) return fail("NOT_A_MEMBER");
    const from = String(args.p_from); const to = String(args.p_to);
    const rows = txnsOf(b.business_id).filter((t) => { const d = dhakaDate(t.occurred_at); return d >= from && d <= to; });
    const dates: string[] = [];
    for (let d = from; d <= to; d = addDays(d, 1)) dates.push(d);
    switch (args.p_report_key) {
      case "sales_by_day":
        return ok(dates.map((date) => { const day = rows.filter((t) => dhakaDate(t.occurred_at) === date && SALE_KINDS.includes(t.kind)); return { date, transaction_count: day.length, sales_minor: day.reduce((s, t) => s + t.amount_minor, 0) }; }));
      case "expenses":
        return ok(rows.filter((t) => t.kind === "EXPENSE").map((t) => ({ date: dhakaDate(t.occurred_at), category: t.category, note: t.note, expense_minor: t.amount_minor })));
      case "baki":
        return ok(db!.customers.filter((c) => c.business_id === b.business_id).map((c) => {
          const given = rows.filter((t) => t.customer_id === c.id && t.kind === "BAKI_SALE").reduce((s, t) => s + t.amount_minor, 0);
          const got = rows.filter((t) => t.customer_id === c.id && t.kind === "BAKI_COLLECTION").reduce((s, t) => s + t.amount_minor, 0);
          return { customer: c.name, baki_given_minor: given, baki_collected_minor: got, net_minor: given - got };
        }));
      case "cash_vs_digital":
        return ok(dates.map((date) => { const day = rows.filter((t) => dhakaDate(t.occurred_at) === date); return { date, cash_minor: day.filter((t) => t.kind === "CASH_SALE").reduce((s, t) => s + t.amount_minor, 0), digital_minor: day.filter((t) => t.kind === "QR_PAYMENT").reduce((s, t) => s + t.amount_minor, 0) }; }));
      default:
        return fail("UNKNOWN", "unknown report");
    }
  },

  log_export: () => ok({ export_id: newId(), expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString() }),
};

function setOfferStatus(args: Record<string, unknown>, from: string[], to: "ACTIVE" | "PAUSED" | "ENDED"): Result {
  const b = bizOf(args); if (!b) return fail("NOT_A_MEMBER");
  const offer = db!.offers.find((o) => o.id === args.p_offer_id && o.business_id === b.business_id);
  if (!offer) return fail("TRANSACTION_NOT_FOUND", "offer not found");
  if (!from.includes(offer.status)) return fail("UNKNOWN", "offer cannot move to that state");
  offer.status = to;
  offer.status_changed_at = new Date().toISOString();
  persist();
  return ok({ offer_id: offer.id, status: to });
}

// ---------------------------------------------------------------------------
// Table reads: a tiny query builder with the chain the app uses.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

class DemoQuery implements PromiseLike<Result> {
  private filters: ((row: Row) => boolean)[] = [];
  private sort: { column: string; ascending: boolean; nullsFirst: boolean } | null = null;
  private max: number | null = null;
  private single = false;
  constructor(private table: string) {}
  select(_columns?: string) { return this; }
  eq(column: string, value: unknown) { this.filters.push((row) => row[column] === value); return this; }
  in(column: string, values: unknown[]) { this.filters.push((row) => values.includes(row[column])); return this; }
  order(column: string, opts: { ascending?: boolean; nullsFirst?: boolean } = {}) { this.sort = { column, ascending: opts.ascending ?? true, nullsFirst: opts.nullsFirst ?? false }; return this; }
  limit(n: number) { this.max = n; return this; }
  maybeSingle() { this.single = true; return this; }

  private async run(): Promise<Result> {
    await ready();
    await delay(120);
    const user = currentUser();
    if (!user) return { data: null, error: { message: "NOT_AUTHENTICATED: no demo session" } };
    let rows = this.rows(user.business_id);
    rows = rows.filter((row) => this.filters.every((f) => f(row)));
    if (this.sort) {
      const { column, ascending, nullsFirst } = this.sort;
      rows = [...rows].sort((a, z) => {
        const x = a[column]; const y = z[column];
        if (x == null || y == null) return x == null && y == null ? 0 : (x == null) === nullsFirst ? -1 : 1;
        return (x < y ? -1 : x > y ? 1 : 0) * (ascending ? 1 : -1);
      });
    }
    if (this.max != null) rows = rows.slice(0, this.max);
    return { data: this.single ? rows[0] ?? null : rows, error: null };
  }

  private rows(businessId: string | null): Row[] {
    // Row-level security, demo edition: a user only ever reads their own business.
    if (!businessId) return [];
    switch (this.table) {
      case "v_account_balances":
        return ["1000", "1010", "1030", "1100", "2000"].map((code) => ({ business_id: businessId, code, name: code, type: "asset", balance_minor: balanceOf(db!, businessId, code) }));
      case "transactions":
        return txnsOf(businessId).map(({ lines: _lines, ...t }) => t as Row);
      case "supplier_payables":
        return db!.payables.filter((p) => p.business_id === businessId).map((p) => ({ ...p, amount_remaining_minor: p.amount_minor - p.paid_minor }));
      case "offer_results":
        return db!.offerResults.filter((r) => db!.offers.some((o) => o.id === r.offer_id && o.business_id === businessId)) as unknown as Row[];
      default:
        return [];
    }
  }

  then<A = Result, B = never>(onfulfilled?: ((value: Result) => A | PromiseLike<A>) | null, onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    return this.run().then(onfulfilled, onrejected);
  }
}

// ---------------------------------------------------------------------------
// The client
// ---------------------------------------------------------------------------

function emit(event: string) {
  for (const listener of listeners) listener(event, session);
}

async function saveSession() {
  if (session) await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(session)).catch(() => undefined);
  else await AsyncStorage.removeItem(SESSION_KEY).catch(() => undefined);
}

export const demoClient = {
  auth: {
    async getSession() {
      await ready();
      return { data: { session }, error: null };
    },
    onAuthStateChange(callback: (event: string, next: Session | null) => void) {
      listeners.add(callback);
      return { data: { subscription: { unsubscribe: () => listeners.delete(callback) } } };
    },
    async signInWithOtp({ phone }: { phone: string }) {
      await ready();
      await delay(500);
      if (!/^\+8801\d{9}$/.test(phone)) return { data: null, error: { message: "Invalid phone number" } };
      return { data: {}, error: null };
    },
    async verifyOtp({ phone, token }: { phone: string; token: string; type?: string }) {
      await ready();
      await delay(600);
      if (token !== DEMO_OTP) return { data: null, error: { message: "Token has expired or is invalid" } };
      let user = users.find((u) => u.phone === phone);
      if (!user) {
        const businessId = phone === DEMO_PHONES.agent ? AGENT_ID : phone === DEMO_PHONES.merchant ? MERCHANT_ID : entranceHint === "AGENT" ? AGENT_ID : MERCHANT_ID;
        user = { id: newId(), phone, business_id: businessId };
        users.push(user);
        persist();
      }
      session = { access_token: `demo-${user.id}`, user: { id: user.id, phone } };
      await saveSession();
      emit("SIGNED_IN");
      return { data: { session, user: session.user }, error: null };
    },
    async signOut(_opts?: { scope?: string }) {
      session = null;
      await saveSession();
      emit("SIGNED_OUT");
      return { error: null };
    },
    async signInWithPassword() {
      return { data: null, error: { message: "The admin console needs the real backend." } };
    },
    mfa: {
      async listFactors() { return { data: null, error: { message: "Not available in the demo." } }; },
      async enroll() { return { data: null, error: { message: "Not available in the demo." } }; },
      async challengeAndVerify() { return { data: null, error: { message: "Not available in the demo." } }; },
    },
  },

  async rpc(name: string, args: Record<string, unknown> = {}) {
    await ready();
    await delay();
    const handler = handlers[name];
    if (!handler) return { data: null, error: { message: `UNKNOWN: ${name} is not available in the demo` } };
    if (name !== "me" && name !== "create_business" && !currentUser()) return fail("NOT_AUTHENTICATED");
    try {
      return await handler(args);
    } catch (e) {
      return { data: null, error: { message: e instanceof Error ? e.message : "UNKNOWN" } };
    }
  },

  from(table: string) {
    return new DemoQuery(table);
  },

  functions: {
    async invoke(name: string, { body }: { body?: Record<string, unknown> } = {}) {
      await ready();
      await delay(700);
      if (name !== "simulator-pay") return { data: null, error: { message: `${name} is not available in the demo` } };
      const user = currentUser();
      const businessId = String(body?.business_id ?? "");
      if (!user || user.business_id !== businessId) return { data: null, error: { message: "NOT_A_MEMBER" } };
      const amount = Number(body?.amount_minor ?? 0) || 85000;
      const app = String(body?.payer_app ?? "bKash");
      const txn = post(businessId, "QR_PAYMENT", "verified", amount, { wallet: "upay", note: app, reference: `UPY${Math.random().toString(36).slice(2, 7).toUpperCase()}` });
      return { data: { simulated: txn.id, webhook: { payer_app: app, amount_minor: amount } }, error: null };
    },
  },
};

export type DemoClient = typeof demoClient;
