import { useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { AmountKeypad, PrimaryButton, StatusPill, keypadAmountMinor, tokens } from "@bizflow/ui";
import { formatMoney } from "@bizflow/shared";
import { RoleGuard } from "../components/RoleGuard";
import { AppIcon } from "../components/AppIcon";
import { AmountRow, Card, Divider, Notice, Screen, ScreenHeader, Section, Segmented, Sheet, Skeleton, TextLink, type, useBangla } from "../components/kit";
import { AnimatedMoney, SuccessSheet, type SuccessInfo } from "../components/motion";
import { PostingError, useLatestForecast, usePostOwnerWithdrawal, useSafeToWithdraw, useSimulateWithdrawal, type WithdrawalSimulation } from "../lib/api";
import { feedback } from "../lib/feedback";
import { useFormatters, goBack } from "../lib/view";

const c = tokens.color;

/**
 * Planner (docs/04 13.7): the one number - how much is safe to take out today - carries
 * the meaning. The chart is optional comprehension with a one-line takeaway; the maths is
 * one tap away. Every figure comes from the deterministic RPC, never from a model.
 */
function Planner() {
  const { t } = useTranslation();
  const router = useRouter();
  const bangla = useBangla();
  const fmt = useFormatters();
  const safe = useSafeToWithdraw();
  const forecast = useLatestForecast("sales7d");
  const simulate = useSimulateWithdrawal();
  const withdraw = usePostOwnerWithdrawal();
  const [why, setWhy] = useState(false);
  const [whatIf, setWhatIf] = useState("");
  const [sim, setSim] = useState<WithdrawalSimulation | null>(null);
  const [recording, setRecording] = useState(false);
  const [wAmount, setWAmount] = useState("");
  const [wFrom, setWFrom] = useState<"cash" | "wallet">("cash");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<SuccessInfo | null>(null);
  const uuid = useRef(globalThis.crypto.randomUUID());
  const d = safe.data;
  const days = forecast.data?.days ?? [];
  const max = Math.max(1, ...days.map((x) => x.p90_minor));
  const money = (minor: number) => formatMoney(minor, { bangla, currency: "taka-sign" });

  async function record() {
    setError(null);
    const amount = keypadAmountMinor(wAmount);
    try {
      await withdraw.mutateAsync({ amount_minor: amount, paid_from: wFrom, client_uuid: uuid.current });
      uuid.current = globalThis.crypto.randomUUID();
      setRecording(false);
      setWAmount("");
      setSuccess({ title: t("ux.withdrawal_saved"), amountMinor: amount, sign: "out", source: "manual" });
      void safe.refetch();
    } catch (e) {
      feedback("error");
      setError(t(`posting_error.${e instanceof PostingError ? e.code : "UNKNOWN"}`));
    }
  }

  return (
    <Screen header={<ScreenHeader title={t("planner.title")} onBack={() => goBack(router)} />} footer={d?.available ? <PrimaryButton variant="secondary" label={t("ux.record_withdrawal")} icon={<AppIcon name="pen" size={18} color={c.brandPrimary} />} onPress={() => setRecording(true)} /> : undefined}>
      {safe.isLoading ? <Skeleton height={160} radius={tokens.radius.xl} /> : !d?.available ? (
        <Notice kind="info" title={t("planner.not_ready")} body={t("planner.not_ready_help")} />
      ) : (
        <View style={s.hero}>
          <Text style={[type.label, { color: c.onBrandMuted }]}>{t("planner.safe_today")}</Text>
          <AnimatedMoney amountMinor={d.safe_to_withdraw_minor ?? 0} size="numberXl" inverse />
          <Text style={[type.caption, { color: c.onBrandMuted }]}>{t("ux.planner_hint")}</Text>
          <View style={s.heroRow}>
            <StatusPill kind={d.confidence === "high" ? "good" : "warn"} compact label={t(`ai.confidence_${d.confidence}`, { defaultValue: d.confidence })} />
            {d.fallback ? <Text style={[type.caption, { color: c.onBrandMuted }]}>{t("planner.simple_estimate")}</Text> : null}
            <View style={{ marginLeft: "auto" }}><TextLink label={why ? t("planner.hide_why") : t("ux.why")} onPress={() => setWhy(!why)} /></View>
          </View>
        </View>
      )}

      {why && d?.available ? (
        <Card style={{ gap: 2 }}>
          <AmountRow label={t("planner.cleared_now")} amount={d.current_cleared_minor} />
          <AmountRow label={t("planner.inflow_7d")} amount={d.forecast_inflow_p10_7d_minor ?? 0} sign="in" />
          <AmountRow label={t("planner.lowest_day")} amount={d.lowest_projected_balance_p10_minor ?? 0} hint={d.lowest_projected_day} />
          <AmountRow label={t("planner.reserve")} amount={d.reserve_minor ?? 0} sign="out" />
          <AmountRow label={t("planner.buffer")} amount={d.uncertainty_buffer_minor ?? 0} sign="out" />
          <Divider />
          <AmountRow label={t("planner.safe_today")} amount={d.safe_to_withdraw_minor ?? 0} strong />
          <Text style={type.caption}>{t("planner.excludes")}</Text>
        </Card>
      ) : null}

      {days.length > 0 ? (
        <Section title={t("ux.forecast_7d")} hint={`${money(days.reduce((sum, x) => sum + x.p10_minor, 0))} - ${money(days.reduce((sum, x) => sum + x.p90_minor, 0))}`}>
          <Card>
            <View style={s.chart}>
              {days.map((x) => (
                <View key={x.day} style={s.barCol}>
                  <View style={s.barTrack}>
                    <View style={[s.band, { height: `${(x.p90_minor / max) * 100}%` }]}>
                      <View style={[s.mid, { height: `${(x.p50_minor / x.p90_minor) * 100}%` }]} />
                    </View>
                  </View>
                  <Text style={[type.caption, { fontSize: 11 }]} numberOfLines={1}>{fmt.day.format(new Date(`${x.day}T06:00:00Z`)).split(/[ ,]/)[0]}</Text>
                </View>
              ))}
            </View>
            <Text style={type.caption}>{bangla ? forecast.data?.advice_bn : forecast.data?.advice_en}</Text>
          </Card>
        </Section>
      ) : null}

      {d?.available ? (
        <Section title={t("planner.what_if")}>
          <Card>
            <AmountKeypad value={whatIf} onChange={(v) => { setWhatIf(v); setSim(null); }} bangla={bangla} compact />
            <PrimaryButton variant="secondary" label={t("planner.check")} busy={simulate.isPending} disabled={keypadAmountMinor(whatIf) <= 0} onPress={() => void simulate.mutateAsync(keypadAmountMinor(whatIf)).then(setSim)} />
            {sim ? (
              <Notice kind={sim.below_reserve ? "bad" : "good"} title={t(sim.below_reserve ? "planner.below_reserve" : "planner.stays_safe")} body={`${t("planner.lowest_after")}: ${money(sim.lowest_after_minor)}`} />
            ) : null}
          </Card>
        </Section>
      ) : null}

      <Sheet visible={recording} onClose={() => setRecording(false)} title={t("ux.record_withdrawal")} subtitle={t("ux.record_only")}
        footer={<PrimaryButton label={t("ux.save")} busy={withdraw.isPending} disabled={keypadAmountMinor(wAmount) <= 0} onPress={() => void record()} />}>
        <AmountKeypad value={wAmount} onChange={setWAmount} bangla={bangla} compact />
        <Segmented value={wFrom} onChange={setWFrom} items={[{ key: "cash", label: t("expense.from_cash"), icon: "cash" }, { key: "wallet", label: t("expense.from_wallet"), icon: "digital" }]} />
        {error ? <Notice kind="bad" title={error} /> : null}
      </Sheet>
      <SuccessSheet info={success} onDone={() => setSuccess(null)} />
    </Screen>
  );
}

const s = StyleSheet.create({
  hero: { padding: tokens.space[5], borderRadius: tokens.radius.xl, backgroundColor: c.brandPrimary, gap: 4, ...tokens.shadow.raised },
  heroRow: { flexDirection: "row", alignItems: "center", gap: tokens.space[2], marginTop: tokens.space[2] },
  chart: { flexDirection: "row", alignItems: "flex-end", gap: 8, height: 140 },
  barCol: { flex: 1, alignItems: "center", gap: 4, height: "100%" },
  barTrack: { flex: 1, width: "100%", justifyContent: "flex-end" },
  band: { width: "100%", borderRadius: 8, backgroundColor: c.brandSoft, justifyContent: "flex-end", overflow: "hidden" },
  mid: { width: "100%", borderRadius: 8, backgroundColor: c.brandPrimary, opacity: 0.85 },
});

export default function PlannerScreen() {
  return <RoleGuard type="MERCHANT"><Planner /></RoleGuard>;
}
