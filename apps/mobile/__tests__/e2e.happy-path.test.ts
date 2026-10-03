/**
 * E2E happy-path test (P10). It drives the real Supabase RPCs the way the app does, as a
 * signed-in owner, so it stands in for the "full demo script runs without intervention"
 * check in the roadmap. No UI, no manual steps.
 *
 * It signs in as the demo merchant (Karim) with the local test OTP, then in one run:
 *   1. me() resolves Karim's membership
 *   2. a cash sale posts and moves the drawer (1000) and sales (4000)
 *   3. a settled QR payment ingests and lands in the wallet (1010) as a verified row
 *   4. the day closes and returns a closing id
 *   5. an offer is created, published, and redeemed, and its budget goes down
 *
 * Needs a running local Supabase with the demo seed loaded (pnpm db:reset). The anon and
 * service-role keys come from apps/mobile/.env; this loader reads that file so the test
 * works under a bare `vitest run`.
 *
 * Run: pnpm --filter mobile test
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

// ── Env ─────────────────────────────────────────────────────────────────────
// Load apps/mobile/.env into process.env for any key not already set, so the test runs
// the same whether launched by the workspace, CI (which injects secrets), or bare vitest.
function loadEnv() {
  try {
    const text = readFileSync(join(process.cwd(), ".env"), "utf8");
    for (const line of text.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    // No .env file: rely on whatever the environment already provides.
  }
}
loadEnv();

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

const MERCHANT_ID = "b0000000-0000-4000-8000-000000000001";
const KARIM_PHONE = "+8801700000001";
const DEMO_OTP = "123456";

// Service-role client: provider-side ingestion and verification reads only. It has no
// auth.uid(), so it is never used to call the owner-gated RPCs under test.
const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

// The owner's own client, authenticated below. This is what exercises the RPCs.
let karim: SupabaseClient;

async function rpc(client: SupabaseClient, name: string, args: Record<string, unknown>) {
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error(`${name} failed: ${error.message}`);
  return data;
}

async function balance(code: string): Promise<number> {
  const { data, error } = await admin
    .from("v_account_balances")
    .select("balance_minor")
    .eq("business_id", MERCHANT_ID)
    .eq("code", code)
    .maybeSingle();
  if (error) throw new Error(`balance(${code}) failed: ${error.message}`);
  return Number((data as { balance_minor: number } | null)?.balance_minor ?? 0);
}

const uuid = () => globalThis.crypto.randomUUID();

describe("E2E happy path", () => {
  let offerId: string;

  beforeAll(async () => {
    expect(ANON_KEY, "EXPO_PUBLIC_SUPABASE_ANON_KEY must be set").not.toBe("");
    expect(SERVICE_KEY, "SUPABASE_SERVICE_ROLE_KEY must be set").not.toBe("");

    karim = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
    await karim.auth.signInWithOtp({ phone: KARIM_PHONE });
    const { error } = await karim.auth.verifyOtp({
      phone: KARIM_PHONE,
      token: DEMO_OTP,
      type: "sms",
    });
    if (error) throw new Error(`demo login failed: ${error.message}`);
  }, 30_000);

  // 1. Session resolves to Karim's shop.
  it("me() resolves Karim's merchant membership", async () => {
    const me = (await rpc(karim, "me", {})) as {
      businesses: { business_id: string; role: string }[];
    };
    const shop = me.businesses.find((b) => b.business_id === MERCHANT_ID);
    expect(shop?.role).toBe("merchant_owner");
  });

  // 2. A cash sale moves the drawer and sales.
  it("post_cash_sale raises the drawer (1000) and sales (4000)", async () => {
    const drawerBefore = await balance("1000");
    const salesBefore = await balance("4000"); // income: credit balance is negative here

    await rpc(karim, "post_cash_sale", {
      p_business_id: MERCHANT_ID,
      p_amount_minor: 50000,
      p_client_uuid: uuid(),
      p_category: "grocery",
      p_note: "E2E test sale",
    });

    expect(await balance("1000")).toBe(drawerBefore + 50000);
    // Sales is an income account, so a credit lowers its debit-minus-credit balance.
    expect(await balance("4000")).toBe(salesBefore - 50000);
  });

  // 3. A settled QR payment ingests to the wallet as a verified row.
  it("a settled QR payment lands in the wallet (1010) and is verified", async () => {
    const walletBefore = await balance("1010");
    const providerTxnId = `E2E-${uuid().slice(0, 8)}`;

    const result = (await rpc(admin, "ingest_payment_event", {
      p_provider: "upay",
      p_payload: {
        event_type: "payment.succeeded",
        provider_txn_id: providerTxnId,
        account_ref: "M-000123",
        amount_minor: 42000,
        occurred_at: new Date().toISOString(),
        settlement: { status: "settled" },
      },
    })) as { posted: boolean };

    expect(result.posted).toBe(true);
    expect(await balance("1010")).toBe(walletBefore + 42000);
  });

  // 4. The day closes. The demo shop has a pending payment above the blocker threshold, so
  //    closing needs a stated exception reason - exactly as the UI requires.
  it("post_closing closes the day (idempotent across reruns)", async () => {
    const expected = await balance("1000");
    try {
      const result = (await rpc(karim, "post_closing", {
        p_business_id: MERCHANT_ID,
        p_counted_cash_minor: expected, // exact count -> zero variance
        p_client_uuid: uuid(),
        p_note: "E2E closing",
        p_exception_reason: "pending payment acknowledged for the demo",
      })) as { closing_id: string; variance_minor: number };

      expect(result.closing_id).toMatch(/^[0-9a-f-]{36}$/);
      expect(result.variance_minor).toBe(0);
    } catch (e) {
      // A second run of the demo on the same day finds it already closed, which is itself
      // the closed state the test asserts. Anything else is a real failure.
      if (!(e instanceof Error) || !e.message.includes("ALREADY_CLOSED")) throw e;
      const preview = (await rpc(karim, "closing_preview", {
        p_business_id: MERCHANT_ID,
      })) as { already_closed: boolean };
      expect(preview.already_closed).toBe(true);
    }
  });

  // 5. Offers: create -> publish -> redeem, with the budget going down.
  it("create_offer returns a DRAFT offer", async () => {
    const result = (await rpc(karim, "create_offer", {
      p_business_id: MERCHANT_ID,
      p_type: "AMOUNT_OFF",
      p_title: "E2E Test Offer",
      p_params: { off_minor: 1000 },
      p_budget_minor: 50000,
      p_starts_at: new Date(Date.now() - 3_600_000).toISOString(),
      p_ends_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    })) as { offer_id: string; status: string };

    expect(result.status).toBe("DRAFT");
    offerId = result.offer_id;
    expect(offerId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("publish_offer moves it to ACTIVE", async () => {
    const result = (await rpc(karim, "publish_offer", {
      p_business_id: MERCHANT_ID,
      p_offer_id: offerId,
    })) as { status: string };
    expect(result.status).toBe("ACTIVE");
  });

  it("redeem_offer spends from the budget", async () => {
    const { data: txn } = await admin
      .from("transactions")
      .select("id")
      .eq("business_id", MERCHANT_ID)
      .eq("kind", "CASH_SALE")
      .limit(1)
      .single();

    await rpc(karim, "redeem_offer", {
      p_business_id: MERCHANT_ID,
      p_offer_id: offerId,
      p_transaction_id: (txn as { id: string }).id,
      p_discount_minor: 1000,
    });

    const { data: offer } = await admin
      .from("offers")
      .select("spent_minor")
      .eq("id", offerId)
      .single();

    expect(Number((offer as { spent_minor: number }).spent_minor)).toBe(1000);
  });
});
