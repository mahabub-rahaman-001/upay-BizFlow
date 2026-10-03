import { useMemo, useState } from "react";
import { Linking, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import { useTranslation } from "react-i18next";
import { create } from "zustand";
import { StatusPill, tokens } from "@bizflow/ui";
import { AppIcon, isAppIconName } from "../../components/AppIcon";
import { Card, FeatureGrid, IconButton, ListRow, Screen, Section, Sheet, Skeleton, SkeletonRows, TextLink, tones, type, useBangla, useDigits, type Feature, type Tone } from "../../components/kit";
import { AnimatedMoney, FadeIn } from "../../components/motion";
import { TxnDetailSheet, TxnItem } from "../../components/txn";
import { useAgentAuditPreview, useClosingPreview, usePayables, useReviewQueue, useSupplierBalances, useTodayInsights, useTransactions, type InsightCard, type TransactionRow } from "../../lib/api";
import { useActiveBusiness, useCanAddEntries, useIsOwner } from "../../lib/session";
import { isDemoData } from "../../lib/supabase";
import { dhakaDay, totals, useBalanceMap } from "../../lib/view";
import { formatMoney } from "@bizflow/shared";

const c = tokens.color;
const UPAY_HELP_URL = "https://www.upaybd.com/need-help";

/** Hidden or shown, remembered for the session: a shop counter is a public place. */
const useBalanceVisible = create<{ visible: boolean; toggle: () => void }>((set) => ({ visible: true, toggle: () => set((s) => ({ visible: !s.visible })) }));

/**
 * Home (docs/16 section 4): who I am, what needs me (slim), how much money I have, what I
 * can do, what just happened. Same frame for both roles; the content follows the role.
 */
export default function Home() {
  const { t } = useTranslation();
  const router = useRouter();
  const active = useActiveBusiness();
  const isAgent = active?.type === "AGENT";
  const canAdd = useCanAddEntries();
  const isOwner = useIsOwner();
  const manager = isOwner || active?.role === "manager";
  const balances = useBalanceMap();
  const insights = useTodayInsights();
  const txns = useTransactions(300);
  const [openRow, setOpenRow] = useState<TransactionRow | null>(null);
  const [insightsOpen, setInsightsOpen] = useState(false);

  const cards = insights.data && insights.data.role === active?.type ? insights.data.cards : [];
  const today = dhakaDay(new Date().toISOString());
  const todayRows = useMemo(() => (txns.data ?? []).filter((r) => dhakaDay(r.occurred_at) === today), [txns.data, today]);
  const reversed = useMemo(() => new Set((txns.data ?? []).map((r) => r.reverses_txn_id).filter(Boolean) as string[]), [txns.data]);
  const attention = cards.filter((card) => card.severity === "warn" || card.severity === "bad").length;

  const go = (route: string) => () => router.push(route as Href);
  const merchantFeatures: Feature[] = [
    ...(canAdd ? [{ key: "sale", icon: "sale" as const, label: t("ux.f_sale"), onPress: go("/cash-sale"), tone: "good" as Tone }] : []),
    ...(canAdd ? [{ key: "expense", icon: "expense" as const, label: t("ux.f_expense"), onPress: go("/expense"), tone: "bad" as Tone }] : []),
    { key: "baki", icon: "baki", label: t("ux.f_baki"), onPress: go("/baki"), tone: "amber" },
    ...(manager ? [
      { key: "suppliers", icon: "suppliers" as const, label: t("ux.f_suppliers"), onPress: go("/suppliers") },
      { key: "closing", icon: "closing" as const, label: t("ux.f_closing"), onPress: go("/closing"), tone: "ai" as Tone },
      { key: "planner", icon: "planner" as const, label: t("ux.f_planner"), onPress: go("/planner") },
      { key: "review", icon: "review" as const, label: t("ux.f_review"), onPress: go("/review") },
    ] : []),
    ...(isOwner ? [{ key: "reports", icon: "reports" as const, label: t("ux.f_reports"), onPress: go("/reports") }] : []),
  ];
  const agentFeatures: Feature[] = [
    ...(canAdd ? [{ key: "wallet", icon: "wallet" as const, label: t("ux.f_wallet"), onPress: go("/manual-wallet"), tone: "amber" as Tone }] : []),
    { key: "book", icon: "transactions", label: t("ux.f_cashbook"), onPress: go("/transactions") },
    { key: "float", icon: "float", label: t("ux.f_float"), onPress: go("/books"), tone: "ai" },
    ...(manager ? [{ key: "audit", icon: "audit" as const, label: t("ux.f_audit"), onPress: go("/agent-audit"), tone: "good" as Tone }] : []),
    ...(isOwner ? [{ key: "commission", icon: "commission" as const, label: t("ux.f_commission"), onPress: go("/commission") }] : []),
    ...(manager ? [{ key: "history", icon: "history" as const, label: t("ux.f_history"), onPress: go("/history") }] : []),
    { key: "receive", icon: "qr", label: t("ux.f_receive"), onPress: go("/receive") },
    { key: "help", icon: "help", label: t("ux.f_help"), onPress: () => void Linking.openURL(UPAY_HELP_URL).catch(() => undefined) },
  ];

  const refreshing = insights.isRefetching || balances.isRefetching || txns.isRefetching;
  function refresh() {
    void insights.refetch();
    void balances.refetch();
    void txns.refetch();
  }

  return (
    <Screen inTabs refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={c.brandPrimary} />}>
      <View style={s.header}>
        <View style={s.avatar}><AppIcon name={isAgent ? "agent" : "store"} size={24} color={c.onBrand} /></View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={type.caption}>{t(isAgent ? "home.agent_account" : "home.merchant_account")}</Text>
          <View style={s.nameRow}>
            <Text accessibilityRole="header" numberOfLines={1} style={[type.heading, { flexShrink: 1 }]}>{active?.name}</Text>
            {active?.verified ? <AppIcon name="verified" size={18} color={c.verified} /> : null}
          </View>
        </View>
        <IconButton name="bell" label={t("ux.notifications")} onPress={go("/notifications")} badge={attention} />
        <IconButton name="user" label={t("settings.open")} onPress={go("/settings")} />
      </View>

      {isDemoData ? (
        <View style={s.demo}><AppIcon name="info" size={14} color={c.statusWarn} /><Text style={[type.caption, { color: c.statusWarn }]}>{t("ux.demo_banner")}</Text></View>
      ) : null}

      <InsightStrip cards={cards} loading={insights.isLoading} error={insights.isError} onOpen={() => setInsightsOpen(true)} />

      {isAgent
        ? <AgentHero cash={balances.of("1000")} efloat={balances.of("1010")} other={balances.of("1030")} loading={balances.isLoading} todayRows={todayRows} />
        : <MerchantHero cash={balances.of("1000")} digital={balances.of("1010")} loading={balances.isLoading} todayRows={todayRows} />}

      <Section title={t("ux.services")}>
        <Card padded={false} style={{ paddingVertical: 6, paddingHorizontal: 6 }}>
          <FeatureGrid items={(isAgent ? agentFeatures : merchantFeatures).slice(0, 8)} />
        </Card>
      </Section>

      {isAgent ? <AgentTodo manager={manager} todayRows={todayRows} /> : <MerchantTodo manager={manager} />}

      <Section title={t("ux.recent")} action={t("ux.see_all")} onAction={go("/transactions")}>
        {txns.isLoading ? <SkeletonRows count={3} /> : (
          <View style={{ gap: tokens.space[2] }}>
            {(txns.data ?? []).filter((r) => r.kind !== "CLOSING_VARIANCE").slice(0, 4).map((row) => (
              <TxnItem key={row.id} row={row} reversed={reversed.has(row.id)} onPress={setOpenRow} />
            ))}
            {(txns.data ?? []).length === 0 ? <Text style={type.bodyMuted}>{t("ux.no_digital_hint")}</Text> : null}
          </View>
        )}
      </Section>

      <TxnDetailSheet row={openRow} reversed={!!openRow && reversed.has(openRow.id)} onClose={() => setOpenRow(null)} />
      <InsightsSheet visible={insightsOpen} cards={cards} onClose={() => setInsightsOpen(false)} />
    </Screen>
  );
}

// ---------------------------------------------------------------------------

const SEVERITY: Record<InsightCard["severity"], { tone: Tone; icon: "alert" | "check" | "info"; word: string }> = {
  bad: { tone: "bad", icon: "alert", word: "insights.bad" },
  warn: { tone: "warn", icon: "alert", word: "insights.warn" },
  good: { tone: "good", icon: "check", word: "insights.good" },
  info: { tone: "ai", icon: "info", word: "insights.info" },
};

/** One slim line at a time (docs/16 section 2): never the biggest thing on Home. */
function InsightStrip({ cards, loading, error, onOpen }: { cards: InsightCard[]; loading: boolean; error: boolean; onOpen: () => void }) {
  const { t } = useTranslation();
  const bangla = useBangla();
  const digits = useDigits();
  const [index, setIndex] = useState(0);
  if (loading) return <Skeleton height={60} radius={tokens.radius.md} />;
  if (error || cards.length === 0) return null;
  const card = cards[index % cards.length]!;
  const sev = SEVERITY[card.severity];
  return (
    <FadeIn key={card.id}>
      <View style={[s.strip, { borderLeftColor: tones[sev.tone].fg }]}>
        <Pressable accessibilityRole="button" accessibilityLabel={bangla ? card.title_bn : card.title_en} onPress={onOpen} style={s.stripBody}>
          <View style={[s.stripIcon, { backgroundColor: tones[sev.tone].bg }]}>
            <AppIcon name={isAppIconName(card.icon) ? card.icon : "sparkle"} size={18} color={tones[sev.tone].fg} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={type.label}>{bangla ? card.title_bn : card.title_en}</Text>
            <Text numberOfLines={1} style={type.caption}>{bangla ? card.body_bn : card.body_en}</Text>
          </View>
        </Pressable>
        {cards.length > 1 ? (
          <Pressable accessibilityRole="button" accessibilityLabel={t("ux.next")} onPress={() => setIndex((i) => i + 1)} style={s.stripNext}>
            <Text style={[type.caption, { fontWeight: "700", color: c.brandPrimary }]}>{digits(`${(index % cards.length) + 1}/${cards.length}`)}</Text>
            <AppIcon name="chevron" size={14} color={c.brandPrimary} strokeWidth={2.4} />
          </Pressable>
        ) : null}
      </View>
    </FadeIn>
  );
}

function InsightsSheet({ visible, cards, onClose }: { visible: boolean; cards: InsightCard[]; onClose: () => void }) {
  const { t } = useTranslation();
  const router = useRouter();
  const bangla = useBangla();
  const [why, setWhy] = useState<string | null>(null);
  return (
    <Sheet visible={visible} onClose={onClose} title={t("ux.insights_title")} subtitle={t("ux.insights_ai_note")}>
      {cards.map((card) => {
        const sev = SEVERITY[card.severity];
        return (
          <Card key={card.id} tone="ai" style={{ gap: tokens.space[2] }}>
            <View style={s.rowBetween}>
              <StatusPill kind={sev.tone === "ai" ? "info" : sev.tone === "good" ? "good" : sev.tone === "bad" ? "bad" : "warn"} compact icon={<AppIcon name={sev.icon} size={12} color={tones[sev.tone].fg} strokeWidth={2.4} />} label={t(sev.word)} />
              <AppIcon name={isAppIconName(card.icon) ? card.icon : "sparkle"} size={18} color={c.aiBorder} />
            </View>
            <Text style={type.label}>{bangla ? card.title_bn : card.title_en}</Text>
            <Text style={[type.body, { fontSize: 15 }]}>{bangla ? card.body_bn : card.body_en}</Text>
            {why === card.id ? (
              <View style={s.facts}>
                {Object.entries(card.facts ?? {}).filter(([, v]) => typeof v === "number" || typeof v === "string").slice(0, 6).map(([k, v]) => (
                  <View key={k} style={s.rowBetween}>
                    <Text style={type.caption}>{k.replace(/_minor$/, "").replace(/_/g, " ")}</Text>
                    <Text style={[type.caption, { color: c.text, fontWeight: "700" }]}>{typeof v === "number" && k.endsWith("_minor") ? formatMoney(v, { bangla, currency: "taka-sign" }) : String(v)}</Text>
                  </View>
                ))}
              </View>
            ) : null}
            <View style={[s.rowBetween, { marginTop: -4 }]}>
              <TextLink label={t("ux.why")} onPress={() => setWhy(why === card.id ? null : card.id)} tone="muted" />
              {card.action_route ? <TextLink label={t("ux.open")} trailingIcon="chevron" onPress={() => { onClose(); router.push(card.action_route as Href); }} /> : null}
            </View>
          </Card>
        );
      })}
    </Sheet>
  );
}

// ---------------------------------------------------------------------------

function HeroFrame({ title, total, loading, children }: { title: string; total: number; loading: boolean; children: React.ReactNode }) {
  const { t } = useTranslation();
  const visible = useBalanceVisible((s) => s.visible);
  const toggle = useBalanceVisible((s) => s.toggle);
  return (
    <View style={s.hero}>
      <View style={s.heroTop}>
        <View style={s.rowBetween}>
          <Text style={[type.label, { color: c.onBrandMuted }]}>{title}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={t(visible ? "ux.hide_balance" : "ux.show_balance")} onPress={toggle} hitSlop={10} style={s.eye}>
            <AppIcon name={visible ? "eye-off" : "eye"} size={20} color={c.onBrandMuted} />
          </Pressable>
        </View>
        {loading ? <Skeleton height={44} width="60%" style={{ backgroundColor: "rgba(255,255,255,0.18)" }} /> : visible ? (
          <AnimatedMoney amountMinor={total} size="numberXl" inverse />
        ) : (
          <Pressable onPress={toggle} accessibilityRole="button" style={s.tapToSee}><Text style={[type.label, { color: c.brandPrimary }]}>{t("ux.tap_to_see")}</Text></Pressable>
        )}
      </View>
      <View style={s.heroBottom}>{children}</View>
    </View>
  );
}

function Part({ icon, label, amount, manual }: { icon: "cash" | "digital" | "wallet"; label: string; amount: number; manual?: boolean }) {
  const visible = useBalanceVisible((s) => s.visible);
  return (
    <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
      <View style={s.partLabel}>
        <AppIcon name={manual ? "pen" : icon} size={14} color={c.onBrandMuted} />
        <Text numberOfLines={1} style={[type.caption, { color: c.onBrandMuted }]}>{label}</Text>
      </View>
      {visible ? <AnimatedMoney amountMinor={amount} size="label" inverse /> : <Text style={[type.label, { color: c.onBrand }]}>••••</Text>}
    </View>
  );
}

function MerchantHero({ cash, digital, loading, todayRows }: { cash: number; digital: number; loading: boolean; todayRows: TransactionRow[] }) {
  const { t } = useTranslation();
  const sales = todayRows.filter((r) => ["QR_PAYMENT", "CASH_SALE", "BAKI_SALE"].includes(r.kind)).reduce((sum, r) => sum + Number(r.amount_minor), 0);
  const { outMinor } = totals(todayRows);
  return (
    <HeroFrame title={t("ux.total_balance")} total={cash + digital} loading={loading}>
      <View style={s.parts}>
        <Part icon="cash" label={t("ux.cash_in_hand")} amount={cash} />
        <View style={s.vr} />
        <Part icon="digital" label={t("ux.digital_wallet")} amount={digital} />
      </View>
      <View style={s.todayRow}>
        <AppIcon name="trending-up" size={16} color="#9FE3C1" />
        <Text style={[type.caption, { color: c.onBrandMuted }]}>{t("ux.today_sales")}</Text>
        <AnimatedMoney amountMinor={sales} size="label" inverse />
        <Text style={[type.caption, { color: c.onBrandMuted, marginLeft: "auto" }]}>{t("ux.today_out")}</Text>
        <AnimatedMoney amountMinor={outMinor} size="label" inverse />
      </View>
    </HeroFrame>
  );
}

function AgentHero({ cash, efloat, other, loading, todayRows }: { cash: number; efloat: number; other: number; loading: boolean; todayRows: TransactionRow[] }) {
  const { t } = useTranslation();
  const pct = cash + efloat > 0 ? Math.round((cash / (cash + efloat)) * 100) : 0;
  const status: { tone: Tone; word: string } = pct < 25 ? { tone: "warn", word: "ux.cash_low" } : pct > 75 ? { tone: "warn", word: "ux.float_low" } : { tone: "good", word: "ux.balanced" };
  const digits = useDigits();
  const count = (kind: string) => digits(todayRows.filter((r) => r.kind === kind).length);
  return (
    <>
      <HeroFrame title={t("ux.total_balance")} total={cash + efloat + other} loading={loading}>
        <View style={s.parts}>
          <Part icon="cash" label={t("ux.cash_in_hand")} amount={cash} />
          <View style={s.vr} />
          <Part icon="digital" label={t("ux.e_float")} amount={efloat} />
          <View style={s.vr} />
          <Part icon="wallet" label={t("ux.other_wallets")} amount={other} manual />
        </View>
        <View style={{ gap: 6, marginTop: tokens.space[3] }}>
          <View style={s.rowBetween}>
            <Text style={[type.caption, { color: c.onBrandMuted }]}>{t("ux.liquidity")} · {t("ux.cash_share", { pct })}</Text>
            <View style={[s.heroPill, { backgroundColor: status.tone === "good" ? "rgba(159,227,193,0.2)" : "rgba(255,200,90,0.22)" }]}>
              <AppIcon name={status.tone === "good" ? "check" : "alert"} size={12} color={status.tone === "good" ? "#9FE3C1" : "#FFD27A"} strokeWidth={2.4} />
              <Text style={[type.caption, { color: status.tone === "good" ? "#9FE3C1" : "#FFD27A", fontWeight: "700", fontSize: 12 }]}>{t(status.word)}</Text>
            </View>
          </View>
          <View style={s.liqTrack}><View style={[s.liqFill, { width: `${pct}%` }]} /></View>
        </View>
      </HeroFrame>
      <View style={s.counters}>
        {[["AGENT_CASH_IN", "cash-in", "good"], ["AGENT_CASH_OUT", "cash-out", "bad"], ["AGENT_SEND_MONEY", "send", "brand"]].map(([kind, icon, tone]) => (
          <View key={kind} style={s.counter}>
            <AppIcon name={icon as "send"} size={18} color={tones[tone as Tone].fg} />
            <Text style={type.heading}>{count(kind!)}</Text>
            <Text numberOfLines={1} style={type.caption}>{t(`txn_kind.${kind}`)}</Text>
          </View>
        ))}
      </View>
    </>
  );
}

// ---------------------------------------------------------------------------

function MerchantTodo({ manager }: { manager: boolean }) {
  const { t } = useTranslation();
  const router = useRouter();
  const bangla = useBangla();
  const closing = useClosingPreview();
  const review = useReviewQueue();
  const payables = usePayables(true);
  const suppliers = useSupplierBalances();
  if (!manager) return null;
  const items: React.ReactNode[] = [];
  if (closing.data && !closing.data.already_closed) {
    items.push(<ListRow key="close" icon="closing" tone="ai" title={t("ux.todo_close")} subtitle={t("ux.todo_close_hint", { amount: formatMoney(closing.data.expected_cash_minor, { bangla, currency: "taka-sign" }) })} onPress={() => router.push("/closing")} />);
  }
  if ((review.data ?? []).length > 0) {
    items.push(<ListRow key="review" icon="review" tone="warn" title={t("ux.todo_review", { count: review.data!.length })} subtitle={t("review.title")} onPress={() => router.push("/review")} />);
  }
  const next = [...(payables.data ?? [])].sort((a, z) => (a.due_date ?? "9").localeCompare(z.due_date ?? "9"))[0];
  if (next) {
    const name = suppliers.data?.find((x) => x.supplier_id === next.supplier_id)?.name ?? "";
    items.push(<ListRow key="supplier" icon="suppliers" tone={next.status === "OVERDUE" ? "bad" : "brand"} title={t("ux.todo_supplier", { name })} subtitle={`${formatMoney(Number(next.amount_remaining_minor), { bangla, currency: "taka-sign" })} · ${next.status === "OVERDUE" ? t("ux.overdue") : t("ux.due_on", { date: next.due_date ?? "" })}`} onPress={() => router.push("/suppliers")} />);
  }
  return <TodoSection items={items.slice(0, 3)} loading={closing.isLoading} />;
}

function AgentTodo({ manager, todayRows }: { manager: boolean; todayRows: TransactionRow[] }) {
  const { t } = useTranslation();
  const router = useRouter();
  const audit = useAgentAuditPreview(manager);
  const manualToday = todayRows.filter((r) => r.source === "manual").length;
  const items: React.ReactNode[] = [];
  if (manager && audit.data && !audit.data.already_audited) items.push(<ListRow key="audit" icon="audit" tone="ai" title={t("ux.todo_audit")} subtitle={t("ux.todo_audit_hint")} onPress={() => router.push("/agent-audit")} />);
  if (manualToday > 0) items.push(<ListRow key="manual" icon="pen" tone="manual" title={t("ux.todo_manual", { count: manualToday })} subtitle={t("ux.manual_explain")} onPress={() => router.push({ pathname: "/transactions", params: { tab: "manual" } })} />);
  return <TodoSection items={items} loading={manager && audit.isLoading} />;
}

function TodoSection({ items, loading }: { items: React.ReactNode[]; loading: boolean }) {
  const { t } = useTranslation();
  if (loading) return <SkeletonRows count={2} />;
  return (
    <Section title={t("ux.todo")}>
      {items.length === 0 ? (
        <Card style={{ flexDirection: "row", alignItems: "center" }}>
          <AppIcon name="closing" size={22} color={c.statusGood} />
          <Text style={type.label}>{t("ux.all_done")}</Text>
        </Card>
      ) : <Card padded={false} style={{ paddingHorizontal: tokens.space[2], paddingVertical: 4 }}>{items}</Card>}
    </Section>
  );
}

const s = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: tokens.space[3], paddingTop: tokens.space[2] },
  avatar: { width: 46, height: 46, borderRadius: 16, backgroundColor: c.brandPrimary, alignItems: "center", justifyContent: "center" },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  demo: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", paddingHorizontal: 10, paddingVertical: 4, borderRadius: tokens.radius.pill, backgroundColor: c.statusWarnBg, marginTop: -tokens.space[3] },
  strip: { flexDirection: "row", alignItems: "center", backgroundColor: c.surface, borderRadius: tokens.radius.md, borderLeftWidth: 3, minHeight: 58, marginTop: -tokens.space[2], ...tokens.shadow.card },
  stripBody: { flex: 1, flexDirection: "row", alignItems: "center", gap: tokens.space[3], paddingVertical: 8, paddingLeft: tokens.space[3] },
  stripIcon: { width: 34, height: 34, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  stripNext: { flexDirection: "row", alignItems: "center", gap: 2, minHeight: 48, paddingHorizontal: tokens.space[3] },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: tokens.space[2] },
  facts: { gap: 4, padding: tokens.space[3], borderRadius: tokens.radius.sm, backgroundColor: c.surface },
  hero: { borderRadius: tokens.radius.xl, backgroundColor: c.brandPrimary, overflow: "hidden", ...tokens.shadow.raised },
  heroTop: { padding: tokens.space[5], paddingBottom: tokens.space[3], gap: 4 },
  heroBottom: { backgroundColor: c.brandDeep, padding: tokens.space[4], paddingTop: tokens.space[3] },
  eye: { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.1)" },
  tapToSee: { alignSelf: "flex-start", marginVertical: 6, paddingHorizontal: 16, paddingVertical: 8, borderRadius: tokens.radius.pill, backgroundColor: c.onBrand },
  parts: { flexDirection: "row", gap: tokens.space[3] },
  partLabel: { flexDirection: "row", alignItems: "center", gap: 4 },
  vr: { width: 1, backgroundColor: "rgba(255,255,255,0.14)" },
  todayRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: tokens.space[3], paddingTop: tokens.space[3], borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.12)" },
  heroPill: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 2, borderRadius: tokens.radius.pill },
  liqTrack: { height: 8, borderRadius: 4, backgroundColor: "rgba(255,255,255,0.18)", overflow: "hidden" },
  liqFill: { height: 8, borderRadius: 4, backgroundColor: c.actionPrimary },
  counters: { flexDirection: "row", gap: tokens.space[2], marginTop: -tokens.space[2] },
  counter: { flex: 1, alignItems: "center", gap: 2, paddingVertical: tokens.space[3], borderRadius: tokens.radius.md, backgroundColor: c.surface, ...tokens.shadow.card },
});
