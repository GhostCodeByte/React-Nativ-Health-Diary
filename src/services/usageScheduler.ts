/**
 * usageScheduler.ts
 *
 * Add background task to collect Android UsageStats daily and push them to Supabase
 *
 * Implementation details:
 * - Uses expo-task-manager + expo-background-fetch to schedule periodic checks.
 * - At each run, we check whether the user-defined daily time has passed and
 *   whether today's data has already been sent. If due, we pull UsageStats via
 *   the native module wrapper (usageNative.ts) and write entries to Supabase.
 * - Data is stored as if it were "answers" to automatically generated questions.
 *   These questions are created once if they don't exist yet.
 *
 * Notes/Limitations:
 * - Exact execution time in the background is not guaranteed. We run periodically
 *   (e.g., every 15 min) and submit once when the time window is reached.
 * - Requires a custom dev client or release build (not Expo Go) to use the native module.
 * - On iOS this file no-ops gracefully.
 */

import * as TaskManager from "expo-task-manager";
import * as BackgroundFetch from "expo-background-fetch";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

import {
  DefaultPackages,
  getTodayMidnightEpochMs,
  getTodayUsageSummary,
  hasUsageAccess,
  isUsageStatsAvailable,
} from "./usageNative";

import {
  isSupabaseConfigured,
  supaGetQuestions,
  supaInsertQuestion,
  supaSetDiaryEntry,
} from "./supabase";

import type { DiaryEntry, Question } from "../types";

// ---------- Configuration ----------

const TASK_NAME = "usage-fetch-task";
const DEFAULT_DAILY_TIME_HHMM = "21:00"; // 9 PM local time
const STORAGE_LAST_SUBMITTED_DATE = "usage:lastSubmittedISODate";
const STORAGE_DAILY_TARGET_HHMM = "usage:dailyTargetHHmm";
const STORAGE_QIDS = "usage:questionIds.v1";

// 15 minutes minimum interval in seconds (OS may group/batch executions)
const MIN_INTERVAL_SEC = 15 * 60;

// Single submission per day threshold: we only submit once per local day.
const RUN_WINDOW_MINUTES = 24 * 60;

// Our "auto questions" texts (German)
const Q_TEXT_TOTAL = "Wie lange warst du heute am Handy? (Automatisch)";
const Q_TEXT_SOCIAL = "Zeit auf Social Media heute (Automatisch)";
const Q_TEXT_MUSIC = "Zeit Musik/Audio heute (Automatisch)";
const Q_TEXT_LAST_APP = "Letzte App vor dem Schlafen (Automatisch)";

// ---------- Public API ----------

/**
 * Register the background task and kick a foreground check.
 * Call this once during app startup (e.g., in App.tsx).
 */
export async function registerUsageBackgroundTask(): Promise<void> {
  if (Platform.OS !== "android") return;

  await defineTaskOnce();

  try {
    const isRegistered = await BackgroundFetch.getStatusAsync().then(
      (status: number) => status !== BackgroundFetch.Status.Restricted,
    );

    if (isRegistered) {
      const already = await BackgroundFetch.isTaskRegisteredAsync(TASK_NAME);
      if (!already) {
        await BackgroundFetch.registerTaskAsync(TASK_NAME, {
          minimumInterval: MIN_INTERVAL_SEC,
          stopOnTerminate: false,
          startOnBoot: true,
        });
      }
    }
  } catch (e) {
    // Best-effort; in dev this may fail if environment is not suitable
    log("[register] BackgroundFetch register failed:", e);
  }

  // Foreground kick: if we are past the configured time and haven't submitted,
  // run once now. This makes behavior more predictable when the app is opened.
  try {
    await runIfDueNow();
  } catch (e) {
    log("[register] Foreground runIfDueNow failed:", e);
  }
}

/**
 * Unregister the background task (useful for debugging or settings switch).
 */
export async function unregisterUsageBackgroundTask(): Promise<void> {
  try {
    const registered = await BackgroundFetch.isTaskRegisteredAsync(TASK_NAME);
    if (registered) {
      await BackgroundFetch.unregisterTaskAsync(TASK_NAME);
    }
  } catch (e) {
    log("[unregister] failed:", e);
  }
}

/**
 * Change the daily target time (HH:mm, 24h), e.g. "21:00".
 */
export async function setDailyTargetTime(hhmm: string): Promise<void> {
  if (!/^\d{2}:\d{2}$/.test(hhmm)) {
    throw new Error('Invalid time format. Expected "HH:mm".');
  }
  await AsyncStorage.setItem(STORAGE_DAILY_TARGET_HHMM, hhmm);
}

/**
 * Read the daily target time, falling back to default.
 */
export async function getDailyTargetTime(): Promise<string> {
  const v = await AsyncStorage.getItem(STORAGE_DAILY_TARGET_HHMM);
  return v && /^\d{2}:\d{2}$/.test(v) ? v : DEFAULT_DAILY_TIME_HHMM;
}

/**
 * Trigger one immediate collection attempt (debug/manual).
 * This ignores the daily schedule and always tries to submit "today".
 */
export async function runOnceNow(): Promise<void> {
  await collectAndSubmit({ enforce: true });
}

/**
 * On app launch, you can call this to check the permission and prompt the user.
 * Note: You cannot show the settings UI in a background task; only call this in foreground.
 */
export async function ensureUsagePermissionOnLaunch(): Promise<boolean> {
  if (Platform.OS !== "android") return false;
  // We only check, we don't open settings here to avoid surprising the user.
  // You can wire your own UI to guide the user to settings if not granted.
  return hasUsageAccess();
}

/**
 * Optionally redirect the user to the Android "Usage Access" settings screen
 * if permission is not granted yet. Returns the final permission state after
 * the user returns to the app (best effort).
 */
export async function promptUsageAccessIfNeeded(): Promise<boolean> {
  if (Platform.OS !== "android") return false;
  const granted = await hasUsageAccess();
  if (granted) return true;
  try {
    // Lazy import to avoid hard dependency when not available
    const mod = require("./usageNative");
    if (mod && typeof mod.openUsageAccessSettings === "function") {
      await mod.openUsageAccessSettings();
    }
  } catch {
    // ignore
  }
  // give system time to apply setting
  await new Promise((r) => setTimeout(r, 750));
  return hasUsageAccess();
}

// ---------- Background Task Definition ----------

let taskDefined = false;

async function defineTaskOnce() {
  if (taskDefined) return;
  if (Platform.OS !== "android") {
    taskDefined = true;
    return;
  }
  TaskManager.defineTask(TASK_NAME, async () => {
    try {
      const ran = await runIfDueNow();
      return ran
        ? BackgroundFetch.BackgroundFetchResult.NewData
        : BackgroundFetch.BackgroundFetchResult.NoData;
    } catch (e) {
      log("[task] failed:", e);
      return BackgroundFetch.BackgroundFetchResult.Failed;
    }
  });
  taskDefined = true;
}

// ---------- Core Logic ----------

/**
 * Periodic entry point: decide if we should run now; if yes, collect+submit.
 * Returns true if a submission was performed.
 */
async function runIfDueNow(): Promise<boolean> {
  if (Platform.OS !== "android") return false;
  if (!isSupabaseConfigured()) {
    log("[runIfDueNow] Supabase not configured. Skipping.");
    return false;
  }
  if (!isUsageStatsAvailable) {
    log("[runIfDueNow] UsageStats native module not available. Skipping.");
    return false;
  }
  const hasAccess = await hasUsageAccess();
  if (!hasAccess) {
    log(
      "[runIfDueNow] Usage Access not granted. Skipping collection. Prompt user in-app to grant permission.",
    );
    return false;
  }

  const now = new Date();
  const target = await getDailyTargetTime();

  if (!(await isSubmissionDue(now, target))) {
    return false;
  }

  await collectAndSubmit({ at: now, targetHHmm: target, enforce: false });
  await markSubmittedForToday(now);
  return true;
}

async function isSubmissionDue(
  now: Date,
  targetHHmm: string,
): Promise<boolean> {
  const last = await AsyncStorage.getItem(STORAGE_LAST_SUBMITTED_DATE);
  const todayISO = toISODate(now);
  if (last === todayISO) {
    return false; // already submitted today
  }

  const minsNow = toMinutesSinceMidnight(now);
  const minsTarget = hhmmToMinutes(targetHHmm);

  // Run once after the target time; if background fetch triggers earlier, wait.
  if (minsNow < minsTarget) return false;

  // Defensive: ensure we don't run more than once per day even if fetch triggers again later.
  return true;
}

async function markSubmittedForToday(now: Date): Promise<void> {
  const todayISO = toISODate(now);
  await AsyncStorage.setItem(STORAGE_LAST_SUBMITTED_DATE, todayISO);
}

type CollectOptions = {
  at?: Date;
  targetHHmm?: string;
  enforce?: boolean; // bypass schedule check
};

/**
 * Collect today's usage stats and submit to Supabase as entries.
 * Creates the required questions if they do not exist.
 */
async function collectAndSubmit(opts: CollectOptions): Promise<void> {
  const now = opts.at ?? new Date();
  const todayISO = toISODate(now);
  const timeHHmm = opts.targetHHmm ?? toHHmm(now);

  const summary = await getTodayUsageSummary({
    socialPackages: DefaultPackages.social as readonly string[],
    musicPackages: DefaultPackages.music as readonly string[],
  });

  // Convert ms -> minutes (integer)
  const totalMinutes = msToMinutes(summary.totalScreenTimeMs);
  const socialMinutes = msToMinutes(summary.socialMs);
  const musicMinutes = msToMinutes(summary.musicMs);
  const lastAppLabel =
    summary.lastApp?.label || summary.lastApp?.packageName || "Unbekannt";

  const qids = await ensureUsageQuestions();

  // Prepare entries
  const entries: DiaryEntry[] = [
    {
      id: 0,
      questionID: qids.totalMinutes,
      date: todayISO,
      time: timeHHmm,
      value: totalMinutes,
      forDay: "today",
    },
    {
      id: 0,
      questionID: qids.socialMinutes,
      date: todayISO,
      time: timeHHmm,
      value: socialMinutes,
      forDay: "today",
    },
    {
      id: 0,
      questionID: qids.musicMinutes,
      date: todayISO,
      time: timeHHmm,
      value: musicMinutes,
      forDay: "today",
    },
    {
      id: 0,
      questionID: qids.lastApp,
      date: todayISO,
      time: timeHHmm,
      value: lastAppLabel,
      forDay: "today",
    },
  ];

  // Submit (upsert-like using supaSetDiaryEntry)
  for (const entry of entries) {
    await supaSetDiaryEntry(entry);
  }

  log(
    `[collectAndSubmit] Sent usage: total=${totalMinutes}m, social=${socialMinutes}m, music=${musicMinutes}m, last="${lastAppLabel}"`,
  );
}

// ---------- Question Management ----------

type UsageQuestionIds = {
  totalMinutes: number;
  socialMinutes: number;
  musicMinutes: number;
  lastApp: number;
};

/**
 * Ensure our special "auto" questions exist, return their IDs.
 * Caches the IDs in AsyncStorage to avoid repeated lookups.
 */
async function ensureUsageQuestions(): Promise<UsageQuestionIds> {
  // Try cached
  const cached = await AsyncStorage.getItem(STORAGE_QIDS);
  if (cached) {
    try {
      const parsed = JSON.parse(cached) as UsageQuestionIds;
      if (parsed && areValidQids(parsed)) {
        return parsed;
      }
    } catch {
      // ignore
    }
  }

  // Lookup existing by text
  const all = await supaGetQuestions();
  const mapByText = new Map<string, Question>(all.map((q) => [q.question, q]));

  const ensure = async (
    text: string,
    answerType: Question["answerType"],
    unit?: string,
  ) => {
    const existing = mapByText.get(text);
    if (existing) return existing.id;

    const created = await supaInsertQuestion({
      groupId: null,
      question: text,
      answerType,
      min: answerType === "number" ? 0 : undefined,
      max: undefined,
      step: undefined,
      options: undefined,
      placeholder: undefined,
      unit,
      order: (all?.length || 0) + 1,
      active: true,
      timeOfDay: "evening",
      refDay: "today",
    });
    return created.id;
  };

  const totalId = await ensure(Q_TEXT_TOTAL, "number", "Min");
  const socialId = await ensure(Q_TEXT_SOCIAL, "number", "Min");
  const musicId = await ensure(Q_TEXT_MUSIC, "number", "Min");
  const lastAppId = await ensure(Q_TEXT_LAST_APP, "text", undefined);

  const qids: UsageQuestionIds = {
    totalMinutes: totalId,
    socialMinutes: socialId,
    musicMinutes: musicId,
    lastApp: lastAppId,
  };

  await AsyncStorage.setItem(STORAGE_QIDS, JSON.stringify(qids));
  return qids;
}

function areValidQids(v: any): v is UsageQuestionIds {
  return (
    v &&
    typeof v.totalMinutes === "number" &&
    typeof v.socialMinutes === "number" &&
    typeof v.musicMinutes === "number" &&
    typeof v.lastApp === "number"
  );
}

// ---------- Helpers ----------

function toISODate(d: Date): string {
  // YYYY-MM-DD in local time
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
}

function toHHmm(d: Date): string {
  const h = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${mi}`;
}

function toMinutesSinceMidnight(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map((n) => Number(n));
  return h * 60 + m;
}

function msToMinutes(ms: number): number {
  return Math.max(0, Math.round(ms / 60000));
}

function log(...args: any[]) {
  // Centralized logging for this module
  // eslint-disable-next-line no-console
  console.log("[usageScheduler]", ...args);
}

// ---------- Optional: Reset helpers (dev) ----------

/**
 * Clear cached state (question IDs and last submission flag).
 */
export async function __debugResetState(): Promise<void> {
  await AsyncStorage.multiRemove([STORAGE_QIDS, STORAGE_LAST_SUBMITTED_DATE]);
}

// ---------- Auto-init (optional) ----------
// You can choose not to auto-define the task on import.
// If desired, uncomment the following line to ensure the task function exists.
// void defineTaskOnce();

/**
 * Developer Checklist:
 * - Implement the Android native module (Kotlin) that exposes UsageStatsManager data used by usageNative.ts
 * - Build a custom dev client or release build (Expo Go won't load custom native modules)
 * - Call registerUsageBackgroundTask() during app startup
 * - Optionally, call ensureUsagePermissionOnLaunch() in a foreground screen to prompt user
 * - Use setDailyTargetTime("21:30") to change the daily submission time
 */
