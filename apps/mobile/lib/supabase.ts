import "react-native-url-polyfill/auto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { demoClient } from "./demo/client";

// Tokens live in the OS secure store on device. Only the ANON key is used here -
// never the service role key (that stays server-side; see docs/09).
const ExpoSecureStoreAdapter = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

/**
 * "demo" runs the whole app on sample data with no backend (docs/16 section 5): set
 * EXPO_PUBLIC_DATA_SOURCE=demo, or leave the Supabase URL unset. Everything else is live.
 */
export const isDemoData = process.env.EXPO_PUBLIC_DATA_SOURCE === "demo" || !url || !anonKey;

export const supabase: SupabaseClient = isDemoData
  ? (demoClient as unknown as SupabaseClient)
  : createClient(url!, anonKey!, {
      auth: {
        storage: Platform.OS === "web" ? undefined : ExpoSecureStoreAdapter,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    });
