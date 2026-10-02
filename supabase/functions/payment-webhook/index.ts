/**
 * Inbound payment webhook (docs/07 section 14).
 *
 * The only job here is to prove the request came from the provider and hand it to
 * ingest_payment_event(), which does all the posting. Nothing in this function decides
 * what a payment means for the books.
 *
 * Signature: X-Signature: t=<unix seconds>,v1=<hex hmac_sha256(secret, t + "." + body)>
 * Rejected if the signature does not match or the timestamp is more than 300 s from now,
 * which is what stops a captured request being replayed later.
 *
 * Secrets live only in this function's environment, never in the app bundle.
 */
import { createClient } from "jsr:@supabase/supabase-js@2";

const TIMESTAMP_TOLERANCE_SECONDS = 300;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WEBHOOK_SECRET = Deno.env.get("PAYMENT_WEBHOOK_SECRET")!;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Parses `t=...,v1=...` without assuming field order. */
function parseSignatureHeader(header: string | null): { t: number; v1: string } | null {
  if (!header) return null;
  const parts = new Map<string, string>();
  for (const piece of header.split(",")) {
    const [key, value] = piece.split("=", 2);
    if (key && value) parts.set(key.trim(), value.trim());
  }
  const t = Number(parts.get("t"));
  const v1 = parts.get("v1");
  if (!Number.isFinite(t) || !v1) return null;
  return { t, v1 };
}

async function expectedSignature(timestamp: number, body: string): Promise<string> {
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

/** Constant-time comparison: a length-or-content short circuit would leak the signature. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  }

  const body = await req.text();
  const signature = parseSignatureHeader(req.headers.get("X-Signature"));

  if (!signature) {
    return json({ error: "SIGNATURE_MISSING" }, 401);
  }

  const skew = Math.abs(Math.floor(Date.now() / 1000) - signature.t);
  if (skew > TIMESTAMP_TOLERANCE_SECONDS) {
    return json({ error: "SIGNATURE_EXPIRED" }, 401);
  }

  const expected = await expectedSignature(signature.t, body);
  if (!timingSafeEqual(expected, signature.v1)) {
    return json({ error: "SIGNATURE_INVALID" }, 401);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return json({ error: "PAYLOAD_NOT_JSON" }, 400);
  }

  const provider = req.headers.get("X-Provider") ?? "upay";

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const { data, error } = await supabase.rpc("ingest_payment_event", {
    p_provider: provider,
    p_payload: payload,
  });

  if (error) {
    // The provider retries on a 5xx, which is what we want: the event is not yet durable.
    console.error("ingest_payment_event failed", error.message);
    return json({ error: "INGEST_FAILED" }, 500);
  }

  // A duplicate is a success from the provider's point of view (docs/07 section 14).
  return json(data, 200);
});
