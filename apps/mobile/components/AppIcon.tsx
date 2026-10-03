import Svg, { Circle, Line, Path, Rect } from "react-native-svg";

export type AppIconName =
  | "back"
  | "eye"
  | "eye-off"
  | "lock"
  | "search"
  | "bell"
  | "agent"
  | "alert"
  | "audit"
  | "books"
  | "cash"
  | "chevron"
  | "closing"
  | "commission"
  | "digital"
  | "expense"
  | "home"
  | "offers"
  | "planner"
  | "qr"
  | "reports"
  | "sale"
  | "settings"
  | "store"
  | "suppliers"
  | "transactions"
  | "wallet";

interface AppIconProps {
  name: AppIconName;
  color?: string;
  size?: number;
  strokeWidth?: number;
}

/** A small, dependency-free icon set with one visual weight across the app shell. */
export function AppIcon({ name, color = "currentColor", size = 24, strokeWidth = 1.8 }: AppIconProps) {
  const common = {
    fill: "none",
    stroke: color,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth,
  };

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden>
      {name === "back" ? <Path {...common} d="m14 5-7 7 7 7M7 12h14" /> : null}
      {name === "eye" || name === "eye-off" ? <><Path {...common} d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z" /><Circle {...common} cx="12" cy="12" r="3" />{name === "eye-off" ? <Path {...common} d="m3 3 18 18" /> : null}</> : null}
      {name === "lock" ? <><Rect {...common} x="5" y="10" width="14" height="11" rx="2" /><Path {...common} d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" /></> : null}
      {name === "search" ? <><Circle {...common} cx="10" cy="10" r="6.5" /><Path {...common} d="m15 15 6 6" /></> : null}
      {name === "bell" ? <><Path {...common} d="M5 17h14l-2-4V9A5 5 0 0 0 7 9v4l-2 4ZM10 20h4M12 2v2" /></> : null}
      {name === "home" ? <><Path {...common} d="M3.5 10.5 12 3.8l8.5 6.7" /><Path {...common} d="M5.8 9.2v10.5h12.4V9.2M9.3 19.7v-6.2h5.4v6.2" /></> : null}
      {name === "transactions" ? <><Path {...common} d="M5 7h13l-3-3M19 17H6l3 3" /><Path {...common} d="m18 7-3 3M6 17l3-3" /></> : null}
      {name === "qr" ? <><Rect {...common} x="3.5" y="3.5" width="6" height="6" rx="1" /><Rect {...common} x="14.5" y="3.5" width="6" height="6" rx="1" /><Rect {...common} x="3.5" y="14.5" width="6" height="6" rx="1" /><Path {...common} d="M14.5 14.5h2.5v2.5h3.5v3.5h-6v-2.7M20.5 12.5v2" /></> : null}
      {name === "books" ? <><Path {...common} d="M5 4.5h10a3 3 0 0 1 3 3v12H7a2 2 0 0 1-2-2z" /><Path {...common} d="M8 4.5v15M11 9h4M11 13h4" /></> : null}
      {name === "offers" ? <><Path {...common} d="M4 7.2V4h3.2l12.3 12.3-3.2 3.2L4 7.2Z" /><Circle {...common} cx="7" cy="7" r="1" /></> : null}
      {name === "settings" ? <><Circle {...common} cx="12" cy="12" r="3" /><Path {...common} d="M19 13.5v-3l-2-.7a6.5 6.5 0 0 0-.7-1.6l.9-1.9-2.1-2.1-1.9.9a6.5 6.5 0 0 0-1.6-.7L10.5 2h-3l-.7 2a6.5 6.5 0 0 0-1.6.7l-1.9-.9-2.1 2.1.9 1.9a6.5 6.5 0 0 0-.7 1.6l-2 .7v3l2 .7c.2.6.4 1.1.7 1.6l-.9 1.9 2.1 2.1 1.9-.9c.5.3 1 .5 1.6.7l.7 2h3l.7-2c.6-.2 1.1-.4 1.6-.7l1.9.9 2.1-2.1-.9-1.9c.3-.5.5-1 .7-1.6z" transform="translate(3 0) scale(.75)" /></> : null}
      {name === "store" ? <><Path {...common} d="M4 9.2 5.6 4h12.8L20 9.2a2.3 2.3 0 0 1-4 1.5 2.3 2.3 0 0 1-4 0 2.3 2.3 0 0 1-4 0 2.3 2.3 0 0 1-4-1.5Z" /><Path {...common} d="M5.5 11.2V20h13v-8.8M9 20v-5h6v5" /></> : null}
      {name === "agent" ? <><Circle {...common} cx="12" cy="8" r="3.2" /><Path {...common} d="M5.5 20a6.5 6.5 0 0 1 13 0M18.5 5.5l2 2M20.5 5.5l-2 2" /></> : null}
      {name === "wallet" ? <><Rect {...common} x="3" y="6" width="18" height="13" rx="3" /><Path {...common} d="M3.7 8.5 16 4.5M15 11h6v4h-6a2 2 0 0 1 0-4Z" /></> : null}
      {name === "cash" ? <><Rect {...common} x="3" y="5" width="18" height="14" rx="2" /><Circle {...common} cx="12" cy="12" r="3" /><Path {...common} d="M6 8h.1M18 16h.1" /></> : null}
      {name === "digital" ? <><Rect {...common} x="6" y="2.8" width="12" height="18.4" rx="2.5" /><Path {...common} d="M9 6h6M10 18h4" /></> : null}
      {name === "sale" ? <><Path {...common} d="M5 8h14l-1 12H6L5 8Z" /><Path {...common} d="M8.5 9V6.5a3.5 3.5 0 0 1 7 0V9M9 14h6M12 11v6" /></> : null}
      {name === "expense" ? <><Path {...common} d="M5 4h14v16H5zM8 8h8M8 12h5M8 16h3" /><Path {...common} d="m15 14 3 3M18 14v3h-3" /></> : null}
      {name === "closing" ? <><Circle {...common} cx="12" cy="12" r="8.5" /><Path {...common} d="m8.5 12 2.2 2.2 4.8-5M12 3.5v2M12 18.5v2" /></> : null}
      {name === "suppliers" ? <><Path {...common} d="M3 8h11v9H3zM14 11h3l3 3v3h-6z" /><Circle {...common} cx="7" cy="18.5" r="1.5" /><Circle {...common} cx="17" cy="18.5" r="1.5" /></> : null}
      {name === "planner" ? <><Rect {...common} x="3.5" y="5" width="17" height="15" rx="2" /><Path {...common} d="M7 3v4M17 3v4M3.5 9h17M7 13h3M7 16h6" /></> : null}
      {name === "audit" ? <><Path {...common} d="M7 3h10v3H7zM5 5h14v16H5z" /><Path {...common} d="m8 13 2.2 2.2L16 9.5" /></> : null}
      {name === "commission" ? <><Circle {...common} cx="12" cy="12" r="8.5" /><Path {...common} d="M9 15 15 9M9.2 9.2h.1M14.7 14.7h.1" /></> : null}
      {name === "reports" ? <><Path {...common} d="M5 3h10l4 4v14H5zM15 3v5h4" /><Path {...common} d="M8 16v-3M12 16V9M16 16v-5" /></> : null}
      {name === "alert" ? <><Path {...common} d="M12 3.5 21 20H3z" /><Line {...common} x1="12" y1="9" x2="12" y2="14" /><Circle fill={color} cx="12" cy="17" r=".8" /></> : null}
      {name === "chevron" ? <Path {...common} d="m9 5 7 7-7 7" /> : null}
    </Svg>
  );
}
