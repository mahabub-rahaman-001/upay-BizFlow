import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { tokens } from "@bizflow/ui";
import { RoleGuard } from "../components/RoleGuard";
import { Card, EmptyState, Screen, ScreenHeader, Section, Skeleton, type, useDigits } from "../components/kit";
import { AnimatedMoney } from "../components/motion";
import { TxnItem } from "../components/txn";
import { useCommissionSummary, useTransactions } from "../lib/api";
import { useFormatters, goBack } from "../lib/view";

const c = tokens.color;

/** Commission: today big, week and month beside it, a 7-day bar row, then the entries. */
function Commission() {
  const { t } = useTranslation();
  const router = useRouter();
  const digits = useDigits();
  const fmt = useFormatters();
  const summary = useCommissionSummary();
  const txns = useTransactions(300);
  const rows = useMemo(() => (txns.data ?? []).filter((r) => r.kind === "AGENT_COMMISSION"), [txns.data]);
  const days = summary.data?.by_day ?? [];
  const max = Math.max(1, ...days.map((d) => Number(d.amount_minor)));
  return (
    <Screen header={<ScreenHeader title={t("agent.commission")} onBack={() => goBack(router)} />}>
      {summary.isLoading ? <Skeleton height={140} radius={tokens.radius.xl} /> : (
        <View style={s.hero}>
          <Text style={[type.label, { color: c.onBrandMuted }]}>{t("agent.commission_today")}</Text>
          <AnimatedMoney amountMinor={summary.data?.today_minor ?? 0} size="numberXl" inverse />
          <Text style={[type.caption, { color: c.onBrandMuted }]}>{digits(summary.data?.count_today ?? 0)} · {t("ux.f_cashbook")}</Text>
          <View style={s.split}>
            <View style={{ flex: 1 }}><Text style={[type.caption, { color: c.onBrandMuted }]}>{t("commission.this_week")}</Text><AnimatedMoney amountMinor={summary.data?.week_minor ?? 0} size="label" inverse /></View>
            <View style={{ flex: 1 }}><Text style={[type.caption, { color: c.onBrandMuted }]}>{t("commission.this_month")}</Text><AnimatedMoney amountMinor={summary.data?.month_minor ?? 0} size="label" inverse /></View>
          </View>
        </View>
      )}
      {days.length ? (
        <Section title={t("commission.last_7_days")}>
          <Card>
            <View style={s.chart}>
              {days.map((d) => (
                <View key={d.date} style={s.col}>
                  <View style={s.track}><View style={[s.bar, { height: `${(Number(d.amount_minor) / max) * 100}%` }]} /></View>
                  <Text style={[type.caption, { fontSize: 11 }]}>{fmt.day.format(new Date(`${d.date}T06:00:00Z`)).split(/[ ,]/)[0]}</Text>
                </View>
              ))}
            </View>
          </Card>
        </Section>
      ) : null}
      <Section title={t("ux.recent")}>
        {rows.length === 0 ? <EmptyState icon="commission" title={t("agent.no_commission")} /> : <View style={{ gap: 6 }}>{rows.slice(0, 20).map((r) => <TxnItem key={r.id} row={r} />)}</View>}
      </Section>
    </Screen>
  );
}

const s = StyleSheet.create({
  hero: { padding: tokens.space[5], borderRadius: tokens.radius.xl, backgroundColor: c.brandPrimary, gap: 2, ...tokens.shadow.raised },
  split: { flexDirection: "row", gap: tokens.space[3], marginTop: tokens.space[3], paddingTop: tokens.space[3], borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.14)" },
  chart: { flexDirection: "row", alignItems: "flex-end", gap: 8, height: 120 },
  col: { flex: 1, alignItems: "center", gap: 4, height: "100%" },
  track: { flex: 1, width: "100%", justifyContent: "flex-end" },
  bar: { width: "100%", borderRadius: 8, backgroundColor: c.aiBorder },
});

export default function CommissionScreen() {
  return <RoleGuard type="AGENT"><Commission /></RoleGuard>;
}
