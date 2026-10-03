/** In-memory product preview only. This module has no network, auth or persistence APIs. */
export type PreviewRole = "MERCHANT" | "AGENT";
export type EntryKind = "cash_in" | "cash_out" | "send_money" | "add_money" | "cash_sale" | "expense" | "baki_collection" | "supplier_payment" | "manual_wallet" | "qr_payment";
export type RecordSource = "verified" | "manual";
export interface PreviewEntry {
  id: string;
  kind: EntryKind;
  source: RecordSource;
  amount: number;
  name: string;
  note: string;
  date: string;
}
export interface PreviewContact { id: string; name: string; amount: number }
export interface PreviewOffer { id: string; title: string; discount: number; budget: number; spent: number; active: boolean }
export interface PreviewAccount {
  role: PreviewRole;
  cash: number;
  digital: number;
  otherWallet: number;
  entries: PreviewEntry[];
  customers: PreviewContact[];
  suppliers: PreviewContact[];
  offers: PreviewOffer[];
  closing: { cash: number; digital: number; variance: number; note: string } | null;
}

export function normalizeDigits(value: string): string {
  return value.replace(/[০-৯]/g, digit => String("০১২৩৪৫৬৭৮৯".indexOf(digit)));
}

/** Integer arithmetic: reject malformed input instead of silently changing its value. */
export function parseUiAmount(value: string, allowZero = false): number | null {
  const normalized = normalizeDigits(value.trim());
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(normalized)) return null;
  const [whole, fraction = ""] = normalized.split(".");
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(minor) && (allowZero ? minor >= 0 : minor > 0) ? minor : null;
}

export function createPreviewAccount(role: PreviewRole): PreviewAccount {
  const date = new Date().toISOString();
  const examples: [EntryKind, RecordSource, number, string][] = role === "MERCHANT"
    ? [["qr_payment", "verified", 84500, "QR • M-2081"], ["qr_payment", "verified", 126000, "QR • M-2079"], ["cash_sale", "manual", 63500, "Cash • M-2078"], ["expense", "manual", 32000, "Stock • M-2074"]]
    : [["cash_in", "verified", 1250000, "Cash in • A-1081"], ["cash_out", "verified", 850000, "Cash out • A-1079"], ["send_money", "verified", 475000, "Send money • A-1078"], ["manual_wallet", "manual", 650000, "Other wallet • A-1075"]];
  return {
    role,
    cash: role === "MERCHANT" ? 1874500 : 8645000,
    digital: role === "MERCHANT" ? 3268000 : 12478000,
    otherWallet: role === "AGENT" ? 650000 : 0,
    entries: examples.map(([kind, source, amount, name], index) => ({ id: `SAMPLE-${role}-${index + 1}`, kind, source, amount, name, note: "", date })),
    customers: [{ id: "c1", name: "Rahima Begum", amount: 245000 }, { id: "c2", name: "Sohel Ahmed", amount: 178500 }],
    suppliers: [{ id: "s1", name: "Meghna Traders", amount: 1280000 }, { id: "s2", name: "Rupali Distribution", amount: 675000 }],
    offers: [{ id: "o1", title: role === "MERCHANT" ? "Weekend savings" : "Loyal customer offer", discount: 2500, budget: 500000, spent: 87500, active: true }],
    closing: null,
  };
}

export function entryLabel(kind: EntryKind): string {
  const keys: Record<EntryKind, string> = { cash_in: "ux.cash_in", cash_out: "ux.cash_out", send_money: "ux.send_money", add_money: "ux.add_money", cash_sale: "cash_sale.title", expense: "expense.title", baki_collection: "baki.received", supplier_payment: "suppliers.pay", manual_wallet: "ux.manual_wallet", qr_payment: "txn_kind.QR_PAYMENT" };
  return keys[kind];
}

export function entrySource(kind: EntryKind): RecordSource {
  return ["cash_sale", "expense", "baki_collection", "supplier_payment", "manual_wallet"].includes(kind) ? "manual" : "verified";
}

export function applyPreviewEntry(account: PreviewAccount, entry: PreviewEntry, contactId?: string): PreviewAccount {
  if (account.role === "MERCHANT" && ["cash_in", "cash_out", "send_money", "manual_wallet"].includes(entry.kind)) throw new Error("WRONG_ROLE");
  if (account.role === "AGENT" && ["cash_sale", "expense", "baki_collection", "supplier_payment", "qr_payment"].includes(entry.kind)) throw new Error("WRONG_ROLE");
  if (!Number.isSafeInteger(entry.amount) || entry.amount <= 0) throw new Error("INVALID_AMOUNT");
  if (account.entries.some(existing => existing.id === entry.id)) return account;
  let cash = account.cash;
  let digital = account.digital;
  let otherWallet = account.otherWallet;
  if (["cash_in", "send_money"].includes(entry.kind)) { cash += entry.amount; digital -= entry.amount; }
  if (entry.kind === "cash_out") { cash -= entry.amount; digital += entry.amount; }
  if (["cash_sale", "baki_collection"].includes(entry.kind)) cash += entry.amount;
  if (["expense", "supplier_payment"].includes(entry.kind)) cash -= entry.amount;
  if (["qr_payment", "add_money"].includes(entry.kind)) digital += entry.amount;
  if (entry.kind === "manual_wallet") otherWallet += entry.amount;
  if (cash < 0 || digital < 0) throw new Error("INSUFFICIENT");
  const updateDue = (contacts: PreviewContact[]) => contacts.map(contact => {
    if (contact.id !== contactId) return contact;
    if (entry.amount > contact.amount) throw new Error("OVERPAYMENT");
    return { ...contact, amount: contact.amount - entry.amount };
  });
  if (["baki_collection", "supplier_payment"].includes(entry.kind) && !contactId) throw new Error("CONTACT_REQUIRED");
  return { ...account, cash, digital, otherWallet, entries: [{ ...entry, source: entrySource(entry.kind) }, ...account.entries], customers: entry.kind === "baki_collection" ? updateDue(account.customers) : account.customers, suppliers: entry.kind === "supplier_payment" ? updateDue(account.suppliers) : account.suppliers };
}
