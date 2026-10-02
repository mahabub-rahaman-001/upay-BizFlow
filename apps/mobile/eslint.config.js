const expoConfig = require("eslint-config-expo/flat");

module.exports = [
  ...expoConfig,
  { ignores: ["dist/*", ".expo/*", "node_modules/*", "*.config.js", "*.config.ts"] },
  {
    rules: {
      // i18next's default export legitimately carries a `use` method.
      "import/no-named-as-default-member": "off",
      // These native packages are declared in package.json but may not be installed yet
      // (network error during pnpm install). TypeScript is satisfied via types/ stubs.
      "import/no-unresolved": [
        "error",
        {
          ignore: [
            "@react-native-async-storage/async-storage",
            "@react-native-community/netinfo",
            "expo-av",
          ],
        },
      ],
    },
  },
];
