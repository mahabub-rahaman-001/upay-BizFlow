/**
 * The app's only route to the database. Every money write goes through one of the posting
 * RPCs in supabase/migrations/0002_posting_rpcs.sql; reads go through RLS-protected
 * selects. No screen builds its own query or passes a business_id it did not get from the
 * session.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AGENT_RPC,
  BOOKS_RPC,
  RPC,
  agentAuditArgs,
  bakiCollectionArgs,
  bakiSaleArgs,
  cashSaleArgs,
  closingArgs,
  expenseArgs,
  manualWalletArgs,
  ownerWithdrawalArgs,
  postingErrorCode,
  postingResult,
  reversalArgs,
  type AgentAuditInput,
  type BakiCollectionInput,
  type BakiSaleInput,
  type CashSaleInput,
  type ClosingInput,
  type ExpenseInput,
  type ManualWalletInput,
  type OwnerWithdrawalInput,
  type PostingResult,
  type ReversalInput,
} from "@bizflow/shared";
import { supabase } from "./supabase";
import { useSession, useActiveBusiness, type BusinessMembership } from "./session";
import { agentKinds, merchantKinds } from "./roles";
import NetInfo from "@react-native-community/netinfo";
import { enqueueOutbox } from "./outbox";

/** An RPC failure carrying the stable code the UI looks up a Bangla string for. */
export class PostingError extends Error {
  readonly code: ReturnType<typeof postingErrorCode>;
  constructor(message: string) {
    super(message);
    this.name = "PostingError";
    this.code = postingErrorCode(message);
  }
}

async function callRpc(name: string, args: Record<string, unknown>): Promise<PostingResult> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new PostingError(error.message);
  return postingResult.parse(data);
}

/** me(): the user and their businesses, in one round trip (docs/07 section 2). */
export function useMe() {
  const setSession = useSession((s) => s.setSession);

  return useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("me");
      if (error) throw new PostingError(error.message);
      const payload = data as { user_id: string; businesses: BusinessMembership[] };
      setSession(payload.user_id, payload.businesses);
      return payload;
    },
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Shared wiring for the posting mutations: resolve the active business, call the RPC, and
 * invalidate the reads a new entry changes. Screens never pass a business id themselves.
 */
function usePostingMutation<TInput>(
  rpcName: string,
  toArgs: (businessId: string, input: TInput) => Record<string, unknown>,
  /** Caches beyond the two every posting changes, e.g. the customer list for baki. */
  alsoInvalidate: string[] = [],
) {
  const queryClient = useQueryClient();
  const activeBusinessId = useSession((s) => s.activeBusinessId);

  return useMutation({
    mutationFn: async (input: TInput) => {
      if (!activeBusinessId) {
        throw new PostingError("NOT_A_MEMBER: no active business selected");
      }
      const args = toArgs(activeBusinessId, input);

      // Offline guard: if no connectivity, persist to outbox and return a sentinel.
      const netState = await NetInfo.fetch();
      if (!netState.isConnected || netState.isInternetReachable === false) {
        await enqueueOutbox(rpcName, args);
        // Return a placeholder so the mutation resolves (not rejects) — UI can detect
        // the queued state from useOutboxStore if needed.
        return { queued: true } as unknown as PostingResult;
      }

      return callRpc(rpcName, args);
    },
    onSuccess: () => {
      for (const key of ["transactions", "balances", "today-insights", ...alsoInvalidate]) {
        void queryClient.invalidateQueries({ queryKey: [key] });
      }
    },
  });
}

export const usePostCashSale = () =>
  usePostingMutation<CashSaleInput>(RPC.cashSale, cashSaleArgs, ["closing"]);

export const usePostExpense = () =>
  usePostingMutation<ExpenseInput>(RPC.expense, expenseArgs, ["closing"]);

export const usePostManualWallet = () =>
  usePostingMutation<ManualWalletInput>(RPC.manualWallet, manualWalletArgs, ["agent-audit"]);

export const usePostOwnerWithdrawal = () =>
  usePostingMutation<OwnerWithdrawalInput>(RPC.ownerWithdrawal, ownerWithdrawalArgs);

export const useReverseTransaction = () =>
  usePostingMutation<ReversalInput>(RPC.reverse, reversalArgs);

/** Account balances for the active business, derived from the journal (never stored). */
export function useBalances() {
  const activeBusinessId = useSession((s) => s.activeBusinessId);

  return useQuery({
    queryKey: ["balances", activeBusinessId],
    enabled: !!activeBusinessId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_account_balances")
        .select("code, name, type, balance_minor")
        .eq("business_id", activeBusinessId);
      if (error) throw new PostingError(error.message);
      return data ?? [];
    },
  });
}

/** The QR payload for the Receive screen. An amount makes it a one-off dynamic QR. */
export function useBusinessQr(amountMinor?: number, reference?: string) {
  const activeBusinessId = useSession((s) => s.activeBusinessId);

  return useQuery({
    queryKey: ["qr", activeBusinessId, amountMinor ?? null, reference ?? null],
    enabled: !!activeBusinessId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_business_qr", {
        p_business_id: activeBusinessId,
        p_amount_minor: amountMinor ?? null,
        p_reference: reference ?? null,
      });
      if (error) throw new PostingError(error.message);
      return data as {
        account_ref: string;
        business_name: string;
        verified: boolean;
        amount_minor: number | null;
        reference: string | null;
        payload: string;
      };
    },
    // The static payload does not change; refetching it on every focus wastes data.
    staleTime: 60 * 60 * 1000,
  });
}

export interface TransactionRow {
  id: string;
  kind: string;
  source: "verified" | "manual";
  amount_minor: number;
  wallet: string | null;
  category: string | null;
  note: string | null;
  reference: string | null;
  reverses_txn_id: string | null;
  occurred_at: string;
}

/**
 * The transaction list. RLS decides what comes back: an owner or manager sees the whole
 * business, a staff member only their own rows (0001 policies), so there is no role
 * branch here.
 */
export function useTransactions(limit = 50) {
  const activeBusinessId = useSession((s) => s.activeBusinessId);
  const active = useActiveBusiness();

  return useQuery({
    queryKey: ["transactions", activeBusinessId, limit],
    enabled: !!activeBusinessId,
    queryFn: async (): Promise<TransactionRow[]> => {
      const { data, error } = await supabase
        .from("transactions")
        .select(
          "id, kind, source, amount_minor, wallet, category, note, reference, reverses_txn_id, occurred_at",
        )
        .eq("business_id", activeBusinessId)
        .in("kind", active?.type === "AGENT" ? agentKinds : merchantKinds)
        .order("occurred_at", { ascending: false })
        .limit(limit);
      if (error) throw new PostingError(error.message);
      return (data ?? []) as TransactionRow[];
    },
  });
}

/**
 * Demo only: asks the simulator Edge Function to mint a signed provider event. It travels
 * the real webhook path, so what lands in the books went through the same signature check
 * and the same posting rules as a live payment. The function refuses unless the
 * deployment has DEMO_MODE on.
 */
export function useSimulatePayment() {
  const queryClient = useQueryClient();
  const activeBusinessId = useSession((s) => s.activeBusinessId);

  return useMutation({
    mutationFn: async (input: { amount_minor: number; payer_app?: string }) => {
      if (!activeBusinessId) {
        throw new PostingError("NOT_A_MEMBER: no active business selected");
      }
      const { data, error } = await supabase.functions.invoke("simulator-pay", {
        body: { business_id: activeBusinessId, ...input },
      });
      if (error) throw new PostingError(error.message);
      return data as { simulated: string; webhook: Record<string, unknown> };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["transactions"] });
      void queryClient.invalidateQueries({ queryKey: ["balances"] });
    },
  });
}

/** Customers with what each still owes, derived from the journal. */
export function useCustomerBalances() {
  const activeBusinessId = useSession((s) => s.activeBusinessId);

  return useQuery({
    queryKey: ["customers", activeBusinessId],
    enabled: !!activeBusinessId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("customer_balances", {
        p_business_id: activeBusinessId,
      });
      if (error) throw new PostingError(error.message);
      return (data ?? []) as {
        customer_id: string;
        name: string;
        phone_last4: string | null;
        balance_minor: number;
      }[];
    },
  });
}

export function useCreateCustomer() {
  const queryClient = useQueryClient();
  const activeBusinessId = useSession((s) => s.activeBusinessId);

  return useMutation({
    mutationFn: async (input: { name: string; phone?: string; consent?: boolean }) => {
      if (!activeBusinessId) {
        throw new PostingError("NOT_A_MEMBER: no active business selected");
      }
      const { data, error } = await supabase.rpc("create_customer", {
        p_business_id: activeBusinessId,
        p_name: input.name,
        p_phone: input.phone ?? null,
        p_consent_to_contact: input.consent ?? false,
      });
      if (error) throw new PostingError(error.message);
      return data as { customer_id: string };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["customers"] });
    },
  });
}

// Baki also moves a customer's balance and the day's expected cash.
const BAKI_CACHES = ["customers", "closing"];

export const usePostBakiSale = () =>
  usePostingMutation<BakiSaleInput>(BOOKS_RPC.bakiSale, bakiSaleArgs, BAKI_CACHES);

export const usePostBakiCollection = () =>
  usePostingMutation<BakiCollectionInput>(
    BOOKS_RPC.bakiCollection,
    bakiCollectionArgs,
    BAKI_CACHES,
  );

export interface ClosingPreview {
  period_date: string;
  expected_cash_minor: number;
  tolerance_minor: number;
  already_closed: boolean;
  lines: Record<string, number>;
  blockers: { transaction_id: string; amount_minor: number; reason: string }[];
}

/** The figures the closing screen shows before the owner counts the drawer. */
export function useClosingPreview() {
  const activeBusinessId = useSession((s) => s.activeBusinessId);

  return useQuery({
    queryKey: ["closing", activeBusinessId],
    enabled: !!activeBusinessId,
    queryFn: async (): Promise<ClosingPreview> => {
      const { data, error } = await supabase.rpc("closing_preview", {
        p_business_id: activeBusinessId,
      });
      if (error) throw new PostingError(error.message);
      return data as ClosingPreview;
    },
    // The expected figure moves with every payment, so do not serve a stale one.
    staleTime: 0,
  });
}

export function usePostClosing() {
  const queryClient = useQueryClient();
  const activeBusinessId = useSession((s) => s.activeBusinessId);

  return useMutation({
    mutationFn: async (input: ClosingInput) => {
      if (!activeBusinessId) {
        throw new PostingError("NOT_A_MEMBER: no active business selected");
      }
      const { data, error } = await supabase.rpc(
        BOOKS_RPC.closing,
        closingArgs(activeBusinessId, input),
      );
      if (error) throw new PostingError(error.message);
      return data as {
        closing_id: string;
        version: number;
        expected_cash_minor: number;
        counted_cash_minor: number;
        variance_minor: number;
      };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["closing"] });
      void queryClient.invalidateQueries({ queryKey: ["transactions"] });
      void queryClient.invalidateQueries({ queryKey: ["balances"] });
    },
  });
}

export interface ClosingHistoryRow {
  closing_id: string;
  period_date: string;
  expected_cash_minor: number;
  counted_cash_minor: number;
  variance_minor: number;
  version: number;
  status: "CLOSED" | "REOPENED";
  created_at: string;
  note: string | null;
  exception_reason: string | null;
  can_reopen: boolean;
}

export function useClosingHistory(enabled = true) {
  const activeBusinessId = useSession((s) => s.activeBusinessId);
  return useQuery({
    queryKey: ["closing-history", activeBusinessId],
    enabled: enabled && !!activeBusinessId,
    queryFn: async (): Promise<ClosingHistoryRow[]> => {
      const { data, error } = await supabase.rpc(BOOKS_RPC.closingHistory, {
        p_business_id: activeBusinessId,
        p_limit: 100,
      });
      if (error) throw new PostingError(error.message);
      return (data ?? []) as ClosingHistoryRow[];
    },
  });
}

export function useReopenClosing() {
  const queryClient = useQueryClient();
  const activeBusinessId = useSession((s) => s.activeBusinessId);
  return useMutation({
    mutationFn: async ({ closingId, reason }: { closingId: string; reason: string }) => {
      if (!activeBusinessId) throw new PostingError("NOT_A_MEMBER: no active business selected");
      const { data, error } = await supabase.rpc(BOOKS_RPC.reopenClosing, {
        p_business_id: activeBusinessId,
        p_closing_id: closingId,
        p_reason: reason,
      });
      if (error) throw new PostingError(error.message);
      return data as { reopened_id: string; version: number };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["closing-history"] });
      void queryClient.invalidateQueries({ queryKey: ["closing"] });
    },
  });
}

export interface AgentWalletPreview {
  wallet: string;
  expected_minor: number;
  source: "manual";
}

export interface AgentAuditPreview {
  period_date: string;
  expected_cash_minor: number;
  expected_upay_minor: number;
  commission_minor: number;
  wallets: AgentWalletPreview[];
  already_audited: boolean;
}

export function useAgentAuditPreview(enabled = true) {
  const activeBusinessId = useSession((s) => s.activeBusinessId);
  return useQuery({
    queryKey: ["agent-audit", activeBusinessId],
    enabled: enabled && !!activeBusinessId,
    queryFn: async (): Promise<AgentAuditPreview> => {
      const { data, error } = await supabase.rpc(AGENT_RPC.auditPreview, {
        p_business_id: activeBusinessId,
      });
      if (error) throw new PostingError(error.message);
      return data as AgentAuditPreview;
    },
    staleTime: 0,
  });
}

export function usePostAgentAudit() {
  const queryClient = useQueryClient();
  const activeBusinessId = useSession((s) => s.activeBusinessId);
  return useMutation({
    mutationFn: async (input: AgentAuditInput) => {
      if (!activeBusinessId) {
        throw new PostingError("NOT_A_MEMBER: no active business selected");
      }
      const { data, error } = await supabase.rpc(
        AGENT_RPC.audit,
        agentAuditArgs(activeBusinessId, input),
      );
      if (error) throw new PostingError(error.message);
      return data as {
        audit_id: string;
        period_date: string;
        cash_variance_minor: number;
        upay_variance_minor: number;
      };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["agent-audit"] });
    },
  });
}

export interface AuditHistoryRow {
  audit_id: string;
  period_date: string;
  expected_cash_minor: number;
  counted_cash_minor: number;
  cash_variance_minor: number;
  expected_upay_minor: number;
  actual_upay_minor: number;
  upay_variance_minor: number;
  commission_minor: number;
  note: string | null;
  created_at: string;
}

export function useAuditHistory(enabled = true) {
  const activeBusinessId = useSession((s) => s.activeBusinessId);
  return useQuery({
    queryKey: ["audit-history", activeBusinessId],
    enabled: enabled && !!activeBusinessId,
    queryFn: async (): Promise<AuditHistoryRow[]> => {
      const { data, error } = await supabase.rpc(AGENT_RPC.auditHistory, {
        p_business_id: activeBusinessId,
        p_limit: 100,
      });
      if (error) throw new PostingError(error.message);
      return (data ?? []) as AuditHistoryRow[];
    },
  });
}

// ---------------------------------------------------------------------------
// P6 AI forecast (reads from v_latest_forecast, written by nightly ai-job)
// ---------------------------------------------------------------------------

export interface ForecastDay {
  day: string;
  p10_minor: number;
  p50_minor: number;
  p90_minor: number;
}

export interface LatestForecast {
  capability: string;
  cutoff_date: string;
  model_version: string;
  confidence: "high" | "medium" | "low";
  abstained: boolean;
  abstain_reason: string | null;
  days: ForecastDay[];
  hours: { date: string; hour: number; p50_minor: number; p90_minor: number }[] | null;
  advice_en: string | null;
  advice_bn: string | null;
}

/**
 * Latest AI forecast for the active business from v_latest_forecast.
 * Returns null (not an error) when no forecast row exists yet.
 * staleTime=0 so the card refreshes on every focus (nightly job may have run).
 */
export function useLatestForecast(capability: "sales7d" | "float24h") {
  const activeBusinessId = useSession((s) => s.activeBusinessId);
  const active = useActiveBusiness();
  return useQuery({
    queryKey: ["ai-forecast", activeBusinessId, capability],
    enabled: !!activeBusinessId && (active?.type === "AGENT" ? capability === "float24h" : capability === "sales7d"),
    queryFn: async (): Promise<LatestForecast | null> => {
      const { data, error } = await supabase.rpc("get_forecast", { p_business_id: activeBusinessId, p_capability: capability });
      if (error) throw new PostingError(error.message);
      return (data as LatestForecast | null) ?? null;
    },
    staleTime: 0,
  });
}


export interface InsightCard {
  id: string;
  icon: string;
  severity: "good" | "warn" | "bad" | "info";
  title_bn: string;
  body_bn: string;
  title_en: string;
  body_en: string;
  facts: Record<string, unknown>;
  action_route: string | null;
}

export function useTodayInsights() {
  const active = useActiveBusiness();
  return useQuery({
    queryKey: ["today-insights", active?.business_id, active?.type],
    enabled: !!active,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("today_insights", { p_business_id: active!.business_id });
      if (error) throw new PostingError(error.message);
      return data as { role: "MERCHANT" | "AGENT"; as_of: string; cards: InsightCard[] };
    },
    refetchInterval: 60 * 1000,
  });
}

export interface SafeToWithdraw {
  available: boolean;
  // True when the AI forecast is switched off for this business (admin feature flag) and
  // the server returned a conservative cash-minus-reserve estimate instead.
  fallback?: boolean;
  reason?: string;
  current_cleared_minor: number;
  forecast_inflow_p10_7d_minor?: number;
  confirmed_expenses_7d_minor?: number;
  supplier_dues_7d_minor?: number;
  dispute_refund_hold_minor?: number;
  lowest_projected_day?: string;
  lowest_projected_balance_p10_minor?: number;
  reserve_minor?: number;
  uncertainty_buffer_minor?: number;
  safe_to_withdraw_minor?: number;
  shortfall_minor?: number;
  confidence: string;
  model_version?: string;
}

/** Deterministic safe-to-withdraw for the active business (docs/08 section 6). */
export function useSafeToWithdraw() {
  const activeBusinessId = useSession((s) => s.activeBusinessId);
  return useQuery({
    queryKey: ["safe-to-withdraw", activeBusinessId],
    enabled: !!activeBusinessId,
    queryFn: async (): Promise<SafeToWithdraw> => {
      const { data, error } = await supabase.rpc("get_safe_to_withdraw", {
        p_business_id: activeBusinessId,
      });
      if (error) throw new PostingError(error.message);
      return data as SafeToWithdraw;
    },
    staleTime: 60 * 1000,
  });
}

export interface WithdrawalSimulation {
  withdraw_minor: number;
  reserve_minor: number;
  lowest_after_minor: number;
  below_reserve: boolean;
  shortfall_minor: number;
  available?: boolean;
}

/** What-if: re-runs the formula with a hypothetical withdrawal. Never calls a model. */
export function useSimulateWithdrawal() {
  const activeBusinessId = useSession((s) => s.activeBusinessId);
  return useMutation({
    mutationFn: async (withdrawMinor: number): Promise<WithdrawalSimulation> => {
      if (!activeBusinessId) {
        throw new PostingError("NOT_A_MEMBER: no active business selected");
      }
      const { data, error } = await supabase.rpc("simulate_withdrawal", {
        p_business_id: activeBusinessId,
        p_withdraw_minor: withdrawMinor,
      });
      if (error) throw new PostingError(error.message);
      return data as WithdrawalSimulation;
    },
  });
}

export interface SupplierBalance {
  supplier_id: string;
  name: string;
  phone_last4: string | null;
  due_minor: number;
  open_count: number;
}

/** Suppliers with what is still owed to each, derived from open payables. */
export function useSupplierBalances() {
  const activeBusinessId = useSession((s) => s.activeBusinessId);
  return useQuery({
    queryKey: ["suppliers", activeBusinessId],
    enabled: !!activeBusinessId,
    queryFn: async (): Promise<SupplierBalance[]> => {
      const { data, error } = await supabase.rpc("supplier_balances", {
        p_business_id: activeBusinessId,
      });
      if (error) throw new PostingError(error.message);
      return (data ?? []) as SupplierBalance[];
    },
  });
}

export interface PayableRow {
  id: string;
  supplier_id: string;
  amount_minor: number;
  amount_remaining_minor: number;
  invoice_ref: string | null;
  due_date: string | null;
  status: string;
  note: string | null;
}

/** Payables for the active business, optionally filtered to the ones still owing. */
export function usePayables(openOnly = true) {
  const activeBusinessId = useSession((s) => s.activeBusinessId);
  return useQuery({
    queryKey: ["payables", activeBusinessId, openOnly],
    enabled: !!activeBusinessId,
    queryFn: async (): Promise<PayableRow[]> => {
      let q = supabase
        .from("supplier_payables")
        .select("id, supplier_id, amount_minor, amount_remaining_minor, invoice_ref, due_date, status, note")
        .eq("business_id", activeBusinessId)
        .order("due_date", { ascending: true, nullsFirst: false });
      if (openOnly) q = q.in("status", ["CONFIRMED", "PARTIALLY_PAID", "OVERDUE"]);
      const { data, error } = await q;
      if (error) throw new PostingError(error.message);
      return (data ?? []) as PayableRow[];
    },
  });
}

export function useCreateSupplier() {
  const queryClient = useQueryClient();
  const activeBusinessId = useSession((s) => s.activeBusinessId);
  return useMutation({
    mutationFn: async (input: { name: string; phone?: string; category?: string }) => {
      if (!activeBusinessId) throw new PostingError("NOT_A_MEMBER: no active business selected");
      const { data, error } = await supabase.rpc("create_supplier", {
        p_business_id: activeBusinessId,
        p_name: input.name,
        p_phone: input.phone ?? null,
        p_category: input.category ?? null,
      });
      if (error) throw new PostingError(error.message);
      return data as { supplier_id: string };
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["suppliers"] }),
  });
}

export function useCreatePayable() {
  const queryClient = useQueryClient();
  const activeBusinessId = useSession((s) => s.activeBusinessId);
  return useMutation({
    mutationFn: async (input: {
      supplier_id: string;
      amount_minor: number;
      due_date?: string;
      invoice_ref?: string;
    }) => {
      if (!activeBusinessId) throw new PostingError("NOT_A_MEMBER: no active business selected");
      const { data, error } = await supabase.rpc("create_payable", {
        p_business_id: activeBusinessId,
        p_supplier_id: input.supplier_id,
        p_amount_minor: input.amount_minor,
        p_due_date: input.due_date ?? null,
        p_invoice_ref: input.invoice_ref ?? null,
      });
      if (error) throw new PostingError(error.message);
      return data as { payable_id: string };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      void queryClient.invalidateQueries({ queryKey: ["payables"] });
      void queryClient.invalidateQueries({ queryKey: ["balances"] });
    },
  });
}

export function usePayPayable() {
  const queryClient = useQueryClient();
  const activeBusinessId = useSession((s) => s.activeBusinessId);
  return useMutation({
    mutationFn: async (input: {
      payable_id: string;
      amount_minor: number;
      paid_from: "cash" | "wallet";
      client_uuid: string;
    }) => {
      if (!activeBusinessId) throw new PostingError("NOT_A_MEMBER: no active business selected");
      const { data, error } = await supabase.rpc("pay_payable", {
        p_business_id: activeBusinessId,
        p_payable_id: input.payable_id,
        p_amount_minor: input.amount_minor,
        p_client_uuid: input.client_uuid,
        p_paid_from: input.paid_from,
      });
      if (error) throw new PostingError(error.message);
      return data as { status: string; remaining_minor: number };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      void queryClient.invalidateQueries({ queryKey: ["payables"] });
      void queryClient.invalidateQueries({ queryKey: ["balances"] });
      void queryClient.invalidateQueries({ queryKey: ["closing"] });
    },
  });
}

export interface ReviewItem {
  transaction_id: string;
  amount_minor: number;
  occurred_at: string;
  reason_code: string;
  reason_bn: string;
}

/** Items needing a human look: pending settlements and open anomaly flags. */
export function useReviewQueue() {
  const activeBusinessId = useSession((s) => s.activeBusinessId);
  return useQuery({
    queryKey: ["review-queue", activeBusinessId],
    enabled: !!activeBusinessId,
    queryFn: async (): Promise<ReviewItem[]> => {
      const { data, error } = await supabase.rpc("review_queue", {
        p_business_id: activeBusinessId,
      });
      if (error) throw new PostingError(error.message);
      return (data ?? []) as ReviewItem[];
    },
  });
}

/** Refund a sale or payment. Owner only; capped at the refundable remaining. */
export function usePostRefund() {
  const queryClient = useQueryClient();
  const activeBusinessId = useSession((s) => s.activeBusinessId);
  return useMutation({
    mutationFn: async (input: {
      original_transaction_id: string;
      amount_minor: number;
      reason: string;
      client_uuid: string;
    }) => {
      if (!activeBusinessId) throw new PostingError("NOT_A_MEMBER: no active business selected");
      const { data, error } = await supabase.rpc("post_refund", {
        p_business_id: activeBusinessId,
        p_original_transaction_id: input.original_transaction_id,
        p_amount_minor: input.amount_minor,
        p_reason: input.reason,
        p_client_uuid: input.client_uuid,
      });
      if (error) throw new PostingError(error.message);
      return data as { status: string; remaining_after_minor: number };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["transactions"] });
      void queryClient.invalidateQueries({ queryKey: ["balances"] });
    },
  });
}

// ---------------------------------------------------------------------------
// P8 Offers
// ---------------------------------------------------------------------------

export type OfferType = "PERCENT_OFF" | "AMOUNT_OFF" | "BXGY" | "STAMP";
export type OfferStatus = "DRAFT" | "ACTIVE" | "PAUSED" | "ENDED";

export interface OfferRow {
  id: string;
  type: OfferType;
  title: string;
  params: Record<string, unknown>;
  budget_minor: number;
  spent_minor: number;
  starts_at: string;
  ends_at: string;
  audience: "all" | "returning" | "new";
  status: OfferStatus;
  status_changed_at: string;
  redemption_count: number;
  total_discount_minor: number;
}

export interface OfferResult {
  offer_id: string;
  pre_sales_minor: number;
  post_sales_minor: number;
  net_lift_minor: number;
  redemption_count: number;
  total_discount_minor: number;
  computed_at: string;
}

/** Active (and recent) offers for the business, with redemption totals. */
export function useOffers(status?: OfferStatus) {
  const activeBusinessId = useSession((s) => s.activeBusinessId);
  return useQuery({
    queryKey: ["offers", activeBusinessId, status ?? null],
    enabled: !!activeBusinessId,
    queryFn: async (): Promise<OfferRow[]> => {
      const { data, error } = await supabase.rpc("list_offers", {
        p_business_id: activeBusinessId,
        p_status: status ?? null,
      });
      if (error) throw new PostingError(error.message);
      return (data ?? []) as OfferRow[];
    },
  });
}

/** DiD results for a single offer (populated after end_offer). */
export function useOfferResults(offerId: string | null) {
  return useQuery({
    queryKey: ["offer-results", offerId],
    enabled: !!offerId,
    queryFn: async (): Promise<OfferResult | null> => {
      const { data, error } = await supabase
        .from("offer_results")
        .select("*")
        .eq("offer_id", offerId)
        .maybeSingle();
      if (error) throw new PostingError(error.message);
      return (data as OfferResult | null) ?? null;
    },
  });
}

export function useCreateOffer() {
  const queryClient = useQueryClient();
  const activeBusinessId = useSession((s) => s.activeBusinessId);
  return useMutation({
    mutationFn: async (input: {
      type: OfferType;
      title: string;
      params: Record<string, unknown>;
      budget_minor: number;
      starts_at: string;
      ends_at: string;
      audience?: "all" | "returning" | "new";
    }) => {
      if (!activeBusinessId) throw new PostingError("NOT_A_MEMBER: no active business selected");
      const { data, error } = await supabase.rpc("create_offer", {
        p_business_id: activeBusinessId,
        p_type: input.type,
        p_title: input.title,
        p_params: input.params,
        p_budget_minor: input.budget_minor,
        p_starts_at: input.starts_at,
        p_ends_at: input.ends_at,
        p_audience: input.audience ?? "all",
      });
      if (error) throw new PostingError(error.message);
      return data as { offer_id: string; status: string };
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["offers"] }),
  });
}

function useOfferMutation(rpcName: string) {
  const queryClient = useQueryClient();
  const activeBusinessId = useSession((s) => s.activeBusinessId);
  return useMutation({
    mutationFn: async (input: { offer_id: string; reason?: string }) => {
      if (!activeBusinessId) throw new PostingError("NOT_A_MEMBER: no active business selected");
      const args: Record<string, unknown> = {
        p_business_id: activeBusinessId,
        p_offer_id: input.offer_id,
      };
      if (input.reason !== undefined) args["p_reason"] = input.reason;
      const { data, error } = await supabase.rpc(rpcName, args);
      if (error) throw new PostingError(error.message);
      return data as { offer_id: string; status: string };
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["offers"] }),
  });
}

export const usePublishOffer = () => useOfferMutation("publish_offer");
export const usePauseOffer  = () => useOfferMutation("pause_offer");
export const useResumeOffer = () => useOfferMutation("resume_offer");
export const useEndOffer    = () => useOfferMutation("end_offer");

export function useRedeemOffer() {
  const queryClient = useQueryClient();
  const activeBusinessId = useSession((s) => s.activeBusinessId);
  return useMutation({
    mutationFn: async (input: {
      offer_id: string;
      transaction_id: string;
      discount_minor: number;
      customer_ref?: string;
    }) => {
      if (!activeBusinessId) throw new PostingError("NOT_A_MEMBER: no active business selected");
      const { data, error } = await supabase.rpc("redeem_offer", {
        p_business_id: activeBusinessId,
        p_offer_id: input.offer_id,
        p_transaction_id: input.transaction_id,
        p_discount_minor: input.discount_minor,
        p_customer_ref: input.customer_ref ?? null,
      });
      if (error) throw new PostingError(error.message);
      return data as {
        redemption_id: string;
        discount_minor: number;
        spent_minor: number;
        budget_minor: number;
      };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["offers"] });
      void queryClient.invalidateQueries({ queryKey: ["balances"] });
    },
  });
}

export function useStampProgress() {
  const queryClient = useQueryClient();
  const activeBusinessId = useSession((s) => s.activeBusinessId);
  return useMutation({
    mutationFn: async (input: {
      offer_id: string;
      customer_ref: string;
      transaction_id: string;
    }) => {
      if (!activeBusinessId) throw new PostingError("NOT_A_MEMBER: no active business selected");
      const { data, error } = await supabase.rpc("stamp_progress", {
        p_business_id: activeBusinessId,
        p_offer_id: input.offer_id,
        p_customer_ref: input.customer_ref,
        p_transaction_id: input.transaction_id,
      });
      if (error) throw new PostingError(error.message);
      return data as {
        stamps: number;
        goal: number;
        completed: boolean;
        reward_minor: number | null;
      };
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["offers"] }),
  });
}

export interface CommissionSummary {
  today_minor: number;
  count_today: number;
  week_minor: number;
  month_minor: number;
  by_day: { date: string; amount_minor: number }[];
}

/** Agent commission rolled up: today, this week, this month, and a 7-day breakdown. */
export function useCommissionSummary() {
  const active = useActiveBusiness();
  return useQuery({
    queryKey: ["commission-summary", active?.business_id],
    enabled: !!active && active.type === "AGENT",
    queryFn: async (): Promise<CommissionSummary> => {
      const { data, error } = await supabase.rpc("commission_summary", {
        p_business_id: active!.business_id,
      });
      if (error) throw new PostingError(error.message);
      return data as CommissionSummary;
    },
  });
}

export interface WalletBreakdown {
  wallets: { wallet: string; total_minor: number; count: number }[];
}

/** Agent's manual other-wallet totals (bKash, Nagad, ...), per wallet. */
export function useWalletBreakdown() {
  const active = useActiveBusiness();
  return useQuery({
    queryKey: ["wallet-breakdown", active?.business_id],
    enabled: !!active && active.type === "AGENT",
    queryFn: async (): Promise<WalletBreakdown> => {
      const { data, error } = await supabase.rpc("wallet_breakdown", {
        p_business_id: active!.business_id,
      });
      if (error) throw new PostingError(error.message);
      return data as WalletBreakdown;
    },
  });
}

export interface BakiReminderDraft {
  customer_name: string;
  phone: string | null;
  balance_minor: number;
  pay_ref: string | null;
  message_bn: string;
  message_en: string;
}

/**
 * Builds a reminder draft for a customer who owes money. It never sends anything: the
 * screen shares the returned text itself (docs/03 M5). Raises NO_CONSENT when the customer
 * has not agreed to be contacted.
 */
export function useBakiReminderDraft() {
  const active = useActiveBusiness();
  return useMutation({
    mutationFn: async (customerId: string): Promise<BakiReminderDraft> => {
      if (!active) throw new PostingError("NOT_A_MEMBER: no active business selected");
      const { data, error } = await supabase.rpc("baki_reminder_draft", {
        p_business_id: active.business_id,
        p_customer_id: customerId,
      });
      if (error) throw new PostingError(error.message);
      return data as BakiReminderDraft;
    },
  });
}

const RECEIPT_BASE = process.env.EXPO_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";

/** The public receipt URL for one of the business's transactions, if it has a receipt. */
export function useReceiptLink() {
  const active = useActiveBusiness();
  return useMutation({
    mutationFn: async (transactionId: string): Promise<string | null> => {
      if (!active) throw new PostingError("NOT_A_MEMBER: no active business selected");
      const { data, error } = await supabase.rpc("get_receipt_link", {
        p_business_id: active.business_id,
        p_transaction_id: transactionId,
      });
      if (error) throw new PostingError(error.message);
      const res = data as { token: string | null; has_receipt: boolean };
      return res.has_receipt && res.token
        ? `${RECEIPT_BASE}/functions/v1/receipt?token=${res.token}`
        : null;
    },
  });
}

export type ReportRow = Record<string, string | number | null>;

/** Owner-only ledger report. The AI never supplies these rows or their amounts. */
export function useReportRows() {
  const active = useActiveBusiness();
  return useMutation({
    mutationFn: async (input: { reportKey: string; fromDate: string; toDate: string }) => {
      if (!active) throw new PostingError("NOT_A_MEMBER: no active business selected");
      const { data, error } = await supabase.rpc("report_rows", {
        p_business_id: active.business_id,
        p_report_key: input.reportKey,
        p_from: input.fromDate,
        p_to: input.toDate,
      });
      if (error) throw new PostingError(error.message);
      return (data ?? []) as ReportRow[];
    },
  });
}

/** Records an export and its audit event after the device re-authentication step. */
export function useLogExport() {
  const active = useActiveBusiness();
  return useMutation({
    mutationFn: async (input: {
      reportKey: string;
      fromDate: string;
      toDate: string;
      rowCount: number;
      fileName: string;
    }) => {
      if (!active) throw new PostingError("NOT_A_MEMBER: no active business selected");
      const { data, error } = await supabase.rpc("log_export", {
        p_business_id: active.business_id,
        p_report_key: input.reportKey,
        p_filters: { from: input.fromDate, to: input.toDate },
        p_format: "csv",
        p_row_count: input.rowCount,
        p_file_name: input.fileName,
      });
      if (error) throw new PostingError(error.message);
      return data as { export_id: string; expires_at: string };
    },
  });
}

const AI_BASE = process.env.EXPO_PUBLIC_AI_SERVICE_URL ?? "http://localhost:8000";

export async function parseReportIntent(requestText: string): Promise<{
  report_key: string;
  filters: { from_date: string; to_date: string };
}> {
  const response = await fetch(`${AI_BASE}/v1/ai/report-builder`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ request_text: requestText }),
  });
  if (!response.ok) throw new Error("REPORT_INTENT_FAILED");
  return response.json() as Promise<{
    report_key: string;
    filters: { from_date: string; to_date: string };
  }>;
}
