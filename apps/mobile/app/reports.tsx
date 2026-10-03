import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  Share,
  Text,
  TextInput,
  View,
} from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { Card, tokens } from "@bizflow/ui";
import { RoleGuard } from "../components/RoleGuard";
import {
  parseReportIntent,
  useLogExport,
  useReportRows,
  type ReportRow,
} from "../lib/api";
import { rowsToCsv } from "../lib/csv";
import { promptReauth } from "../lib/reauth";
import { useActiveBusiness, useIsOwner } from "../lib/session";

const REPORT_COLUMNS = {
  sales_by_day: ["date", "transaction_count", "sales_minor"],
  expenses: ["date", "category", "note", "expense_minor"],
  baki: ["customer", "baki_given_minor", "baki_collected_minor", "net_minor"],
  cash_vs_digital: ["date", "cash_minor", "digital_minor"],
} as const;

type MerchantReportKey = keyof typeof REPORT_COLUMNS;

function isoDate(daysAgo = 0): string {
  const value = new Date();
  value.setDate(value.getDate() - daysAgo);
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function validRange(fromDate: string, toDate: string): boolean {
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (!iso.test(fromDate) || !iso.test(toDate)) return false;
  const from = new Date(`${fromDate}T00:00:00Z`);
  const to = new Date(`${toDate}T00:00:00Z`);
  return !Number.isNaN(from.valueOf()) && !Number.isNaN(to.valueOf()) && from <= to;
}

function Reports() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t, i18n } = useTranslation();
  const active = useActiveBusiness();
  const isOwner = useIsOwner();
  const report = useReportRows();
  const exportLog = useLogExport();
  const [reportKey, setReportKey] = useState<MerchantReportKey>("sales_by_day");
  const [fromDate, setFromDate] = useState(isoDate(7));
  const [toDate, setToDate] = useState(isoDate());
  const [requestText, setRequestText] = useState("");
  const [intentBusy, setIntentBusy] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bangla = i18n.language === "bn";
  const rows = report.data ?? [];
  const columns = REPORT_COLUMNS[reportKey];

  useEffect(() => {
    if (active && !isOwner) router.replace("/");
  }, [active, isOwner, router]);

  const moneyFormatter = useMemo(
    () => new Intl.NumberFormat(bangla ? "bn-BD" : "en-BD", { minimumFractionDigits: 2 }),
    [bangla],
  );

  function preview() {
    setError(null);
    if (!validRange(fromDate, toDate)) {
      setError(t("reports.invalid_dates"));
      return;
    }
    report.mutate({ reportKey, fromDate, toDate }, {
      onError: () => setError(t("reports.load_error")),
    });
  }

  async function applyIntent() {
    if (!requestText.trim() || intentBusy) return;
    setIntentBusy(true);
    setError(null);
    try {
      const intent = await parseReportIntent(requestText.trim());
      if (intent.report_key in REPORT_COLUMNS) {
        setReportKey(intent.report_key as MerchantReportKey);
        setFromDate(intent.filters.from_date);
        setToDate(intent.filters.to_date);
      } else {
        setError(t("reports.unsupported_intent"));
      }
    } catch {
      setError(t("reports.intent_error"));
    } finally {
      setIntentBusy(false);
    }
  }

  async function exportCsv() {
    if (rows.length === 0 || exportBusy) return;
    setExportBusy(true);
    setError(null);
    try {
      const auth = await promptReauth(t("reauth.title"));
      if (!auth.success) {
        setError(t("reauth.failed"));
        return;
      }
      const fileName = `${reportKey}_${fromDate}_${toDate}.csv`;
      const csv = rowsToCsv(columns, rows);
      let fileUri: string | undefined;
      if (Platform.OS !== "web" && FileSystem.documentDirectory) {
        fileUri = `${FileSystem.documentDirectory}${fileName}`;
        await FileSystem.writeAsStringAsync(fileUri, csv, { encoding: FileSystem.EncodingType.UTF8 });
      }
      await exportLog.mutateAsync({ reportKey, fromDate, toDate, rowCount: rows.length, fileName });
      await Share.share({ title: fileName, message: Platform.OS === "web" ? csv : fileName, url: fileUri });
    } catch {
      setError(t("reports.export_error"));
    } finally {
      setExportBusy(false);
    }
  }

  if (!isOwner) return <View style={{ flex: 1, backgroundColor: tokens.color.bg }} />;

  return (
    <View style={{ flex: 1, backgroundColor: tokens.color.bg, paddingTop: insets.top }}>
      <View style={{ flexDirection: "row", alignItems: "center", padding: tokens.space[4] }}>
        <Text accessibilityRole="header" style={{ flex: 1, color: tokens.color.text, fontSize: tokens.font.size.title, fontWeight: "700" }}>{t("reports.title")}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={t("common.close")} onPress={() => router.back()} style={{ minWidth: tokens.touchMin, minHeight: tokens.touchMin, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: tokens.color.textMuted, fontSize: tokens.font.size.title }}>x</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={{ padding: tokens.space[4], paddingBottom: insets.bottom + tokens.space[6], gap: tokens.space[3] }}>
        <Card title={t("reports.ask_title")}>
          <TextInput value={requestText} onChangeText={setRequestText} placeholder={t("reports.ask_placeholder")} placeholderTextColor={tokens.color.textMuted} style={inputStyle} />
          <Button label={intentBusy ? t("reports.working") : t("reports.apply_intent")} disabled={intentBusy || !requestText.trim()} onPress={() => void applyIntent()} />
        </Card>

        <Card title={t("reports.type") }>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: tokens.space[2] }}>
            {(Object.keys(REPORT_COLUMNS) as MerchantReportKey[]).map((key) => (
              <Pressable key={key} accessibilityRole="radio" accessibilityState={{ checked: reportKey === key }} onPress={() => setReportKey(key)} style={{ minHeight: tokens.touchMin, justifyContent: "center", paddingHorizontal: tokens.space[3], borderRadius: tokens.radius.pill, backgroundColor: reportKey === key ? tokens.color.aiTint : tokens.color.bg }}>
                <Text style={{ color: reportKey === key ? tokens.color.brandPrimary : tokens.color.text }}>{t(`reports.types.${key}`)}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={labelStyle}>{t("reports.from")}</Text>
          <TextInput value={fromDate} onChangeText={setFromDate} autoCapitalize="none" keyboardType="numbers-and-punctuation" placeholder="YYYY-MM-DD" style={inputStyle} />
          <Text style={labelStyle}>{t("reports.to")}</Text>
          <TextInput value={toDate} onChangeText={setToDate} autoCapitalize="none" keyboardType="numbers-and-punctuation" placeholder="YYYY-MM-DD" style={inputStyle} />
          <Button label={t("reports.preview")} disabled={report.isPending} onPress={preview} />
        </Card>

        {error ? <Text accessibilityRole="alert" style={{ color: tokens.color.statusBad }}>{error}</Text> : null}
        {report.isPending ? <ActivityIndicator color={tokens.color.brandPrimary} /> : null}
        {report.isSuccess ? (
          <Card title={t("reports.preview_count", { count: rows.length })}>
            {rows.length === 0 ? <Text style={{ color: tokens.color.textMuted }}>{t("reports.empty")}</Text> : rows.slice(0, 20).map((row, index) => (
              <View key={`${index}-${String(row[columns[0]])}`} style={{ paddingVertical: tokens.space[2], borderBottomWidth: index === Math.min(rows.length, 20) - 1 ? 0 : 1, borderBottomColor: tokens.color.divider, gap: tokens.space[1] }}>
                {columns.map((column) => <ReportValue key={column} column={column} value={row[column]} moneyFormatter={moneyFormatter} />)}
              </View>
            ))}
            {rows.length > 0 ? <Button label={exportBusy ? t("reports.working") : t("reports.export_csv")} disabled={exportBusy} onPress={() => void exportCsv()} /> : null}
          </Card>
        ) : null}
      </ScrollView>
    </View>
  );
}

function ReportValue({ column, value, moneyFormatter }: { column: string; value: ReportRow[string]; moneyFormatter: Intl.NumberFormat }) {
  const { t } = useTranslation();
  const display = column.endsWith("_minor") && value != null
    ? `৳${moneyFormatter.format(Number(value) / 100)}`
    : String(value ?? "-");
  return <View style={{ flexDirection: "row", gap: tokens.space[2] }}><Text style={{ flex: 1, color: tokens.color.textMuted, fontSize: tokens.font.size.caption }}>{t(`reports.columns.${column}`)}</Text><Text selectable style={{ flex: 1, textAlign: "right", color: tokens.color.text, fontSize: tokens.font.size.label }}>{display}</Text></View>;
}

function Button({ label, disabled, onPress }: { label: string; disabled?: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={{ minHeight: tokens.buttonHeight, alignItems: "center", justifyContent: "center", borderRadius: tokens.radius.md, backgroundColor: tokens.color.actionPrimary, opacity: disabled ? 0.5 : 1 }}><Text style={{ color: tokens.color.actionPrimaryText, fontWeight: "700", fontSize: tokens.font.size.body }}>{label}</Text></Pressable>;
}

const inputStyle = { minHeight: tokens.touchMin, borderWidth: 1, borderColor: tokens.color.divider, borderRadius: tokens.radius.md, paddingHorizontal: tokens.space[3], color: tokens.color.text, backgroundColor: tokens.color.bg } as const;
const labelStyle = { color: tokens.color.textMuted, fontSize: tokens.font.size.label } as const;

export default function ReportsScreen() {
  return <RoleGuard type="MERCHANT"><Reports /></RoleGuard>;
}
