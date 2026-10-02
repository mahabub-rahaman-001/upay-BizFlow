import Svg, { Circle, Path, Rect } from "react-native-svg";

/**
 * One icon set for the whole app: 24 x 24 grid, round caps, one stroke weight. Every icon
 * is a concrete, familiar metaphor (docs/04 section 9) and is always shown with a word on
 * primary controls.
 */
const PATHS = {
  back: "M15 5l-7 7 7 7",
  close: "M6 6l12 12M18 6L6 18",
  chevron: "M9 5l7 7-7 7",
  "chevron-down": "M5 9l7 7 7-7",
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  check: "M5 12.5l4.5 4.5L19 7.5",
  search: "M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM15.5 15.5L21 21",
  bell: "M6 16.5h12l-1.6-2.6V10a4.4 4.4 0 0 0-8.8 0v3.9L6 16.5zM10 19.5a2 2 0 0 0 4 0",
  home: "M3.5 10.5L12 3.8l8.5 6.7M5.8 9.2v10.5h12.4V9.2M9.6 19.7v-5.6h4.8v5.6",
  transactions: "M4 8h14l-3.5-3.5M20 16H6l3.5 3.5",
  qr: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2.5v2.5H14zM17.5 17.5H20V20h-2.5zM14 18.5V20M20 14v1.5M6.5 6.5h1M16.5 6.5h1M6.5 16.5h1",
  books: "M5 4.5h10.5A3.5 3.5 0 0 1 19 8v11.5H7.5A2.5 2.5 0 0 1 5 17zM5 17a2.5 2.5 0 0 1 2.5-2.5H19M9 8.5h6",
  float: "M3.5 7.5h17v11h-17zM3.5 11h17M7 15h3M16 15h1.5",
  offers: "M4 4.5h7.2l8.8 8.8-6.7 6.7L4.5 11.2zM8.3 8.3h.01",
  settings: "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 2.8v2.4M12 18.8v2.4M4.2 7.5l2.1 1.2M17.7 15.3l2.1 1.2M4.2 16.5l2.1-1.2M17.7 8.7l2.1-1.2",
  store: "M4 9.5L5.6 4.5h12.8L20 9.5a2.4 2.4 0 0 1-4 1.6 2.4 2.4 0 0 1-4 0 2.4 2.4 0 0 1-4 0 2.4 2.4 0 0 1-4-1.6zM5.5 11.5v8h13v-8M9.5 19.5v-4.5h5v4.5",
  agent: "M12 4a3.3 3.3 0 1 0 0 6.6A3.3 3.3 0 0 0 12 4zM5.5 20a6.5 6.5 0 0 1 13 0M17.5 8.5h4M19.5 6.5v4",
  user: "M12 4a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM5 20a7 7 0 0 1 14 0",
  users: "M9 5a3.2 3.2 0 1 0 0 6.4A3.2 3.2 0 0 0 9 5zM3 19.5a6 6 0 0 1 12 0M16 5.4a3.2 3.2 0 0 1 0 6M18 14.2a6 6 0 0 1 3 5.3",
  wallet: "M4 7.5h15a1.5 1.5 0 0 1 1.5 1.5v9.5a1.5 1.5 0 0 1-1.5 1.5H5.5A1.5 1.5 0 0 1 4 18.5zM4 7.5l11-3.2V7.5M15.5 12h5v3.5h-5a1.75 1.75 0 0 1 0-3.5z",
  cash: "M3 6.5h18v11H3zM12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM6 9.5v.01M18 14.5v.01",
  digital: "M7 3h10a1.5 1.5 0 0 1 1.5 1.5v15A1.5 1.5 0 0 1 17 21H7a1.5 1.5 0 0 1-1.5-1.5v-15A1.5 1.5 0 0 1 7 3zM10.5 18h3",
  sale: "M5 8h14l-1 12H6zM8.5 9V7a3.5 3.5 0 0 1 7 0v2M9.5 14h5M12 11.5v5",
  expense: "M6 3.5h12v17l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4-2 1.4zM9 8h6M9 11.5h6M9 15h3",
  baki: "M5 4h11.5L19 6.5V20H5zM8.5 9h7M8.5 12.5h7M8.5 16h3.5M15.5 17.5l1.5 1.5 2.5-3",
  closing: "M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM8.5 12.2l2.4 2.4 4.8-5.2",
  suppliers: "M3 7.5h11v9.5H3zM14 10.5h3.5l3.5 3.5v3h-7zM7 17.2a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2zM17 17.2a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2z",
  planner: "M4 19.5h16M6.5 16v-4M11 16V8.5M15.5 16v-6M20 5l-4 3.5-3-2L8.5 9",
  audit: "M8 3.5h8v3H8zM6 5H5v15.5h14V5h-1M8.5 13l2.3 2.3 4.7-4.8",
  commission: "M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM9 15l6-6M9.3 9.3h.01M14.7 14.7h.01",
  reports: "M6 3.5h8.5L18 7v13.5H6zM14 3.5V7.5h4M9 17v-3M12 17v-6M15 17v-4",
  review: "M4.5 12s2.8-5.5 7.5-5.5 7.5 5.5 7.5 5.5-2.8 5.5-7.5 5.5S4.5 12 4.5 12zM12 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4z",
  refund: "M9 7H5V3M5.4 7A8 8 0 1 1 4 12.5M12 8.5v7M14.5 10H11a1.5 1.5 0 0 0 0 3h2a1.5 1.5 0 0 1 0 3H9.5",
  history: "M4 12a8 8 0 1 0 2.4-5.7L4 8.5M4 4v4.5h4.5M12 8v4.5l3 1.8",
  alert: "M12 4L2.8 19.5h18.4zM12 10v4.2M12 17v.01",
  info: "M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM12 11v5M12 8v.01",
  lock: "M6 10.5h12v10H6zM8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3M12 14.5v2",
  key: "M7.5 8.5a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM11.5 12.5H21M17.5 12.5v3M20.5 12.5v2.5",
  shield: "M12 3l7 3v5.5c0 4.5-3 7.8-7 9.5-4-1.7-7-5-7-9.5V6zM9 12l2 2 4-4",
  eye: "M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM12 9.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6z",
  "eye-off": "M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM12 9.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6zM4 4l16 16",
  pen: "M4 20l1-4.5L15.5 5a2.1 2.1 0 0 1 3 3L8 18.5zM13.5 7l3 3",
  verified: "M12 3l2.2 1.6 2.7-.2.9 2.6 2.2 1.6-.9 2.6.9 2.6-2.2 1.6-.9 2.6-2.7-.2L12 21l-2.2-1.6-2.7.2-.9-2.6-2.2-1.6.9-2.6-.9-2.6 2.2-1.6.9-2.6 2.7.2zM8.8 12l2.2 2.2 4.2-4.4",
  "arrow-in": "M17 7L7 17M7 9v8h8",
  "arrow-out": "M7 17L17 7M9 7h8v8",
  send: "M4 12l16-7-6 15-2.5-6.5zM11.5 13.5L20 5",
  share: "M12 15V3.5M7.5 8L12 3.5 16.5 8M5 13v6.5h14V13",
  phone: "M5 3.5h4l1.5 4-2.2 1.4a11 11 0 0 0 6.8 6.8l1.4-2.2 4 1.5v4a1.5 1.5 0 0 1-1.6 1.5A16.5 16.5 0 0 1 3.5 5.1 1.5 1.5 0 0 1 5 3.5z",
  help: "M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM9.6 9.5a2.5 2.5 0 1 1 3.4 2.3c-.7.3-1 .8-1 1.5v.7M12 17v.01",
  language: "M4 5.5h9M8.5 3.5v2M6 5.5c.5 3 2.7 5.5 5.5 6.5M11 5.5c-.6 3.6-3 6.4-6.5 7.5M12.5 20.5l4-9.5 4 9.5M13.8 17.5h5.4",
  logout: "M14 4.5H5.5v15H14M10 12h10.5M17 8.5l3.5 3.5-3.5 3.5",
  calendar: "M4.5 6h15v14h-15zM8 3.5v4M16 3.5v4M4.5 10h15",
  clock: "M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM12 7.5V12l3 2",
  "trending-up": "M3.5 17l6-6 4 4 7-8M15 7h5.5v5.5",
  "trending-down": "M3.5 7l6 6 4-4 7 8M15 17h5.5v-5.5",
  "bar-chart": "M5 20v-8M12 20V5M19 20v-5",
  sparkle: "M12 3.5l1.6 4.9 4.9 1.6-4.9 1.6L12 16.5l-1.6-4.9L5.5 10l4.9-1.6zM18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z",
  gift: "M4 9.5h16v3.5H4zM5.5 13v7h13v-7M12 9.5V20M12 9.5S10.8 5 8.5 5a2.2 2.2 0 0 0 0 4.5M12 9.5S13.2 5 15.5 5a2.2 2.2 0 0 1 0 4.5",
  percent: "M18 6L6 18M7.5 5.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM16.5 14.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4z",
  taka: "M7 4.5c1.8 0 3 1 3 3V16a3.5 3.5 0 0 0 7 0v-1.5M6 10h8M15.5 14.5h.01",
  stamp: "M9 4.5h6l-1 6h-4zM5 14h14v3.5H5zM6.5 20.5h11",
  mic: "M12 3.5a3 3 0 0 0-3 3V12a3 3 0 0 0 6 0V6.5a3 3 0 0 0-3-3zM6 11.5a6 6 0 0 0 12 0M12 17.5v3",
  volume: "M4.5 9.5h3.5L13 5.5v13l-5-4H4.5zM16.5 9a4 4 0 0 1 0 6M18.8 6.5a7.5 7.5 0 0 1 0 11",
  "wifi-off": "M3.5 3.5l17 17M8.7 9.4A10 10 0 0 0 4 12M19.9 12a10 10 0 0 0-6.1-3M7.3 15.2a6 6 0 0 1 6.8-.8M12 19v.01",
  refresh: "M19.5 8.5A8 8 0 0 0 5 9M4.5 15.5A8 8 0 0 0 19 15M19.5 4v4.5H15M4.5 20v-4.5H9",
  pause: "M8.5 5.5v13M15.5 5.5v13",
  play: "M8 5l11 7-11 7z",
  stop: "M6.5 6.5h11v11h-11z",
  filter: "M4 6h16M7 12h10M10 18h4",
  copy: "M8.5 8.5h11v11h-11zM5.5 15.5h-1v-11h11v1",
  backspace: "M9 5.5h11v13H9L3.5 12zM12.5 9.5l5 5M17.5 9.5l-5 5",
  bank: "M4 9.5L12 4.5l8 5M5.5 10v7.5M9.5 10v7.5M14.5 10v7.5M18.5 10v7.5M3.5 20h17",
  coins: "M9 5c3 0 5.5 1 5.5 2.5S12 10 9 10 3.5 9 3.5 7.5 6 5 9 5zM3.5 7.5v4C3.5 13 6 14 9 14M3.5 11.5v4C3.5 17 6 18 9 18M14.5 11c3 0 5.5 1 5.5 2.5s-2.5 2.5-5.5 2.5S9 15 9 13.5 11.5 11 14.5 11zM9 13.5v3.5c0 1.5 2.5 2.5 5.5 2.5s5.5-1 5.5-2.5v-3.5",
  receipt: "M6 3.5h12v17l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4-2 1.4zM9 8.5h6M9 12h6",
  "alert-triangle": "M12 4L2.8 19.5h18.4zM12 10v4.2M12 17v.01",
  more: "M6 12h.01M12 12h.01M18 12h.01",
  grid: "M4.5 4.5h6v6h-6zM13.5 4.5h6v6h-6zM4.5 13.5h6v6h-6zM13.5 13.5h6v6h-6z",
  "cash-in": "M3 7h18v10H3zM12 9.5v5M9.8 12.3L12 14.5l2.2-2.2",
  "cash-out": "M3 7h18v10H3zM12 14.5v-5M9.8 11.7L12 9.5l2.2 2.2",
} as const;

export type AppIconName = keyof typeof PATHS;

interface AppIconProps {
  name: AppIconName;
  color?: string;
  size?: number;
  strokeWidth?: number;
}

export function AppIcon({ name, color = "#13212B", size = 24, strokeWidth = 1.8 }: AppIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d={PATHS[name]} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

/** Insight icon names arrive from the server; unknown names fall back to a neutral mark. */
export function isAppIconName(name: string): name is AppIconName {
  return Object.prototype.hasOwnProperty.call(PATHS, name);
}

/** A filled dot used by status rows and the live-balance marker. */
export function Dot({ color, size = 8 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 8 8">
      <Circle cx={4} cy={4} r={4} fill={color} />
    </Svg>
  );
}

/** The BizFlow mark: a ledger page with a rising line, in a rounded square. */
export function BrandMark({ size = 40, color = "#FFFFFF", background = "#0F3D6E" }: { size?: number; color?: string; background?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 40 40">
      <Rect x={0} y={0} width={40} height={40} rx={12} fill={background} />
      <Path d="M12 10.5h12.5L28 14v15.5H12z" fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
      <Path d="M15.5 24.5l3.5-3.5 2.5 2.5 3.5-4.5" fill="none" stroke="#F5A800" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}
