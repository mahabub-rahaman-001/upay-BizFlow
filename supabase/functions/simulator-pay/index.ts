/**
 * Demo payment simulator (docs/07 section 14, "Hackathon").
 *
 * Signs a synthetic provider event and sends it through the real payment-webhook path, so
 * a demo exercises the same signature check, the same ingress RPC and the same posting
 * rules as production. It is not a second way into the ledger.
 *
 * Guards, because this mints payments:
 *   - refuses unless DEMO_MODE is "true" in the function environment
 *   - requires the caller's own Supabase JWT, and only ever uses the account_ref of a
 *     business that caller is a member of (RLS decides that, not this code)
 */
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const WEBHOOK_SECRET = Deno.env.get("PAYMENT_WEBHOOK_SECRET")!;
const DEMO_MODE = Deno.env.get("DEMO_MODE") === "true";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function sign(timestamp: number, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(WEBHOOK_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestamp}.${body}`),
  );
  return Array.from(new Uint8Array(mac))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req) => {
  if (!DEMO_MODE) {
    return json({ error: "SIMULATOR_DISABLED" }, 403);
  }
  if (req.method !== "POST") {
    return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return json({ error: "AUTH_REQUIRED" }, 401);
  }

  const { business_id, amount_minor, payer_app, reference, settled } = await req
    .json()
    .catch(() => ({}) as Record<string, unknown>);

  if (typeof business_id !== "string" || typeof amount_minor !== "number") {
    return json({ error: "business_id and amount_minor are required" }, 400);
  }
  if (!Number.isInteger(amount_minor) || amount_minor <= 0) {
    return json({ error: "amount_minor must be a positive integer of poisha" }, 400);
  }

  // The caller's own token, so RLS limits this read to businesses they belong to.
  const asCaller = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });

  const { data: business, error: lookupError } = await asCaller
    .from("businesses")
    .select("upay_account_ref")
    .eq("id", business_id)
    .single();

  if (lookupError || !business?.upay_account_ref) {
    return json({ error: "BUSINESS_NOT_VISIBLE_OR_NO_ACCOUNT_REF" }, 403);
  }

  const now = new Date();
  const payload = {
    event_id: `evt_sim_${crypto.randomUUID()}`,
    event_type: "payment.succeeded",
    provider_txn_id: `SIM${crypto.randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`,
    account_ref: business.upay_account_ref,
    amount_minor,
    currency: "BDT",
    payer_app: typeof payer_app === "string" ? payer_app : "bKash",
    payer_token: `sim-${crypto.randomUUID()}`,
    reference: typeof reference === "string" ? reference : null,
    occurred_at: now.toISOString(),
    settlement:
      settled === false
        ? { status: "pending" }
        : { status: "settled", settled_at: now.toISOString() },
  };

  const body = JSON.stringify(payload);
  const timestamp = Math.floor(now.getTime() / 1000);

  const response = await fetch(`${SUPABASE_URL}/functions/v1/payment-webhook`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Provider": "upay",
      "X-Signature": `t=${timestamp},v1=${await sign(timestamp, body)}`,
    },
    body,
  });

  return json(
    { simulated: payload.provider_txn_id, webhook: await response.json() },
    response.status,
  );
});
