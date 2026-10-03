import { RoleGuard } from "../components/RoleGuard";
import { useMemo } from "react";
import { ActivityIndicator, FlatList, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { EmptyState, MoneyText, StatusPill, tokens } from "@bizflow/ui";
import { useReviewQueue } from "../lib/api";

/**
 * Review queue (docs/07 section 7). The short list of things that need the owner's eye -
 * payments still waiting to settle, and anything the AI flagged as unusual. An empty queue
 * is the good state, and the screen says so rather than showing a blank.
 *
 * Owner and manager only; the RPC enforces that, this screen just renders what comes back.
 */
function Review() {
  const insets = useSafeAreaInsets();
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const bangla = i18n.language === "bn";
  const { data, isLoading, isError, refetch, isRefetching } = useReviewQueue();

  const timeFormatter = useMemo(
    () => new Intl.DateTimeFormat(bangla ? "bn-BD" : "en-GB", {
      day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Dhaka",
    }),
    [bangla],
  );

  return (
    <View style={{ flex: 1, backgroundColor: tokens.color.bg, paddingTop: insets.top + tokens.space[3] }}>
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: tokens.space[4] }}>
        <Text style={{ flex: 1, fontSize: tokens.font.size.title, fontWeight: "700", color: tokens.color.text }}>
          {t("review.title")}
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

      {isLoading ? (
        <ActivityIndicator color={tokens.color.brandPrimary} style={{ marginTop: tokens.space[6] }} />
      ) : isError ? (
        <Text style={{ color: tokens.color.statusBad, padding: tokens.space[4] }}>
          {t("posting_error.UNKNOWN")}
        </Text>
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(item) => `${item.transaction_id}-${item.reason_code}`}
          refreshing={isRefetching}
          onRefresh={() => void refetch()}
          contentContainerStyle={{ padding: tokens.space[4], gap: tokens.space[2] }}
          ListHeaderComponent={
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push("/refund")}
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                backgroundColor: tokens.color.surface,
                borderRadius: tokens.radius.md,
                padding: tokens.space[4],
                minHeight: tokens.touchMin,
                marginBottom: tokens.space[2],
              }}
            >
              <Text style={{ fontSize: tokens.font.size.body, color: tokens.color.text }}>
                {t("refund.title")}
              </Text>
              <Text style={{ color: tokens.color.brandPrimary, fontWeight: "700" }}>{">"}</Text>
            </Pressable>
          }
          ListEmptyComponent={
            <EmptyState message={t("review.empty")} />
          }
          renderItem={({ item }) => (
            <View
              style={{
                backgroundColor: tokens.color.surface,
                borderRadius: tokens.radius.md,
                padding: tokens.space[4],
                gap: tokens.space[2],
              }}
            >
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <StatusPill
                  kind={item.reason_code === "ANOMALY" ? "bad" : "warn"}
                  icon="!"
                  label={item.reason_code === "ANOMALY" ? t("review.anomaly") : t("review.pending")}
                />
                <MoneyText amountMinor={Number(item.amount_minor)} bangla={bangla} />
              </View>
              <Text style={{ fontSize: tokens.font.size.label, color: tokens.color.text }}>
                {bangla ? item.reason_bn : (item.reason_code === "ANOMALY" ? "Unusual transaction" : "Awaiting settlement")}
              </Text>
              <Text style={{ fontSize: tokens.font.size.caption, color: tokens.color.textMuted }}>
                {timeFormatter.format(new Date(item.occurred_at))}
              </Text>
            </View>
          )}
        />
      )}
    </View>
  );
}

export default function ReviewScreen() {
  return (
    <RoleGuard type="MERCHANT">
      <Review />
    </RoleGuard>
  );
}
