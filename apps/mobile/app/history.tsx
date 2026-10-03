import { memo, useState } from "react";
import { FlatList, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { PrimaryButton, StatusPill, tokens } from "@bizflow/ui";
import { AppIcon } from "../components/AppIcon";
import { AmountRow, Card, Divider, EmptyState, ErrorState, Field, Notice, Screen, ScreenHeader, SkeletonRows, TextLink, showToast, type } from "../components/kit";
import { promptReauth } from "../lib/reauth";
import { PostingError, useAuditHistory, useClosingHistory, useReopenClosing, type AuditHistoryRow, type ClosingHistoryRow } from "../lib/api";
import { useActiveBusiness } from "../lib/session";
import { useFormatters, goBack } from "../lib/view";

const c = tokens.color;

/** Past daily closings (merchant) or float audits (agent), newest first. */
export default function HistoryScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const isAgent = useActiveBusiness()?.type === "AGENT";
  const closings = useClosingHistory(!isAgent);
  const audits = useAuditHistory(isAgent);
  const query = isAgent ? audits : closings;
  const data = (query.data ?? []) as (ClosingHistoryRow | AuditHistoryRow)[];
  return (
    <Screen scroll={false} header={<ScreenHeader title={t(isAgent ? "history.agent_title" : "history.merchant_title")} onBack={() => goBack(router)} />}>
      {query.isError ? <ErrorState onRetry={() => void query.refetch()} /> : (
        <FlatList
          data={data}
          keyExtractor={(item) => ("audit_id" in item ? item.audit_id : item.closing_id)}
          refreshing={query.isRefetching}
          onRefresh={() => void query.refetch()}
          contentContainerStyle={{ padding: tokens.space[4], gap: tokens.space[3], width: "100%", maxWidth: 560, alignSelf: "center" }}
          ListEmptyComponent={query.isLoading ? <SkeletonRows /> : <EmptyState icon="history" title={t("history.empty")} />}
          renderItem={({ item }) => ("audit_id" in item ? <AuditCard row={item} /> : <ClosingCard row={item} />)}
        />
      )}
    </Screen>
  );
}

function statusOf(variance: number, t: (k: string) => string) {
  return variance === 0 ? { kind: "good" as const, label: t("ux.matched") } : { kind: "warn" as const, label: variance < 0 ? t("ux.short") : t("ux.over") };
}

const ClosingCard = memo(function ClosingCard({ row }: { row: ClosingHistoryRow }) {
  const { t } = useTranslation();
  const fmt = useFormatters();
  const reopen = useReopenClosing();
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const st = statusOf(row.variance_minor, t);

  async function confirm() {
    setError(null);
    const auth = await promptReauth(t("reauth.title"));
    if (!auth.success) { setError(t("reauth.failed")); return; }
    try {
      await reopen.mutateAsync({ closingId: row.closing_id, reason: reason.trim() });
      setAsking(false);
      showToast({ kind: "info", title: t("history.reopened") });
    } catch (e) {
      setError(t(`posting_error.${e instanceof PostingError ? e.code : "UNKNOWN"}`));
    }
  }

  return (
    <Card style={{ gap: tokens.space[2] }}>
      <View style={s.head}>
        <Text style={[type.heading, { flex: 1 }]}>{fmt.date.format(new Date(`${row.period_date}T06:00:00Z`))}</Text>
        <StatusPill kind={row.status === "CLOSED" ? st.kind : "neutral"} compact icon={<AppIcon name={row.status === "CLOSED" ? "check" : "history"} size={12} color={row.status === "CLOSED" ? (st.kind === "good" ? c.statusGood : c.statusWarn) : c.textMuted} />} label={row.status === "CLOSED" ? st.label : t("history.reopened")} />
      </View>
      <Text style={type.caption}>{t("history.version", { version: row.version })}</Text>
      <AmountRow label={t("history.expected")} amount={row.expected_cash_minor} />
      <AmountRow label={t("history.counted")} amount={row.counted_cash_minor} />
      <Divider />
      <AmountRow label={t("history.variance")} amount={row.variance_minor} strong />
      {row.note ? <Text style={type.caption}>{row.note}</Text> : null}
      {row.can_reopen && !asking ? <TextLink label={t("history.reopen")} onPress={() => setAsking(true)} /> : null}
      {asking ? (
        <View style={{ gap: tokens.space[2] }}>
          <Field label={t("history.reopen_reason")} value={reason} onChangeText={setReason} maxLength={240} />
          {error ? <Notice kind="bad" title={error} /> : null}
          <PrimaryButton variant="danger" label={t("history.confirm_reopen")} busy={reopen.isPending} disabled={!reason.trim()} onPress={() => void confirm()} />
          <TextLink label={t("history.cancel")} tone="muted" onPress={() => { setAsking(false); setReason(""); }} />
        </View>
      ) : null}
    </Card>
  );
});

const AuditCard = memo(function AuditCard({ row }: { row: AuditHistoryRow }) {
  const { t } = useTranslation();
  const fmt = useFormatters();
  const st = statusOf(row.cash_variance_minor + row.upay_variance_minor, t);
  return (
    <Card style={{ gap: tokens.space[2] }}>
      <View style={s.head}>
        <Text style={[type.heading, { flex: 1 }]}>{fmt.date.format(new Date(`${row.period_date}T06:00:00Z`))}</Text>
        <StatusPill kind={st.kind} compact label={st.label} />
      </View>
      <Text style={[type.label, { color: c.brandPrimary }]}>{t("history.cash")}</Text>
      <AmountRow label={t("history.expected")} amount={row.expected_cash_minor} />
      <AmountRow label={t("history.counted")} amount={row.counted_cash_minor} />
      <AmountRow label={t("history.variance")} amount={row.cash_variance_minor} strong />
      <Divider />
      <Text style={[type.label, { color: c.brandPrimary }]}>{t("history.upay")}</Text>
      <AmountRow label={t("history.actual")} amount={row.actual_upay_minor} />
      <AmountRow label={t("history.variance")} amount={row.upay_variance_minor} strong />
      <AmountRow label={t("agent.commission")} amount={row.commission_minor} />
      {row.note ? <Text style={type.caption}>{row.note}</Text> : null}
    </Card>
  );
});

const s = StyleSheet.create({ head: { flexDirection: "row", alignItems: "center", gap: tokens.space[2] } });
