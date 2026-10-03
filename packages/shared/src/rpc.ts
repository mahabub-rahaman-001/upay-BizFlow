/**
 * The posting API surface. These RPCs are the only way money enters the ledger
 * (supabase/migrations/0002_posting_rpcs.sql and 0006_books_baki_closing.sql); the client
 * never writes to transactions or journal_* directly, and never picks the accounts a
 * transaction posts to.
 *
 * Each helper turns a validated input into the RPC's named parameters. The caller
 * supplies the active business_id from the session, never from user input.
 */
import type {
  AgentAuditInput,
  BakiCollectionInput,
  BakiSaleInput,
  CashSaleInput,
  ClosingInput,
  ExpenseInput,
  ManualWalletInput,
  OwnerWithdrawalInput,
  ReversalInput,
} from "./schemas";

export const RPC = {
  cashSale: "post_cash_sale",
  expense: "post_expense",
  manualWallet: "post_manual_wallet",
  ownerWithdrawal: "post_owner_withdrawal",
  reverse: "reverse_transaction",
} as const;

export type RpcName = (typeof RPC)[keyof typeof RPC];

export function cashSaleArgs(businessId: string, input: CashSaleInput) {
  return {
    p_business_id: businessId,
    p_amount_minor: input.amount_minor,
    p_client_uuid: input.client_uuid,
    p_category: input.category ?? null,
    p_note: input.note ?? null,
    p_customer_id: input.customer_id ?? null,
    p_device_time: input.device_time ?? null,
  };
}

export function expenseArgs(businessId: string, input: ExpenseInput) {
  return {
    p_business_id: businessId,
    p_amount_minor: input.amount_minor,
    p_client_uuid: input.client_uuid,
    p_paid_from: input.paid_from,
    p_expense_type: input.expense_type,
    p_note: input.note ?? null,
  };
}

export function manualWalletArgs(businessId: string, input: ManualWalletInput) {
  return {
    p_business_id: businessId,
    p_amount_minor: input.amount_minor,
    p_client_uuid: input.client_uuid,
    p_wallet: input.wallet,
    p_note: input.note ?? null,
    p_device_time: input.device_time ?? null,
  };
}

export function ownerWithdrawalArgs(businessId: string, input: OwnerWithdrawalInput) {
  return {
    p_business_id: businessId,
    p_amount_minor: input.amount_minor,
    p_client_uuid: input.client_uuid,
    p_paid_from: input.paid_from,
    p_note: input.note ?? null,
    p_device_time: input.device_time ?? null,
  };
}

export function reversalArgs(businessId: string, input: ReversalInput) {
  return {
    p_business_id: businessId,
    p_transaction_id: input.transaction_id,
    p_client_uuid: input.client_uuid,
    p_reason: input.reason,
  };
}

/**
 * Error codes the posting RPCs raise. The database prefixes its message with the code
 * (for example "AMOUNT_INVALID: amount_minor must be ..."), so the UI can look up a
 * Bangla string instead of showing the raw Postgres text.
 */
export const PostingErrorCode = {
  NOT_A_MEMBER: "NOT_A_MEMBER",
  ROLE_NOT_PERMITTED: "ROLE_NOT_PERMITTED",
  AMOUNT_INVALID: "AMOUNT_INVALID",
  PAID_FROM_INVALID: "PAID_FROM_INVALID",
  WALLET_REQUIRED: "WALLET_REQUIRED",
  REASON_REQUIRED: "REASON_REQUIRED",
  IDEMPOTENCY_KEY_REQUIRED: "IDEMPOTENCY_KEY_REQUIRED",
  IDEMPOTENCY_KEY_REUSED: "IDEMPOTENCY_KEY_REUSED",
  TRANSACTION_NOT_FOUND: "TRANSACTION_NOT_FOUND",
  ALREADY_REVERSED: "ALREADY_REVERSED",
  ALREADY_A_REVERSAL: "ALREADY_A_REVERSAL",
  ACCOUNT_NOT_FOUND: "ACCOUNT_NOT_FOUND",
  NO_JOURNAL_LINES: "NO_JOURNAL_LINES",
  CUSTOMER_NOT_FOUND: "CUSTOMER_NOT_FOUND",
  COLLECTION_EXCEEDS_BAKI: "COLLECTION_EXCEEDS_BAKI",
  BLOCKERS_UNRESOLVED: "BLOCKERS_UNRESOLVED",
  ALREADY_CLOSED: "ALREADY_CLOSED",
  CLOSING_NOT_FOUND: "CLOSING_NOT_FOUND",
  NOT_CLOSED: "NOT_CLOSED",
  ALREADY_SUPERSEDED: "ALREADY_SUPERSEDED",
  NAME_REQUIRED: "NAME_REQUIRED",
  NOT_AUTHENTICATED: "NOT_AUTHENTICATED",
  REAUTH_REQUIRED: "REAUTH_REQUIRED",
  AGENT_BUSINESS_REQUIRED: "AGENT_BUSINESS_REQUIRED",
  MERCHANT_BUSINESS_REQUIRED: "MERCHANT_BUSINESS_REQUIRED",
  WALLETS_INVALID: "WALLETS_INVALID",
  ALREADY_AUDITED: "ALREADY_AUDITED",
  UNKNOWN: "UNKNOWN",
} as const;

export type PostingErrorCode =
  (typeof PostingErrorCode)[keyof typeof PostingErrorCode];

/** Reads the leading error code out of a Postgres error message. */
export function postingErrorCode(message: string | undefined): PostingErrorCode {
  const head = message?.split(":")[0]?.trim();
  if (head && head in PostingErrorCode) {
    return PostingErrorCode[head as keyof typeof PostingErrorCode];
  }
  return PostingErrorCode.UNKNOWN;
}

export const BOOKS_RPC = {
  createCustomer: "create_customer",
  customerBalances: "customer_balances",
  bakiSale: "post_baki_sale",
  bakiCollection: "post_baki_collection",
  closingPreview: "closing_preview",
  closing: "post_closing",
  reopenClosing: "reopen_closing",
  closingHistory: "closing_history",
} as const;

export function bakiSaleArgs(businessId: string, input: BakiSaleInput) {
  return {
    p_business_id: businessId,
    p_amount_minor: input.amount_minor,
    p_client_uuid: input.client_uuid,
    p_customer_id: input.customer_id,
    p_note: input.note ?? null,
    p_device_time: input.device_time ?? null,
  };
}

export function bakiCollectionArgs(businessId: string, input: BakiCollectionInput) {
  return {
    ...bakiSaleArgs(businessId, input),
    p_received_in: input.received_in,
  };
}

export function closingArgs(businessId: string, input: ClosingInput) {
  return {
    p_business_id: businessId,
    p_counted_cash_minor: input.counted_cash_minor,
    p_client_uuid: input.client_uuid,
    p_period_date: input.period_date ?? null,
    p_note: input.note ?? null,
    p_exception_reason: input.exception_reason ?? null,
  };
}

export const AGENT_RPC = {
  auditPreview: "agent_audit_preview",
  audit: "post_agent_audit",
  auditHistory: "audit_history",
} as const;

export function agentAuditArgs(businessId: string, input: AgentAuditInput) {
  return {
    p_business_id: businessId,
    p_counted_cash_minor: input.counted_cash_minor,
    p_actual_upay_minor: input.actual_upay_minor,
    p_wallets: input.wallets,
    p_period_date: input.period_date ?? null,
    p_note: input.note ?? null,
  };
}
