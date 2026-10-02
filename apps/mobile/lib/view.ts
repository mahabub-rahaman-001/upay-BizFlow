/**
 * Small view helpers shared by screens: how a transaction reads (icon, direction, title),
 * day grouping and the balance map. Presentation only; no money maths beyond summing
 * already-posted integer amounts.
 */
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type { AppIconName } from "../components/AppIcon";
import type { Tone } from "../components/kit";
import { useBalances, type TransactionRow } from "./api";

export type Direction = "in" | "out" | "none";

const ICONS: Record<string, AppIconName> = {
  QR_PAYMENT: "qr", CASH_SALE: "sale", BAKI_SALE: "baki", BAKI_COLLECTION: "baki", EXPENSE: "expense",
  SUPPLIER_PAYMENT: "suppliers", REFUND: "refund", OWNER_WITHDRAWAL: "wallet", OWNER_DEPOSIT: "wallet",
  AGENT_CASH_IN: "cash-in", AGENT_CASH_OUT: "cash-out", AGENT_SEND_MONEY: "send", AGENT_COMMISSION: "commission",
  MANUAL_WALLET: "wallet", REVERSAL: "history", SETTLEMENT: "bank", CLOSING_VARIANCE: "closing",
};

/** Money in or out of the business's cash and wallets, as the owner thinks of it. */
export function txnDirection(row: Pick<TransactionRow, "kind" | "category">): Direction {
  switch (row.kind) {
    case "QR_PAYMENT": case "CASH_SALE": case "BAKI_COLLECTION": case "OWNER_DEPOSIT":
    case "AGENT_CASH_IN": case "AGENT_SEND_MONEY": case "AGENT_COMMISSION":
      return "in";
    case "EXPENSE": case "SUPPLIER_PAYMENT": case "REFUND": case "OWNER_WITHDRAWAL": case "AGENT_CASH_OUT":
      return "out";
    case "MANUAL_WALLET":
      return row.category === "cash_in" ? "in" : "out";
    default:
      return "none";
  }
}

export function txnIcon(kind: string): AppIconName {
  return ICONS[kind] ?? "transactions";
}

export function txnTone(row: TransactionRow): Tone {
  if (row.source === "manual") return "manual";
  const dir = txnDirection(row);
  return dir === "in" ? "good" : dir === "out" ? "bad" : "neutral";
}

export function txnTitle(row: TransactionRow, t: TFunction): string {
  const kind = t(`txn_kind.${row.kind}`, { defaultValue: row.kind });
  if (row.kind === "CASH_SALE" && row.category) return `${kind} · ${t(`cash_sale.categories.${row.category}`, { defaultValue: row.category })}`;
  if (row.kind === "EXPENSE" && row.category) return t(`expense.types.${row.category}`, { defaultValue: kind });
  if ((row.kind === "BAKI_SALE" || row.kind === "BAKI_COLLECTION" || row.kind === "SUPPLIER_PAYMENT") && row.note) return row.note;
  if (row.kind === "MANUAL_WALLET") return `${row.wallet ?? kind} · ${t(row.category === "cash_in" ? "ux.dir_cash_in" : "ux.dir_cash_out")}`;
  return kind;
}

/** Second line: payer app for QR payments, otherwise the kind for named rows. */
export function txnSubtitle(row: TransactionRow, t: TFunction): string | null {
  if (row.kind === "QR_PAYMENT" && row.note) return t("ux.from_app", { app: row.note });
  if (row.kind === "BAKI_SALE" || row.kind === "BAKI_COLLECTION" || row.kind === "SUPPLIER_PAYMENT") return t(`txn_kind.${row.kind}`);
  if (row.kind === "REVERSAL" && row.note) return row.note;
  return null;
}

export function dhakaDay(iso: string): string {
  return new Date(Date.parse(iso) + 6 * 3600 * 1000).toISOString().slice(0, 10);
}

export function useFormatters() {
  const { i18n } = useTranslation();
  const locale = i18n.language === "en" ? "en-GB" : "bn-BD";
  return useMemo(() => ({
    time: new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit", timeZone: "Asia/Dhaka" }),
    day: new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Dhaka" }),
    date: new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Dhaka" }),
    full: new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Dhaka" }),
    number: new Intl.NumberFormat(locale),
  }), [locale]);
}

/** "Today", "Yesterday" or a short date, for list section headers. */
export function dayLabel(day: string, t: TFunction, fmt: ReturnType<typeof useFormatters>): string {
  const today = dhakaDay(new Date().toISOString());
  if (day === today) return t("ux.today");
  const y = new Date(`${today}T00:00:00Z`);
  y.setUTCDate(y.getUTCDate() - 1);
  if (day === y.toISOString().slice(0, 10)) return t("ux.yesterday");
  return fmt.day.format(new Date(`${day}T06:00:00Z`));
}

/** Balances by account code, in poisha. */
export function useBalanceMap() {
  const query = useBalances();
  const of = (code: string) => Number(query.data?.find((b) => b.code === code)?.balance_minor ?? 0);
  return { ...query, of };
}

/** Totals in and out for a set of rows (reversed rows and their reversals cancel out). */
export function totals(rows: TransactionRow[]) {
  const reversed = new Set(rows.map((r) => r.reverses_txn_id).filter(Boolean));
  let inMinor = 0;
  let outMinor = 0;
  for (const row of rows) {
    if (row.kind === "REVERSAL" || reversed.has(row.id)) continue;
    const dir = txnDirection(row);
    if (dir === "in") inMinor += Number(row.amount_minor);
    if (dir === "out") outMinor += Number(row.amount_minor);
  }
  return { inMinor, outMinor };
}

/** Back if there is somewhere to go back to (a screen opened from a link has none), else Home. */
export function goBack(router: { canGoBack: () => boolean; back: () => void; replace: (href: "/") => void }) {
  if (router.canGoBack()) router.back();
  else router.replace("/");
}
