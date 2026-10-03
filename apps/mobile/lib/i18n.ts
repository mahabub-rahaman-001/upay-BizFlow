import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import AsyncStorage from "@react-native-async-storage/async-storage";
import bn from "../locales/bn.json";
import en from "../locales/en.json";
import { experienceBn, experienceEn } from "../locales/experience";

export type AppLanguage = "bn" | "en";

const LANGUAGE_STORAGE_KEY = "bizflow.language";

function isAppLanguage(value: string | null): value is AppLanguage {
  return value === "bn" || value === "en";
}

// Bangla is the first-run default. Resolve the saved language before rendering the app
// so returning users do not see one language flash briefly before the other.
export const i18nReady = AsyncStorage.getItem(LANGUAGE_STORAGE_KEY)
  .catch(() => null)
  .then((savedLanguage) =>
    i18n.use(initReactI18next).init({
      resources: { bn: { translation: { ...bn, ux: experienceBn } }, en: { translation: { ...en, ux: experienceEn } } },
      lng: isAppLanguage(savedLanguage) ? savedLanguage : "bn",
      fallbackLng: "en",
      interpolation: { escapeValue: false },
    }),
  );

export async function setAppLanguage(language: AppLanguage): Promise<void> {
  await i18nReady;
  await AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  await i18n.changeLanguage(language);
}

export default i18n;
