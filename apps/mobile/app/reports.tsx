import { useEffect, useState } from "react";
import { Platform, Share, Text, View } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { PrimaryButton, tokens } from "@bizflow/ui";
import { formatMoney } from "@bizflow/shared";
import { RoleGuard } from "../components/RoleGuard";
import { AppIcon } from "../components/AppIcon";
import { Card, ChipBar, Divider, EmptyState, Field, Notice, Screen, ScreenHeader, Section, SkeletonRows, type, useBangla } from "../components/kit";
import { parseReportIntent, useLogExport, useReportRows, type ReportRow } from "../lib/api";
import { rowsToCsv } from "../lib/csv";
import { promptReauth } from "../lib/reauth";
import { useActiveBusiness, useIsOwner } from "../lib/session";
import { goBack } from "../lib/view";

const COLUMNS = {
  sales_by_day: ["date", "transaction_count", "sales_minor"],
  expenses: ["date", "category", "note", "expense_minor"],
  baki: ["customer", "baki_given_minor", "baki_collected_minor", "net_minor"],
  cash_vs_digital: ["date", "cash_minor", "digital_minor"],
} as const;
type ReportKey = keyof typeof COLUMNS;

function isoDate(daysAgo = 0) {
  return new Date(Date.now() + 6 * 3600 * 1000 - daysAgo * 86400000).toISOString().slice(0, 10);
}

/**
 * Reports (docs/03 M15): pick or describe a report, preview it, export CSV after the
 * owner's device check. The AI only maps words to a report type; rows come from the ledger.
 */
function Reports() {
  const { t } = useTranslation();
  const router = useRouter();
  const bangla = useBangla();
  const active = useActiveBusiness();
  const isOwner = useIsOwner();
  const report = useReportRows();
  const exportLog = useLogExport();
  const [key, setKey] = useState<ReportKey>("sales_by_day");
  const [from, setFrom] = useState(isoDate(7));
  const [to, setTo] = useState(isoDate());
  const [ask, setAsk] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rows = report.data ?? [];
  const columns = COLUMNS[key];

  useEffect(() => { if (active && !isOwner) router.replace("/"); }, [active, isOwner, router]);
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && from <= to;

  function preview() {
    setError(null);
    if (!valid) { setError(t("reports.invalid_dates")); return; }
    report.mutate({ reportKey: key, fromDate: from, toDate: to }, { onError: () => setError(t("reports.load_error")) });
  }

  async function applyAsk() {
    setBusy(true);
    setError(null);
    try {
      const intent = await parseReportIntent(ask.trim());
      if (intent.report_key in COLUMNS) {
        setKey(intent.report_key as ReportKey);
        setFrom(intent.filters.from_date);
        setTo(intent.filters.to_date);
      } else setError(t("reports.unsupported_intent"));
    } catch {
      setError(t("reports.intent_error"));
    } finally {
      setBusy(false);
    }
  }

  async function exportCsv() {
    setBusy(true);
    setError(null);
    try {
      const auth = await promptReauth(t("reauth.title"));
      if (!auth.success) { setError(t("reauth.failed")); return; }
      const fileName = `${key}_${from}_${to}.csv`;
      const csv = rowsToCsv(columns, rows);
      let uri: string | undefined;
      if (Platform.OS !== "web" && FileSystem.documentDirectory) {
        uri = `${FileSystem.documentDirectory}${fileName}`;
        await FileSystem.writeAsStringAsync(uri, csv, { encoding: FileSystem.EncodingType.UTF8 });
      }
      await exportLog.mutateAsync({ reportKey: key, fromDate: from, toDate: to, rowCount: rows.length, fileName });
      await Share.share({ title: fileName, message: Platform.OS === "web" ? csv : fileName, url: uri });
    } catch {
      setError(t("reports.export_error"));
    } finally {
      setBusy(false);
    }
  }

  const show = (column: string, value: ReportRow[string]) => (column.endsWith("_minor") && value != null ? formatMoney(Number(value), { bangla, currency: "taka-sign" }) : String(value ?? "-"));

  return (
    <Screen header={<ScreenHeader title={t("reports.title")} onBack={() => goBack(router)} />} footer={<PrimaryButton label={t("reports.preview")} busy={report.isPending} onPress={preview} />}>
      <Card tone="ai">
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}><AppIcon name="sparkle" size={18} color={tokens.color.aiBorder} /><Text style={type.label}>{t("reports.ask_title")}</Text></View>
        <Field label={t("reports.ask_placeholder")} value={ask} onChangeText={setAsk} />
        <PrimaryButton variant="secondary" compact label={t("reports.apply_intent")} busy={busy && !!ask} disabled={!ask.trim()} onPress={() => void applyAsk()} />
      </Card>
      <Section title={t("reports.type")}>
        <ChipBar wrap items={(Object.keys(COLUMNS) as ReportKey[]).map((k) => ({ key: k, label: t(`reports.types.${k}`) }))} value={key} onChange={setKey} />
        <View style={{ flexDirection: "row", gap: tokens.space[2] }}>
          <View style={{ flex: 1 }}><Field label={t("reports.from")} value={from} onChangeText={setFrom} /></View>
          <View style={{ flex: 1 }}><Field label={t("reports.to")} value={to} onChangeText={setTo} /></View>
        </View>
      </Section>
      {error ? <Notice kind="bad" title={error} /> : null}
      {report.isPending ? <SkeletonRows /> : report.isSuccess ? (
        <Section title={t("reports.preview_count", { count: rows.length })}>
          {rows.length === 0 ? <EmptyState icon="reports" title={t("reports.empty")} /> : (
            <Card style={{ gap: 0 }}>
              {rows.slice(0, 20).map((row, i) => (
                <View key={i}>
                  {i > 0 ? <Divider /> : null}
                  <View style={{ paddingVertical: 8, gap: 2 }}>
                    {columns.map((col) => (
                      <View key={col} style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
                        <Text style={type.caption}>{t(`reports.columns.${col}`)}</Text>
                        <Text selectable style={[type.label, { textAlign: "right", flexShrink: 1 }]}>{show(col, row[col])}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              ))}
              <PrimaryButton variant="secondary" label={t("reports.export_csv")} icon={<AppIcon name="share" size={18} color={tokens.color.brandPrimary} />} busy={busy && !ask} onPress={() => void exportCsv()} />
            </Card>
          )}
        </Section>
      ) : null}
    </Screen>
  );
}

export default function ReportsScreen() {
  return <RoleGuard type="MERCHANT"><Reports /></RoleGuard>;
}
