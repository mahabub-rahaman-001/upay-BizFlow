import { RoleGuard } from "../components/RoleGuard";
import { useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import {
  AmountKeypad,
  MoneyText,
  PrimaryButton,
  StatusPill,
  keypadAmountMinor,
  tokens,
} from "@bizflow/ui";
import { PostingError, useClosingPreview, usePostClosing } from "../lib/api";

/**
 * Daily closing (docs/04 section 13.6) - the paper-khata ritual, digitised. Expected
 * against counted, one variance line that says a word as well as a colour, and any blocker
 * stated before the amber button rather than after it.
 *
 * The variance is posted to 9000 Cash over/short, so a difference lands on the books
 * instead of being quietly absorbed: after closing, the drawer account equals what the
 * owner actually counted.
 */
function Closing() {
  const insets = useSafeAreaInsets();
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const bangla = i18n.language === "bn";

  const [counted, setCounted] = useState("");
  const [note, setNote] = useState("");
  const [exceptionReason, setExceptionReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const clientUuid = useRef(globalThis.crypto.randomUUID());

  const { data: preview, isLoading } = useClosingPreview();
  const post = usePostClosing();

  const countedMinor = keypadAmountMinor(counted);
  const expected = Number(preview?.expected_cash_minor ?? 0);
  const tolerance = Number(preview?.tolerance_minor ?? 10000);
  const variance = countedMinor - expected;
  const blockers = preview?.blockers ?? [];
  const needsException = blockers.length > 0;

  // Zero is fine, within tolerance is worth a look, beyond it needs attention.
  const varianceKind = variance === 0 ? "good" : Math.abs(variance) <= tolerance ? "warn" : "bad";
  const varianceLabel =
    variance === 0 ? t("closing.ok") : Math.abs(variance) <= tolerance ? t("closing.watch") : t("closing.alert");

  async function close() {
    setError(null);
    try {
      await post.mutateAsync({
        counted_cash_minor: countedMinor,
        client_uuid: clientUuid.current,
        note: note.trim() || undefined,
        exception_reason: exceptionReason.trim() || undefined,
      });
      router.back();
    } catch (e) {
      setError(t(`posting_error.${e instanceof PostingError ? e.code : "UNKNOWN"}`));
      clientUuid.current = globalThis.crypto.randomUUID();
    }
  }

  if (isLoading) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: tokens.color.bg,
        }}
      >
        <ActivityIndicator color={tokens.color.brandPrimary} />
      </View>
    );
  }

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: tokens.color.bg,
        paddingTop: insets.top + tokens.space[3],
      }}
    >
      <View
        style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: tokens.space[4] }}
      >
        <Text
          style={{
            flex: 1,
            fontSize: tokens.font.size.title,
            fontWeight: "700",
            color: tokens.color.text,
          }}
        >
          {t("closing.title")}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("common.close")}
          onPress={() => router.back()}
          style={{
            minWidth: tokens.touchMin,
            minHeight: tokens.touchMin,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ fontSize: tokens.font.size.title, color: tokens.color.textMuted }}>x</Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: tokens.space[4], gap: tokens.space[4] }}
        keyboardShouldPersistTaps="handled"
      >
        {/* What the day did, straight from the ledger. */}
        <View
          style={{
            backgroundColor: tokens.color.surface,
            borderRadius: tokens.radius.md,
            padding: tokens.space[4],
            gap: tokens.space[2],
          }}
        >
          {Object.entries(preview?.lines ?? {}).map(([kind, total]) => (
            <Row
              key={kind}
              label={t(`txn_kind.${kind}`, { defaultValue: kind })}
              amountMinor={Number(total)}
              bangla={bangla}
            />
          ))}
          <View
            style={{
              borderTopWidth: 1,
              borderTopColor: tokens.color.divider,
              paddingTop: tokens.space[2],
            }}
          >
            <Row label={t("closing.expected")} amountMinor={expected} bangla={bangla} strong />
          </View>
        </View>

        <Text style={{ fontSize: tokens.font.size.label, color: tokens.color.textMuted }}>
          {t("closing.counted")}
        </Text>
        <AmountKeypad value={counted} onChange={setCounted} bangla={bangla} />

        {/* One variance line: word, colour and number together. */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            gap: tokens.space[3],
          }}
        >
          <StatusPill
            kind={varianceKind}
            icon={variance === 0 ? "v" : "!"}
            label={`${t("closing.difference")} - ${varianceLabel}`}
          />
          <MoneyText amountMinor={variance} size="title" bangla={bangla} />
        </View>

        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder={t("closing.note")}
          accessibilityLabel={t("closing.note")}
          style={inputStyle}
        />

        {needsException ? (
          <View style={{ gap: tokens.space[2] }}>
            <StatusPill
              kind="warn"
              icon="!"
              label={t("closing.blockers", { count: blockers.length })}
            />
            <TextInput
              value={exceptionReason}
              onChangeText={setExceptionReason}
              placeholder={t("closing.exception_reason")}
              accessibilityLabel={t("closing.exception_reason")}
              style={inputStyle}
            />
          </View>
        ) : null}

        {error ? (
          <Text style={{ color: tokens.color.statusBad, fontSize: tokens.font.size.label }}>
            {error}
          </Text>
        ) : null}
      </ScrollView>

      <View
        style={{
          padding: tokens.space[4],
          paddingBottom: insets.bottom + tokens.space[4],
          backgroundColor: tokens.color.bg,
        }}
      >
        <PrimaryButton
          label={t("closing.close")}
          busy={post.isPending}
          disabled={counted.length === 0 || (needsException && exceptionReason.trim().length === 0)}
          onPress={close}
        />
      </View>
    </View>
  );
}

function Row({
  label,
  amountMinor,
  bangla,
  strong = false,
}: {
  label: string;
  amountMinor: number;
  bangla: boolean;
  strong?: boolean;
}) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: tokens.space[3] }}>
      <Text
        style={{
          fontSize: tokens.font.size.label,
          color: strong ? tokens.color.text : tokens.color.textMuted,
          fontWeight: strong ? "700" : "400",
        }}
      >
        {label}
      </Text>
      <MoneyText
        amountMinor={amountMinor}
        bangla={bangla}
        size={strong ? "title" : "body"}
        muted={!strong}
      />
    </View>
  );
}

const inputStyle = {
  minHeight: tokens.touchMin,
  borderRadius: tokens.radius.md,
  borderWidth: 1,
  borderColor: tokens.color.divider,
  backgroundColor: tokens.color.surface,
  paddingHorizontal: tokens.space[4],
  fontSize: tokens.font.size.body,
  color: tokens.color.text,
} as const;

export default function ClosingScreen() {
  return (
    <RoleGuard type="MERCHANT">
      <Closing />
    </RoleGuard>
  );
}
