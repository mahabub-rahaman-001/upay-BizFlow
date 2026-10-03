import { useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import QRCode from "react-native-qrcode-svg";
import { MoneyText, StatusPill, tokens } from "@bizflow/ui";
import { takaToPoisha } from "@bizflow/shared";
import { useBusinessQr } from "../../lib/api";

/**
 * Receive money (docs/04 section 13.3) - the hero control. Big QR, the verified shop name
 * beside it, and the explicit "scan with any app" line, which is the product's whole
 * promise: a payment from any Bangla QR app becomes books by itself.
 *
 * The amount is optional and never blocks receiving money. The QR stays in the same place
 * whether or not an amount is set, because position is how these users navigate.
 */
export default function Receive() {
  const insets = useSafeAreaInsets();
  const { t, i18n } = useTranslation();
  const [amountTaka, setAmountTaka] = useState("");
  const bangla = i18n.language === "bn";

  const typedTaka = Number(amountTaka.replace(/[^\d]/g, ""));
  const amountMinor = Number.isFinite(typedTaka) && typedTaka > 0 ? takaToPoisha(typedTaka) : undefined;

  const { data, isLoading, isError, error } = useBusinessQr(amountMinor);

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: tokens.color.bg,
        paddingTop: insets.top + tokens.space[3],
        paddingHorizontal: tokens.space[4],
        gap: tokens.space[4],
      }}
    >
      <Text
        style={{ fontSize: tokens.font.size.title, fontWeight: "700", color: tokens.color.text }}
      >
        {t("receive.title")}
      </Text>

      <View
        style={{
          backgroundColor: tokens.color.surface,
          borderRadius: tokens.radius.lg,
          padding: tokens.space[5],
          alignItems: "center",
          gap: tokens.space[3],
        }}
      >
        {isLoading ? (
          <View style={{ width: 220, height: 220, alignItems: "center", justifyContent: "center" }}>
            <ActivityIndicator color={tokens.color.brandPrimary} />
          </View>
        ) : isError || !data ? (
          <View style={{ width: 220, height: 220, alignItems: "center", justifyContent: "center" }}>
            <Text
              style={{
                color: tokens.color.statusBad,
                fontSize: tokens.font.size.label,
                textAlign: "center",
              }}
            >
              {error instanceof Error && error.message.startsWith("QR_NOT_ISSUED")
                ? t("receive.no_qr")
                : t("posting_error.UNKNOWN")}
            </Text>
          </View>
        ) : (
          <QRCode
            value={data.payload}
            size={220}
            color={tokens.color.text}
            backgroundColor={tokens.color.surface}
          />
        )}

        <View style={{ alignItems: "center", gap: tokens.space[2] }}>
          <Text
            style={{
              fontSize: tokens.font.size.body,
              fontWeight: "700",
              color: tokens.color.text,
            }}
          >
            {data?.business_name ?? ""}
          </Text>
          {data?.verified ? (
            <StatusPill kind="good" icon="v" label={t("home.verified")} />
          ) : null}
        </View>

        {amountMinor ? (
          <MoneyText amountMinor={amountMinor} size="numberLg" bangla={bangla} />
        ) : null}

        <Text
          style={{
            fontSize: tokens.font.size.body,
            color: tokens.color.textMuted,
            textAlign: "center",
          }}
        >
          {t("receive.any_app")}
        </Text>
        <Text style={{ fontSize: tokens.font.size.caption, color: tokens.color.textMuted }}>
          bKash - Nagad - Rocket - upay
        </Text>
      </View>

      <View style={{ gap: tokens.space[2] }}>
        <Text style={{ fontSize: tokens.font.size.label, color: tokens.color.textMuted }}>
          {t("receive.amount_optional")}
        </Text>
        <View style={{ flexDirection: "row", gap: tokens.space[2] }}>
          <TextInput
            value={amountTaka}
            onChangeText={setAmountTaka}
            keyboardType="number-pad"
            placeholder="0"
            accessibilityLabel={t("receive.amount_optional")}
            style={{
              flex: 1,
              height: tokens.buttonHeight,
              borderRadius: tokens.radius.md,
              borderWidth: 1,
              borderColor: tokens.color.divider,
              backgroundColor: tokens.color.surface,
              paddingHorizontal: tokens.space[4],
              fontSize: tokens.font.size.title,
              color: tokens.color.text,
            }}
          />
          {amountTaka.length > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("receive.clear_amount")}
              onPress={() => setAmountTaka("")}
              style={{
                minWidth: tokens.touchMin,
                height: tokens.buttonHeight,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: tokens.radius.md,
                backgroundColor: tokens.color.surface,
                borderWidth: 1,
                borderColor: tokens.color.divider,
              }}
            >
              <Text style={{ fontSize: tokens.font.size.title, color: tokens.color.textMuted }}>
                x
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
}
