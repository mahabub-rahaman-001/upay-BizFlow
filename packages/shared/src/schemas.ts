import { z } from "zod";
import { TxnKind } from "./enums";

/** Integer poisha, positive. */
export const amountMinor = z.number().int().positive();

export const cashSaleInput = z.object({
  amount_minor: amountMinor,
  category: z.string().max(40).optional(),
  note: z.string().max(240).optional(),
  customer_id: z.string().uuid().optional(),
  client_uuid: z.string().uuid(),
  device_time: z.string().datetime().optional(),
});
export type CashSaleInput = z.infer<typeof cashSaleInput>;

export const expenseInput = z.object({
  amount_minor: amountMinor,
  expense_type: z.enum([
    "supplier_purchase",
    "rent",
    "electricity",
    "transport",
    "salary",
    "other",
  ]),
  paid_from: z.enum(["cash", "wallet"]),
  note: z.string().max(240).optional(),
  client_uuid: z.string().uuid(),
});
export type ExpenseInput = z.infer<typeof expenseInput>;

export const refundInput = z.object({
  original_txn_id: z.string().uuid(),
  amount_minor: amountMinor,
  reason: z.string().min(3).max(240),
});
export type RefundInput = z.infer<typeof refundInput>;

export const paymentEvent = z.object({
  event_id: z.string(),
  event_type: z.string(),
  provider_txn_id: z.string(),
  account_ref: z.string(),
  amount_minor: amountMinor,
  currency: z.literal("BDT"),
  payer_app: z.string().optional(),
  payer_token: z.string().optional(),
  reference: z.string().optional(),
  occurred_at: z.string().datetime(),
  settlement: z
    .object({ status: z.enum(["settled", "pending"]), settled_at: z.string().datetime().optional() })
    .optional(),
});
export type PaymentEvent = z.infer<typeof paymentEvent>;

export const txnKindSchema = z.nativeEnum(TxnKind);

export const manualWalletInput = z.object({
  amount_minor: amountMinor,
  wallet: z.string().min(1).max(40),
  note: z.string().max(240).optional(),
  client_uuid: z.string().uuid(),
  device_time: z.string().datetime().optional(),
});
export type ManualWalletInput = z.infer<typeof manualWalletInput>;

export const ownerWithdrawalInput = z.object({
  amount_minor: amountMinor,
  paid_from: z.enum(["cash", "wallet"]),
  note: z.string().max(240).optional(),
  client_uuid: z.string().uuid(),
  device_time: z.string().datetime().optional(),
});
export type OwnerWithdrawalInput = z.infer<typeof ownerWithdrawalInput>;

export const reversalInput = z.object({
  transaction_id: z.string().uuid(),
  reason: z.string().min(3).max(240),
  client_uuid: z.string().uuid(),
});
export type ReversalInput = z.infer<typeof reversalInput>;

/** What every posting RPC returns. `replayed` is true when the call was a retry. */
export const postingResult = z.object({
  transaction_id: z.string().uuid(),
  entry_id: z.string().uuid(),
  kind: txnKindSchema,
  amount_minor: amountMinor,
  replayed: z.boolean(),
});
export type PostingResult = z.infer<typeof postingResult>;

export const bakiSaleInput = z.object({
  amount_minor: amountMinor,
  customer_id: z.string().uuid(),
  note: z.string().max(240).optional(),
  client_uuid: z.string().uuid(),
  device_time: z.string().datetime().optional(),
});
export type BakiSaleInput = z.infer<typeof bakiSaleInput>;

export const bakiCollectionInput = bakiSaleInput.extend({
  received_in: z.enum(["cash", "wallet"]),
});
export type BakiCollectionInput = z.infer<typeof bakiCollectionInput>;

export const closingInput = z.object({
  counted_cash_minor: z.number().int().nonnegative(),
  client_uuid: z.string().uuid(),
  period_date: z.string().date().optional(),
  note: z.string().max(240).optional(),
  exception_reason: z.string().max(240).optional(),
});
export type ClosingInput = z.infer<typeof closingInput>;

export const agentAuditInput = z.object({
  counted_cash_minor: z.number().int().nonnegative(),
  actual_upay_minor: z.number().int().nonnegative(),
  wallets: z.array(
    z.object({
      wallet: z.string().min(1).max(40),
      actual_minor: z.number().int().nonnegative(),
    }),
  ),
  period_date: z.string().date().optional(),
  note: z.string().max(240).optional(),
});
export type AgentAuditInput = z.infer<typeof agentAuditInput>;
