/**
 * Minimal TypeScript shims for Expo background fetch and task manager.
 * These declarations provide just enough typing information for this project.
 *
 * Note:
 * - Replace with official type packages when you add the real dependencies.
 */

/* ============================
 * expo-task-manager (shim)
 * ============================
 */
declare module "expo-task-manager" {
  /**
   * Register a background task by name.
   * Implementation is provided by the native runtime; this is only a type shim.
   */
  export function defineTask(
    taskName: string,
    taskFn: (...args: any[]) => any,
  ): void;
}

/* =================================
 * expo-background-fetch (shim)
 * =================================
 */
declare module "expo-background-fetch" {
  /**
   * Background fetch status constants (shape mirrors Expo API).
   * Values are opaque sentinel numbers.
   */
  export type BackgroundFetchStatus = number;
  export const Status: {
    Restricted: BackgroundFetchStatus;
    Denied: BackgroundFetchStatus;
    Available: BackgroundFetchStatus;
  };

  /**
   * Background fetch result constants (shape mirrors Expo API).
   * Values are opaque sentinel numbers.
   */
  export type BackgroundFetchResultType = number;
  export const BackgroundFetchResult: {
    NoData: BackgroundFetchResultType;
    NewData: BackgroundFetchResultType;
    Failed: BackgroundFetchResultType;
  };

  export interface RegisterOptions {
    /**
     * Minimum interval in seconds between background fetch executions.
     * The system is free to batch/defers runs; exact timing is not guaranteed.
     */
    minimumInterval?: number;

    /**
     * Whether the task should stop when the app is terminated (Android).
     */
    stopOnTerminate?: boolean;

    /**
     * Whether the task should start on device boot (Android).
     */
    startOnBoot?: boolean;

    /**
     * Additional platform-specific options may exist in the real API.
     * They are omitted in this shim.
     */
    // [key: string]: any;
  }

  /**
   * Registers a background fetch task by name.
   */
  export function registerTaskAsync(
    taskName: string,
    options?: RegisterOptions,
  ): Promise<void>;

  /**
   * Returns the current background fetch status.
   */
  export function getStatusAsync(): Promise<BackgroundFetchStatus>;

  /**
   * Checks if a background task is registered by name.
   */
  export function isTaskRegisteredAsync(taskName: string): Promise<boolean>;

  /**
   * Unregisters a background fetch task by name.
   */
  export function unregisterTaskAsync(taskName: string): Promise<void>;
}

/* =================================================
 * Local module augmentation for usageNative helper
 * - Widen parameter types to accept readonly arrays
 *   to avoid assignment errors when passing const arrays.
 * =================================================
 */
declare module "../services/usageNative" {
  export function getTodayUsageSummary(config?: {
    socialPackages?: readonly string[];
    musicPackages?: readonly string[];
  }): Promise<any>;
}

declare module "./usageNative" {
  export function getTodayUsageSummary(config?: {
    socialPackages?: readonly string[];
    musicPackages?: readonly string[];
  }): Promise<any>;
}
