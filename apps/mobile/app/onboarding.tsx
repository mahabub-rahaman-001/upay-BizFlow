import { useRef, useState } from "react";
import { Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { AmountKeypad, PrimaryButton, keypadAmountMinor } from "@bizflow/ui";
import { ChoiceCard, Field, Notice, Screen, ScreenHeader, StepHeader, type, useBangla } from "../components/kit";
import { supabase } from "../lib/supabase";
import { PostingError } from "../lib/api";
import { useSession } from "../lib/session";
import { feedback } from "../lib/feedback";

type BizType = "MERCHANT" | "AGENT";
const CATEGORIES = [["grocery", "store"], ["pharmacy", "shield"], ["restaurant", "sale"], ["stationery", "books"], ["electronics", "digital"], ["other", "grid"]] as const;

/**
 * Onboarding (docs/04 section 14): one question per screen - type, name, what you sell,
 * opening cash, opening wallet - then one create_business() call that makes the business,
 * the chart of accounts and the opening entries together.
 */
export default function Onboarding() {
  const { t } = useTranslation();
  const router = useRouter();
  const bangla = useBangla();
  const queryClient = useQueryClient();
  const entrance = useSession((s) => s.entrance);
  const [step, setStep] = useState(1);
  const [kind, setKind] = useState<BizType>(entrance ?? "MERCHANT");
  const [name, setName] = useState("");
  const [category, setCategory] = useState("grocery");
  const [cash, setCash] = useState("");
  const [wallet, setWallet] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const uuid = useRef(globalThis.crypto.randomUUID());
  const total = kind === "AGENT" ? 4 : 5;
  const last = step === total;

  async function submit() {
    setBusy(true);
    setError(null);
    const { error: rpcError } = await supabase.rpc("create_business", {
      p_type: kind, p_name: name.trim(), p_category: kind === "AGENT" ? "agent" : category, p_client_uuid: uuid.current,
      p_opening_cash_minor: keypadAmountMinor(cash), p_opening_wallet_minor: keypadAmountMinor(wallet),
    });
    setBusy(false);
    if (rpcError) {
      feedback("error");
      setError(t(`posting_error.${new PostingError(rpcError.message).code}`));
      return;
    }
    feedback("success");
    await queryClient.invalidateQueries({ queryKey: ["me"] });
    router.replace("/");
  }

  // Agents skip the category question.
  const screen = kind === "AGENT" && step >= 3 ? step + 1 : step;
  const canNext = screen === 2 ? name.trim().length > 0 : true;

  return (
    <Screen
      header={<ScreenHeader title={t("onboarding.title")} onBack={step > 1 ? () => setStep(step - 1) : undefined} />}
      footer={<PrimaryButton label={last ? t("onboarding.start") : t("ux.next")} busy={busy} disabled={!canNext} onPress={() => (last ? void submit() : setStep(step + 1))} />}
    >
      <StepHeader step={step} total={total} />
      {screen === 1 ? (
        <View style={{ gap: 8 }}>
          <Text style={type.display}>{t("ux.ob_type")}</Text>
          <ChoiceCard icon="store" label={t("ux.merchant_door")} hint={t("ux.merchant_door_hint")} selected={kind === "MERCHANT"} onPress={() => setKind("MERCHANT")} />
          <ChoiceCard icon="agent" label={t("ux.agent_door")} hint={t("ux.agent_door_hint")} selected={kind === "AGENT"} onPress={() => setKind("AGENT")} />
        </View>
      ) : null}
      {screen === 2 ? (
        <View style={{ gap: 12 }}>
          <Text style={type.display}>{t("ux.ob_name")}</Text>
          <Field label={t("onboarding.name")} value={name} onChangeText={setName} autoFocus maxLength={60} />
        </View>
      ) : null}
      {screen === 3 ? (
        <View style={{ gap: 8 }}>
          <Text style={type.display}>{t("ux.ob_category")}</Text>
          {CATEGORIES.map(([key, icon]) => <ChoiceCard key={key} icon={icon} label={t(`ux.cat_${key}`)} selected={category === key} onPress={() => setCategory(key)} />)}
        </View>
      ) : null}
      {screen === 4 ? (
        <View style={{ gap: 12 }}>
          <Text style={type.display}>{t("ux.ob_cash")}</Text>
          <Text style={type.bodyMuted}>{t("ux.ob_skip_hint")}</Text>
          <AmountKeypad value={cash} onChange={setCash} bangla={bangla} />
        </View>
      ) : null}
      {screen === 5 ? (
        <View style={{ gap: 12 }}>
          <Text style={type.display}>{t(kind === "AGENT" ? "ux.ob_float" : "ux.ob_wallet")}</Text>
          <Text style={type.bodyMuted}>{t("ux.ob_skip_hint")}</Text>
          <AmountKeypad value={wallet} onChange={setWallet} bangla={bangla} />
        </View>
      ) : null}
      {error ? <Notice kind="bad" title={error} /> : null}
    </Screen>
  );
}
