export type Entrance = "MERCHANT" | "AGENT";

/** Membership is authoritative; ambiguous legacy accounts must fail closed. */
export function accountType(businesses: { type: Entrance }[]): Entrance | null {
  const types = new Set(businesses.map((business) => business.type));
  if (types.size > 1) throw new Error("MIXED_ROLES");
  return businesses[0]?.type ?? null;
}

export const merchantKinds = ["QR_PAYMENT", "CASH_SALE", "EXPENSE", "BAKI_SALE", "BAKI_COLLECTION", "SUPPLIER_PAYMENT", "REFUND", "SETTLEMENT", "OWNER_DEPOSIT", "OWNER_WITHDRAWAL", "REVERSAL"];
export const agentKinds = ["QR_PAYMENT", "AGENT_CASH_IN", "AGENT_CASH_OUT", "AGENT_SEND_MONEY", "AGENT_COMMISSION", "MANUAL_WALLET", "SETTLEMENT", "OWNER_DEPOSIT", "OWNER_WITHDRAWAL", "REVERSAL"];
