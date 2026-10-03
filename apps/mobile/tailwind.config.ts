// Tailwind theme generated from the shared design tokens so the palette has one source.
//
// This reaches straight for the tokens module rather than the package barrel: the barrel
// re-exports .tsx components, and the loader that reads this config handles .ts only.
import type { Config } from "tailwindcss";
import { tokens } from "@bizflow/ui/src/tokens";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: tokens.color,
      borderRadius: {
        sm: `${tokens.radius.sm}px`,
        md: `${tokens.radius.md}px`,
        lg: `${tokens.radius.lg}px`,
        pill: `${tokens.radius.pill}px`,
      },
      fontSize: Object.fromEntries(
        Object.entries(tokens.font.size).map(([k, v]) => [k, `${v}px`]),
      ),
      minHeight: { touch: `${tokens.touchMin}px`, button: `${tokens.buttonHeight}px` },
    },
  },
  plugins: [],
} satisfies Config;
