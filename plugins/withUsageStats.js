"use strict";

/**
 * JS version of the config plugin so EAS can resolve it without TS transpilation.
 *
 * Responsibilities:
 * - Add android.permission.PACKAGE_USAGE_STATS (with tools:ignore="ProtectedPermissions")
 * - Try to register the UsageStatsPackage in MainApplication (Java/Kotlin)
 */

const {
  withAndroidManifest,
  withMainApplication,
  withDangerousMod,
} = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

const USAGE_PERMISSION = "android.permission.PACKAGE_USAGE_STATS";
const TOOLS_NS_URI = "http://schemas.android.com/tools";
const PACKAGE_IMPORT = "com.diary.usage.UsageStatsPackage";

const withUsageStats = (config, props = {}) => {
  // Add permission to AndroidManifest
  config = withAndroidManifest(config, (c) => {
    c.modResults = addUsageStatsPermission(c.modResults);
    return c;
  });

  // Write Kotlin sources for the native module (idempotent)
  config = withDangerousMod(config, [
    "android",
    async (c) => {
      try {
        const projectRoot = c.modRequest.projectRoot;
        const baseDir = path.join(
          projectRoot,
          "android",
          "app",
          "src",
          "main",
          "java",
          "com",
          "diary",
          "usage",
        );

        fs.mkdirSync(baseDir, { recursive: true });

        const moduleKtPath = path.join(baseDir, "UsageStatsModule.kt");
        const packageKtPath = path.join(baseDir, "UsageStatsPackage.kt");

        const MODULE_KT = `
package com.diary.usage

import android.app.AppOpsManager
import android.app.usage.UsageEvents
import android.app.usage.UsageStats
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.os.Build
import android.provider.Settings
import com.facebook.react.bridge.*
import com.facebook.react.module.annotations.ReactModule
import java.util.Calendar

@ReactModule(name = UsageStatsModule.NAME)
class UsageStatsModule(private val reactCtx: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactCtx) {

  companion object {
    const val NAME = "UsageStatsModule"
  }

  override fun getName(): String = NAME

  @ReactMethod
  fun isUsageAccessGranted(promise: Promise) {
    try {
      val appOps = reactCtx.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
      val mode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        appOps.unsafeCheckOpNoThrow(
          AppOpsManager.OPSTR_GET_USAGE_STATS,
          android.os.Process.myUid(),
          reactCtx.packageName
        )
      } else {
        appOps.checkOpNoThrow(
          AppOpsManager.OPSTR_GET_USAGE_STATS,
          android.os.Process.myUid(),
          reactCtx.packageName
        )
      }
      promise.resolve(mode == AppOpsManager.MODE_ALLOWED)
    } catch (_: Exception) {
      promise.resolve(false)
    }
  }

  @ReactMethod
  fun openUsageAccessSettings(promise: Promise) {
    try {
      val intent = Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS)
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      reactCtx.startActivity(intent)
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("OPEN_SETTINGS_FAILED", e)
    }
  }

  @ReactMethod
  fun getTodayUsageSummary(config: ReadableMap?, promise: Promise) {
    try {
      if (!checkUsagePermissionInternal()) {
        val map = Arguments.createMap()
        map.putDouble("totalScreenTimeMs", 0.0)
        map.putDouble("socialMs", 0.0)
        map.putDouble("musicMs", 0.0)
        map.putNull("lastApp")
        map.putDouble("generatedAt", System.currentTimeMillis().toDouble())
        promise.resolve(map)
        return
      }

      val socialPkgs = toStringList(config?.getArray("social"))
      val musicPkgs = toStringList(config?.getArray("music"))

      val usm = reactCtx.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
      val (start, end) = todayWindowEpoch()

      val stats: List<UsageStats> = usm.queryUsageStats(
        UsageStatsManager.INTERVAL_DAILY, start, end
      ) ?: emptyList()

      var totalMs = 0L
      var socialMs = 0L
      var musicMs = 0L

      for (s in stats) {
        val t = s.totalTimeInForeground
        if (t > 0) {
          totalMs += t
          val pkg = s.packageName
          if (socialPkgs.contains(pkg)) socialMs += t
          if (musicPkgs.contains(pkg)) musicMs += t
        }
      }

      val events = usm.queryEvents(start, end)
      var lastEventPkg: String? = null
      var lastEventTs = 0L
      val event = UsageEvents.Event()
      while (events.hasNextEvent()) {
        events.getNextEvent(event)
        val type = event.eventType
        val isForeground = (type == UsageEvents.Event.MOVE_TO_FOREGROUND) ||
          (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && type == UsageEvents.Event.ACTIVITY_RESUMED)
        if (isForeground && event.timeStamp >= lastEventTs) {
          lastEventTs = event.timeStamp
          lastEventPkg = event.packageName
        }
      }

      val pm = reactCtx.packageManager
      var lastLabel: String? = null
      if (lastEventPkg != null) {
        try {
          val appInfo: ApplicationInfo = pm.getApplicationInfo(lastEventPkg!!, 0)
          lastLabel = pm.getApplicationLabel(appInfo)?.toString()
        } catch (_: Exception) {}
      }

      val map = Arguments.createMap()
      map.putDouble("totalScreenTimeMs", totalMs.toDouble())
      map.putDouble("socialMs", socialMs.toDouble())
      map.putDouble("musicMs", musicMs.toDouble())
      map.putDouble("generatedAt", end.toDouble())

      if (lastEventPkg != null && lastEventTs > 0) {
        val last = Arguments.createMap()
        last.putString("packageName", lastEventPkg)
        if (lastLabel != null) last.putString("label", lastLabel)
        last.putDouble("lastUsedAt", lastEventTs.toDouble())
        map.putMap("lastApp", last)
      } else {
        map.putNull("lastApp")
      }

      promise.resolve(map)
    } catch (e: Exception) {
      promise.reject("USAGE_SUMMARY_FAILED", e)
    }
  }

  @ReactMethod
  fun getAppEventsSince(sinceEpochMs: Double, promise: Promise) {
    try {
      if (!checkUsagePermissionInternal()) {
        promise.resolve(Arguments.createArray())
        return
      }

      val start = sinceEpochMs.toLong()
      val end = System.currentTimeMillis()
      if (start >= end) {
        promise.resolve(Arguments.createArray())
        return
      }

      val usm = reactCtx.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
      val events = usm.queryEvents(start, end)

      var currentPkg: String? = null
      var currentStart = 0L

      val totals = mutableMapOf<String, Long>()
      val firstTs = mutableMapOf<String, Long>()
      val lastTs = mutableMapOf<String, Long>()

      val e = UsageEvents.Event()
      while (events.hasNextEvent()) {
        events.getNextEvent(e)
        val ts = e.timeStamp
        val type = e.eventType
        val pkg = e.packageName ?: continue

        val isFg = (type == UsageEvents.Event.MOVE_TO_FOREGROUND) ||
          (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && type == UsageEvents.Event.ACTIVITY_RESUMED)
        val isBg = (type == UsageEvents.Event.MOVE_TO_BACKGROUND) ||
          (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && type == UsageEvents.Event.ACTIVITY_PAUSED)

        if (isFg) {
          if (currentPkg != null && currentStart > 0) {
            val dur = ts - currentStart
            if (dur > 0) {
              totals[currentPkg!!] = (totals[currentPkg!!] ?: 0L) + dur
            }
          }
          currentPkg = pkg
          currentStart = ts
          if (!firstTs.containsKey(pkg)) firstTs[pkg] = ts
          lastTs[pkg] = ts
        } else if (isBg) {
          if (currentPkg == pkg && currentStart > 0) {
            val dur = ts - currentStart
            if (dur > 0) {
              totals[pkg] = (totals[pkg] ?: 0L) + dur
            }
            lastTs[pkg] = ts
            currentPkg = null
            currentStart = 0L
          } else {
            lastTs[pkg] = ts
            if (!firstTs.containsKey(pkg)) firstTs[pkg] = ts
          }
        } else {
          lastTs[pkg] = ts
          if (!firstTs.containsKey(pkg)) firstTs[pkg] = ts
        }
      }

      if (currentPkg != null && currentStart > 0) {
        val dur = end - currentStart
        if (dur > 0) {
          totals[currentPkg!!] = (totals[currentPkg!!] ?: 0L) + dur
        }
        lastTs[currentPkg!!] = end
      }

      val arr = Arguments.createArray()
      for ((pkg, total) in totals.entries) {
        val obj = Arguments.createMap()
        obj.putString("packageName", pkg)
        obj.putDouble("totalTimeMs", total.toDouble())
        obj.putDouble("firstTimestamp", (firstTs[pkg] ?: start).toDouble())
        obj.putDouble("lastTimestamp", (lastTs[pkg] ?: end).toDouble())
        arr.pushMap(obj)
      }

      promise.resolve(arr)
    } catch (e: Exception) {
      promise.reject("USAGE_EVENTS_FAILED", e)
    }
  }

  private fun toStringList(arr: ReadableArray?): List<String> {
    if (arr == null) return emptyList()
    val list = mutableListOf<String>()
    for (i in 0 until arr.size()) {
      val v = arr.getString(i)
      if (v != null) list.add(v)
    }
    return list
  }

  private fun todayWindowEpoch(): Pair<Long, Long> {
    val cal = Calendar.getInstance()
    cal.set(Calendar.HOUR_OF_DAY, 0)
    cal.set(Calendar.MINUTE, 0)
    cal.set(Calendar.SECOND, 0)
    cal.set(Calendar.MILLISECOND, 0)
    val start = cal.timeInMillis
    val end = System.currentTimeMillis()
    return Pair(start, end)
  }

  private fun checkUsagePermissionInternal(): Boolean {
    return try {
      val appOps = reactCtx.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
      val mode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        appOps.unsafeCheckOpNoThrow(
          AppOpsManager.OPSTR_GET_USAGE_STATS,
          android.os.Process.myUid(),
          reactCtx.packageName
        )
      } else {
        appOps.checkOpNoThrow(
          AppOpsManager.OPSTR_GET_USAGE_STATS,
          android.os.Process.myUid(),
          reactCtx.packageName
        )
      }
      mode == AppOpsManager.MODE_ALLOWED
    } catch (_: Exception) {
      false
    }
  }
}
`.trimStart();

        const PACKAGE_KT = `
package com.diary.usage

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class UsageStatsPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> {
    return listOf(UsageStatsModule(reactContext))
  }

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> {
    return emptyList()
  }
}
`.trimStart();

        fs.writeFileSync(moduleKtPath, MODULE_KT, { encoding: "utf8" });
        fs.writeFileSync(packageKtPath, PACKAGE_KT, { encoding: "utf8" });
      } catch {}
      return c;
    },
  ]);

  // Register the native package in MainApplication (Kotlin)
  config = withMainApplication(config, (c) => {
    try {
      const language = (c.modResults && c.modResults.language) || "kotlin";
      let contents = c.modResults.contents;

      // Add import if missing
      if (!contents.includes("com.diary.usage.UsageStatsPackage")) {
        const importLine = `import com.diary.usage.UsageStatsPackage\n`;
        const pkgLineMatch = contents.match(/^package[^\n]*\n/);
        if (pkgLineMatch && typeof pkgLineMatch.index === "number") {
          const insertIndex = pkgLineMatch.index + pkgLineMatch[0].length;
          contents =
            contents.slice(0, insertIndex) +
            importLine +
            contents.slice(insertIndex);
        } else {
          contents = importLine + contents;
        }
      }

      // Insert packages.add(UsageStatsPackage()) if not present
      if (!/packages\.add\(UsageStatsPackage\(\)\)/.test(contents)) {
        if (
          /val\s+packages\s*=\s*PackageList\(this\)\.packages/.test(contents)
        ) {
          contents = contents.replace(
            /(val\s+packages\s*=\s*PackageList\(this\)\.packages[^\n]*\n)/,
            `$1      packages.add(UsageStatsPackage())\n`,
          );
        } else if (/return\s+packages/.test(contents)) {
          contents = contents.replace(
            /return\s+packages/,
            `packages.add(UsageStatsPackage())\n      return packages`,
          );
        }
      }

      c.modResults.contents = contents;
    } catch {}
    return c;
  });

  return config;
};

function addUsageStatsPermission(androidManifest) {
  const manifest = androidManifest.manifest || (androidManifest.manifest = {});
  manifest.$ = manifest.$ || {};
  if (!manifest.$["xmlns:tools"]) {
    manifest.$["xmlns:tools"] = TOOLS_NS_URI;
  }

  const usesPermissions = manifest["uses-permission"] || [];
  const exists = usesPermissions.some(
    (p) => p && p.$ && p.$["android:name"] === USAGE_PERMISSION,
  );

  if (!exists) {
    usesPermissions.push({
      $: {
        "android:name": USAGE_PERMISSION,
        "tools:ignore": "ProtectedPermissions",
      },
    });
  }

  manifest["uses-permission"] = usesPermissions;
  return androidManifest;
}

// Helpers added above to write Kotlin sources and register the package

module.exports = withUsageStats;
module.exports.default = withUsageStats;
