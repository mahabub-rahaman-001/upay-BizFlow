// Shared enums. Keep in sync with supabase/migrations.

export const BusinessType = { MERCHANT: "MERCHANT", AGENT: "AGENT" } as const;
export type BusinessType = (typeof BusinessType)[keyof typeof BusinessType];

export const MemberRole = {
  MERCHANT_OWNER: "merchant_owner",
  AGENT_OWNER: "agent_owner",
  STAFF: "staff",
  MANAGER: "manager",
  AUDITOR: "auditor",
} as const;
export type MemberRole = (typeof MemberRole)[keyof typeof MemberRole];

export const TxnKind = {
  QR_PAYMENT: "QR_PAYMENT",
  CASH_SALE: "CASH_SALE",
  BAKI_SALE: "BAKI_SALE",
  BAKI_COLLECTION: "BAKI_COLLECTION",
  EXPENSE: "EXPENSE",
  SUPPLIER_PAYMENT: "SUPPLIER_PAYMENT",
  REFUND: "REFUND",
  OWNER_WITHDRAWAL: "OWNER_WITHDRAWAL",
  OWNER_DEPOSIT: "OWNER_DEPOSIT",
  AGENT_CASH_IN: "AGENT_CASH_IN",
  AGENT_CASH_OUT: "AGENT_CASH_OUT",
  AGENT_SEND_MONEY: "AGENT_SEND_MONEY",
  AGENT_COMMISSION: "AGENT_COMMISSION",
  MANUAL_WALLET: "MANUAL_WALLET",
  CLOSING_VARIANCE: "CLOSING_VARIANCE",
  REVERSAL: "REVERSAL",
} as const;
export type TxnKind = (typeof TxnKind)[keyof typeof TxnKind];

export const Confidence = { HIGH: "high", MEDIUM: "medium", LOW: "low" } as const;
export type Confidence = (typeof Confidence)[keyof typeof Confidence];
