/**
 * EmptyState & ErrorState — reusable components for all list screens.
 *
 * EmptyState: shows an emoji illustration + title + subtitle + optional CTA button.
 * ErrorState: shows error message + retry button.
 *
 * Both are stateless; callers pass translated strings (use t("empty.transactions") etc).
 */

import { Pressable, Text, View } from "react-native";
import { tokens } from "@bizflow/ui";
import { useTranslation } from "react-i18next";

// ─── EmptyState ──────────────────────────────────────────────────────────────

interface EmptyStateProps {
  /** Large illustrative emoji (e.g. "📭", "🏷️", "👤") */
  icon?: string;
  title: string;
  subtitle?: string;
  /** If provided, renders a primary CTA button */
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({
  icon = "📭",
  title,
  subtitle,
  actionLabel,
  onAction,
}: EmptyStateProps) {
  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        padding: tokens.space[6],
        gap: tokens.space[3],
      }}
      accessibilityRole="text"
    >
      <Text
        style={{ fontSize: 56, lineHeight: 64, textAlign: "center" }}
        accessibilityElementsHidden
      >
        {icon}
      </Text>

      <Text
        style={{
          fontSize: tokens.font.size.title,
          fontWeight: "700",
          color: tokens.color.text,
          textAlign: "center",
        }}
      >
        {title}
      </Text>

      {subtitle ? (
        <Text
          style={{
            fontSize: tokens.font.size.body,
            color: tokens.color.textMuted,
            textAlign: "center",
            lineHeight: 22,
          }}
        >
          {subtitle}
        </Text>
      ) : null}

      {actionLabel && onAction ? (
        <Pressable
          onPress={onAction}
          style={({ pressed }) => ({
            marginTop: tokens.space[2],
            paddingHorizontal: tokens.space[6],
            paddingVertical: 14,
            borderRadius: tokens.radius.md,
            backgroundColor: tokens.color.actionPrimary,
            opacity: pressed ? 0.8 : 1,
          })}
          accessibilityRole="button"
        >
          <Text
            style={{
              color: tokens.color.actionPrimaryText,
              fontWeight: "700",
              fontSize: tokens.font.size.body,
            }}
          >
            {actionLabel}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

// ─── ErrorState ──────────────────────────────────────────────────────────────

interface ErrorStateProps {
  /** Defaults to t("error.generic") */
  message?: string;
  onRetry?: () => void;
}

export function ErrorState({ message, onRetry }: ErrorStateProps) {
  const { t } = useTranslation();

  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        padding: tokens.space[6],
        gap: tokens.space[3],
      }}
      accessibilityRole="alert"
    >
      <Text style={{ fontSize: 48 }} accessibilityElementsHidden>⚠️</Text>

      <Text
        style={{
          fontSize: tokens.font.size.body,
          color: tokens.color.statusBad,
          textAlign: "center",
          fontWeight: "600",
        }}
      >
        {message ?? t("error.generic")}
      </Text>

      {onRetry ? (
        <Pressable
          onPress={onRetry}
          style={({ pressed }) => ({
            paddingHorizontal: tokens.space[5],
            paddingVertical: 12,
            borderRadius: tokens.radius.md,
            borderWidth: 1.5,
            borderColor: tokens.color.statusBad,
            opacity: pressed ? 0.7 : 1,
          })}
          accessibilityRole="button"
        >
          <Text style={{ color: tokens.color.statusBad, fontWeight: "700" }}>
            {t("error.retry")}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

// ─── NetworkErrorState ────────────────────────────────────────────────────────
/** Convenience variant shown when a query fails due to network. */
export function NetworkErrorState({ onRetry }: { onRetry?: () => void }) {
  const { t } = useTranslation();
  return <ErrorState message={t("error.network")} onRetry={onRetry} />;
}
