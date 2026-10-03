import { RefreshControl, Text, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import { useTranslation } from "react-i18next";
import { tokens } from "@bizflow/ui";
import { isAppIconName } from "../components/AppIcon";
import { Card, EmptyState, IconTile, Notice, Screen, ScreenHeader, SkeletonRows, TextLink, type, useBangla, type Tone } from "../components/kit";
import { useTodayInsights } from "../lib/api";
import { goBack } from "../lib/view";

const TONE: Record<string, Tone> = { bad: "bad", warn: "warn", good: "good", info: "ai" };

/**
 * Notifications. There is no notifications table yet (docs/16 section 7), so this lists
 * today's insights, most urgent first, each with its way in.
 */
export default function Notifications() {
  const { t } = useTranslation();
  const router = useRouter();
  const bangla = useBangla();
  const insights = useTodayInsights();
  const cards = insights.data?.cards ?? [];
  return (
    <Screen header={<ScreenHeader title={t("ux.notifications")} onBack={() => goBack(router)} />} refreshControl={<RefreshControl refreshing={insights.isRefetching} onRefresh={() => void insights.refetch()} tintColor={tokens.color.brandPrimary} />}>
      {insights.isLoading ? <SkeletonRows /> : cards.length === 0 ? <EmptyState icon="bell" title={t("ux.no_notifications")} /> : (
        <View style={{ gap: tokens.space[2] }}>
          <Notice kind="ai" title={t("ux.insights_ai_note")} />
          {cards.map((card) => (
            <Card key={card.id} style={{ flexDirection: "row", gap: tokens.space[3] }}>
              <IconTile name={isAppIconName(card.icon) ? card.icon : "bell"} tone={TONE[card.severity] ?? "ai"} size={42} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={type.label}>{bangla ? card.title_bn : card.title_en}</Text>
                <Text style={[type.body, { fontSize: 15 }]}>{bangla ? card.body_bn : card.body_en}</Text>
                {card.action_route ? <View style={{ alignSelf: "flex-start" }}><TextLink label={t("ux.open")} trailingIcon="chevron" onPress={() => router.push(card.action_route as Href)} /></View> : null}
              </View>
            </Card>
          ))}
        </View>
      )}
    </Screen>
  );
}
