import Svg, { Path } from "react-native-svg";
import { tokens } from "@bizflow/ui";

const paths: Record<string, string> = {
  "trending-up": "M3 17l6-6 4 4 8-10M15 5h6v6",
  "bar-chart": "M4 20V10M12 20V4M20 20v-7",
  wallet: "M3 6h18v14H3zM3 6V3h15v3M21 11h-6v5h6",
  clock: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M12 7v5l3 2",
  "alert-triangle": "M12 3L2 21h20zM12 9v5M12 17v1",
  users: "M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8M2 21v-3a7 7 0 0 1 14 0v3M17 4a4 4 0 0 1 0 8M19 15a5 5 0 0 1 3 5",
  calendar: "M3 5h18v16H3zM7 2v6M17 2v6M3 11h18",
};

export function InsightIcon({ name }: { name: string }) {
  return <Svg width={24} height={24} viewBox="0 0 24 24" accessible={false}><Path d={paths[name] ?? paths.calendar} fill="none" stroke={tokens.color.brandPrimary} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" /></Svg>;
}
