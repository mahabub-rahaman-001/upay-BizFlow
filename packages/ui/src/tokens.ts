/**
 * Design tokens - single source of truth, mirrors docs/04-ui-ux-design-system.md.
 * Placeholder palette: swap for the official upay brand before release, keep the roles.
 */
export const tokens = {
  color: {
    brandPrimary: "#123F67",
    brandPrimaryDark: "#0A2D4B",
    brandSoft: "#E8F0F5",
    brandWash: "#F2F7F9",
    actionPrimary: "#F2A900",
    actionPrimaryText: "#231900",
    bg: "#F3F5F4",
    surface: "#FFFFFF",
    surfaceMuted: "#EDF1F1",
    text: "#142329",
    textMuted: "#607078",
    statusGood: "#17704A",
    statusGoodBg: "#E2F3EA",
    statusWarn: "#9A5A05",
    statusWarnBg: "#FFF0CF",
    statusBad: "#A93A3A",
    statusBadBg: "#FBE8E5",
    aiTint: "#EAF2F1",
    aiBorder: "#27756D",
    manualTag: "#657078",
    verified: "#17704A",
    divider: "#DCE3E2",
  },
  dark: {
    bg: "#0B1220",
    surface: "#111A2E",
    text: "#F3F4F6",
    statusGood: "#4ADE80",
    statusWarn: "#FBBF24",
    statusBad: "#F87171",
  },
  radius: { sm: 8, md: 14, lg: 24, pill: 999 },
  space: [0, 4, 8, 12, 16, 24, 32, 48],
  font: {
    familyBn: "Hind Siliguri, Noto Sans Bengali",
    familyEn: "Inter",
    size: { caption: 13, label: 14, body: 16, title: 20, numberLg: 32, numberXl: 40 },
    lineHeightBn: 1.5,
  },
  touchMin: 48,
  buttonHeight: 56,
  motion: { fast: 150, normal: 250 },
} as const;

export type Tokens = typeof tokens;
