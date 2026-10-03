import { useEffect } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { Redirect, Tabs } from "expo-router";
import { useTranslation } from "react-i18next";
import { tokens } from "@bizflow/ui";
import { useMe } from "../../lib/api";
import { useActiveBusiness, useSession } from "../../lib/session";
import { hydrateOutbox, startOutboxListener, stopOutboxListener } from "../../lib/outbox";
import { OfflineBanner } from "../../components/OfflineBanner";
import { AppIcon, type AppIconName } from "../../components/AppIcon";

/**
 * The shell. Five fixed bottom tabs with icon and label both (docs/04 section 5): an icon
 * alone fails a low-literacy user and a label alone fails a user in a hurry, so every tab
 * carries both. The set differs by business type, and nothing here is a permission - the
 * database re-checks role on every call.
 */
export default function AppLayout() {
  const { t } = useTranslation();
  const { isLoading, isError } = useMe();
  const businesses = useSession((s) => s.businesses);
  const active = useActiveBusiness();
  const setActiveBusiness = useSession((s) => s.setActiveBusiness);

  // Land on the first business the user owns until they switch.
  useEffect(() => {
    if (!active && businesses[0]) {
      setActiveBusiness(businesses[0].business_id);
    }
  }, [active, businesses, setActiveBusiness]);

  // Offline outbox: hydrate from storage once and listen for reconnects.
  useEffect(() => {
    void hydrateOutbox();
    startOutboxListener();
    return () => stopOutboxListener();
  }, []);

  if (isLoading) {
    return <Centered>{<ActivityIndicator color={tokens.color.brandPrimary} />}</Centered>;
  }

  if (isError) {
    return (
      <Centered>
        <Text style={{ color: tokens.color.statusBad, fontSize: tokens.font.size.body }}>
          {t("posting_error.UNKNOWN")}
        </Text>
      </Centered>
    );
  }

  // Signed in but with no business yet: onboarding comes before the shell.
  if (businesses.length === 0) {
    return <Redirect href="/onboarding" />;
  }

  const isAgent = active?.type === "AGENT";

  return (
    <View style={{ flex: 1 }}>
      <OfflineBanner />
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: tokens.color.brandPrimary,
          tabBarInactiveTintColor: tokens.color.textMuted,
          tabBarStyle: {
            backgroundColor: tokens.color.surface,
            borderTopColor: tokens.color.divider,
            height: 70,
            paddingTop: 7,
            shadowColor: tokens.color.brandPrimaryDark,
            shadowOpacity: 0.08,
            shadowRadius: 12,
            shadowOffset: { width: 0, height: -4 },
            elevation: 8,
          },
          tabBarLabelStyle: { fontSize: 11, fontWeight: "600", marginTop: 2 },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{ title: t("nav.home"), tabBarIcon: ({ color }) => <TabIcon name="home" color={String(color)} /> }}
        />
        <Tabs.Screen
          name="transactions"
          options={{ title: t("nav.transactions"), tabBarIcon: ({ color }) => <TabIcon name="transactions" color={String(color)} /> }}
        />
        <Tabs.Screen
          name="receive"
          options={{ title: t("nav.receive"), tabBarIcon: () => <TabIcon name="qr" color={tokens.color.actionPrimaryText} raised /> }}
        />
        <Tabs.Screen
          name="books"
          options={{
            title: isAgent ? t("nav.float") : t("nav.books"),
            tabBarIcon: ({ color }) => <TabIcon name="books" color={String(color)} />,
          }}
        />
        <Tabs.Screen
          name="offers"
          options={{ title: t("nav.offers"), tabBarIcon: ({ color }) => <TabIcon name="offers" color={String(color)} /> }}
        />
      </Tabs>
    </View>
  );
}

/**
 * The centre receive action stays raised and the icon positions stay stable across roles.
 */
function TabIcon({ name, color, raised = false }: { name: AppIconName; color: string; raised?: boolean }) {
  return (
    <View
      style={{
        width: raised ? 46 : 28,
        height: raised ? 46 : 28,
        borderRadius: raised ? 16 : 0,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: raised ? tokens.color.actionPrimary : "transparent",
        marginTop: raised ? -14 : 0,
        shadowColor: raised ? tokens.color.brandPrimaryDark : "transparent",
        shadowOpacity: raised ? 0.18 : 0,
        shadowRadius: raised ? 8 : 0,
        shadowOffset: { width: 0, height: 4 },
        elevation: raised ? 4 : 0,
      }}
    >
      <AppIcon name={name} color={color} size={raised ? 25 : 23} strokeWidth={raised ? 2 : 1.8} />
    </View>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: tokens.color.bg,
        padding: tokens.space[4],
      }}
    >
      {children}
    </View>
  );
}
