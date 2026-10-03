/**
 * Money is always integer poisha (1 taka = 100 poisha). Never floats.
 * These helpers format for display (Bangla lakh grouping) and parse input safely.
 */

export type Poisha = number; // integer

export function takaToPoisha(taka: number): Poisha {
  // Round to avoid float artefacts; input is a human-entered taka amount.
  return Math.round(taka * 100);
}

export function poishaToTaka(p: Poisha): number {
  return p / 100;
}

const BN_DIGITS = ["০", "১", "২", "৩", "৪", "৫", "৬", "৭", "৮", "৯"];

function toBnDigits(s: string): string {
  return s.replace(/[0-9]/g, (d) => BN_DIGITS[Number(d)]!);
}

/**
 * Group an integer string in the South-Asian lakh system: 1234567 -> 12,34,567.
 */
export function groupLakh(intStr: string): string {
  const neg = intStr.startsWith("-");
  const digits = neg ? intStr.slice(1) : intStr;
  if (digits.length <= 3) return (neg ? "-" : "") + digits;
  const last3 = digits.slice(-3);
  const rest = digits.slice(0, -3);
  const grouped = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return (neg ? "-" : "") + grouped + "," + last3;
}

export interface MoneyFormatOptions {
  /** Use Bangla digits (০-৯). Default false (Latin). */
  bangla?: boolean;
  /** Show the Tk symbol prefix. Default true. */
  symbol?: boolean;
  /** Show paisa (two decimals) when non-zero. Default false - shops use whole taka. */
  showPaisa?: boolean;
}

/**
 * Format poisha for display, e.g. 1840000 -> "Tk 18,400".
 */
export function formatMoney(p: Poisha, opts: MoneyFormatOptions = {}): string {
  const { bangla = false, symbol = true, showPaisa = false } = opts;
  const neg = p < 0;
  const abs = Math.abs(p);
  const wholeTaka = Math.trunc(abs / 100);
  const paisa = abs % 100;

  let body = groupLakh(String(wholeTaka));
  if (showPaisa && paisa !== 0) {
    body += "." + String(paisa).padStart(2, "0");
  }
  let out = (neg ? "-" : "") + body;
  if (bangla) out = toBnDigits(out);
  return symbol ? "Tk " + out : out;
}

/**
 * Accessible label: reads the full amount in words-friendly form for screen readers.
 */
export function moneyAccessibilityLabel(p: Poisha): string {
  return formatMoney(p, { bangla: false, symbol: true, showPaisa: true });
}
