import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Button,
  Platform,
  SafeAreaView,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";

const THEME = {
  background: "#F5F5DC",
  text: "#808080",
  border: "#C0C0C0",
  primary: "#808080",
  muted: "#A9A9A9",
  surface: "#FFFFFF",
};

const STORAGE_KEYS = {
  enabled: "diary_notif_enabled",
  times: "diary_notif_times", // string[] of "HH:mm"
  scheduledIds: "diary_notif_ids", // string[] of scheduled notification ids
} as const;

type PermissionStatus = "granted" | "denied" | "undetermined";

export default function NotificationsScreen() {
  const [loading, setLoading] = useState(true);
  const [permission, setPermission] = useState<PermissionStatus>("undetermined");
  const [enabled, setEnabled] = useState<boolean>(false);
  const [times, setTimes] = useState<string[]>([]);
  const [showTimePicker, setShowTimePicker] = useState(false);

  // Dynamisch importierter TimePicker (falls Paket fehlt, bricht UI nicht)
  const DateTimePickerMod: any = useMemo(() => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      return require("@react-native-community/datetimepicker");
    } catch {
      return null;
    }
  }, []);
  const DTP = DateTimePickerMod?.default ?? DateTimePickerMod;
  const [timeDraft, setTimeDraft] = useState<Date>(new Date());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Load stored prefs
        const [rawEnabled, rawTimes] = await Promise.all([
          AsyncStorage.getItem(STORAGE_KEYS.enabled),
          AsyncStorage.getItem(STORAGE_KEYS.times),
        ]);
        if (!cancelled) {
          setEnabled(rawEnabled === "1");
          const parsedTimes: string[] = (() => {
            try {
              const arr = rawTimes ? (JSON.parse(rawTimes) as string[]) : [];
              return Array.isArray(arr) ? arr.filter(isValidHHMM).sort(sortHHMM) : [];
            } catch {
              return [];
            }
          })();
          setTimes(parsedTimes);
        }

        // Permission
        const p = await Notifications.getPermissionsAsync();
        if (!cancelled) setPermission(mapPermission(p));

        // Android channel
        if (Platform.OS === "android") {
          await Notifications.setNotificationChannelAsync("diary-reminders", {
            name: "Diary Reminders",
            importance: Notifications.AndroidImportance.DEFAULT,
            bypassDnd: false,
            sound: "default",
            vibrationPattern: [250, 250],
            lightColor: "#FF231F7C",
          });
        }
      } catch (err: any) {
        Alert.alert("Fehler", err?.message || "Konnte Benachrichtigungen nicht laden.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const requestPermission = useCallback(async () => {
    try {
      const { status, granted } = await Notifications.requestPermissionsAsync();
      setPermission(granted ? "granted" : status || "undetermined");
    } catch (err: any) {
      Alert.alert("Fehler", err?.message || "Konnte Berechtigung nicht anfragen.");
    }
  }, []);

  const addTimeByDate = useCallback((d: Date) => {
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    const t = `${hh}:${mm}`;
    setTimes((prev) => {
      const set = new Set(prev);
      set.add(t);
      return Array.from(set).filter(isValidHHMM).sort(sortHHMM);
    });
  }, []);

  const removeTime = useCallback((t: string) => {
    setTimes((prev) => prev.filter((x) => x !== t));
  }, []);

  const clearTimes = useCallback(() => {
    setTimes([]);
  }, []);

  const persistPrefs = useCallback(async (en: boolean, list: string[]) => {
    await Promise.all([
      AsyncStorage.setItem(STORAGE_KEYS.enabled, en ? "1" : "0"),
      AsyncStorage.setItem(STORAGE_KEYS.times, JSON.stringify(list)),
    ]);
  }, []);

  const scheduleAll = useCallback(async () => {
    if (permission !== "granted") {
      Alert.alert("Berechtigung nötig", "Bitte erlaube Benachrichtigungen.");
      return;
    }

    // Save prefs first
    await persistPrefs(enabled, times);

    // Clear existing schedules
    try {
      const rawIds = (await AsyncStorage.getItem(STORAGE_KEYS.scheduledIds)) || "[]";
      let ids: string[] = [];
      try {
        ids = JSON.parse(rawIds);
      } catch {
        ids = [];
      }
      if (Array.isArray(ids) && ids.length) {
        await Promise.all(ids.map((id) => Notifications.cancelScheduledNotificationAsync(id)));
      } else {
        // Ensure all cleared
        await Notifications.cancelAllScheduledNotificationsAsync();
      }
    } catch {
      // ignore cancel errors
    }

    if (!enabled || times.length === 0) {
      await AsyncStorage.setItem(STORAGE_KEYS.scheduledIds, JSON.stringify([]));
      Alert.alert("Gespeichert", "Benachrichtigungen deaktiviert.");
      return;
    }

    // Schedule new
    try {
      const ids: string[] = [];
      for (const t of times) {
        const { hour, minute } = parseHHMM(t);
        const id = await Notifications.scheduleNotificationAsync({
          content: {
            title: "Tagebuch Erinnerung",
            body: "Bitte fülle dein Diary aus.",
            sound: "default",
          },
          trigger: {
            hour,
            minute,
            repeats: true,
            channelId: Platform.OS === "android" ? "diary-reminders" : undefined,
          },
        });
        ids.push(id);
      }
      await AsyncStorage.setItem(STORAGE_KEYS.scheduledIds, JSON.stringify(ids));
      Alert.alert("Gespeichert", "Benachrichtigungen aktualisiert.");
    } catch (err: any) {
      Alert.alert("Fehler", err?.message || "Planen der Erinnerungen fehlgeschlagen.");
    }
  }, [permission, enabled, times, persistPrefs]);

  const sendTestNotification = useCallback(async () => {
    if (permission !== "granted") {
      Alert.alert("Berechtigung nötig", "Bitte erlaube Benachrichtigungen.");
      return;
    }
    try {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: "Test-Erinnerung",
          body: "Das ist eine Test-Benachrichtigung.",
          sound: "default",
        },
        trigger: { seconds: 2 },
      });
    } catch (err: any) {
      Alert.alert("Fehler", err?.message || "Test-Benachrichtigung fehlgeschlagen.");
    }
  }, [permission]);

  const permissionLabel = useMemo(() => {
    switch (permission) {
      case "granted":
        return { color: "#2E7D32", text: "Erlaubt" };
      case "denied":
        return { color: "#C62828", text: "Verweigert" };
      default:
        return { color: THEME.muted, text: "Unbekannt" };
    }
  }, [permission]);

  const openTimePicker = useCallback(() => {
    if (!DTP) {
      Alert.alert(
        "Hinweis",
        "Der native Zeit-Auswähler ist nicht verfügbar. Bitte installiere @react-native-community/datetimepicker.",
      );
      return;
    }
    setTimeDraft(new Date());
    setShowTimePicker(true);
  }, [DTP]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: THEME.background }}>
      <ScrollView contentContainerStyle={{ padding: 16 }}>
        <Text style={{ color: THEME.text, fontSize: 20, marginBottom: 12 }}>
          Benachrichtigungen
        </Text>

        {loading ? (
          <View style={{ alignItems: "center", padding: 20 }}>
            <ActivityIndicator size="large" color={THEME.text} />
          </View>
        ) : (
          <>
            {/* Permission block */}
            <View
              style={{
                borderWidth: 1,
                borderColor: THEME.border,
                backgroundColor: THEME.surface,
                borderRadius: 8,
                padding: 12,
                marginBottom: 16,
              }}
            >
              <Text style={{ color: THEME.text, marginBottom: 6 }}>
                Berechtigung
              </Text>
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <View
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 5,
                    backgroundColor: permissionLabel.color,
                    marginRight: 8,
                  }}
                />
                <Text style={{ color: THEME.text }}>{permissionLabel.text}</Text>
              </View>
              <View style={{ height: 8 }} />
              <Button
                title="Berechtigung anfragen"
                color={THEME.primary}
                onPress={requestPermission}
              />
            </View>

            {/* Enable/disable */}
            <View
              style={{
                borderWidth: 1,
                borderColor: THEME.border,
                backgroundColor: THEME.surface,
                borderRadius: 8,
                padding: 12,
                marginBottom: 16,
              }}
            >
              <Text style={{ color: THEME.text, marginBottom: 8 }}>
                Aktiviert: {enabled ? "Ja" : "Nein"}
              </Text>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <Button
                    title={enabled ? "Deaktivieren" : "Aktivieren"}
                    color={THEME.primary}
                    onPress={() => setEnabled((e) => !e)}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Button
                    title="Test-Benachrichtigung"
                    color={THEME.muted}
                    onPress={sendTestNotification}
                  />
                </View>
              </View>
            </View>

            {/* Times list */}
            <View
              style={{
                borderWidth: 1,
                borderColor: THEME.border,
                backgroundColor: THEME.surface,
                borderRadius: 8,
                padding: 12,
                marginBottom: 16,
              }}
            >
              <Text style={{ color: THEME.text, marginBottom: 8 }}>
                Zeiten pro Tag ({times.length})
              </Text>

              {times.length ? (
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  {times.map((t) => (
                    <View
                      key={t}
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        borderWidth: 1,
                        borderColor: THEME.border,
                        paddingVertical: 6,
                        paddingHorizontal: 10,
                        borderRadius: 16,
                        backgroundColor: "#FFFFFF",
                      }}
                    >
                      <Text style={{ color: THEME.text, marginRight: 8 }}>{t}</Text>
                      <TouchableOpacity onPress={() => removeTime(t)}>
                        <Text style={{ color: THEME.muted }}>✕</Text>
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              ) : (
                <Text style={{ color: THEME.muted }}>Keine Zeiten eingestellt.</Text>
              )}

              <View style={{ height: 8 }} />
              <View style={{ flexDirection: "row", gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <Button
                    title="Zeit hinzufügen"
                    color={THEME.primary}
                    onPress={openTimePicker}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Button
                    title="Alle löschen"
                    color={THEME.muted}
                    onPress={clearTimes}
                  />
                </View>
              </View>

              {DTP && showTimePicker && (
                <View style={{ marginTop: 8 }}>
                  <DTP
                    value={timeDraft}
                    mode="time"
                    is24Hour
                    display="default"
                    onChange={(_event: any, selectedDate?: Date) => {
                      const date = selectedDate ?? timeDraft;
                      const d = date || new Date();
                      setTimeDraft(d);
                      // iOS & Android: übernehmen und schließen nach Auswahl
                      addTimeByDate(d);
                      setShowTimePicker(false);
                    }}
                  />
                </View>
              )}
            </View>

            {/* Save plan */}
            <View
              style={{
                borderWidth: 1,
                borderColor: THEME.border,
                backgroundColor: THEME.surface,
                borderRadius: 8,
                padding: 12,
                marginBottom: 24,
              }}
            >
              <Button title="Plan speichern" color={THEME.primary} onPress={scheduleAll} />
            </View>

            <InfoBlock />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function InfoBlock() {
  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: THEME.border,
        borderRadius: 8,
        padding: 12,
        backgroundColor: THEME.surface,
      }}
    >
      <Text style={{ color: THEME.text, marginBottom: 6 }}>
        - Stelle ein, wie oft am Tag du eine Erinnerung bekommen möchtest, indem du Zeiten
        hinzufügst.
      </Text>
      <Text style={{ color: THEME.text, marginBottom: 6 }}>
        - Aktiviere Benachrichtigungen, damit der Plan wirksam ist.
      </Text>
      <Text style={{ color: THEME.text, marginBottom: 6 }}>
        - Du kannst jederzeit einen Test auslösen, um Benachrichtigungen zu prüfen.
      </Text>
      <Text style={{ color: THEME.text }}>
        - Hinweis (Android): Für Benachrichtigungen wird ein Kanal "Diary Reminders" verwendet.
      </Text>
    </View>
  );
}

/**
 * Utils
 */
function isValidHHMM(s: string): boolean {
  const m = /^(\d{2}):(\d{2})$/.exec(String(s).trim());
  if (!m) return false;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  return Number.isFinite(h) && Number.isFinite(mi) && h >= 0 && h <= 23 && mi >= 0 && mi <= 59;
}

function parseHHMM(s: string): { hour: number; minute: number } {
  const [hh, mm] = s.split(":");
  return { hour: Number(hh), minute: Number(mm) };
}

function sortHHMM(a: string, b: string) {
  const { hour: ah, minute: am } = parseHHMM(a);
  const { hour: bh, minute: bm } = parseHHMM(b);
  if (ah !== bh) return ah - bh;
  return am - bm;
}

function mapPermission(p: Notifications.NotificationPermissionsStatus): PermissionStatus {
  if (p.granted) return "granted";
  if (p.status === "denied") return "denied";
  return "undetermined";
}
