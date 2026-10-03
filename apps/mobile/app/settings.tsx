import { useState } from "react";
import { Linking, Pressable, ScrollView, Text, View } from "react-native";
import Constants from "expo-constants";
import { useRouter } from "expo-router";
import type { Href } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { Card, StatusPill, tokens } from "@bizflow/ui";
import { setAppLanguage, type AppLanguage } from "../lib/i18n";
import { useActiveBusiness, useIsOwner } from "../lib/session";
import { supabase } from "../lib/supabase";

const UPAY_HELP_URL = "https://www.upaybd.com/need-help";

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t, i18n } = useTranslation();
  const active = useActiveBusiness();
  const isOwner = useIsOwner();
  const canViewHistory = active?.type === "MERCHANT"
    || active?.role === "agent_owner"
    || active?.role === "manager";
  const [busyLanguage, setBusyLanguage] = useState<AppLanguage | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const language: AppLanguage = i18n.resolvedLanguage === "en" ? "en" : "bn";
  const appVersion = Constants.expoConfig?.version ?? "0.1.0";

  async function chooseLanguage(nextLanguage: AppLanguage) {
    if (nextLanguage === language || busyLanguage) return;
    setError(null);
    setBusyLanguage(nextLanguage);
    try {
      await setAppLanguage(nextLanguage);
    } catch {
      setError(t("settings.language_error"));
    } finally {
      setBusyLanguage(null);
    }
  }

  async function openSupport() {
    setError(null);
    try {
      await Linking.openURL(UPAY_HELP_URL);
    } catch {
      setError(t("settings.support_error"));
    }
  }

  async function logout() {
    if (loggingOut) return;
    setError(null);
    setLoggingOut(true);
    const { error: signOutError } = await supabase.auth.signOut({ scope: "local" });
    if (signOutError) {
      setError(t("settings.logout_error"));
      setLoggingOut(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: tokens.color.bg, paddingTop: insets.top }}>
      <Header title={t("settings.title")} onClose={() => router.back()} />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: tokens.space[4], paddingBottom: insets.bottom + tokens.space[6], gap: tokens.space[4] }}
      >
        <Card title={t("settings.business")}>
          <DetailRow label={t("settings.business_name")} value={active?.name ?? "—"} />
          <DetailRow
            label={t("settings.business_type")}
            value={t(active?.type === "AGENT" ? "settings.agent" : "settings.merchant")}
          />
          <DetailRow
            label={t("settings.upay_reference")}
            value={active?.upay_account_ref || t("settings.not_issued")}
          />
          <StatusPill
            kind={active?.verified ? "good" : "warn"}
            icon={active?.verified ? "✓" : "!"}
            label={t(active?.verified ? "settings.verified" : "settings.not_verified")}
          />
        </Card>

        <Card title={t("settings.language")}>
          <View accessibilityRole="radiogroup" style={{ flexDirection: "row", gap: tokens.space[2] }}>
            <LanguageButton label={t("settings.bangla")} selected={language === "bn"} disabled={!!busyLanguage} onPress={() => void chooseLanguage("bn")} />
            <LanguageButton label={t("settings.english")} selected={language === "en"} disabled={!!busyLanguage} onPress={() => void chooseLanguage("en")} />
          </View>
        </Card>

        <Card>
          {isOwner && active?.type === "MERCHANT" ? (
            <>
              <Pressable accessibilityRole="link" onPress={() => router.push("/reports" as Href)} style={rowButtonStyle}>
                <View style={{ flex: 1, gap: tokens.space[1] }}>
                  <Text style={rowTitleStyle}>{t("reports.title")}</Text>
                  <Text style={rowHintStyle}>{t("reports.settings_hint")}</Text>
                </View>
                <Text style={{ color: tokens.color.brandPrimary, fontSize: tokens.font.size.title }}>›</Text>
              </Pressable>
              <View style={{ height: 1, backgroundColor: tokens.color.divider }} />
            </>
          ) : null}
          {canViewHistory ? (
            <>
              <Pressable accessibilityRole="link" onPress={() => router.push("/history" as Href)} style={rowButtonStyle}>
                <View style={{ flex: 1, gap: tokens.space[1] }}>
                  <Text style={rowTitleStyle}>{t("history.title")}</Text>
                  <Text style={rowHintStyle}>{t(active?.type === "AGENT" ? "history.agent_hint" : "history.merchant_hint")}</Text>
                </View>
                <Text style={{ color: tokens.color.brandPrimary, fontSize: tokens.font.size.title }}>›</Text>
              </Pressable>
              <View style={{ height: 1, backgroundColor: tokens.color.divider }} />
            </>
          ) : null}
          <Pressable accessibilityRole="link" onPress={() => void openSupport()} style={rowButtonStyle}>
            <View style={{ flex: 1, gap: tokens.space[1] }}>
              <Text style={rowTitleStyle}>{t("settings.support")}</Text>
              <Text style={rowHintStyle}>{t("settings.support_hint")}</Text>
            </View>
            <Text style={{ color: tokens.color.brandPrimary, fontSize: tokens.font.size.title }}>›</Text>
          </Pressable>
          <View style={{ height: 1, backgroundColor: tokens.color.divider }} />
          <DetailRow label={t("settings.app_version")} value={appVersion} />
        </Card>

        {error ? <Text accessibilityRole="alert" style={{ color: tokens.color.statusBad }}>{error}</Text> : null}

        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: loggingOut, busy: loggingOut }}
          disabled={loggingOut}
          onPress={() => void logout()}
          style={{
            minHeight: tokens.buttonHeight,
            alignItems: "center",
            justifyContent: "center",
            borderWidth: 1,
            borderColor: tokens.color.statusBad,
            borderRadius: tokens.radius.md,
            opacity: loggingOut ? 0.6 : 1,
          }}
        >
          <Text style={{ color: tokens.color.statusBad, fontSize: tokens.font.size.body, fontWeight: "700" }}>
            {t("settings.logout")}
          </Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

function Header({ title, onClose }: { title: string; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: tokens.space[4], paddingVertical: tokens.space[2] }}>
      <Text accessibilityRole="header" style={{ flex: 1, color: tokens.color.text, fontSize: tokens.font.size.title, fontWeight: "700" }}>{title}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={t("common.close")} onPress={onClose} style={{ minWidth: tokens.touchMin, minHeight: tokens.touchMin, alignItems: "center", justifyContent: "center" }}>
        <Text style={{ color: tokens.color.textMuted, fontSize: tokens.font.size.title }}>×</Text>
      </Pressable>
    </View>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: tokens.space[3], minHeight: tokens.touchMin }}>
      <Text style={{ flex: 1, color: tokens.color.textMuted, fontSize: tokens.font.size.label }}>{label}</Text>
      <Text selectable style={{ flex: 1, textAlign: "right", color: tokens.color.text, fontSize: tokens.font.size.body, fontWeight: "600" }}>{value}</Text>
    </View>
  );
}

function LanguageButton({ label, selected, disabled, onPress }: { label: string; selected: boolean; disabled: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{
        flex: 1,
        minHeight: tokens.touchMin,
        alignItems: "center",
        justifyContent: "center",
        borderWidth: 1,
        borderColor: selected ? tokens.color.brandPrimary : tokens.color.divider,
        backgroundColor: selected ? tokens.color.aiTint : tokens.color.surface,
        borderRadius: tokens.radius.md,
        opacity: disabled && !selected ? 0.6 : 1,
      }}
    >
      <Text style={{ color: selected ? tokens.color.brandPrimary : tokens.color.text, fontSize: tokens.font.size.body, fontWeight: selected ? "700" : "400" }}>{label}</Text>
    </Pressable>
  );
}

const rowButtonStyle = { minHeight: tokens.touchMin, flexDirection: "row", alignItems: "center", gap: tokens.space[3] } as const;
const rowTitleStyle = { color: tokens.color.brandPrimary, fontSize: tokens.font.size.body, fontWeight: "700" } as const;
const rowHintStyle = { color: tokens.color.textMuted, fontSize: tokens.font.size.caption } as const;
