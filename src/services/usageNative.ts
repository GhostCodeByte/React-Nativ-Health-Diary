/**
 * usageNative.ts
 * JS/TS wrapper for the Android native module that exposes UsageStatsManager data.
 *
 * Goals:
 * - Provide a safe, typed interface to the native module
 * - Gracefully degrade when the module is not available (iOS, Expo Go without custom dev client, etc.)
 * - Offer helpers for permission flow and default app category lists
 *
 * Expected native module (Android/Kotlin) methods:
 * - isUsageAccessGranted(): Promise<boolean>
 * - openUsageAccessSettings(): Promise<void>
 * - getTodayUsageSummary(config?: { social: string[]; music: string[] }): Promise<UsageSummary>
 * - getAppEventsSince?(sinceMsEpoch: number): Promise<AppEvent[]>
 *
 * NOTE:
 * - This file is a thin JS wrapper. The native side must be implemented in Android (Kotlin).
 * - On iOS, or if the native module is not linked/available, all calls either no-op or throw with a helpful error.
 */

import { Linking, NativeModules, Platform } from "react-native";

/**
 * Default package names to classify apps into categories.
 * Feel free to extend or adjust according to your needs.
 */
export const DefaultPackages = {
  social: [
    "com.instagram.android",
    "com.zhiliaoapp.musically", // TikTok
    "com.ss.android.ugc.trill", // TikTok (alt)
    "com.facebook.katana", // Facebook
    "com.twitter.android", // X/Twitter
    "com.reddit.frontpage",
    "com.snapchat.android",
    "com.discord",
    "com.whatsapp",
    "org.thoughtcrime.securesms", // Signal
    "com.facebook.orca", // Messenger
    "com.telegram.messenger",
    "org.telegram.messenger",
    "com.linkedin.android",
  ],
  music: [
    "com.spotify.music",
    "com.google.android.apps.youtube.music",
    "com.soundcloud.android",
    "deezer.android.app",
    "com.apple.android.music",
    "com.amazon.mp3",
    "com.pandora.android",
  ],
} as const;

export type EpochMs = number;

/**
 * One consolidated summary for "today".
 */
export type UsageSummary = {
  // Total foreground usage time across all apps since local midnight.
  totalScreenTimeMs: number;

  // Summed time for the given category packages
  socialMs: number;
  musicMs: number;

  // Last app used (best effort) + its timestamp
  lastApp: {
    packageName: string;
    label?: string;
    lastUsedAt: EpochMs;
  } | null;

  // When this snapshot was generated on device
  generatedAt: EpochMs;
};

/**
 * Optional lower-level event payloads if native side exposes them.
 * Useful when you need finer-grained analysis.
 */
export type AppEvent = {
  packageName: string;
  label?: string;
  firstTimestamp: EpochMs; // when usage window started
  lastTimestamp: EpochMs; // when usage window ended
  totalTimeMs: number; // accumulated time in this window
};

type NativeConfig = {
  social?: string[];
  music?: string[];
};

type UsageStatsModule = {
  isUsageAccessGranted(): Promise<boolean>;
  openUsageAccessSettings(): Promise<void>;
  getTodayUsageSummary(config?: NativeConfig): Promise<UsageSummary>;
  getAppEventsSince?(sinceMsEpoch: number): Promise<AppEvent[]>;
};

// Try a few common export names for the native module
const _native: Partial<UsageStatsModule> | undefined =
  (NativeModules as any)?.UsageStatsModule ||
  (NativeModules as any)?.RNUsageStats ||
  (NativeModules as any)?.UsageStats ||
  undefined;

/**
 * Feature detection. True if native usage stats module looks available on Android.
 */
export const isUsageStatsAvailable: boolean =
  Platform.OS === "android" &&
  !!_native &&
  typeof _native.isUsageAccessGranted === "function" &&
  typeof _native.getTodayUsageSummary === "function";

/**
 * Returns true if "Usage Access" permission is granted on Android.
 * Always returns false on non-Android platforms or if the module is missing.
 */
export async function hasUsageAccess(): Promise<boolean> {
  if (Platform.OS !== "android" || !isUsageStatsAvailable) return false;
  try {
    return await (_native as UsageStatsModule).isUsageAccessGranted();
  } catch {
    return false;
  }
}

/**
 * Attempts to send the user to the correct Usage Access settings screen.
 * Falls back to Linking.openSettings() if the native function is not present.
 *
 * This does NOT guarantee the user grants permission; you must re-check after.
 */
export async function openUsageAccessSettings(): Promise<void> {
  if (Platform.OS !== "android") {
    return;
  }
  try {
    if (
      isUsageStatsAvailable &&
      typeof _native?.openUsageAccessSettings === "function"
    ) {
      await (_native as UsageStatsModule).openUsageAccessSettings();
      return;
    }
  } catch {
    // no-op, fallback below
  }
  // Fallback: open app settings (not the specialized Usage Access screen)
  try {
    await Linking.openSettings();
  } catch {
    // Swallow as last resort
  }
}

/**
 * Ensures the permission is granted by:
 * - Checking current state
 * - If not granted, navigating user to settings
 * - Returning the final state after user returns (best effort)
 *
 * NOTE: There is no callback from settings that guarantees user action.
 * Consider re-checking permission later or after a small delay.
 */
export async function ensureUsageAccess(): Promise<boolean> {
  const granted = await hasUsageAccess();
  if (granted) return true;

  await openUsageAccessSettings();

  // Best effort: give the OS a moment and re-check
  await sleep(750);
  return hasUsageAccess();
}

/**
 * Fetch a "today" usage summary. Requires the native module and Android.
 * You can optionally pass custom package lists for social/music classifications.
 */
export async function getTodayUsageSummary(config?: {
  socialPackages?: readonly string[];
  musicPackages?: readonly string[];
}): Promise<UsageSummary> {
  guardAndroid();
  guardNative();

  const payload: NativeConfig = {
    social: config?.socialPackages
      ? Array.from(config.socialPackages)
      : [...DefaultPackages.social],
    music: config?.musicPackages
      ? Array.from(config.musicPackages)
      : [...DefaultPackages.music],
  };

  return (_native as UsageStatsModule).getTodayUsageSummary(payload);
}

/**
 * Optional: Get raw usage events since a given point in time (epoch ms) if the native module provides it.
 */
export async function getAppEventsSince(
  sinceMsEpoch: number,
): Promise<AppEvent[]> {
  guardAndroid();
  guardNative();

  if (typeof (_native as UsageStatsModule).getAppEventsSince !== "function") {
    throw new Error(
      "getAppEventsSince is not implemented by the native usage stats module.",
    );
  }
  return (_native as UsageStatsModule).getAppEventsSince!(sinceMsEpoch);
}

/**
 * Helper to calculate local midnight epoch in ms.
 */
export function getTodayMidnightEpochMs(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Internal guards
 */
function guardAndroid() {
  if (Platform.OS !== "android") {
    throw new Error("Usage stats are only available on Android.");
  }
}

function guardNative() {
  if (!isUsageStatsAvailable) {
    throw new Error(
      "Usage stats native module is not available. Make sure you are running on Android with a custom dev build (not Expo Go) and the native module is properly installed/linked.",
    );
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Developer notes:
 * - Android requires "Usage Access" permission (granted by the user in Settings) to query UsageStatsManager.
 * - Your Kotlin module should request stats using UsageStatsManager APIs for "today" (from local midnight) and
 *   aggregate times per package. Then it should sum total time, social/music times based on provided package lists,
 *   and detect the last used app by recency of foreground events.
 * - Consider using JobScheduler/WorkManager natively for background collection if you need fully headless execution.
 */
