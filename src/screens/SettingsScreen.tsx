import React, { useEffect, useState } from "react";
import { Button, View, Text, Platform } from "react-native";
import { useNavigation } from "@react-navigation/native";
import DateTimePicker from "@react-native-community/datetimepicker";
import {
  getDailyTargetTime,
  setDailyTargetTime,
  promptUsageAccessIfNeeded,
  ensureUsagePermissionOnLaunch,
  runOnceNow,
} from "../services/usageScheduler";

const THEME = {
  background: "#F5F5DC",
  primary: "#808080",
};

export default function SettingsScreen() {
  const navigation = useNavigation<any>();
  const [dailyTime, setDailyTime] = useState<string>("21:00");
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [hasUsagePermission, setHasUsagePermission] = useState<boolean>(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const t = await getDailyTargetTime();
        const granted = await ensureUsagePermissionOnLaunch();
        if (!mounted) return;
        setDailyTime(t);
        setHasUsagePermission(granted);
      } catch {
        // ignore
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const hhmmToDate = (hhmm: string) => {
    const m = /^(\d{2}):(\d{2})$/.exec(hhmm) || ["", "21", "00"];
    const d = new Date();
    d.setHours(Number(m[1]), Number(m[2]), 0, 0);
    return d;
  };

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: THEME.background,
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      {/* Usage stats settings */}
      <View style={{ width: "100%", gap: 8, marginBottom: 16 }}>
        <Text
          style={{ color: THEME.primary, fontSize: 18, textAlign: "center" }}
        >
          Automatische Nutzungsdaten
        </Text>

        <Text style={{ color: THEME.primary, textAlign: "center" }}>
          Tägliche Eintragszeit: {dailyTime}{" "}
          {Platform.OS !== "android" ? "(Android erforderlich)" : ""}
        </Text>

        <View style={{ alignItems: "center" }}>
          <Button
            title="Zeit ändern"
            color={THEME.primary}
            onPress={() => setShowTimePicker(true)}
          />
        </View>

        {showTimePicker && (
          <DateTimePicker
            value={hhmmToDate(dailyTime)}
            mode="time"
            is24Hour
            display="default"
            onChange={(_e, selected) => {
              if (Platform.OS === "android") setShowTimePicker(false);
              const d = selected || hhmmToDate(dailyTime);
              const hh = String(d.getHours()).padStart(2, "0");
              const mm = String(d.getMinutes()).padStart(2, "0");
              const next = `${hh}:${mm}`;
              setDailyTime(next);
              setDailyTargetTime(next).catch(() => {});
            }}
          />
        )}

        <Text style={{ color: THEME.primary, textAlign: "center" }}>
          Berechtigung: {hasUsagePermission ? "erteilt" : "fehlend"}
        </Text>

        <View style={{ alignItems: "center" }}>
          <Button
            title="Berechtigung anfragen/öffnen"
            color={THEME.primary}
            onPress={async () => {
              const granted = await promptUsageAccessIfNeeded();
              setHasUsagePermission(granted);
            }}
          />
        </View>

        <View style={{ alignItems: "center", marginTop: 8 }}>
          <Button
            title="Jetzt synchronisieren"
            color={THEME.primary}
            onPress={async () => {
              try {
                await runOnceNow();
              } catch (e) {}
            }}
          />
        </View>
      </View>

      <Button
        title="Fragen einstellen"
        color={THEME.primary}
        onPress={() => navigation.navigate("GroupManager")}
      />
      <View style={{ height: 12 }} />
      <Button
        title="Benachrichtigung"
        color={THEME.primary}
        onPress={() => navigation.navigate("Notifications")}
      />
    </View>
  );
}
