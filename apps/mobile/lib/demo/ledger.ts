/**
 * The demo ledger: an in-memory, append-only, double-entry book that stands in for the
 * Postgres ledger when the app runs without a backend (docs/16 section 5).
 *
 * It follows the same rules as the real one: money is integer poisha, every transaction
 * posts balanced journal lines to the same account codes (docs/06), nothing is edited or
 * deleted, and a correction is a reversal. Seed data is generated from a fixed seed so the
 * demo looks the same on every run, relative to today's date.
 */

export type DemoRole = "MERCHANT" | "AGENT";

export type TxnKind =
  | "QR_PAYMENT" | "CASH_SALE" | "BAKI_SALE" | "BAKI_COLLECTION" | "EXPENSE" | "SUPPLIER_PAYMENT"
  | "REFUND" | "OWNER_WITHDRAWAL" | "OWNER_DEPOSIT" | "AGENT_CASH_IN" | "AGENT_CASH_OUT"
  | "AGENT_SEND_MONEY" | "AGENT_COMMISSION" | "MANUAL_WALLET" | "CLOSING_VARIANCE" | "REVERSAL" | "SETTLEMENT";

export interface Line { code: string; debit: number; credit: number }

export interface Txn {
  id: string;
  business_id: string;
  kind: TxnKind;
  source: "verified" | "manual";
  wallet: string | null;
  amount_minor: number;
  category: string | null;
  note: string | null;
  reference: string | null;
  customer_id: string | null;
  reverses_txn_id: string | null;
  occurred_at: string;
  client_uuid: string | null;
  lines: Line[];
}

export interface DemoBusiness {
  business_id: string;
  type: DemoRole;
  name: string;
  category: string;
  upay_account_ref: string;
  verified: boolean;
  status: string;
  role: "merchant_owner" | "agent_owner";
  permissions: Record<string, unknown>;
}

export interface Customer { id: string; business_id: string; name: string; phone: string | null; consent: boolean }
export interface Supplier { id: string; business_id: string; name: string; phone: string | null; category: string | null }
export interface Payable {
  id: string; business_id: string; supplier_id: string; amount_minor: number; paid_minor: number;
  invoice_ref: string | null; due_date: string | null; status: string; note: string | null;
}
export interface Offer {
  id: string; business_id: string; type: "PERCENT_OFF" | "AMOUNT_OFF" | "BXGY" | "STAMP"; title: string;
  params: Record<string, unknown>; budget_minor: number; spent_minor: number; starts_at: string; ends_at: string;
  audience: "all" | "returning" | "new"; status: "DRAFT" | "ACTIVE" | "PAUSED" | "ENDED"; status_changed_at: string;
  redemption_count: number; total_discount_minor: number;
}
export interface OfferResult {
  offer_id: string; pre_sales_minor: number; post_sales_minor: number; net_lift_minor: number;
  redemption_count: number; total_discount_minor: number; computed_at: string;
}
export interface Closing {
  closing_id: string; business_id: string; period_date: string; expected_cash_minor: number; counted_cash_minor: number;
  variance_minor: number; version: number; status: "CLOSED" | "REOPENED"; created_at: string; note: string | null;
  exception_reason: string | null;
}
export interface Audit {
  audit_id: string; business_id: string; period_date: string; expected_cash_minor: number; counted_cash_minor: number;
  cash_variance_minor: number; expected_upay_minor: number; actual_upay_minor: number; upay_variance_minor: number;
  commission_minor: number; note: string | null; created_at: string;
}
export interface ReviewFlag { transaction_id: string; reason_code: "PENDING_SETTLEMENT" | "ANOMALY"; reason_bn: string; blocker: boolean }

export interface DemoDb {
  version: number;
  businesses: DemoBusiness[];
  txns: Txn[];
  customers: Customer[];
  suppliers: Supplier[];
  payables: Payable[];
  offers: Offer[];
  offerResults: OfferResult[];
  closings: Closing[];
  audits: Audit[];
  flags: ReviewFlag[];
}

export const DB_VERSION = 5;
export const MERCHANT_ID = "b0000000-0000-4000-8000-000000000001";
export const AGENT_ID = "b0000000-0000-4000-8000-000000000002";

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** A real v4 UUID, so ids pass the same zod checks the live RPC arguments use. */
export function newId(_kind?: string): string {
  return globalThis.crypto.randomUUID();
}

/** Deterministic pseudo-random numbers so the seeded demo is identical on every run. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/** The Dhaka calendar date of an instant, as YYYY-MM-DD. */
export function dhakaDate(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return new Date(d.getTime() + 6 * 3600 * 1000).toISOString().slice(0, 10);
}

export function todayDhaka(): string {
  return dhakaDate(new Date());
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** An instant on a Dhaka calendar day at a given local hour and minute. */
function at(date: string, hour: number, minute: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + ((hour - 6) * 60 + minute) * 60 * 1000).toISOString();
}

const tk = (taka: number) => Math.round(taka) * 100;

// ---------------------------------------------------------------------------
// Posting rules (mirror supabase/migrations/0002 and friends)
// ---------------------------------------------------------------------------

export function linesFor(kind: TxnKind, amount: number, opts: { paidFrom?: "cash" | "wallet"; direction?: "cash_out" | "cash_in" } = {}): Line[] {
  const L = (code: string, debit: number, credit: number): Line => ({ code, debit, credit });
  const from = opts.paidFrom === "wallet" ? "1010" : "1000";
  switch (kind) {
    case "QR_PAYMENT": return [L("1010", amount, 0), L("4000", 0, amount)];
    case "CASH_SALE": return [L("1000", amount, 0), L("4000", 0, amount)];
    case "BAKI_SALE": return [L("1100", amount, 0), L("4000", 0, amount)];
    case "BAKI_COLLECTION": return [L(from, amount, 0), L("1100", 0, amount)];
    case "EXPENSE": return [L("5100", amount, 0), L(from, 0, amount)];
    case "SUPPLIER_PAYMENT": return [L("2000", amount, 0), L(from, 0, amount)];
    case "REFUND": return [L("4010", amount, 0), L("1010", 0, amount)];
    case "OWNER_WITHDRAWAL": return [L("3000", amount, 0), L(from, 0, amount)];
    case "OWNER_DEPOSIT": return [L(from, amount, 0), L("3000", 0, amount)];
    case "AGENT_CASH_IN": return [L("1000", amount, 0), L("1010", 0, amount)];
    case "AGENT_SEND_MONEY": return [L("1000", amount, 0), L("1010", 0, amount)];
    case "AGENT_CASH_OUT": return [L("1010", amount, 0), L("1000", 0, amount)];
    case "AGENT_COMMISSION": return [L("1010", amount, 0), L("4200", 0, amount)];
    case "MANUAL_WALLET":
      return opts.direction === "cash_in"
        ? [L("1000", amount, 0), L("1030", 0, amount)]
        : [L("1030", amount, 0), L("1000", 0, amount)];
    default: return [];
  }
}

export function balanceOf(db: DemoDb, businessId: string, code: string, wallet?: string): number {
  let sum = 0;
  for (const t of db.txns) {
    if (t.business_id !== businessId) continue;
    if (wallet !== undefined && t.wallet !== wallet) continue;
    for (const l of t.lines) if (l.code === code) sum += l.debit - l.credit;
  }
  return sum;
}

export function postTxn(db: DemoDb, txn: Omit<Txn, "id"> & { id?: string }): Txn {
  const debit = txn.lines.reduce((s, l) => s + l.debit, 0);
  const credit = txn.lines.reduce((s, l) => s + l.credit, 0);
  if (debit !== credit || debit <= 0) throw new Error("NO_JOURNAL_LINES: unbalanced demo entry");
  const row: Txn = { ...txn, id: txn.id ?? newId("t") };
  db.txns.push(row);
  return row;
}

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

const base = (businessId: string) => ({
  business_id: businessId,
  wallet: null,
  category: null,
  note: null,
  reference: null,
  customer_id: null,
  reverses_txn_id: null,
  client_uuid: null,
});

function seedMerchant(db: DemoDb, today: string) {
  const b = MERCHANT_ID;
  const r = rng(20261004);
  const start = addDays(today, -21);
  const payerApps = ["bKash", "Nagad", "Rocket", "upay", "bKash", "bKash", "Nagad"];
  const categories = ["grocery", "drinks", "snacks", "other"];
  const nowMinutes = (() => {
    const d = new Date(Date.now() + 6 * 3600 * 1000);
    return d.getUTCHours() * 60 + d.getUTCMinutes();
  })();

  postTxn(db, { ...base(b), kind: "OWNER_DEPOSIT", source: "manual", amount_minor: tk(25000), note: "Opening cash", occurred_at: at(start, 8, 0), lines: linesFor("OWNER_DEPOSIT", tk(25000)) });
  postTxn(db, { ...base(b), kind: "OWNER_DEPOSIT", source: "manual", amount_minor: tk(30000), note: "Opening wallet", occurred_at: at(start, 8, 1), lines: linesFor("OWNER_DEPOSIT", tk(30000), { paidFrom: "wallet" }) });

  const customers: Customer[] = [
    { id: newId("c"), business_id: b, name: "রহিমা বেগম", phone: "01711428390", consent: true },
    { id: newId("c"), business_id: b, name: "সোহেল আহমেদ", phone: "01819276451", consent: true },
    { id: newId("c"), business_id: b, name: "জামাল চাচা", phone: null, consent: false },
    { id: newId("c"), business_id: b, name: "নাসরিন আক্তার", phone: "01915603327", consent: true },
    { id: newId("c"), business_id: b, name: "মিঠু (চায়ের দোকান)", phone: "01633118204", consent: true },
  ];
  db.customers.push(...customers);
  const suppliers: Supplier[] = [
    { id: newId("s"), business_id: b, name: "রহমান ট্রেডার্স", phone: "01712004561", category: "grocery" },
    { id: newId("s"), business_id: b, name: "মেঘনা ডিস্ট্রিবিউশন", phone: "01798310022", category: "drinks" },
    { id: newId("s"), business_id: b, name: "রূপালী বিস্কুট", phone: "01556780911", category: "snacks" },
  ];
  db.suppliers.push(...suppliers);

  for (let day = 0; day <= 21; day++) {
    const date = addDays(start, day);
    const isToday = date === today;
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    const busy = weekday === 5 ? 1.35 : weekday === 3 ? 0.8 : 1;
    const qrCount = Math.round((12 + r() * 10) * busy);
    const cashCount = Math.round((10 + r() * 9) * busy);
    const events: { minute: number; make: () => void }[] = [];
    for (let i = 0; i < qrCount; i++) {
      const minute = 8 * 60 + Math.floor(r() * 13.5 * 60);
      const amount = tk(40 + Math.floor(r() * r() * 1600 / 10) * 10);
      const app = payerApps[Math.floor(r() * payerApps.length)]!;
      const ref = `UPY${Math.floor(r() * 0xffffff).toString(36).toUpperCase().padStart(5, "0")}`;
      events.push({ minute, make: () => postTxn(db, { ...base(b), kind: "QR_PAYMENT", source: "verified", wallet: "upay", note: app, reference: ref, amount_minor: amount, occurred_at: at(date, 0, minute), lines: linesFor("QR_PAYMENT", amount) }) });
    }
    for (let i = 0; i < cashCount; i++) {
      const minute = 8 * 60 + Math.floor(r() * 13.5 * 60);
      const amount = tk(20 + Math.floor(r() * r() * 900 / 5) * 5);
      const category = categories[Math.floor(r() * categories.length)]!;
      events.push({ minute, make: () => postTxn(db, { ...base(b), kind: "CASH_SALE", source: "manual", category, amount_minor: amount, occurred_at: at(date, 0, minute), lines: linesFor("CASH_SALE", amount) }) });
    }
    const expenseCount = 1 + Math.floor(r() * 2.4);
    const expenseTypes = ["transport", "electricity", "salary", "other", "supplier_purchase"];
    for (let i = 0; i < expenseCount; i++) {
      const minute = 9 * 60 + Math.floor(r() * 11 * 60);
      const type = expenseTypes[Math.floor(r() * expenseTypes.length)]!;
      const amount = tk(type === "salary" ? 500 : type === "electricity" ? 800 + Math.floor(r() * 400) : 60 + Math.floor(r() * 340));
      events.push({ minute, make: () => postTxn(db, { ...base(b), kind: "EXPENSE", source: "manual", category: type, amount_minor: amount, occurred_at: at(date, 0, minute), lines: linesFor("EXPENSE", amount) }) });
    }
    if (r() < 0.7) {
      const customer = customers[Math.floor(r() * customers.length)]!;
      const minute = 10 * 60 + Math.floor(r() * 10 * 60);
      const amount = tk(150 + Math.floor(r() * 25) * 20);
      events.push({ minute, make: () => postTxn(db, { ...base(b), kind: "BAKI_SALE", source: "manual", customer_id: customer.id, note: customer.name, amount_minor: amount, occurred_at: at(date, 0, minute), lines: linesFor("BAKI_SALE", amount) }) });
    }
    if (r() < 0.45 && day > 2) {
      const customer = customers[Math.floor(r() * customers.length)]!;
      const owed = balanceOf(db, b, "1100") > 0 ? Math.min(tk(400), customerBalance(db, customer.id)) : 0;
      if (owed > 0) {
        const minute = 11 * 60 + Math.floor(r() * 9 * 60);
        events.push({ minute, make: () => {
          const still = Math.min(owed, customerBalance(db, customer.id));
          if (still > 0) postTxn(db, { ...base(b), kind: "BAKI_COLLECTION", source: "manual", customer_id: customer.id, note: customer.name, amount_minor: still, occurred_at: at(date, 0, minute), lines: linesFor("BAKI_COLLECTION", still) });
        } });
      }
    }
    events.sort((a, z) => a.minute - z.minute);
    for (const e of events) {
      if (isToday && e.minute > nowMinutes) continue;
      e.make();
    }

    if (!isToday) {
      // The owner takes most of the drawer home at night and closes the day.
      const drawer = balanceOf(db, b, "1000");
      const keep = tk(6000);
      if (drawer > keep + tk(1000)) {
        const amount = Math.floor((drawer - keep) / 10000) * 10000;
        if (amount > 0) postTxn(db, { ...base(b), kind: "OWNER_WITHDRAWAL", source: "manual", amount_minor: amount, note: "বাসায় নেওয়া", occurred_at: at(date, 21, 50), lines: linesFor("OWNER_WITHDRAWAL", amount) });
      }
      if (day >= 8) {
        const expected = balanceOf(db, b, "1000");
        const variance = r() < 0.65 ? 0 : -tk(10 * Math.ceil(r() * 15));
        if (variance !== 0) {
          postTxn(db, { ...base(b), kind: "CLOSING_VARIANCE", source: "manual", amount_minor: -variance, occurred_at: at(date, 22, 0), lines: [{ code: "9000", debit: -variance, credit: 0 }, { code: "1000", debit: 0, credit: -variance }] });
        }
        db.closings.push({ closing_id: newId("k"), business_id: b, period_date: date, expected_cash_minor: expected, counted_cash_minor: expected + variance, variance_minor: variance, version: 1, status: "CLOSED", created_at: at(date, 22, 0), note: variance ? "ভাংতি দিতে ভুল" : null, exception_reason: null });
      }
    }
  }

  // Bills: one due soon, one overdue, one paid off in part.
  const [rahman, meghna, rupali] = suppliers;
  db.payables.push(
    { id: newId("p"), business_id: b, supplier_id: rahman!.id, amount_minor: tk(15000), paid_minor: 0, invoice_ref: "RT-1048", due_date: addDays(today, 2), status: "CONFIRMED", note: null },
    { id: newId("p"), business_id: b, supplier_id: meghna!.id, amount_minor: tk(8400), paid_minor: tk(3000), invoice_ref: "MD-552", due_date: addDays(today, -1), status: "OVERDUE", note: null },
    { id: newId("p"), business_id: b, supplier_id: rupali!.id, amount_minor: tk(3250), paid_minor: 0, invoice_ref: null, due_date: addDays(today, 6), status: "CONFIRMED", note: null },
  );

  // Review queue: one settlement still pending (a blocker for closing) and one unusual payment.
  const recentQr = db.txns.filter((t) => t.business_id === b && t.kind === "QR_PAYMENT" && dhakaDate(t.occurred_at) === today);
  const big = postTxn(db, { ...base(b), kind: "QR_PAYMENT", source: "verified", wallet: "pending", note: "Nagad", reference: "INV-1048", amount_minor: tk(2450), occurred_at: new Date(Date.now() - 95 * 60 * 1000).toISOString(), lines: linesFor("QR_PAYMENT", tk(2450)) });
  db.flags.push({ transaction_id: big.id, reason_code: "PENDING_SETTLEMENT", reason_bn: "সেটেলমেন্ট এখনো আসেনি", blocker: true });
  const odd = recentQr[recentQr.length - 1];
  if (odd) db.flags.push({ transaction_id: odd.id, reason_code: "ANOMALY", reason_bn: "একই পরিমাণ পরপর দুইবার এসেছে", blocker: false });

  const now = new Date().toISOString();
  db.offers.push(
    { id: newId("o"), business_id: b, type: "STAMP", title: "৫ বার কিনলে ১টি চা ফ্রি", params: { goal: 5, reward_minor: tk(15) }, budget_minor: tk(1500), spent_minor: tk(345), starts_at: at(addDays(today, -9), 8, 0), ends_at: at(addDays(today, 21), 22, 0), audience: "all", status: "ACTIVE", status_changed_at: now, redemption_count: 23, total_discount_minor: tk(345) },
    { id: newId("o"), business_id: b, type: "PERCENT_OFF", title: "বুধবার ৫% ছাড়", params: { pct: 5 }, budget_minor: tk(2000), spent_minor: tk(0), starts_at: at(addDays(today, 1), 8, 0), ends_at: at(addDays(today, 30), 22, 0), audience: "returning", status: "DRAFT", status_changed_at: now, redemption_count: 0, total_discount_minor: 0 },
  );
  const ended = { id: newId("o"), business_id: b, type: "AMOUNT_OFF" as const, title: "ঈদ অফার ৳৩০ ছাড়", params: { off_minor: tk(30) }, budget_minor: tk(1200), spent_minor: tk(1200), starts_at: at(addDays(today, -40), 8, 0), ends_at: at(addDays(today, -30), 22, 0), audience: "all" as const, status: "ENDED" as const, status_changed_at: now, redemption_count: 40, total_discount_minor: tk(1200) };
  db.offers.push(ended);
  db.offerResults.push({ offer_id: ended.id, pre_sales_minor: tk(41200), post_sales_minor: tk(47850), net_lift_minor: tk(5450), redemption_count: 40, total_discount_minor: tk(1200), computed_at: now });
}

function seedAgent(db: DemoDb, today: string) {
  const b = AGENT_ID;
  const r = rng(77031);
  const start = addDays(today, -21);
  const nowMinutes = (() => {
    const d = new Date(Date.now() + 6 * 3600 * 1000);
    return d.getUTCHours() * 60 + d.getUTCMinutes();
  })();
  postTxn(db, { ...base(b), kind: "OWNER_DEPOSIT", source: "manual", amount_minor: tk(60000), note: "Opening cash", occurred_at: at(start, 8, 0), lines: linesFor("OWNER_DEPOSIT", tk(60000)) });
  postTxn(db, { ...base(b), kind: "OWNER_DEPOSIT", source: "manual", amount_minor: tk(50000), note: "Opening e-float", occurred_at: at(start, 8, 1), lines: linesFor("OWNER_DEPOSIT", tk(50000), { paidFrom: "wallet" }) });
  const otherWallets = ["bKash", "Nagad", "Rocket"];
  for (const w of otherWallets) {
    const amount = tk(w === "bKash" ? 18000 : w === "Nagad" ? 9000 : 4000);
    postTxn(db, { ...base(b), kind: "OWNER_DEPOSIT", source: "manual", wallet: w, amount_minor: amount, note: `Opening ${w}`, occurred_at: at(start, 8, 2), lines: [{ code: "1030", debit: amount, credit: 0 }, { code: "3000", debit: 0, credit: amount }] });
  }

  for (let day = 0; day <= 21; day++) {
    const date = addDays(start, day);
    const isToday = date === today;
    // Each morning the agent tops up whichever side ran low (bank visit / distributor).
    for (const [code, from] of [["1000", "cash"], ["1010", "wallet"]] as const) {
      const have = balanceOf(db, b, code);
      if (have < tk(40000)) {
        const amount = Math.ceil((tk(45000) - have) / 100000) * 100000;
        postTxn(db, { ...base(b), kind: "OWNER_DEPOSIT", source: "manual", amount_minor: amount, note: "Morning top-up", occurred_at: at(date, 8, 30), lines: linesFor("OWNER_DEPOSIT", amount, { paidFrom: from }) });
      }
    }
    const count = 55 + Math.floor(r() * 35);
    const minutes = Array.from({ length: count }, () => {
      // Busier in the evening: bias minutes toward 17:00-20:00.
      const u = r();
      return u < 0.45 ? 17 * 60 + Math.floor(r() * 180) : 9 * 60 + Math.floor(r() * 12 * 60);
    }).sort((a, z) => a - z);
    let commissionToday = 0;
    for (const minute of minutes) {
      if (isToday && minute > nowMinutes) break;
      const roll = r();
      let kind: TxnKind = roll < 0.36 ? "AGENT_CASH_IN" : roll < 0.84 ? "AGENT_CASH_OUT" : "AGENT_SEND_MONEY";
      const amount = tk(100 * Math.ceil((r() * r() * 9500 + 300) / 100));
      const cash = balanceOf(db, b, "1000");
      const float = balanceOf(db, b, "1010");
      if (kind !== "AGENT_CASH_OUT" && float - amount < tk(4000)) kind = "AGENT_CASH_OUT";
      if (kind === "AGENT_CASH_OUT" && cash - amount < tk(4000)) kind = "AGENT_CASH_IN";
      if (kind === "AGENT_CASH_IN" && float - amount < tk(4000)) continue;
      const ref = `UPA${Math.floor(r() * 0xffffff).toString(36).toUpperCase().padStart(5, "0")}`;
      postTxn(db, { ...base(b), kind, source: "verified", wallet: "upay", reference: ref, amount_minor: amount, occurred_at: at(date, 0, minute), lines: linesFor(kind, amount) });
      if (kind === "AGENT_CASH_OUT") commissionToday += Math.round(amount * 0.0041);
      else if (kind === "AGENT_CASH_IN") commissionToday += Math.round(amount * 0.0018);
    }
    const manualCount = 3 + Math.floor(r() * 5);
    for (let i = 0; i < manualCount; i++) {
      const minute = 10 * 60 + Math.floor(r() * 10 * 60);
      if (isToday && minute > nowMinutes) continue;
      const wallet = otherWallets[Math.floor(r() * 2.6)]!;
      // Keep each other-wallet float realistic: once it is high, the agent sells it back.
      const direction = balanceOf(db, b, "1030", wallet) > tk(20000) ? "cash_in" : r() < 0.6 ? "cash_out" : "cash_in";
      const amount = tk(500 * Math.ceil(r() * 8));
      if (direction === "cash_out" && balanceOf(db, b, "1000") - amount < tk(4000)) continue;
      if (direction === "cash_in" && balanceOf(db, b, "1030", wallet) - amount < 0) continue;
      postTxn(db, { ...base(b), kind: "MANUAL_WALLET", source: "manual", wallet, category: direction, amount_minor: amount, occurred_at: at(date, 0, minute), lines: linesFor("MANUAL_WALLET", amount, { direction }) });
    }
    // At night surplus drawer cash goes to the bank, as a real agent would do.
    if (!isToday && balanceOf(db, b, "1000") > tk(70000)) {
      const amount = Math.floor((balanceOf(db, b, "1000") - tk(50000)) / 100000) * 100000;
      if (amount > 0) postTxn(db, { ...base(b), kind: "OWNER_WITHDRAWAL", source: "manual", amount_minor: amount, note: "ব্যাংকে জমা", occurred_at: at(date, 21, 45), lines: linesFor("OWNER_WITHDRAWAL", amount) });
    }
    const commission = Math.round(commissionToday / 100) * 100;
    if (commission > 0) {
      const when = isToday ? Math.min(nowMinutes, 21 * 60) : 21 * 60 + 30;
      postTxn(db, { ...base(b), kind: "AGENT_COMMISSION", source: "verified", wallet: "upay", amount_minor: commission, occurred_at: at(date, 0, when), lines: linesFor("AGENT_COMMISSION", commission) });
    }
    if (!isToday && day >= 10) {
      const expectedCash = balanceOf(db, b, "1000");
      const expectedUpay = balanceOf(db, b, "1010");
      const variance = r() < 0.7 ? 0 : -tk(50 * Math.ceil(r() * 6));
      if (variance !== 0) postTxn(db, { ...base(b), kind: "CLOSING_VARIANCE", source: "manual", amount_minor: -variance, occurred_at: at(date, 22, 0), lines: [{ code: "9000", debit: -variance, credit: 0 }, { code: "1000", debit: 0, credit: -variance }] });
      db.audits.push({ audit_id: newId("a"), business_id: b, period_date: date, expected_cash_minor: expectedCash, counted_cash_minor: expectedCash + variance, cash_variance_minor: variance, expected_upay_minor: expectedUpay, actual_upay_minor: expectedUpay, upay_variance_minor: 0, commission_minor: commission, note: variance ? "গুনতে ভুল হতে পারে" : null, created_at: at(date, 22, 0) });
    }
  }
  const lastCashOut = [...db.txns].reverse().find((t) => t.business_id === b && t.kind === "AGENT_CASH_OUT");
  if (lastCashOut) db.flags.push({ transaction_id: lastCashOut.id, reason_code: "ANOMALY", reason_bn: "একই নম্বর থেকে ১০ মিনিটে ৩টি ক্যাশ আউট", blocker: false });
  const now = new Date().toISOString();
  db.offers.push({ id: newId("o"), business_id: b, type: "STAMP", title: "৫টি upay লেনদেনে ছোট উপহার", params: { goal: 5, reward_minor: tk(20) }, budget_minor: tk(1000), spent_minor: tk(260), starts_at: at(addDays(today, -6), 8, 0), ends_at: at(addDays(today, 24), 22, 0), audience: "all", status: "ACTIVE", status_changed_at: now, redemption_count: 13, total_discount_minor: tk(260) });
}

export function customerBalance(db: DemoDb, customerId: string): number {
  let sum = 0;
  for (const t of db.txns) {
    if (t.customer_id !== customerId) continue;
    for (const l of t.lines) if (l.code === "1100") sum += l.debit - l.credit;
  }
  return sum;
}

export function createSeedDb(): DemoDb {
  const today = todayDhaka();
  const db: DemoDb = {
    version: DB_VERSION,
    businesses: [
      { business_id: MERCHANT_ID, type: "MERCHANT", name: "করিম জেনারেল স্টোর", category: "grocery", upay_account_ref: "UPM-0174-2290", verified: true, status: "ACTIVE", role: "merchant_owner", permissions: {} },
      { business_id: AGENT_ID, type: "AGENT", name: "রহিম এজেন্ট পয়েন্ট", category: "agent", upay_account_ref: "UPA-0193-0471", verified: true, status: "ACTIVE", role: "agent_owner", permissions: {} },
    ],
    txns: [], customers: [], suppliers: [], payables: [], offers: [], offerResults: [], closings: [], audits: [], flags: [],
  };
  seedMerchant(db, today);
  seedAgent(db, today);
  return db;
}
