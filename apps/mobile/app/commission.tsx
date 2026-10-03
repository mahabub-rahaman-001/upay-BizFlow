import { RoleGuard } from "../components/RoleGuard";
import { useMemo } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { Card, EmptyState, MoneyText, TxnRow, tokens } from "@bizflow/ui";
import { useCommissionSummary, useTransactions } from "../lib/api";

function Commission() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t, i18n } = useTranslation();
  const bangla = i18n.language === "bn";
  const { data: summary } = useCommissionSummary();
  const { data } = useTransactions(100);
  const rows = useMemo(() => (data ?? []).filter((row) => row.kind === "AGENT_COMMISSION"), [data]);
  const formatter = useMemo(() => new Intl.DateTimeFormat(bangla ? "bn-BD" : "en-GB", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Dhaka",
  }), [bangla]);
  const dayLabel = useMemo(() => new Intl.DateTimeFormat(bangla ? "bn-BD" : "en-GB", {
    day: "2-digit", month: "short", timeZone: "Asia/Dhaka",
  }), [bangla]);
  return (
    <View style={{ flex: 1, backgroundColor: tokens.color.bg, paddingTop: insets.top }}>
      <View style={{ flexDirection: "row", alignItems: "center", padding: tokens.space[4] }}>
        <Text style={{ flex: 1, color: tokens.color.text, fontSize: tokens.font.size.title, fontWeight: "700" }}>{t("agent.commission")}</Text>
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel={t("common.close")} style={{ minWidth: tokens.touchMin, minHeight: tokens.touchMin, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: tokens.color.textMuted, fontSize: tokens.font.size.title }}>x</Text>
        </Pressable>
      </View>
      <View style={{ marginHorizontal: tokens.space[4], marginBottom: tokens.space[3], padding: tokens.space[4], borderRadius: tokens.radius.md, backgroundColor: tokens.color.surface }}>
        <Text style={{ color: tokens.color.textMuted }}>{t("agent.commission_today")}</Text>
        <MoneyText amountMinor={summary?.today_minor ?? 0} bangla={bangla} size="numberLg" />
        <View style={{ flexDirection: "row", gap: tokens.space[4], marginTop: tokens.space[2] }}>
          <View>
            <Text style={{ color: tokens.color.textMuted, fontSize: tokens.font.size.caption }}>{t("commission.this_week")}</Text>
            <MoneyText amountMinor={summary?.week_minor ?? 0} bangla={bangla} muted />
          </View>
          <View>
            <Text style={{ color: tokens.color.textMuted, fontSize: tokens.font.size.caption }}>{t("commission.this_month")}</Text>
            <MoneyText amountMinor={summary?.month_minor ?? 0} bangla={bangla} muted />
          </View>
        </View>
      </View>

      {summary && summary.by_day.some((d) => d.amount_minor > 0) ? (
        <View style={{ marginHorizontal: tokens.space[4], marginBottom: tokens.space[3] }}>
          <Card title={t("commission.last_7_days")}>
            {summary.by_day.map((d) => (
              <View key={d.date} style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: tokens.space[1] }}>
                <Text style={{ color: tokens.color.textMuted, fontSize: tokens.font.size.label }}>{dayLabel.format(new Date(d.date))}</Text>
                <MoneyText amountMinor={Number(d.amount_minor)} bangla={bangla} muted={d.amount_minor === 0} />
              </View>
            ))}
          </Card>
        </View>
      ) : null}

      <FlatList
        data={rows}
        keyExtractor={(row) => row.id}
        ListEmptyComponent={<EmptyState message={t("agent.no_commission")} />}
        renderItem={({ item }) => <TxnRow title={t("txn_kind.AGENT_COMMISSION")} amountMinor={item.amount_minor} time={formatter.format(new Date(item.occurred_at))} source={item.source} manualLabel={t("transactions.manual")} bangla={bangla} />}
      />
    </View>
  );
}

export default function CommissionScreen() {
  return (
    <RoleGuard type="AGENT">
      <Commission />
    </RoleGuard>
  );
}
