import { FlatList, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { MoneyText, StatusPill, tokens } from "@bizflow/ui";
import { RoleGuard } from "../components/RoleGuard";
import { AppIcon } from "../components/AppIcon";
import { Card, EmptyState, ErrorState, ListRow, Notice, Screen, ScreenHeader, SkeletonRows, type, useBangla } from "../components/kit";
import { useReviewQueue } from "../lib/api";
import { useFormatters, goBack } from "../lib/view";

const c = tokens.color;

/** Payments that need the owner's eye. An empty queue is the good state and says so. */
function Review() {
  const { t } = useTranslation();
  const router = useRouter();
  const bangla = useBangla();
  const fmt = useFormatters();
  const { data, isLoading, isError, refetch, isRefetching } = useReviewQueue();
  return (
    <Screen scroll={false} header={<ScreenHeader title={t("ux.f_review")} onBack={() => goBack(router)} />}>
      {isError ? <ErrorState onRetry={() => void refetch()} /> : (
        <FlatList
          data={data ?? []}
          keyExtractor={(item) => `${item.transaction_id}-${item.reason_code}`}
          refreshing={isRefetching}
          onRefresh={() => void refetch()}
          contentContainerStyle={{ padding: tokens.space[4], gap: tokens.space[2], width: "100%", maxWidth: 560, alignSelf: "center" }}
          ListHeaderComponent={
            <View style={{ gap: tokens.space[3], marginBottom: tokens.space[2] }}>
              <Card padded={false} style={{ paddingHorizontal: tokens.space[2] }}>
                <ListRow icon="refund" tone="brand" title={t("refund.title")} subtitle={t("refund.which")} onPress={() => router.push("/refund")} />
              </Card>
              {(data ?? []).length > 0 ? <Notice kind="info" title={t("insights.warn")} body={t("ux.insights_ai_note")} /> : null}
            </View>
          }
          ListEmptyComponent={isLoading ? <SkeletonRows /> : <EmptyState icon="closing" title={t("review.empty")} body={t("empty.review_sub")} />}
          renderItem={({ item }) => {
            const anomaly = item.reason_code === "ANOMALY";
            return (
              <Card style={{ gap: tokens.space[2] }}>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                  <StatusPill kind={anomaly ? "bad" : "warn"} compact icon={<AppIcon name={anomaly ? "alert" : "clock"} size={12} color={anomaly ? c.statusBad : c.statusWarn} />} label={t(anomaly ? "review.anomaly" : "review.pending")} />
                  <MoneyText amountMinor={Number(item.amount_minor)} bangla={bangla} size="title" />
                </View>
                <Text style={type.label}>{bangla ? item.reason_bn : anomaly ? "Unusual transaction" : "Awaiting settlement"}</Text>
                <Text style={type.caption}>{fmt.full.format(new Date(item.occurred_at))}</Text>
              </Card>
            );
          }}
        />
      )}
    </Screen>
  );
}

export default function ReviewScreen() {
  return <RoleGuard type="MERCHANT"><Review /></RoleGuard>;
}
