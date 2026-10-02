/**
 * ai-job — Nightly Supabase Edge Function (P6).
 *
 * Triggered by pg_cron at 02:00 Asia/Dhaka daily.
 * For each active business:
 *   1. Fetches last 90 days of daily sales from the ledger.
 *   2. Calls the AI service /v1/forecast/sales.
 *   3. Stores result in forecast_runs.
 *   4. If AI service times out, computes baseline forecast in-process (SQL fallback).
 *
 * Auth: called with service role key (never exposed to client).
 * The AI service URL is in AI_SERVICE_URL env var (no trailing slash).
 */

import { createClient } from "jsr:@supabase/supabase-js@2";

const AI_SERVICE_URL = Deno.env.get("AI_SERVICE_URL") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const AI_TIMEOUT_MS = 8_000;
const MAX_BUSINESSES = 500; // cap per run

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DailyHistory {
  day: string;
  sales_minor: number;
}

interface ForecastDay {
  day: string;
  p10_minor: number;
  p50_minor: number;
  p90_minor: number;
}

interface ForecastResult {
  model_version: string;
  confidence: string;
  abstained: boolean;
  abstain_reason: string | null;
  days: ForecastDay[];
  from_fallback: boolean;
}

// ---------------------------------------------------------------------------
// Deterministic baseline (SQL fallback when AI service is unavailable)
// ---------------------------------------------------------------------------

function seasonalMean4w(series: number[], dowOffset: number): number {
  // Collect up to 4 values from series where position matches the weekday stride.
  const samples: number[] = [];
  const n = series.length;
  for (let i = n - 1; i >= 0; i--) {
    const daysBack = n - 1 - i;
    if (daysBack > 0 && daysBack % 7 === 0) {
      samples.push(series[i]);
    }
    if (samples.length === 4) break;
  }
  if (samples.length === 0) {
    const tail = series.slice(-7);
    return tail.length > 0 ? Math.round(tail.reduce((a, b) => a + b, 0) / tail.length) : 0;
  }
  return Math.round(samples.reduce((a, b) => a + b, 0) / samples.length);
}

function baselineForecast(history: DailyHistory[], cutoffDate: Date): ForecastResult {
  const values = history.map((h) => h.sales_minor);
  const n = values.length;

  if (n < 14) {
    return {
      model_version: "baseline-seasonal-0.1",
      confidence: "low",
      abstained: true,
      abstain_reason: "Not enough history yet (need at least 14 days).",
      days: [],
      from_fallback: true,
    };
  }

  const byDow: Map<number, number[]> = new Map();
  for (const h of history) {
    const d = new Date(h.day);
    const dow = d.getDay(); // 0=Sun in JS; adjust if needed
    if (!byDow.has(dow)) byDow.set(dow, []);
    byDow.get(dow)!.push(h.sales_minor);
  }

  const overallMed = [...values].sort((a, b) => a - b)[Math.floor(n / 2)];
  const days: ForecastDay[] = [];

  for (let i = 0; i < 7; i++) {
    const d = new Date(cutoffDate);
    d.setDate(d.getDate() + i + 1);
    const dow = d.getDay();
    const series = byDow.get(dow) ?? values;
    const recent = series.slice(-4);
    const sorted = [...recent].sort((a, b) => a - b);
    const p50 = sorted[Math.floor(sorted.length / 2)] ?? overallMed;
    const spread = recent.length > 1
      ? Math.round(Math.sqrt(recent.reduce((s, v) => s + (v - p50) ** 2, 0) / recent.length))
      : Math.round(0.2 * p50);
    days.push({
      day: d.toISOString().slice(0, 10),
      p10_minor: Math.max(0, p50 - spread),
      p50_minor: Math.max(0, p50),
      p90_minor: Math.max(0, p50 + spread),
    });
  }

  const confidence = n >= 56 ? "high" : n >= 28 ? "medium" : "low";
  return {
    model_version: "baseline-seasonal-0.1",
    confidence,
    abstained: false,
    abstain_reason: null,
    days,
    from_fallback: true,
  };
}

// ---------------------------------------------------------------------------
// AI service call
// ---------------------------------------------------------------------------

async function callAIService(
  businessId: string,
  history: DailyHistory[],
  category: string,
  locationType: string,
): Promise<ForecastResult | null> {
  if (!AI_SERVICE_URL) return null;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
    const resp = await fetch(`${AI_SERVICE_URL}/v1/forecast/sales`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        business_id: businessId,
        history,
        category,
        location_type: locationType,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!resp.ok) return null;
    const data = await resp.json();
    return { ...data, from_fallback: false };
  } catch {
    return null; // timeout or network error → use baseline
  }
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

async function runForBusiness(
  businessId: string,
  category: string,
  locationType: string,
  cutoffDate: Date,
): Promise<{ success: boolean; note: string }> {
  // Fetch last 90 days of daily net sales from ledger.
  const since = new Date(cutoffDate);
  since.setDate(since.getDate() - 90);

  const { data: rows, error } = await supabase.rpc("business_daily_sales", {
    p_business_id: businessId,
    p_since: since.toISOString().slice(0, 10),
    p_until: cutoffDate.toISOString().slice(0, 10),
  });

  if (error || !rows) {
    return { success: false, note: error?.message ?? "no data" };
  }

  const history: DailyHistory[] = (rows as { day: string; sales_minor: number }[]).map((r) => ({
    day: r.day,
    sales_minor: r.sales_minor,
  }));

  const startMs = Date.now();
  let result = await callAIService(businessId, history, category, locationType);
  if (!result) {
    // SQL fallback: compute baseline in-process
    result = baselineForecast(history, cutoffDate);
  }
  const latencyMs = Date.now() - startMs;

  const { error: insertErr } = await supabase.from("forecast_runs").upsert(
    {
      business_id: businessId,
      capability: "sales7d",
      cutoff_date: cutoffDate.toISOString().slice(0, 10),
      model_version: result.model_version,
      feature_version: "v1",
      confidence: result.confidence,
      abstained: result.abstained,
      abstain_reason: result.abstain_reason ?? null,
      days: result.days,
      latency_ms: latencyMs,
    },
    { onConflict: "business_id,capability,cutoff_date" },
  );

  if (insertErr) {
    return { success: false, note: insertErr.message };
  }
  return { success: true, note: result.from_fallback ? "baseline" : "lgbm" };
}

Deno.serve(async (req: Request) => {
  // Only accept POST (pg_cron sends HTTP POST to trigger).
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0); // start of today Asia/Dhaka (simplified)

  // Fetch active MERCHANT businesses (AGENT float is handled separately).
  const { data: businesses, error } = await supabase
    .from("businesses")
    .select("id, category, location_type")
    .eq("type", "MERCHANT")
    .eq("status", "active")
    .limit(MAX_BUSINESSES);

  if (error || !businesses) {
    return new Response(JSON.stringify({ error: error?.message }), { status: 500 });
  }

  const results: { id: string; success: boolean; note: string }[] = [];
  for (const biz of businesses) {
    const r = await runForBusiness(
      biz.id,
      biz.category ?? "other",
      biz.location_type ?? "urban",
      cutoff,
    );
    results.push({ id: biz.id, ...r });
  }

  const succeeded = results.filter((r) => r.success).length;
  return new Response(
    JSON.stringify({ ran: results.length, succeeded, cutoff: cutoff.toISOString().slice(0, 10) }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
});
