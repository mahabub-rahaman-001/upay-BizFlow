import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../../lib/supabase";
import { adminRpc, useAdminAiOutputs, useAdminAuditExportCsv, useAdminBusinessOverview, useAdminCommand, useAdminDashboard, useAdminRiskOverview, useAdminSession, type AdminAiOutput, type AdminDashboard, type AdminSession, type RiskRow, type SupportCase } from "../../lib/admin";
import { formatMoney } from "@bizflow/shared";

const DEMO = process.env.EXPO_PUBLIC_DEMO_MODE === "true";
type Page = "portfolio" | "support" | "health" | "flags" | "audit" | "risk" | "simulator";
const box: CSSProperties = { background: "#fff", border: "1px solid #e1e7ef", borderRadius: 12, padding: 22 };
const button: CSSProperties = { background: "#0B4EA2", border: 0, color: "white", borderRadius: 8, padding: "12px 18px", cursor: "pointer", font: "inherit" };
const input: CSSProperties = { padding: 12, border: "1px solid #b9c4d3", borderRadius: 8, font: "inherit", width: "100%", boxSizing: "border-box" };

export default function Admin() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [page, setPage] = useState<Page>("portfolio");
  const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now());
  const identity = useAdminSession(session?.user.id);
  const dashboard = useAdminDashboard(identity.data);
  const risk = useAdminRiskOverview(identity.data);

  useEffect(() => {
    let live = true;
    void supabase.auth.getSession().then(({ data, error: e }) => {
      if (live) { setSession(data.session); setReady(true); if (e) setError(e.message); }
    });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next); setReady(true);
    });
    return () => { live = false; data.subscription.unsubscribe(); };
  }, []);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 10000);
    return () => clearInterval(timer);
  }, []);
  async function signOut() {
    await supabase.auth.signOut();
    queryClient.removeQueries({ queryKey: ["admin-dashboard"] });
    queryClient.removeQueries({ queryKey: ["admin-session"] });
    setPage("portfolio");
  }
  const isAdmin = identity.data?.role === "upay_admin";
  const currentPage = !isAdmin ? "support" : page;
  const nav: Page[] = isAdmin ? ["portfolio", "risk", "support", "health", "flags", "audit", ...(identity.data?.demo_access ? ["simulator" as const] : [])] : ["support"];
  return <div style={{ minHeight: "100vh", background: "#F4F7FB", color: "#111827", fontFamily: "system-ui, sans-serif", lineHeight: 1.5 }}>
    <header style={{ background: "#083A7A", color: "white", padding: "18px 28px", display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap" }}>
      <strong style={{ fontSize: 23, flex: 1 }}>upay <span style={{ fontWeight: 400 }}>BizFlow / {t("admin.title")}</span></strong>
      <button style={button} onClick={() => void i18n.changeLanguage(i18n.language === "bn" ? "en" : "bn")}>{i18n.language === "bn" ? "English" : "বাংলা"}</button>
      {session ? <button style={button} onClick={() => void signOut()}>{t("admin.sign_out")}</button> : null}
    </header>
    {!ready ? <p style={{ padding: 28 }}>{t("admin.loading")}</p> : !session ? <AdminLogin /> : identity.isLoading ? <p style={{ padding: 28 }}>{t("admin.loading")}</p> : identity.isError ?
      <Notice>{t("admin.denied")}</Notice> : identity.data?.requires_mfa ? <Mfa onVerified={() => void identity.refetch()} /> :
      <div style={{ display: "flex", flexWrap: "wrap", minHeight: "calc(100vh - 78px)" }}>
        <nav aria-label={t("admin.navigation")} style={{ background: "#fff", width: 210, padding: 20, borderRight: "1px solid #e1e7ef" }}>
          <p style={{ color: "#5B6472", fontSize: 13 }}>{identity.data?.role}</p>
          {nav.map((item) => <button key={item} aria-current={currentPage === item ? "page" : undefined} onClick={() => setPage(item)} style={{ ...button, width: "100%", textAlign: "left", marginBottom: 8, background: currentPage === item ? "#0B4EA2" : "#edf3fa", color: currentPage === item ? "white" : "#083A7A" }}>{t(`admin.${item}`)}</button>)}
        </nav>
        <main style={{ flex: "1 1 550px", minWidth: 0, padding: 28, maxWidth: 1450 }}>
          <h1 style={{ fontSize: 28, marginTop: 0 }}>{t(`admin.${currentPage}`)}</h1>
          {identity.data?.demo_access ? <Notice>{t("admin.demo_notice")}</Notice> : null}
          {error ? <Notice error>{error}</Notice> : null}
          {dashboard.isError ? <Notice error>{t("admin.load_error")} <button style={button} onClick={() => void dashboard.refetch()}>{t("admin.retry")}</button></Notice> : !dashboard.data ? <p>{t("admin.loading")}</p> : <>
            {currentPage === "portfolio" ? <Portfolio data={dashboard.data} /> : null}
            {currentPage === "risk" ? <Risk rows={risk.data ?? []} isLoading={risk.isLoading} isError={risk.isError} onRefresh={() => void risk.refetch()} /> : null}
            {currentPage === "support" ? <Support cases={dashboard.data.cases} now={now} /> : null}
            {currentPage === "health" ? <Health data={dashboard.data} session={identity.data} /> : null}
            {currentPage === "flags" ? <Flags data={dashboard.data} userId={session.user.id} /> : null}
            {currentPage === "audit" ? <Audit data={dashboard.data} /> : null}
            {currentPage === "simulator" ? <Simulator businesses={dashboard.data.businesses ?? []} /> : null}
          </>}
        </main>
      </div>}
  </div>;
}

function AdminLogin() {
  const { t } = useTranslation();
  const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function login(phone?: string) {
    setBusy(true); setError("");
    try {
      if (phone) {
        const otp = await supabase.auth.signInWithOtp({ phone }); if (otp.error) throw otp.error;
        const verified = await supabase.auth.verifyOtp({ phone, token: "123456", type: "sms" }); if (verified.error) throw verified.error;
      } else {
        const result = await supabase.auth.signInWithPassword({ email, password }); if (result.error) throw result.error;
      }
    } catch { setError(t("admin.login_error")); } finally { setBusy(false); }
  }
  return <section style={{ ...box, maxWidth: 430, margin: "60px auto" }}>
    <h1>{t("admin.sign_in")}</h1><p>{t("admin.login_hint")}</p>
    <form onSubmit={(e) => { e.preventDefault(); void login(); }} style={{ display: "grid", gap: 16 }}>
      <Field label={t("admin.email")}><input style={input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="username" /></Field>
      <Field label={t("admin.password")}><input style={input} type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" /></Field>
      <button style={button} disabled={busy}>{t("admin.sign_in")}</button>
    </form>
    {error ? <Notice error>{error}</Notice> : null}
    {DEMO ? <div style={{ display: "grid", gap: 8, marginTop: 24 }}>
      {["admin", "checker", "support"].map((role, i) => <button key={role} style={button} disabled={busy} onClick={() => void login(`+880170000000${i + 4}`)}>{t(`admin.demo_${role}`)}</button>)}
    </div> : null}
  </section>;
}

function Mfa({ onVerified }: { onVerified: () => void }) {
  const { t } = useTranslation();
  const [factorId, setFactorId] = useState(""); const [qr, setQr] = useState(""); const [code, setCode] = useState("");
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  async function prepare() {
    setBusy(true); setError("");
    try {
      const factors = await supabase.auth.mfa.listFactors(); if (factors.error) throw factors.error;
      if (factors.data.totp[0]) setFactorId(factors.data.totp[0].id);
      else {
        const enrollment = await supabase.auth.mfa.enroll({ factorType: "totp" });
        if (enrollment.error) throw enrollment.error;
        setFactorId(enrollment.data.id); setQr(enrollment.data.totp.qr_code);
      }
    } catch { setError(t("admin.mfa_error")); } finally { setBusy(false); }
  }
  async function verify() {
    setBusy(true); setError("");
    const result = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
    setBusy(false);
    if (result.error) setError(t("admin.mfa_error")); else onVerified();
  }
  return <section style={{ ...box, margin: "50px auto", maxWidth: 420 }}>
    <h1>{t("admin.mfa")}</h1><p>{t("admin.mfa_hint")}</p>
    {!factorId ? <button style={button} disabled={busy} onClick={() => void prepare()}>{t("admin.continue")}</button> : <>
      {qr ? <img src={qr.startsWith("data:") ? qr : `data:image/svg+xml;utf8,${encodeURIComponent(qr)}`} alt={t("admin.mfa_qr")} width={240} /> : null}
      <Field label={t("admin.code")}><input style={input} value={code} inputMode="numeric" maxLength={6} onChange={(e) => setCode(e.target.value)} /></Field>
      <button style={{ ...button, marginTop: 16 }} disabled={busy || !/^\d{6}$/.test(code)} onClick={() => void verify()}>{t("admin.verify")}</button>
    </>}{error ? <Notice error>{error}</Notice> : null}
  </section>;
}

function Portfolio({ data }: { data: AdminDashboard }) {
  const { t, i18n } = useTranslation();
  const bangla = i18n.language === "bn";
  const money = (n?: string) => formatMoney(Number(n ?? 0), { bangla });
  const [selectedBiz, setSelectedBiz] = useState<string | null>(null);

  const sla = data.sla;
  return <>
    <p>{t("admin.window_7d")}</p>

    {/* 8.4 SLA badges */}
    {sla ? (
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 18 }}>
        {[
          {
            label: bangla ? "মোট খোলা কেস" : "Open cases",
            value: sla.open_count,
            color: sla.open_count > 0 ? "#1D4ED8" : "#15803D",
          },
          {
            label: bangla ? "মেয়াদ পেরিয়ে গেছে" : "Overdue",
            value: sla.overdue_count,
            color: sla.overdue_count > 0 ? "#B91C1C" : "#15803D",
          },
          {
            label: bangla ? "গড় সমাধান (ঘণ্টা, ৩০দিন)" : "Avg resolution (h, 30 d)",
            value: sla.avg_resolution_h != null ? `${sla.avg_resolution_h} h` : "—",
            color: "#5B6472",
          },
        ].map(chip => (
          <article key={chip.label} style={{ ...box, padding: "12px 18px", minWidth: 170 }}>
            <div style={{ color: "#5B6472", fontSize: 12 }}>{chip.label}</div>
            <strong style={{ fontSize: 26, color: chip.color }}>{chip.value}</strong>
          </article>
        ))}
      </div>
    ) : null}

    {/* KPI grid */}
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 18 }}>
      {[
        ["businesses", data.portfolio?.businesses], ["merchants", data.portfolio?.merchants], ["agents", data.portfolio?.agents],
        ["active_7d", data.activity?.active_7d], ["wab4", data.closing?.wab4], ["closing_adoption", data.closing?.adoption_count],
        ["qr_gmv", money(data.activity?.qr_gmv_minor)], ["agent_volume", money(data.activity?.agent_volume_minor)],
      ].map(([key, value]) => <article key={key} style={box}><div style={{ color: "#5B6472" }}>{t(`admin.${key}`)}</div><strong style={{ fontSize: 32 }}>{value ?? "—"}</strong></article>)}
    </div>
    <p style={{ color: "#5B6472" }}>{t("admin.kpi_method")}</p>

    {/* 8.3 Business drill-down */}
    <h2 style={{ marginTop: 28 }}>{bangla ? "ব্যবসার তালিকা" : "Business list"}</h2>
    <div style={{ ...box, padding: 0, overflowX: "auto", marginBottom: 24 }}>
      <table style={{ borderCollapse: "collapse", width: "100%", textAlign: "left" }}>
        <thead>
          <tr>
            {[bangla ? "নাম" : "Name", bangla ? "ধরন" : "Type", bangla ? "বিস্তারিত" : "Detail"].map((h, i) => (
              <th key={i} scope="col" style={{ padding: 12, background: "#edf3fa", fontWeight: 600 }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(data.businesses ?? []).map(b => (
            <tr key={b.id}>
              <td style={{ padding: 12, borderTop: "1px solid #e1e7ef", fontWeight: 500 }}>{b.name}</td>
              <td style={{ padding: 12, borderTop: "1px solid #e1e7ef", color: "#5B6472" }}>—</td>
              <td style={{ padding: 12, borderTop: "1px solid #e1e7ef" }}>
                <button style={{ ...button, padding: "7px 14px", fontSize: 13 }}
                  onClick={() => setSelectedBiz(selectedBiz === b.id ? null : b.id)}>
                  {selectedBiz === b.id
                    ? (bangla ? "বন্ধ করুন" : "Close")
                    : (bangla ? "দেখুন" : "View")}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>

    {selectedBiz ? <BusinessPanel businessId={selectedBiz} /> : null}
  </>;
}

// 8.3 drill-down panel
function BusinessPanel({ businessId }: { businessId: string }) {
  const { i18n } = useTranslation();
  const bangla = i18n.language === "bn";
  const biz = useAdminBusinessOverview(businessId);
  const money = (s: string | null | undefined) =>
    s == null ? "—" : formatMoney(Number(s), { bangla });

  if (biz.isLoading) return <p style={{ padding: 16 }}>{bangla ? "লোড হচ্ছে…" : "Loading…"}</p>;
  if (biz.isError || !biz.data) return <Notice error>{bangla ? "তথ্য আনা যায়নি।" : "Could not load."}</Notice>;
  const d = biz.data;
  const b = d.business;
  const k = d.kpi_7d;

  return (
    <section style={{ ...box, marginBottom: 24, borderLeft: "4px solid #0B4EA2" }}>
      {/* Header */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 14, alignItems: "baseline" }}>
        <h2 style={{ margin: 0 }}>{b?.name ?? "—"}</h2>
        <span style={{ color: "#5B6472" }}>{b?.type}</span>
        <span style={{ color: b?.status === "active" ? "#15803D" : "#B91C1C", fontSize: 13 }}>● {b?.status}</span>
        {b?.verified ? <span style={{ color: "#1D4ED8", fontSize: 13 }}>✓ {bangla ? "যাচাই" : "verified"}</span> : null}
      </div>

      {/* KPI row */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
        {[
          { label: bangla ? "লেনদেন (৭দিন)" : "Txn (7 d)",    value: k?.txn_count ?? "—" },
          { label: bangla ? "GMV (৭দিন)" : "GMV (7 d)",       value: money(k?.gmv_minor) },
          { label: bangla ? "রিফান্ড (৭দিন)" : "Refunds (7 d)", value: k?.refund_count ?? "—" },
          { label: bangla ? "রিফান্ড মোট" : "Refund total",   value: money(k?.refund_minor) },
        ].map(c => (
          <div key={c.label} style={{ background: "#f4f7fb", borderRadius: 8, padding: "10px 16px", minWidth: 130 }}>
            <div style={{ color: "#5B6472", fontSize: 12 }}>{c.label}</div>
            <strong style={{ fontSize: 22 }}>{c.value}</strong>
          </div>
        ))}
      </div>

      {/* Members */}
      <div style={{ marginBottom: 12 }}>
        <strong>{bangla ? "সদস্য:" : "Members:"}</strong>{" "}
        {d.members.length === 0
          ? <span style={{ color: "#5B6472" }}>—</span>
          : d.members.map(m => <span key={m.role} style={{ marginRight: 10 }}>{m.role} × {m.count}</span>)}
      </div>

      {/* Open cases */}
      {d.open_cases.length > 0 ? (
        <div style={{ marginBottom: 12 }}>
          <strong>{bangla ? "খোলা কেস:" : "Open cases:"}</strong>
          <ul style={{ margin: "6px 0 0 0", paddingLeft: 20 }}>
            {d.open_cases.map(c => (
              <li key={c.id} style={{ color: c.overdue ? "#B91C1C" : "inherit" }}>
                {c.subject} — {c.sla_key}
                {c.overdue ? <span style={{ marginLeft: 6, fontWeight: 700 }}>{bangla ? " (মেয়াদ শেষ)" : " (overdue)"}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Last closing / float audit */}
      {d.last_closing ? (
        <div style={{ color: "#5B6472", fontSize: 13 }}>
          {bangla ? "শেষ ক্লোজিং:" : "Last closing:"}{" "}
          {d.last_closing.period_date} —{" "}
          {bangla ? "ভ্যারিয়েন্স" : "variance"} {money(d.last_closing.variance_minor)}
        </div>
      ) : null}
      {d.last_float_audit ? (
        <div style={{ color: "#5B6472", fontSize: 13, marginTop: 4 }}>
          {bangla ? "শেষ ফ্লোট অডিট:" : "Last float audit:"}{" "}
          {d.last_float_audit.period_date} —{" "}
          {bangla ? "নগদ ভ্যারিয়েন্স" : "cash variance"} {money(d.last_float_audit.cash_variance_minor)}
        </div>
      ) : null}

      <p style={{ color: "#5B6472", fontSize: 12, marginTop: 10, marginBottom: 0 }}>
        {bangla
          ? "লেনদেনের বিস্তারিত দেখতে Support কেস ও Grant লাগবে।"
          : "Transaction detail requires a support case and an active grant."}
      </p>
    </section>
  );
}

function Support({ cases, now }: { cases: SupportCase[]; now: number }) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState(""); const [filter, setFilter] = useState("open");
  const current = cases.find((c) => c.id === selected);
  return <>
    <Field label={t("admin.status")}><select style={{ ...input, maxWidth: 250 }} value={filter} onChange={(e) => setFilter(e.target.value)}><option value="open">{t("admin.open")}</option><option value="resolved">{t("admin.resolved")}</option><option value="all">{t("admin.all")}</option></select></Field>
    <Table headers={[t("admin.business"), t("admin.subject"), t("admin.status"), t("admin.sla"), t("admin.action")]} rows={cases.filter((c) => filter === "all" || c.status === filter).map((c) => [c.business_name, c.subject, t(`admin.${c.status}`),
      c.status === "resolved" ? t("admin.resolved") : <span key="sla" style={{ color: new Date(c.due_at).getTime() < now ? "#B91C1C" : "#15803D" }}>{new Date(c.due_at).getTime() < now ? "! " + t("admin.overdue") : t("admin.remaining")} {Math.abs(Math.ceil((new Date(c.due_at).getTime() - now) / 3600000))} {t("admin.hours")}</span>,
      <button key="act" style={button} onClick={() => setSelected(c.id)}>{t("admin.inspect")}</button>])} />
    {current ? <CaseDetail key={current.id} item={current} now={now} /> : null}
  </>;
}
function CaseDetail({ item, now }: { item: SupportCase; now: number }) {
  const { t, i18n } = useTranslation(); const command = useAdminCommand();
  const [reason, setReason] = useState(""); const [error, setError] = useState(""); const [offset, setOffset] = useState(0);
  const [rows, setRows] = useState<{ id: string; kind: string; source: string; amount_minor: string; occurred_at: string }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const request = useRef({ body: "", id: "" });
  const active = item.status === "open" && item.grant && new Date(item.grant.expires_at).getTime() > now;
  async function run(action: "grant" | "resolve") {
    setError(""); const body = { case_id: item.id, reason }; const serialized = JSON.stringify({ action, body });
    if (request.current.body !== serialized) request.current = { body: serialized, id: crypto.randomUUID() };
    try { await command.mutateAsync({ action, body, requestId: request.current.id }); setRows(null); }
    catch { setError(t("admin.action_error")); }
  }
  async function read(next = 0) {
    setBusy(true); setRows(null); setError("");
    try { setRows(await adminRpc("admin_case_transactions", { p_case_id: item.id, p_offset: next })); setOffset(next); }
    catch { setError(t("admin.grant_error")); } finally { setBusy(false); }
  }
  return <section style={{ ...box, marginTop: 20 }}>
    <h2>{item.business_name} / {item.subject}</h2>
    <p>{t("admin.grant_hint")}</p>
    <Field label={t("admin.reason")}><input style={input} maxLength={240} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
    {item.status === "open" ? <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 14 }}>
      <button style={button} disabled={reason.trim().length < 3 || command.isPending} onClick={() => void run("grant")}>{t("admin.grant")}</button>
      <button style={button} disabled={!active || busy} onClick={() => void read()}>{t("admin.read_transactions")}</button>
      <button style={button} disabled={reason.trim().length < 3 || command.isPending} onClick={() => void run("resolve")}>{t("admin.resolve")}</button>
    </div> : null}
    {active ? <p>{t("admin.expires")} {new Date(item.grant!.expires_at).toLocaleTimeString(i18n.language, { timeZone: "Asia/Dhaka" })}</p> : null}
    {error ? <Notice error>{error}</Notice> : null}
    {rows && active ? <><Table headers={[t("admin.id"), t("admin.type"), t("admin.amount"), t("admin.time")]} rows={rows.map((r) => [r.id, t(`txn_kind.${r.kind}`), formatMoney(Number(r.amount_minor), { bangla: i18n.language === "bn" }), new Date(r.occurred_at).toLocaleString()])} />
      <button style={button} disabled={busy || offset === 0} onClick={() => void read(Math.max(0, offset - 50))}>{t("admin.previous")}</button>{" "}
      <button style={button} disabled={busy || rows.length < 50} onClick={() => void read(offset + 50)}>{t("admin.next")}</button></> : null}
  </section>;
}

function Health({ data, session }: { data: AdminDashboard; session?: AdminSession }) {
  const { t, i18n } = useTranslation();
  const bangla = i18n.language === "bn";
  const aiOutputs = useAdminAiOutputs(session);
  const command = useAdminCommand();
  const [markingId, setMarkingId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionSuccess, setActionSuccess] = useState("");
  const request = useRef({ body: "", id: "" });

  async function handleMarkWrong(outputId: string) {
    setActionError("");
    setActionSuccess("");
    const body = { output_id: outputId, reason: reason.trim() };
    const serialized = JSON.stringify(body);
    if (request.current.body !== serialized) {
      request.current = { body: serialized, id: crypto.randomUUID() };
    }
    try {
      await command.mutateAsync({
        action: "mark_ai_wrong",
        body,
        requestId: request.current.id,
      });
      setActionSuccess(bangla ? "আউটপুট ভুল হিসেবে চিহ্নিত ও অডিট করা হয়েছে।" : "Marked wrong and audited.");
      setMarkingId(null);
      setReason("");
      request.current = { body: "", id: "" };
    } catch {
      setActionError(bangla ? "চিহ্নিত করা সম্ভব হয়নি।" : "Failed to mark wrong.");
    }
  }

  return <>
    <Notice>{t("admin.window_7d")} · {t("admin.forecast_runs")}: {data.forecasts?.runs ?? 0} · {t("admin.abstained")}: {data.forecasts?.abstained ?? 0}</Notice>
    <Table headers={[t("admin.capability"), t("admin.runs"), t("admin.latency"), t("admin.low_confidence"), t("admin.wrong_feedback")]} rows={(data.ai_health ?? []).map((h) => [
      h.capability,
      h.runs,
      h.latency_ms === null ? "—" : `${h.latency_ms} ms`,
      h.low_confidence,
      <strong key="wf" style={{ color: h.wrong_feedback > 0 ? "#B91C1C" : "inherit" }}>{h.wrong_feedback}</strong>,
    ])} />
    <h2>{t("admin.evaluations")}</h2>
    <Table headers={[t("admin.model"), t("admin.dataset"), "WAPE", t("admin.coverage")]} rows={(data.evaluations ?? []).map((e) => [
      e.model_version,
      e.dataset,
      e.metrics.wape === undefined ? "—" : `${(e.metrics.wape * 100).toFixed(2)}%`,
      e.metrics.pi_coverage_80 === undefined ? "—" : `${(e.metrics.pi_coverage_80 * 100).toFixed(2)}%`,
    ])} />

    {/* 8.5: AI Output Review Panel */}
    <h2 style={{ marginTop: 32 }}>{bangla ? "এআই আউটপুট ও তথ্যের পর্যালোচনা" : "AI Output & Facts Review"}</h2>
    <p style={{ color: "#5B6472", marginTop: -6, marginBottom: 16 }}>
      {bangla
        ? "সাম্প্রতিক এআই ইনসাইট ও পূর্বাভাসের বিশ্লেষণ। তথ্যের অমিল বা ভুল পূর্বাভাস থাকলে কারণসহ ভুল চিহ্নিত করতে পারেন।"
        : "Review recent stored AI insight & forecast outputs with underlying facts JSON. Mark inaccurate outputs as wrong to audit and update Health metrics."}
    </p>

    {actionSuccess ? <Notice>{actionSuccess}</Notice> : null}
    {actionError ? <Notice error>{actionError}</Notice> : null}

    {aiOutputs.isLoading ? (
      <p style={{ padding: 18 }}>{bangla ? "লোড হচ্ছে…" : "Loading AI outputs…"}</p>
    ) : aiOutputs.isError ? (
      <Notice error>{bangla ? "এআই আউটপুট আনা যায়নি।" : "Failed to load AI outputs."}</Notice>
    ) : (aiOutputs.data ?? []).length === 0 ? (
      <div style={{ ...box, color: "#5B6472", padding: 24 }}>
        {bangla ? "কোনো সংরক্ষিত এআই আউটপুট নেই।" : "No stored AI outputs found."}
      </div>
    ) : (
      <div style={{ display: "grid", gap: 16, marginTop: 12 }}>
        {aiOutputs.data!.map((item: AdminAiOutput) => {
          const isWrong = item.feedback === "wrong";
          const what = bangla ? item.what_bn ?? item.what_en : item.what_en ?? item.what_bn;
          const why = bangla ? item.why_bn ?? item.why_en : item.why_en ?? item.why_bn;
          const action = bangla ? item.action_bn ?? item.action_en : item.action_en ?? item.action_bn;
          const confColor = item.confidence === "high" ? "#15803D" : item.confidence === "medium" ? "#D97706" : "#B91C1C";

          return (
            <article
              key={item.id}
              style={{
                ...box,
                borderLeft: isWrong ? "4px solid #B91C1C" : "4px solid #0B4EA2",
                background: isWrong ? "#FFFBFB" : "#fff",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10, marginBottom: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <strong style={{ fontSize: 16 }}>{item.business_name}</strong>
                  <span style={{ background: "#edf3fa", color: "#083A7A", padding: "2px 8px", borderRadius: 6, fontSize: 12, fontWeight: 600 }}>
                    {item.capability}
                  </span>
                  {item.confidence ? (
                    <span style={{ color: confColor, fontSize: 12, fontWeight: 600 }}>
                      ● {item.confidence}
                    </span>
                  ) : null}
                  {item.model_version ? (
                    <span style={{ color: "#5B6472", fontSize: 12 }}>{item.model_version}</span>
                  ) : null}
                </div>
                <span style={{ color: "#5B6472", fontSize: 12 }}>
                  {new Date(item.created_at).toLocaleString(i18n.language, { timeZone: "Asia/Dhaka" })}
                </span>
              </div>

              {what ? <p style={{ margin: "4px 0 6px", fontWeight: 600 }}>{what}</p> : null}
              {why ? <p style={{ margin: "4px 0", color: "#374151", fontSize: 14 }}>{why}</p> : null}
              {action ? (
                <p style={{ margin: "6px 0", color: "#0B4EA2", fontSize: 13 }}>
                  → <strong>{bangla ? "প্রস্তাবিত পদক্ষেপ:" : "Action:"}</strong> {action}
                </p>
              ) : null}

              {/* Collapsible Facts / Payload */}
              <details style={{ marginTop: 10, marginBottom: 10, fontSize: 13 }}>
                <summary style={{ cursor: "pointer", color: "#0B4EA2", fontWeight: 500 }}>
                  {bangla ? "তথ্যের বিস্তারিত দেখুন (Facts / Payload JSON)" : "View Facts / Payload JSON"}
                </summary>
                <pre
                  style={{
                    background: "#F8FAFC",
                    border: "1px solid #E2E8F0",
                    borderRadius: 6,
                    padding: 12,
                    fontSize: 12,
                    overflowX: "auto",
                    marginTop: 8,
                    maxHeight: 220,
                  }}
                >
                  {JSON.stringify(item.payload, null, 2)}
                </pre>
              </details>

              {/* Feedback status & Mark Wrong action */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, paddingTop: 10, borderTop: "1px solid #e1e7ef" }}>
                <div>
                  {isWrong ? (
                    <span style={{ color: "#B91C1C", fontWeight: 600, fontSize: 13 }}>
                      ✕ {bangla ? "ভুল হিসেবে চিহ্নিত" : "Marked wrong"}
                      {item.feedback_at ? ` (${new Date(item.feedback_at).toLocaleTimeString(i18n.language, { timeZone: "Asia/Dhaka" })})` : null}
                    </span>
                  ) : (
                    <span style={{ color: "#15803D", fontSize: 13 }}>
                      ✓ {bangla ? "সক্রিয় আউটপুট" : "Active output"}
                    </span>
                  )}
                </div>

                {!isWrong ? (
                  markingId === item.id ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <input
                        style={{ ...input, width: 260, padding: "6px 10px", fontSize: 13 }}
                        placeholder={bangla ? "ভুলের কারণ (কমপক্ষে ৩ অক্ষর)" : "Reason for wrong (min 3 chars)"}
                        maxLength={240}
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                      />
                      <button
                        style={{ ...button, background: "#B91C1C", padding: "6px 12px", fontSize: 13 }}
                        disabled={reason.trim().length < 3 || command.isPending}
                        onClick={() => void handleMarkWrong(item.id)}
                      >
                        {command.isPending ? (bangla ? "সংরক্ষণ হচ্ছে…" : "Saving…") : (bangla ? "নিশ্চিত করুন" : "Confirm")}
                      </button>
                      <button
                        style={{ ...button, background: "#6B7280", padding: "6px 12px", fontSize: 13 }}
                        disabled={command.isPending}
                        onClick={() => { setMarkingId(null); setReason(""); }}
                      >
                        {bangla ? "বাতিল" : "Cancel"}
                      </button>
                    </div>
                  ) : (
                    <button
                      style={{ ...button, background: "#DC2626", padding: "6px 14px", fontSize: 13 }}
                      onClick={() => { setMarkingId(item.id); setReason(""); setActionError(""); }}
                    >
                      {bangla ? "ভুল চিহ্নিত করুন" : "Mark Wrong"}
                    </button>
                  )
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
    )}
  </>;
}

// ──────────────────────────────────────────────────────────────
// 8.1  Platform-wide risk overview
// ──────────────────────────────────────────────────────────────
function Risk({ rows, isLoading, isError, onRefresh }: {
  rows: RiskRow[];
  isLoading: boolean;
  isError: boolean;
  onRefresh: () => void;
}) {
  const { i18n } = useTranslation();
  const bangla = i18n.language === "bn";
  const money = (s: string | null) =>
    s == null ? "—" : formatMoney(Number(s), { bangla });

  // Severity badge colour helpers
  function psColor(count: number) {
    if (count >= 10) return "#B91C1C";
    if (count >= 3)  return "#D97706";
    return "#15803D";
  }
  function varColor(val: string | null) {
    if (val == null) return "#5B6472";
    const v = Number(val);
    if (Math.abs(v) >= 50000) return "#B91C1C";  // ≥ ৳500 variance
    if (Math.abs(v) >= 10000) return "#D97706";  // ≥ ৳100
    return v === 0 ? "#15803D" : "#5B6472";
  }

  if (isLoading) return <p style={{ padding: 28 }}>{bangla ? "লোড হচ্ছে…" : "Loading…"}</p>;
  if (isError)   return <Notice error>{bangla ? "ঝুঁকির তথ্য আনা যায়নি।" : "Could not load risk data."} <button style={button} onClick={onRefresh}>{bangla ? "আবার চেষ্টা" : "Retry"}</button></Notice>;

  return (
    <>
      <Notice>
        {bangla
          ? "প্রতিটি ব্যবসার জন্য তিনটি ঝুঁকির সংকেত একসাথে দেখুন। সবচেয়ে বড় পেন্ডিং সেটেলমেন্ট প্রথমে দেখাচ্ছে।"
          : "Platform-wide risk signals per business. Sorted by largest pending settlement first. Read-only — no money moves here."}
      </Notice>

      {/* Summary chips */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 18 }}>
        {[
          {
            label: bangla ? "পেন্ডিং সেটেলমেন্ট" : "Pending settlement",
            value: rows.filter(r => r.pending_settlement_count > 0).length,
            suffix: bangla ? "টি ব্যবসা" : "businesses",
          },
          {
            label: bangla ? "রিফান্ড স্পাইক (৭দিন)" : "Refund spike (7 d)",
            value: rows.filter(r => r.refund_spike_7d > 0).length,
            suffix: bangla ? "টি ব্যবসা" : "businesses",
          },
          {
            label: bangla ? "ভ্যারিয়েন্স আছে" : "Non-zero variance",
            value: rows.filter(r =>
              (r.float_cash_variance_minor != null && Number(r.float_cash_variance_minor) !== 0) ||
              (r.closing_variance_minor    != null && Number(r.closing_variance_minor)    !== 0)
            ).length,
            suffix: bangla ? "টি ব্যবসা" : "businesses",
          },
        ].map(chip => (
          <article key={chip.label} style={{ ...box, padding: "14px 20px", minWidth: 180 }}>
            <div style={{ color: "#5B6472", fontSize: 13 }}>{chip.label}</div>
            <strong style={{ fontSize: 28 }}>{chip.value}</strong>
            <span style={{ color: "#5B6472", fontSize: 13, marginLeft: 6 }}>{chip.suffix}</span>
          </article>
        ))}
      </div>

      {/* Detail table */}
      <div style={{ ...box, padding: 0, overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", textAlign: "left" }}>
          <thead>
            <tr>
              {[
                bangla ? "ব্যবসা" : "Business",
                bangla ? "ধরন" : "Type",
                bangla ? "পেন্ডিং সেটেল" : "Pending settle",
                bangla ? "পরিমাণ" : "Amount",
                bangla ? "রিফান্ড (৭দিন)" : "Refunds (7 d)",
                bangla ? "রিফান্ড মোট" : "Refund total",
                bangla ? "ফ্লোট ভ্যারিয়েন্স" : "Float variance",
                bangla ? "ক্লোজিং ভ্যারিয়েন্স" : "Closing variance",
              ].map((h, i) => (
                <th key={i} scope="col" style={{ padding: 14, background: "#edf3fa", fontWeight: 600, whiteSpace: "nowrap" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={8} style={{ padding: 24, color: "#5B6472" }}>
                {bangla ? "কোনো ব্যবসা নেই।" : "No businesses found."}
              </td></tr>
            ) : rows.map(r => (
              <tr key={r.business_id} style={{ background: r.pending_settlement_count >= 10 || r.refund_spike_7d >= 5 ? "#FFF7ED" : undefined }}>
                <td style={{ padding: 12, borderTop: "1px solid #e1e7ef", fontWeight: 600 }}>
                  {r.business_name}
                  {r.business_status !== "active" ? <span style={{ marginLeft: 6, color: "#B91C1C", fontSize: 12 }}>({r.business_status})</span> : null}
                </td>
                <td style={{ padding: 12, borderTop: "1px solid #e1e7ef", color: "#5B6472" }}>{r.business_type}</td>
                <td style={{ padding: 12, borderTop: "1px solid #e1e7ef" }}>
                  <strong style={{ color: psColor(r.pending_settlement_count) }}>{r.pending_settlement_count}</strong>
                </td>
                <td style={{ padding: 12, borderTop: "1px solid #e1e7ef" }}>{money(r.pending_settlement_minor)}</td>
                <td style={{ padding: 12, borderTop: "1px solid #e1e7ef" }}>
                  <strong style={{ color: r.refund_spike_7d >= 5 ? "#B91C1C" : r.refund_spike_7d >= 2 ? "#D97706" : "inherit" }}>
                    {r.refund_spike_7d}
                  </strong>
                </td>
                <td style={{ padding: 12, borderTop: "1px solid #e1e7ef" }}>{money(r.refund_spike_minor_7d)}</td>
                <td style={{ padding: 12, borderTop: "1px solid #e1e7ef" }}>
                  {r.float_audit_date
                    ? <><strong style={{ color: varColor(r.float_cash_variance_minor) }}>{money(r.float_cash_variance_minor)}</strong><br /><span style={{ color: "#5B6472", fontSize: 12 }}>{r.float_audit_date}</span></>
                    : <span style={{ color: "#5B6472" }}>—</span>}
                </td>
                <td style={{ padding: 12, borderTop: "1px solid #e1e7ef" }}>
                  {r.closing_date
                    ? <><strong style={{ color: varColor(r.closing_variance_minor) }}>{money(r.closing_variance_minor)}</strong><br /><span style={{ color: "#5B6472", fontSize: 12 }}>{r.closing_date}</span></>
                    : <span style={{ color: "#5B6472" }}>—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ──────────────────────────────────────────────────────────────
// 8.2  Audit table with CSV export
// ──────────────────────────────────────────────────────────────
function Audit({ data }: { data: AdminDashboard }) {
  const { t, i18n } = useTranslation();
  const bangla = i18n.language === "bn";
  const exportCsv = useAdminAuditExportCsv();
  const [csvMsg, setCsvMsg] = useState("");

  async function downloadCsv() {
    setCsvMsg("");
    try {
      const csv = await exportCsv.mutateAsync(500);
      // Trigger browser download: prepend UTF-8 BOM then create a blob URL
      const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      const ts   = new Date().toISOString().slice(0, 16).replace("T", "_").replace(":", "-");
      a.href     = url;
      a.download = `admin_audit_${ts}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setCsvMsg(bangla ? "CSV ডাউনলোড হচ্ছে…" : "CSV download started.");
    } catch {
      setCsvMsg(bangla ? "এক্সপোর্ট ব্যর্থ হয়েছে।" : "Export failed.");
    }
  }

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16, flexWrap: "wrap" }}>
        <p style={{ margin: 0, color: "#5B6472", flex: 1 }}>
          {bangla
            ? "সর্বশেষ ৫০টি অ্যাডমিন কার্যক্রম। CSV-তে সর্বশেষ ৫০০টি ডাউনলোড করা যাবে। ডাউনলোড নিজেই অডিট লগে রেকর্ড হয়।"
            : "Last 50 admin actions. Download exports up to 500 rows. The download action is itself recorded in the audit log."}
        </p>
        <button
          style={{ ...button, background: "#065F46" }}
          disabled={exportCsv.isPending}
          onClick={() => void downloadCsv()}
        >
          {exportCsv.isPending
            ? (bangla ? "কাজ হচ্ছে…" : "Working…")
            : (bangla ? "CSV ডাউনলোড" : "Download CSV")}
        </button>
      </div>
      {csvMsg ? <Notice>{csvMsg}</Notice> : null}
      <Table
        headers={[t("admin.time"), t("admin.actor"), t("admin.action"), t("admin.reason")]}
        rows={(data.audit ?? []).map(a => [
          new Date(a.created_at).toLocaleString(i18n.language, { timeZone: "Asia/Dhaka" }),
          a.actor, a.action, a.reason,
        ])}
      />
    </>
  );
}

function Flags({ data, userId }: { data: AdminDashboard; userId: string }) {
  const { t } = useTranslation(); const command = useAdminCommand();
  const [reason, setReason] = useState(""); const [business, setBusiness] = useState("");
  const [message, setMessage] = useState(""); const request = useRef({ body: "", id: "" });
  async function run(action: string, body: Record<string, unknown>) {
    setMessage(""); const full = { ...body, reason }; const serialized = JSON.stringify({ action, full });
    if (request.current.body !== serialized) request.current = { body: serialized, id: crypto.randomUUID() };
    try { await command.mutateAsync({ action, body: full, requestId: request.current.id }); setMessage(t("admin.saved")); }
    catch { setMessage(t("admin.action_error")); }
  }
  const flags = (data.flags ?? []).filter((f) => f.key === "ai.forecast" && (f.business_id ?? "") === business);
  const flag = flags[0];
  return <section style={box}>
    <p>{t("admin.flags_hint")}</p>
    <Field label={t("admin.scope")}><select style={input} value={business} onChange={(e) => setBusiness(e.target.value)}><option value="">{t("admin.global")}</option>{data.businesses?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
    <Field label={t("admin.reason")}><input style={input} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={240} /></Field>
    <h2>ai.forecast</h2><p>{t("admin.override")}: {flag ? t(flag.enabled ? "admin.enabled" : "admin.disabled") : t("admin.inherited")}</p>
    <div style={{ display: "flex", gap: 12 }}><button style={button} disabled={reason.trim().length < 3 || command.isPending} onClick={() => void run("propose_flag", { key: "ai.forecast", business_id: business || null, enabled: false })}>{t("admin.disable")}</button>
      <button style={button} disabled={reason.trim().length < 3 || command.isPending} onClick={() => void run("propose_flag", { key: "ai.forecast", business_id: business || null, enabled: true })}>{t("admin.enable")}</button></div>
    {message ? <Notice>{message}</Notice> : null}
    <h2>{t("admin.pending")}</h2>
    <Table headers={[t("admin.flag"), t("admin.requested"), t("admin.reason"), t("admin.action")]} rows={(data.pending ?? []).map((p) => [p.key, t(p.enabled ? "admin.enabled" : "admin.disabled"), p.reason, <button key="act" style={button} disabled={p.proposed_by === userId || command.isPending || reason.trim().length < 3} onClick={() => void run("approve_flag", { id: p.id })}>{t(p.proposed_by === userId ? "admin.other_admin" : "admin.approve")}</button>])} />
  </section>;
}

function Simulator({ businesses }: { businesses: { id: string; name: string }[] }) {
  const { t } = useTranslation(); const [business, setBusiness] = useState("");
  const [amount, setAmount] = useState("850"); const [payer, setPayer] = useState("bKash");
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  const request = useRef({ body: "", id: "" });
  async function simulate() {
    setBusy(true); setMessage("");
    const parts = amount.split("."); const minor = Number(parts[0]) * 100 + Number((parts[1] ?? "").padEnd(2, "0"));
    const body = { business_id: business, amount_minor: minor, payer_app: payer, admin: true };
    const serialized = JSON.stringify(body);
    if (request.current.body !== serialized) request.current = { body: serialized, id: crypto.randomUUID() };
    const result = await supabase.functions.invoke("simulator-pay", { body: { ...body, request_id: request.current.id } });
    setBusy(false);
    if (result.error) setMessage(t("admin.simulator_error"));
    else { setMessage(`${t("admin.simulated")}: ${result.data.simulated}`); request.current = { body: "", id: "" }; }
  }
  return <section style={{ ...box, maxWidth: 650 }}><p>{t("admin.simulator_hint")}</p>
    <Field label={t("admin.business")}><select style={input} value={business} onChange={(e) => setBusiness(e.target.value)}><option value="">{t("admin.select")}</option>{businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
    <Field label={t("admin.amount_taka")}><input style={input} value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" /></Field>
    <Field label={t("admin.payer")}><select style={input} value={payer} onChange={(e) => setPayer(e.target.value)}>{["bKash", "Nagad", "Rocket", "upay"].map((p) => <option key={p}>{p}</option>)}</select></Field>
    <button style={button} disabled={busy || !business || !/^\d{1,7}(\.\d{1,2})?$/.test(amount) || Number(amount) <= 0} onClick={() => void simulate()}>{t("admin.simulate")}</button>
    {message ? <Notice>{message}</Notice> : null}
  </section>;
}

function Field({ label, children }: { label: string; children: ReactNode }) { return <label style={{ display: "grid", gap: 6, marginBottom: 16 }}>{label}{children}</label>; }
function Notice({ children, error = false }: { children: ReactNode; error?: boolean }) { return <div role={error ? "alert" : "status"} style={{ padding: 16, margin: "14px 0", borderRadius: 8, background: error ? "#FEE2E2" : "#E8EFF8", color: error ? "#991B1B" : "#083A7A" }}>{children}</div>; }
function Table({ headers, rows }: { headers: string[]; rows: ReactNode[][] }) {
  const { t } = useTranslation();
  return <div style={{ ...box, padding: 0, overflowX: "auto", marginTop: 18, marginBottom: 18 }}><table style={{ borderCollapse: "collapse", width: "100%", textAlign: "left" }}><thead><tr>{headers.map((h, i) => <th key={i} scope="col" style={{ padding: 14, background: "#edf3fa", fontWeight: 600 }}>{h}</th>)}</tr></thead><tbody>{rows.length ? rows.map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j} style={{ padding: 14, borderTop: "1px solid #e1e7ef", overflowWrap: "anywhere" }}>{cell}</td>)}</tr>) : <tr><td colSpan={headers.length} style={{ padding: 24, color: "#5B6472" }}>{t("admin.empty")}</td></tr>}</tbody></table></div>;
}
