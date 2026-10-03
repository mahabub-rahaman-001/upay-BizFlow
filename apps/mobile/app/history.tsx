import { memo, useCallback, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { Card, MoneyText, PrimaryButton, StatusPill, tokens } from "@bizflow/ui";
import { promptReauth } from "../lib/reauth";
import {
  PostingError,
  useAuditHistory,
  useClosingHistory,
  useReopenClosing,
  type AuditHistoryRow,
  type ClosingHistoryRow,
} from "../lib/api";
import { useActiveBusiness } from "../lib/session";

const dateFormatters = {
  bn: new Intl.DateTimeFormat("bn-BD", { day: "numeric", month: "long", year: "numeric" }),
  en: new Intl.DateTimeFormat("en-BD", { day: "numeric", month: "short", year: "numeric" }),
};

function formatDate(periodDate: string, bangla: boolean) {
  return dateFormatters[bangla ? "bn" : "en"].format(new Date(`${periodDate}T00:00:00+06:00`));
}

export default function HistoryScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t, i18n } = useTranslation();
  const active = useActiveBusiness();
  const isAgent = active?.type === "AGENT";
  const bangla = i18n.resolvedLanguage !== "en";
  const closings = useClosingHistory(!isAgent);
  const audits = useAuditHistory(isAgent);
  const query = isAgent ? audits : closings;
  const data = (query.data ?? []) as (ClosingHistoryRow | AuditHistoryRow)[];

  const renderItem = useCallback(({ item }: { item: ClosingHistoryRow | AuditHistoryRow }) => (
    isAgent
      ? <AuditCard row={item as AuditHistoryRow} bangla={bangla} />
      : <ClosingCard row={item as ClosingHistoryRow} bangla={bangla} />
  ), [bangla, isAgent]);

  return (
    <View style={{ flex: 1, backgroundColor: tokens.color.bg, paddingTop: insets.top }}>
      <Header title={t(isAgent ? "history.agent_title" : "history.merchant_title")} onClose={() => router.back()} />
      {query.isLoading ? (
        <Centered><ActivityIndicator color={tokens.color.brandPrimary} /></Centered>
      ) : (
        <FlatList
          data={data}
          keyExtractor={(item) => "audit_id" in item ? item.audit_id : item.closing_id}
          renderItem={renderItem}
          refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} />}
          contentContainerStyle={{ padding: tokens.space[4], paddingBottom: insets.bottom + tokens.space[6], gap: tokens.space[3], flexGrow: data.length === 0 ? 1 : undefined }}
          ListEmptyComponent={<Centered><Text style={{ color: query.isError ? tokens.color.statusBad : tokens.color.textMuted }}>{t(query.isError ? "history.error" : "history.empty")}</Text></Centered>}
        />
      )}
    </View>
  );
}

const ClosingCard = memo(function ClosingCard({ row, bangla }: { row: ClosingHistoryRow; bangla: boolean }) {
  const { t } = useTranslation();
  const reopen = useReopenClosing();
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function confirmReopen() {
    if (!reason.trim()) {
      setError(t("history.reason_required"));
      return;
    }
    setError(null);
    // Reopening a closed day is a sensitive action (Phase D): confirm it is the owner, and
    // open the server reauth window, before the reopen RPC.
    const auth = await promptReauth(t("reauth.title"));
    if (!auth.success) {
      setError(auth.error ?? t("reauth.failed"));
      return;
    }
    try {
      await reopen.mutateAsync({ closingId: row.closing_id, reason: reason.trim() });
      setAsking(false);
      setReason("");
    } catch (caught) {
      setError(t(`posting_error.${caught instanceof PostingError ? caught.code : "UNKNOWN"}`));
    }
  }

  return (
    <Card>
      <View style={{ flexDirection: "row", alignItems: "center", gap: tokens.space[2] }}>
        <Text style={{ flex: 1, color: tokens.color.text, fontSize: tokens.font.size.body, fontWeight: "700" }}>{formatDate(row.period_date, bangla)}</Text>
        <StatusPill kind={row.status === "CLOSED" ? "good" : "warn"} icon={row.status === "CLOSED" ? "✓" : "↺"} label={t(row.status === "CLOSED" ? "history.closed" : "history.reopened")} />
      </View>
      <Text style={{ color: tokens.color.textMuted, fontSize: tokens.font.size.caption }}>{t("history.version", { version: row.version })}</Text>
      <MoneyRow label={t("history.expected")} value={row.expected_cash_minor} bangla={bangla} />
      <MoneyRow label={t("history.counted")} value={row.counted_cash_minor} bangla={bangla} />
      <MoneyRow label={t("history.variance")} value={row.variance_minor} bangla={bangla} strong />
      {row.note ? <Text style={{ color: tokens.color.textMuted }}>{row.note}</Text> : null}
      {row.can_reopen && !asking ? (
        <Pressable accessibilityRole="button" onPress={() => setAsking(true)} style={{ minHeight: tokens.touchMin, justifyContent: "center" }}>
          <Text style={{ color: tokens.color.brandPrimary, fontWeight: "700" }}>{t("history.reopen")}</Text>
        </Pressable>
      ) : null}
      {asking ? (
        <View style={{ gap: tokens.space[2] }}>
          <TextInput value={reason} onChangeText={setReason} placeholder={t("history.reopen_reason")} maxLength={240} style={inputStyle} />
          {error ? <Text accessibilityRole="alert" style={{ color: tokens.color.statusBad }}>{error}</Text> : null}
          <PrimaryButton label={t("history.confirm_reopen")} busy={reopen.isPending} onPress={() => void confirmReopen()} />
          <Pressable accessibilityRole="button" disabled={reopen.isPending} onPress={() => { setAsking(false); setReason(""); setError(null); }} style={{ minHeight: tokens.touchMin, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ color: tokens.color.textMuted }}>{t("history.cancel")}</Text>
          </Pressable>
        </View>
      ) : null}
    </Card>
  );
});

const AuditCard = memo(function AuditCard({ row, bangla }: { row: AuditHistoryRow; bangla: boolean }) {
  const { t } = useTranslation();
  return (
    <Card title={formatDate(row.period_date, bangla)}>
      <Text style={sectionLabelStyle}>{t("history.cash")}</Text>
      <MoneyRow label={t("history.expected")} value={row.expected_cash_minor} bangla={bangla} />
      <MoneyRow label={t("history.counted")} value={row.counted_cash_minor} bangla={bangla} />
      <MoneyRow label={t("history.variance")} value={row.cash_variance_minor} bangla={bangla} strong />
      <View style={{ height: 1, backgroundColor: tokens.color.divider }} />
      <Text style={sectionLabelStyle}>{t("history.upay")}</Text>
      <MoneyRow label={t("history.expected")} value={row.expected_upay_minor} bangla={bangla} />
      <MoneyRow label={t("history.actual")} value={row.actual_upay_minor} bangla={bangla} />
      <MoneyRow label={t("history.variance")} value={row.upay_variance_minor} bangla={bangla} strong />
      {row.note ? <Text style={{ color: tokens.color.textMuted }}>{row.note}</Text> : null}
    </Card>
  );
});

function MoneyRow({ label, value, bangla, strong = false }: { label: string; value: number; bangla: boolean; strong?: boolean }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: tokens.space[3], minHeight: 32 }}>
      <Text style={{ color: strong ? tokens.color.text : tokens.color.textMuted, fontWeight: strong ? "700" : "400" }}>{label}</Text>
      <MoneyText amountMinor={value} bangla={bangla} muted={!strong} />
    </View>
  );
}

function Header({ title, onClose }: { title: string; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: tokens.space[4], paddingVertical: tokens.space[2] }}>
      <Text accessibilityRole="header" style={{ flex: 1, color: tokens.color.text, fontSize: tokens.font.size.title, fontWeight: "700" }}>{title}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={t("common.close")} onPress={onClose} style={{ minWidth: tokens.touchMin, minHeight: tokens.touchMin, alignItems: "center", justifyContent: "center" }}>
        <Text style={{ color: tokens.color.textMuted, fontSize: tokens.font.size.title }}>×</Text>
      </Pressable>
    </View>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: tokens.space[4] }}>{children}</View>;
}

const sectionLabelStyle = { color: tokens.color.brandPrimary, fontSize: tokens.font.size.label, fontWeight: "700" } as const;
const inputStyle = { minHeight: tokens.touchMin, borderRadius: tokens.radius.md, borderWidth: 1, borderColor: tokens.color.divider, backgroundColor: tokens.color.bg, paddingHorizontal: tokens.space[4], fontSize: tokens.font.size.body, color: tokens.color.text } as const;
