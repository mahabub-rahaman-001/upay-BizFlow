/**
 * Design tokens - single source of truth, mirrors docs/04-ui-ux-design-system.md and the
 * redesign in docs/16. Placeholder palette: swap for the official upay brand before
 * release, keep the roles.
 *
 * Roles, not colours:
 * - brand*   structure: headers, the balance hero, selected states
 * - action*  the one amber primary button a screen may have
 * - status*  good / warn / bad, always paired with an icon and a word
 * - manual*  the warm "paper khata" look of a hand-written record
 * - ai*      the restrained teal of machine-written advice
 */
export const tokens = {
  color: {
    brandPrimary: "#0F3D6E",
    brandPrimaryDark: "#0A2B4E",
    brandDeep: "#0B3159",
    brandSoft: "#E4EDF7",
    brandWash: "#F1F5FA",
    onBrand: "#FFFFFF",
    onBrandMuted: "#C3D5E8",
    actionPrimary: "#F5A800",
    actionPrimaryText: "#2A1D00",
    bg: "#F4F5F2",
    surface: "#FFFFFF",
    surfaceMuted: "#ECEFEE",
    text: "#13212B",
    textMuted: "#5B6872",
    statusGood: "#17704A",
    statusGoodBg: "#E2F3E9",
    statusWarn: "#965606",
    statusWarnBg: "#FFF0CF",
    statusBad: "#A93636",
    statusBadBg: "#FBE8E5",
    aiTint: "#E8F3F1",
    aiBorder: "#25726A",
    manualTag: "#7A5520",
    manualTint: "#FBF4E7",
    manualBorder: "#EBDABB",
    verified: "#17704A",
    divider: "#E0E5E3",
    scrim: "rgba(10, 30, 50, 0.45)",
  },
  dark: {
    bg: "#0B1220",
    surface: "#111A2E",
    text: "#F3F4F6",
    statusGood: "#4ADE80",
    statusWarn: "#FBBF24",
    statusBad: "#F87171",
  },
  radius: { sm: 10, md: 14, lg: 20, xl: 28, pill: 999 },
  space: [0, 4, 8, 12, 16, 24, 32, 48],
  font: {
    familyBn: "Hind Siliguri, Noto Sans Bengali",
    familyEn: "Inter",
    size: { caption: 13, label: 14, body: 16, title: 20, numberLg: 32, numberXl: 40 },
    lineHeightBn: 1.5,
  },
  /** One light source, from above; shadows carry the brand hue instead of pure black. */
  shadow: {
    card: {
      shadowColor: "#0A2B4E",
      shadowOpacity: 0.06,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 4 },
      elevation: 2,
    },
    raised: {
      shadowColor: "#0A2B4E",
      shadowOpacity: 0.16,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 8 },
      elevation: 6,
    },
  },
  touchMin: 48,
  buttonHeight: 56,
  /**
   * The motion system (docs/16 section 8). Every animation in the app uses these values;
   * no screen invents its own timing.
   */
  motion: {
    press: 100,
    fast: 150,
    normal: 220,
    standard: 220,
    sheet: 280,
    success: 350,
    pressScale: 0.98,
    pressScalePrimary: 0.97,
  },
} as const;

export type Tokens = typeof tokens;
