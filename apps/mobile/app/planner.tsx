import { RoleGuard } from "../components/RoleGuard";
import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { AmountKeypad, Card, MoneyText, StatusPill, keypadAmountMinor, tokens } from "@bizflow/ui";
import { useSafeToWithdraw, useSimulateWithdrawal, type WithdrawalSimulation } from "../lib/api";

/**
 * Planner / safe-to-withdraw (docs/04 section 13.7). The single number - how much is safe
 * to take out today - carries the meaning; the breakdown below is there for the owner who
 * wants to see the sum. Every figure comes from the deterministic RPC, never client maths
 * and never a model.
 */
function Planner() {
  const insets = useSafeAreaInsets();
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const bangla = i18n.language === "bn";

  const { data, isLoading } = useSafeToWithdraw();
  const simulate = useSimulateWithdrawal();
  const [showWhy, setShowWhy] = useState(false);
  const [whatIf, setWhatIf] = useState("");
  const [sim, setSim] = useState<WithdrawalSimulation | null>(null);

  async function runSimulation() {
    const minor = keypadAmountMinor(whatIf);
    if (minor <= 0) return;
    setSim(await simulate.mutateAsync(minor));
  }

  return (
    <View style={{ flex: 1, backgroundColor: tokens.color.bg, paddingTop: insets.top + tokens.space[3] }}>
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: tokens.space[4] }}>
        <Text style={{ flex: 1, fontSize: tokens.font.size.title, fontWeight: "700", color: tokens.color.text }}>
          {t("planner.title")}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("common.close")}
          onPress={() => router.back()}
          style={{ minWidth: tokens.touchMin, minHeight: tokens.touchMin, alignItems: "center", justifyContent: "center" }}
        >
          <Text style={{ fontSize: tokens.font.size.title, color: tokens.color.textMuted }}>x</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: tokens.space[4], gap: tokens.space[3] }} keyboardShouldPersistTaps="handled">
        {isLoading ? (
          <ActivityIndicator color={tokens.color.brandPrimary} style={{ marginTop: tokens.space[6] }} />
        ) : !data?.available ? (
          // No forecast, or one the model would not stand behind: say so plainly rather
          // than show a number the data cannot support.
          <Card>
            <StatusPill kind="neutral" icon="~" label={t("planner.not_ready")} />
            <Text style={{ fontSize: tokens.font.size.body, color: tokens.color.textMuted, lineHeight: 22 }}>
              {t("planner.not_ready_help")}
            </Text>
          </Card>
        ) : (
          <>
            {/* The one number that matters. */}
            <Card title={t("planner.safe_today")}>
              <MoneyText amountMinor={data.safe_to_withdraw_minor ?? 0} size="numberXl" bangla={bangla} />
              <StatusPill
                kind={data.confidence === "high" ? "good" : "warn"}
                icon="~"
                label={t(`ai.confidence_${data.confidence}`)}
              />
              {/* When the forecast is switched off, say so: this is a plain cash-minus-
                  reserve estimate, not the model's projection. */}
              {data.fallback ? (
                <Text style={{ fontSize: tokens.font.size.caption, color: tokens.color.textMuted }}>
                  {t("planner.simple_estimate")}
                </Text>
              ) : null}
            </Card>

            <Pressable accessibilityRole="button" onPress={() => setShowWhy((v) => !v)} style={{ minHeight: tokens.touchMin, justifyContent: "center" }}>
              <Text style={{ color: tokens.color.brandPrimary, fontWeight: "700", fontSize: tokens.font.size.label }}>
                {showWhy ? t("planner.hide_why") : t("planner.see_why")}
              </Text>
            </Pressable>

            {showWhy ? (
              <Card>
                <Line label={t("planner.cleared_now")} amount={data.current_cleared_minor} bangla={bangla} />
                <Line label={t("planner.inflow_7d")} amount={data.forecast_inflow_p10_7d_minor ?? 0} bangla={bangla} sign="+" />
                <Line label={t("planner.lowest_day")} amount={data.lowest_projected_balance_p10_minor ?? 0} bangla={bangla} />
                <Line label={t("planner.reserve")} amount={-(data.reserve_minor ?? 0)} bangla={bangla} />
                <Line label={t("planner.buffer")} amount={-(data.uncertainty_buffer_minor ?? 0)} bangla={bangla} />
                <View style={{ borderTopWidth: 1, borderTopColor: tokens.color.divider, paddingTop: tokens.space[2] }}>
                  <Line label={t("planner.safe_today")} amount={data.safe_to_withdraw_minor ?? 0} bangla={bangla} strong />
                </View>
                <Text style={{ fontSize: tokens.font.size.caption, color: tokens.color.textMuted, marginTop: tokens.space[2] }}>
                  {t("planner.excludes")}
                </Text>
              </Card>
            ) : null}

            {/* What-if: a concrete consequence, never a model call. */}
            <Card title={t("planner.what_if")}>
              <AmountKeypad value={whatIf} onChange={setWhatIf} bangla={bangla} />
              <Pressable
                accessibilityRole="button"
                disabled={keypadAmountMinor(whatIf) <= 0 || simulate.isPending}
                onPress={runSimulation}
                style={{
                  minHeight: tokens.touchMin,
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: tokens.radius.md,
                  borderWidth: 1,
                  borderColor: tokens.color.brandPrimary,
                  opacity: keypadAmountMinor(whatIf) <= 0 ? 0.5 : 1,
                }}
              >
                <Text style={{ color: tokens.color.brandPrimary, fontWeight: "700", fontSize: tokens.font.size.label }}>
                  {t("planner.check")}
                </Text>
              </Pressable>

              {sim ? (
                <View style={{ gap: tokens.space[2], marginTop: tokens.space[2] }}>
                  <StatusPill
                    kind={sim.below_reserve ? "bad" : "good"}
                    icon={sim.below_reserve ? "!" : "v"}
                    label={sim.below_reserve ? t("planner.below_reserve") : t("planner.stays_safe")}
                  />
                  <Text style={{ fontSize: tokens.font.size.label, color: tokens.color.textMuted }}>
                    {t("planner.lowest_after")}{" "}
                    <MoneyText amountMinor={sim.lowest_after_minor} bangla={bangla} muted />
                  </Text>
                </View>
              ) : null}
            </Card>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function Line({ label, amount, bangla, sign, strong = false }: { label: string; amount: number; bangla: boolean; sign?: string; strong?: boolean }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: tokens.space[3], paddingVertical: tokens.space[1] }}>
      <Text style={{ fontSize: tokens.font.size.label, color: strong ? tokens.color.text : tokens.color.textMuted, fontWeight: strong ? "700" : "400" }}>
        {sign === "+" ? "+ " : ""}{label}
      </Text>
      <MoneyText amountMinor={amount} bangla={bangla} muted={!strong} />
    </View>
  );
}

export default function PlannerScreen() {
  return (
    <RoleGuard type="MERCHANT">
      <Planner />
    </RoleGuard>
  );
}
