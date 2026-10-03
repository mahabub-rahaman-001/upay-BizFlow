import { RoleGuard } from "../components/RoleGuard";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { MoneyText, PrimaryButton, StatusPill, keypadAmountMinor, tokens } from "@bizflow/ui";
import { PostingError, useAgentAuditPreview, usePostAgentAudit } from "../lib/api";

function AgentAudit() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t, i18n } = useTranslation();
  const bangla = i18n.language === "bn";
  const { data: preview, isLoading } = useAgentAuditPreview();
  const post = usePostAgentAudit();
  const [cash, setCash] = useState("");
  const [upay, setUpay] = useState("");
  const [walletValues, setWalletValues] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!preview) return;
    setCash((preview.expected_cash_minor / 100).toFixed(2));
    setUpay((preview.expected_upay_minor / 100).toFixed(2));
    setWalletValues(
      Object.fromEntries(preview.wallets.map((w) => [w.wallet, (w.expected_minor / 100).toFixed(2)])),
    );
  }, [preview]);

  if (isLoading || !preview) {
    return <Centered><ActivityIndicator color={tokens.color.brandPrimary} /></Centered>;
  }

  const cashMinor = keypadAmountMinor(cash);
  const upayMinor = keypadAmountMinor(upay);
  const walletsValid = preview.wallets.every((w) => walletValues[w.wallet]?.trim().length > 0);

  async function save() {
    setError(null);
    try {
      await post.mutateAsync({
        counted_cash_minor: cashMinor,
        actual_upay_minor: upayMinor,
        wallets: preview!.wallets.map((w) => ({
          wallet: w.wallet,
          actual_minor: keypadAmountMinor(walletValues[w.wallet] ?? ""),
        })),
        note: note.trim() || undefined,
      });
      router.back();
    } catch (e) {
      setError(t(`posting_error.${e instanceof PostingError ? e.code : "UNKNOWN"}`));
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: tokens.color.bg, paddingTop: insets.top }}>
      <Header title={t("agent.audit_title")} onClose={() => router.back()} />
      <ScrollView contentContainerStyle={{ padding: tokens.space[4], gap: tokens.space[4] }}>
        {preview.already_audited ? (
          <StatusPill kind="good" icon="v" label={t("agent.audit_done")} />
        ) : null}
        <AuditInput
          label={t("agent.cash_drawer")}
          expected={preview.expected_cash_minor}
          value={cash}
          onChange={setCash}
          bangla={bangla}
        />
        <AuditInput
          label={t("agent.upay_float")}
          expected={preview.expected_upay_minor}
          value={upay}
          onChange={setUpay}
          bangla={bangla}
          verified
        />
        {preview.wallets.map((wallet) => (
          <AuditInput
            key={wallet.wallet}
            label={wallet.wallet}
            expected={wallet.expected_minor}
            value={walletValues[wallet.wallet] ?? ""}
            onChange={(value) => setWalletValues((current) => ({ ...current, [wallet.wallet]: value }))}
            bangla={bangla}
            manual
          />
        ))}
        <View style={{ padding: tokens.space[4], borderRadius: tokens.radius.md, backgroundColor: tokens.color.surface }}>
          <Text style={{ color: tokens.color.textMuted, fontSize: tokens.font.size.label }}>
            {t("agent.commission_today")}
          </Text>
          <MoneyText amountMinor={preview.commission_minor} bangla={bangla} size="title" />
        </View>
        <TextInput value={note} onChangeText={setNote} placeholder={t("agent.note_optional")} maxLength={240} style={inputStyle} />
        {error ? <Text style={{ color: tokens.color.statusBad }}>{error}</Text> : null}
      </ScrollView>
      <View style={{ padding: tokens.space[4], paddingBottom: insets.bottom + tokens.space[4] }}>
        <PrimaryButton
          label={preview.already_audited ? t("agent.audit_done") : t("agent.save_audit")}
          disabled={preview.already_audited || cash.length === 0 || upay.length === 0 || !walletsValid}
          busy={post.isPending}
          onPress={save}
        />
      </View>
    </View>
  );
}

function AuditInput({ label, expected, value, onChange, bangla, verified, manual }: {
  label: string; expected: number; value: string; onChange: (value: string) => void;
  bangla: boolean; verified?: boolean; manual?: boolean;
}) {
  const { t } = useTranslation();
  const actual = value.length > 0 ? keypadAmountMinor(value) : 0;
  const variance = actual - expected;
  return (
    <View style={{ gap: tokens.space[2], padding: tokens.space[4], borderRadius: tokens.radius.md, backgroundColor: tokens.color.surface }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text style={{ color: tokens.color.text, fontWeight: "700", fontSize: tokens.font.size.body }}>{label}</Text>
        {verified ? <StatusPill kind="good" icon="v" label={t("home.verified")} /> : null}
        {manual ? <StatusPill kind="warn" icon="!" label={t("transactions.manual")} /> : null}
      </View>
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Text style={{ color: tokens.color.textMuted }}>{t("agent.expected")}</Text>
        <MoneyText amountMinor={expected} bangla={bangla} />
      </View>
      <TextInput
        value={value}
        onChangeText={onChange}
        keyboardType="decimal-pad"
        accessibilityLabel={`${label} ${t("agent.actual")}`}
        placeholder={t("agent.actual")}
        style={inputStyle}
      />
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Text style={{ color: variance === 0 ? tokens.color.statusGood : tokens.color.statusWarn }}>{t("closing.difference")}</Text>
        <MoneyText amountMinor={variance} bangla={bangla} muted={variance === 0} />
      </View>
    </View>
  );
}

function Header({ title, onClose }: { title: string; onClose: () => void }) {
  const { t } = useTranslation();
  return <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: tokens.space[4], paddingVertical: tokens.space[3] }}>
    <Text style={{ flex: 1, color: tokens.color.text, fontSize: tokens.font.size.title, fontWeight: "700" }}>{title}</Text>
    <Pressable accessibilityRole="button" accessibilityLabel={t("common.close")} onPress={onClose} style={{ minWidth: tokens.touchMin, minHeight: tokens.touchMin, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ color: tokens.color.textMuted, fontSize: tokens.font.size.title }}>x</Text>
    </Pressable>
  </View>;
}

function Centered({ children }: { children: React.ReactNode }) {
  return <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: tokens.color.bg }}>{children}</View>;
}

const inputStyle = {
  minHeight: tokens.touchMin, borderRadius: tokens.radius.md, borderWidth: 1,
  borderColor: tokens.color.divider, backgroundColor: tokens.color.bg,
  paddingHorizontal: tokens.space[4], fontSize: tokens.font.size.body, color: tokens.color.text,
} as const;

export default function AgentAuditScreen() {
  return (
    <RoleGuard type="AGENT">
      <AgentAudit />
    </RoleGuard>
  );
}
