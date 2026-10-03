/**
 * OfflineBanner — shows a dismissible warning strip when items are pending in the outbox.
 * Rendered once at the (app) layout level so it overlays every merchant/agent screen.
 *
 * States:
 *  - Hidden when queue is empty and not syncing.
 *  - Yellow "অফলাইন — N টি অপেক্ষমাণ" when queue has items.
 *  - Blue "সিঙ্ক হচ্ছে…" spinner while flushing.
 */

import { ActivityIndicator, Animated, Easing, Pressable, Text } from "react-native";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useOutboxStore, flushOutbox } from "../lib/outbox";
import { tokens } from "@bizflow/ui";

export function OfflineBanner() {
  const { t } = useTranslation();
  const items   = useOutboxStore((s) => s.items);
  const syncing = useOutboxStore((s) => s.syncing);

  const count   = items.length;
  const visible = count > 0 || syncing;

  // Slide-down animation
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(anim, {
      toValue: visible ? 1 : 0,
      duration: 250,
      easing: Easing.out(Easing.ease),
      useNativeDriver: true,
    }).start();
  }, [visible, anim]);

  const translateY = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [-48, 0],
  });

  if (!visible && !syncing && count === 0) return null;

  return (
    <Animated.View
      style={{
        transform: [{ translateY }],
        backgroundColor: syncing ? tokens.color.brandPrimary : "#D97706",
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 16,
        paddingVertical: 8,
        gap: 8,
      }}
      accessible
      accessibilityRole="alert"
    >
      {syncing ? (
        <ActivityIndicator size="small" color="#fff" />
      ) : (
        <Text style={{ fontSize: 16 }}>📶</Text>
      )}

      <Text
        style={{
          color: "#fff",
          fontFamily: "System",
          fontSize: 13,
          fontWeight: "600",
          flex: 1,
        }}
      >
        {syncing
          ? t("offline.syncing")
          : t("offline.pending", { count })}
      </Text>

      {!syncing && count > 0 && (
        <Pressable
          onPress={() => void flushOutbox()}
          hitSlop={8}
          accessibilityLabel={t("offline.retry_now")}
          style={({ pressed }) => ({
            opacity: pressed ? 0.7 : 1,
            paddingHorizontal: 8,
            paddingVertical: 4,
            backgroundColor: "rgba(0,0,0,0.2)",
            borderRadius: 6,
          })}
        >
          <Text style={{ color: "#fff", fontSize: 12, fontWeight: "700" }}>
            {t("offline.retry_now")}
          </Text>
        </Pressable>
      )}
    </Animated.View>
  );
}
