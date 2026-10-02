import * as LocalAuthentication from "expo-local-authentication";
import { supabase } from "./supabase";

export interface ReauthResult {
  success: boolean;
  error?: string;
}

/**
 * Re-authentication before a sensitive action (refund, reversal, day reopen) - docs/09
 * section 9. Two steps: confirm the person on the device (biometric or PIN where the
 * hardware has it), then open the server-side reauth window the sensitive RPCs require via
 * request_reauth. The server window is the real gate; the device check is the local factor.
 *
 * The device check is best-effort: a shared counter phone may have no biometric enrolled,
 * so there it falls through to opening the window directly. The server still records it.
 */
export async function promptReauth(
  promptMessage: string = "Authenticate to continue",
): Promise<ReauthResult> {
  try {
    try {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const isEnrolled = hasHardware && (await LocalAuthentication.isEnrolledAsync());
      if (isEnrolled) {
        const result = await LocalAuthentication.authenticateAsync({
          promptMessage,
          cancelLabel: "Cancel",
          fallbackLabel: "Use PIN",
          disableDeviceFallback: false,
        });
        if (!result.success) {
          return { success: false, error: result.error || "Authentication failed or cancelled" };
        }
      }
    } catch {
      // No biometric module (for example on web): fall through to the server window.
    }

    // Open the 5-minute server reauth window. Without this the sensitive RPC still refuses.
    const { error } = await supabase.rpc("request_reauth");
    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : "Authentication error" };
  }
}
