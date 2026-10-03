import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "./supabase";

export async function adminRpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message.split(":")[0]);
  return data as T;
}
export interface AdminSession {
  user_id: string; role: "upay_admin" | "upay_support"; demo_access: boolean; requires_mfa: boolean;
}
export interface SupportCase {
  id: string; business_id: string; business_name: string; subject: string;
  status: "open" | "resolved"; due_at: string; sla_key: string; assigned_to: string;
  grant: { id: string; expires_at: string } | null;
}
export interface AdminDashboard {
  cases: SupportCase[];
  portfolio?: { businesses: number; merchants: number; agents: number };
  activity?: { active_7d: number; qr_gmv_minor: string; agent_volume_minor: string };
  closing?: { wab4: number; adoption_count: number };
  sla?: { open_count: number; overdue_count: number; avg_resolution_h: number | null };
  ai_health?: { capability: string; runs: number; latency_ms: number | null; low_confidence: number; wrong_feedback: number }[];
  forecasts?: { runs: number; abstained: number; latest_at: string | null };
  evaluations?: { model_version: string; dataset: string; metrics: Record<string, number>; evaluated_at: string }[];
  flags?: { id: string; key: string; business_id: string | null; business_name: string | null; enabled: boolean }[];
  pending?: { id: string; key: string; enabled: boolean; reason: string; proposed_by: string }[];
  audit?: { id: string; actor: string; action: string; reason: string; created_at: string }[];
  businesses?: { id: string; name: string }[];
  as_of?: string;
}
export interface BusinessOverview {
  business: {
    id: string; name: string; type: "MERCHANT" | "AGENT";
    status: string; verified: boolean; category: string; created_at: string;
  } | null;
  members: { role: string; count: number }[];
  kpi_7d: {
    txn_count: number; gmv_minor: string;
    refund_count: number; refund_minor: string; last_txn_at: string | null;
  } | null;
  open_cases: {
    id: string; subject: string; sla_key: string; due_at: string;
    assigned_to: string; overdue: boolean;
  }[];
  last_closing: {
    period_date: string; variance_minor: string;
    counted_cash_minor: string; expected_cash_minor: string;
  } | null;
  last_float_audit: {
    period_date: string; cash_variance_minor: string;
    upay_variance_minor: string; commission_minor: string;
  } | null;
  as_of: string;
}
export interface RiskRow {
  business_id: string;
  business_name: string;
  business_type: "MERCHANT" | "AGENT";
  business_status: string;
  pending_settlement_count: number;
  pending_settlement_minor: string;
  refund_spike_7d: number;
  refund_spike_minor_7d: string;
  float_cash_variance_minor: string | null;
  float_upay_variance_minor: string | null;
  float_audit_date: string | null;
  closing_variance_minor: string | null;
  closing_date: string | null;
}
export function useAdminSession(userId?: string) {
  return useQuery({ queryKey: ["admin-session", userId], enabled: !!userId,
    queryFn: () => adminRpc<AdminSession>("admin_session"), retry: false });
}
export function useAdminDashboard(session?: AdminSession) {
  return useQuery({ queryKey: ["admin-dashboard", session?.user_id],
    enabled: !!session && !session.requires_mfa,
    queryFn: () => adminRpc<AdminDashboard>("admin_dashboard"), refetchInterval: 15000, retry: false });
}
export interface AdminAiOutput {
  id: string;
  business_id: string;
  business_name: string;
  capability: string;
  what_en: string | null;
  what_bn: string | null;
  why_en: string | null;
  why_bn: string | null;
  action_en: string | null;
  action_bn: string | null;
  confidence: "high" | "medium" | "low" | null;
  payload: Record<string, unknown>;
  model_version: string | null;
  feedback: "helpful" | "not_helpful" | "wrong" | null;
  feedback_at: string | null;
  created_at: string;
}
export function useAdminCommand() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { action: string; body: Record<string, unknown>; requestId: string }) =>
      adminRpc("admin_command", { p_action: input.action, p_body: input.body, p_request_id: input.requestId }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["admin-dashboard"] });
      void client.invalidateQueries({ queryKey: ["admin-ai-outputs"] });
    },
  });
}
export function useAdminRiskOverview(session?: AdminSession) {
  return useQuery({
    queryKey: ["admin-risk", session?.user_id],
    enabled: !!session && !session.requires_mfa && session.role === "upay_admin",
    queryFn: () => adminRpc<RiskRow[]>("admin_risk_overview"),
    refetchInterval: 30000,
    retry: false,
  });
}
export function useAdminBusinessOverview(businessId: string | null) {
  return useQuery({
    queryKey: ["admin-biz", businessId],
    enabled: !!businessId,
    queryFn: () => adminRpc<BusinessOverview>("admin_business_overview", { p_business_id: businessId }),
    retry: false,
  });
}
export function useAdminAuditExportCsv() {
  return useMutation({
    mutationFn: (limit: number) =>
      adminRpc<string>("admin_audit_export_csv", { p_limit: limit }),
  });
}
export function useAdminAiOutputs(session?: AdminSession) {
  return useQuery({
    queryKey: ["admin-ai-outputs", session?.user_id],
    enabled: !!session && !session.requires_mfa && session.role === "upay_admin",
    queryFn: () => adminRpc<AdminAiOutput[]>("admin_ai_outputs", { p_limit: 50 }),
    refetchInterval: 30000,
    retry: false,
  });
}

