import { useRef, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { PrimaryButton, tokens } from "@bizflow/ui";
import { takaToPoisha } from "@bizflow/shared";
import { supabase } from "../lib/supabase";
import { PostingError } from "../lib/api";

type BizType = "MERCHANT" | "AGENT";

/**
 * Onboarding (docs/02 section 8): type, name, category, then the opening balances. One
 * call to create_business() creates the business, the owner membership, the chart of
 * accounts and the opening balance entry together, so a half-made business cannot exist.
 *
 * Amounts are typed in whole taka and converted to poisha here; nothing downstream ever
 * sees a float.
 */
export default function Onboarding() {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [type, setType] = useState<BizType>("MERCHANT");
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [openingCash, setOpeningCash] = useState("");
  const [openingWallet, setOpeningWallet] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // One key for this onboarding attempt: a retry after a dropped connection must not
  // create a second business.
  const clientUuid = useRef(globalThis.crypto.randomUUID());

  const taka = (input: string) => {
    const n = Number(input.replace(/[^\d]/g, ""));
    return Number.isFinite(n) && n > 0 ? takaToPoisha(n) : 0;
  };

  async function submit() {
    setBusy(true);
    setError(null);

    const { error: rpcError } = await supabase.rpc("create_business", {
      p_type: type,
      p_name: name.trim(),
      p_category: category.trim() || "other",
      p_client_uuid: clientUuid.current,
      p_opening_cash_minor: taka(openingCash),
      p_opening_wallet_minor: taka(openingWallet),
    });

    setBusy(false);

    if (rpcError) {
      setError(t(`posting_error.${new PostingError(rpcError.message).code}`));
      return;
    }

    await queryClient.invalidateQueries({ queryKey: ["me"] });
    router.replace("/");
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: tokens.color.bg }}
      contentContainerStyle={{
        paddingTop: insets.top + tokens.space[5],
        paddingHorizontal: tokens.space[4],
        paddingBottom: tokens.space[6],
        gap: tokens.space[4],
      }}
    >
      <Text
        style={{ fontSize: tokens.font.size.title, fontWeight: "700", color: tokens.color.text }}
      >
        {t("onboarding.title")}
      </Text>

      <Field label={t("onboarding.type")}>
        <View style={{ flexDirection: "row", gap: tokens.space[2] }}>
          <TypeChoice
            label={t("onboarding.merchant")}
            selected={type === "MERCHANT"}
            onPress={() => setType("MERCHANT")}
          />
          <TypeChoice
            label={t("onboarding.agent")}
            selected={type === "AGENT"}
            onPress={() => setType("AGENT")}
          />
        </View>
      </Field>

      <Field label={t("onboarding.name")}>
        <TextInput value={name} onChangeText={setName} style={inputStyle} />
      </Field>

      <Field label={t("onboarding.category")}>
        <TextInput value={category} onChangeText={setCategory} style={inputStyle} />
      </Field>

      <Field label={t("onboarding.opening_cash")}>
        <TextInput
          value={openingCash}
          onChangeText={setOpeningCash}
          keyboardType="number-pad"
          placeholder="0"
          style={inputStyle}
        />
      </Field>

      <Field
        label={type === "AGENT" ? t("onboarding.opening_float") : t("onboarding.opening_wallet")}
      >
        <TextInput
          value={openingWallet}
          onChangeText={setOpeningWallet}
          keyboardType="number-pad"
          placeholder="0"
          style={inputStyle}
        />
      </Field>

      {error ? (
        <Text style={{ color: tokens.color.statusBad, fontSize: tokens.font.size.label }}>
          {error}
        </Text>
      ) : null}

      <PrimaryButton
        label={t("onboarding.start")}
        busy={busy}
        disabled={name.trim().length === 0}
        onPress={submit}
      />
    </ScrollView>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: tokens.space[2] }}>
      <Text style={{ fontSize: tokens.font.size.label, color: tokens.color.textMuted }}>
        {label}
      </Text>
      {children}
    </View>
  );
}

function TypeChoice({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={{
        flex: 1,
        minHeight: tokens.touchMin,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: tokens.radius.md,
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? tokens.color.brandPrimary : tokens.color.divider,
        backgroundColor: tokens.color.surface,
      }}
    >
      <Text
        style={{
          fontSize: tokens.font.size.body,
          fontWeight: selected ? "700" : "400",
          color: selected ? tokens.color.brandPrimary : tokens.color.text,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const inputStyle = {
  height: tokens.buttonHeight,
  borderRadius: tokens.radius.md,
  borderWidth: 1,
  borderColor: tokens.color.divider,
  backgroundColor: tokens.color.surface,
  paddingHorizontal: tokens.space[4],
  fontSize: tokens.font.size.body,
  color: tokens.color.text,
} as const;
