import { useMemo, useState } from "react";
import { RefreshControl, SectionList, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { tokens } from "@bizflow/ui";
import { AppIcon } from "../../components/AppIcon";
import { ChipBar, EmptyState, ErrorState, Field, Notice, Screen, ScreenHeader, Segmented, SkeletonRows, type } from "../../components/kit";
import { AnimatedMoney } from "../../components/motion";
import { TxnDetailSheet, TxnItem } from "../../components/txn";
import { useTransactions, type TransactionRow } from "../../lib/api";
import { useActiveBusiness, useCanAddEntries } from "../../lib/session";
import { dayLabel, dhakaDay, totals, txnSubtitle, txnTitle, useFormatters } from "../../lib/view";

const c = tokens.color;
type Tab = "digital" | "manual";

/**
 * Transactions (docs/16 section 4). Proven money and hand-written records live on two
 * tabs, each with its own in/out summary, so a typed number never passes for a verified
 * one. Rows group by day; a tap opens the detail sheet with receipt, refund or correction.
 */
export default function Transactions() {
  const { t } = useTranslation();
  const router = useRouter();
  const params = useLocalSearchParams<{ tab?: string }>();
  const isAgent = useActiveBusiness()?.type === "AGENT";
  const canAdd = useCanAddEntries();
  const fmt = useFormatters();
  const { data, isLoading, isError, refetch, isRefetching } = useTransactions(400);
  const [tab, setTab] = useState<Tab>(params.tab === "manual" ? "manual" : "digital");
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<TransactionRow | null>(null);

  const reversed = useMemo(() => new Set((data ?? []).map((r) => r.reverses_txn_id).filter(Boolean) as string[]), [data]);
  const filters = tab === "digital"
    ? (isAgent
      ? [["all", t("agent.filter_all")], ["AGENT_CASH_IN", t("txn_kind.AGENT_CASH_IN")], ["AGENT_CASH_OUT", t("txn_kind.AGENT_CASH_OUT")], ["AGENT_SEND_MONEY", t("txn_kind.AGENT_SEND_MONEY")], ["AGENT_COMMISSION", t("txn_kind.AGENT_COMMISSION")]]
      : [["all", t("agent.filter_all")], ["QR_PAYMENT", t("txn_kind.QR_PAYMENT")], ["REFUND", t("txn_kind.REFUND")]])
    : (isAgent
      ? [["all", t("agent.filter_all")], ["MANUAL_WALLET", t("txn_kind.MANUAL_WALLET")], ["REVERSAL", t("txn_kind.REVERSAL")]]
      : [["all", t("agent.filter_all")], ["CASH_SALE", t("txn_kind.CASH_SALE")], ["EXPENSE", t("txn_kind.EXPENSE")], ["BAKI_SALE", t("txn_kind.BAKI_SALE")], ["BAKI_COLLECTION", t("txn_kind.BAKI_COLLECTION")], ["SUPPLIER_PAYMENT", t("txn_kind.SUPPLIER_PAYMENT")]]);

  const rows = useMemo(() => {
    const source = tab === "digital" ? "verified" : "manual";
    const q = query.trim().toLowerCase();
    return (data ?? []).filter((r) => r.source === source && r.kind !== "CLOSING_VARIANCE" && r.kind !== "OWNER_DEPOSIT")
      .filter((r) => filter === "all" || r.kind === filter)
      .filter((r) => !q || [txnTitle(r, t), txnSubtitle(r, t) ?? "", r.reference ?? "", String(Math.trunc(Number(r.amount_minor) / 100))].join(" ").toLowerCase().includes(q));
  }, [data, tab, filter, query, t]);

  const today = dhakaDay(new Date().toISOString());
  const sum = totals(rows.filter((r) => dhakaDay(r.occurred_at) === today));
  const sections = useMemo(() => {
    const map = new Map<string, TransactionRow[]>();
    for (const row of rows) {
      const day = dhakaDay(row.occurred_at);
      map.set(day, [...(map.get(day) ?? []), row]);
    }
    return [...map.entries()].map(([day, list]) => ({ day, data: list }));
  }, [rows]);

  const manualTab = tab === "manual";
  const header = (
    <View style={{ gap: tokens.space[3], paddingBottom: tokens.space[2] }}>
      <Segmented
        value={tab}
        onChange={(next) => { setTab(next); setFilter("all"); }}
        items={[{ key: "digital", label: t("ux.tab_digital"), icon: "verified" }, { key: "manual", label: t("ux.tab_manual"), icon: "pen" }]}
      />
      <View style={[s.summary, manualTab && s.summaryManual]}>
        <View style={s.summaryCell}>
          <View style={s.summaryLabel}><AppIcon name="arrow-in" size={15} color={c.statusGood} /><Text style={type.caption}>{t("ux.today")} · {t("ux.money_in")}</Text></View>
          <AnimatedMoney amountMinor={sum.inMinor} size="title" />
        </View>
        <View style={s.vr} />
        <View style={s.summaryCell}>
          <View style={s.summaryLabel}><AppIcon name="arrow-out" size={15} color={c.statusBad} /><Text style={type.caption}>{t("ux.today")} · {t("ux.money_out")}</Text></View>
          <AnimatedMoney amountMinor={sum.outMinor} size="title" />
        </View>
      </View>
      <Notice kind={manualTab ? "manual" : "good"} icon={manualTab ? "pen" : "verified"} title={t(manualTab ? "ux.manual_explain" : "ux.digital_explain")} />
      <Field label={t("ux.search")} icon="search" value={query} onChangeText={setQuery} placeholder={t("ux.search")} accessibilityLabel={t("ux.search")} />
      <ChipBar items={filters.map(([key, label]) => ({ key: key!, label: label! }))} value={filter} onChange={setFilter} />
    </View>
  );

  return (
    <Screen inTabs scroll={false} header={<ScreenHeader title={t("nav.transactions")} subtitle={t(manualTab ? "ux.manual_records" : "ux.verified_records")} />}>
      {isLoading ? (
        <View style={{ padding: tokens.space[4], gap: tokens.space[4] }}>{header}<SkeletonRows count={6} /></View>
      ) : isError ? (
        <ErrorState onRetry={() => void refetch()} />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(row) => row.id}
          stickySectionHeadersEnabled={false}
          contentContainerStyle={s.list}
          ListHeaderComponent={header}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} tintColor={c.brandPrimary} />}
          renderSectionHeader={({ section }) => {
            const day = totals(section.data);
            return (
              <View style={s.dayHeader}>
                <Text style={type.label}>{dayLabel(section.day, t, fmt)}</Text>
                <Text style={type.caption}>+{fmt.number.format(Math.trunc(day.inMinor / 100))} / -{fmt.number.format(Math.trunc(day.outMinor / 100))}</Text>
              </View>
            );
          }}
          renderItem={({ item }) => <View style={{ marginBottom: 6 }}><TxnItem row={item} reversed={reversed.has(item.id)} onPress={setOpen} /></View>}
          ListEmptyComponent={query ? <EmptyState icon="search" title={t("ux.no_results")} /> : manualTab ? (
            <EmptyState icon="pen" title={t("ux.no_manual")} body={t("ux.no_manual_hint")} action={canAdd ? t("ux.add_entry") : undefined} onAction={() => router.push(isAgent ? "/manual-wallet" : "/cash-sale")} />
          ) : (
            <EmptyState icon="qr" title={t("ux.no_digital")} body={t("ux.no_digital_hint")} action={t("ux.f_receive")} onAction={() => router.push("/receive")} />
          )}
        />
      )}
      <TxnDetailSheet row={open} reversed={!!open && reversed.has(open.id)} onClose={() => setOpen(null)} />
    </Screen>
  );
}

const s = StyleSheet.create({
  list: { paddingHorizontal: tokens.space[4], paddingBottom: tokens.space[6], width: "100%", maxWidth: 560, alignSelf: "center" },
  summary: { flexDirection: "row", padding: tokens.space[4], borderRadius: tokens.radius.lg, backgroundColor: c.surface, ...tokens.shadow.card },
  summaryManual: { backgroundColor: c.manualTint, borderWidth: 1, borderColor: c.manualBorder, shadowOpacity: 0, elevation: 0 },
  summaryCell: { flex: 1, gap: 2 },
  summaryLabel: { flexDirection: "row", alignItems: "center", gap: 4 },
  vr: { width: 1, backgroundColor: c.divider, marginHorizontal: tokens.space[3] },
  dayHeader: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", paddingTop: tokens.space[3], paddingBottom: tokens.space[2] },
});
