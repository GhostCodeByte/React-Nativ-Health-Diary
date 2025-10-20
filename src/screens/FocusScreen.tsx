import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Button,
  Keyboard,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useIsFocused, useRoute } from "@react-navigation/native";

import {
  isSupabaseConfigured,
  supaGetQuestions,
  supaInsertDiaryEntry,
  supaHasAnsweredQuestionOnDate,
} from "../services/supabase";
import type { DiaryEntry, EntryValue, Question } from "../types";

const THEME = {
  background: "#F5F5DC",
  text: "#808080",
  border: "#C0C0C0",
  primary: "#808080",
  muted: "#A9A9A9",
};

type LoadState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "error"; error: string }
  | { kind: "done" };

export default function FocusScreen() {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [index, setIndex] = useState(0);
  const [loadState, setLoadState] = useState<LoadState>({ kind: "idle" });
  const route = useRoute();
  const isFocused = useIsFocused();

  // Per-question transient answer state
  const [textValue, setTextValue] = useState("");
  const [numberValue, setNumberValue] = useState<string>(""); // keep as string to avoid locale issues
  const [multiValue, setMultiValue] = useState<string[]>([]);
  const [timeValue, setTimeValue] = useState<string>("");
  const [boolThenTimePhase, setBoolThenTimePhase] = useState<"ask" | "time">(
    "ask",
  );
  const [showTimePicker, setShowTimePicker] = useState(false);

  const DateTimePickerMod: any = (() => {
    try {
      return require("@react-native-community/datetimepicker");
    } catch {
      return null;
    }
  })();
  const DTP = DateTimePickerMod?.default ?? DateTimePickerMod;

  const current = questions[index];

  // Initialize defaults whenever question changes
  useEffect(() => {
    if (!current) return;
    if (current.answerType === "text") {
      setTextValue("");
      setBoolThenTimePhase("ask");
    } else if (
      current.answerType === "number" ||
      current.answerType === "scale"
    ) {
      const start = typeof current.min === "number" ? current.min : 0;
      setNumberValue(String(start));
      setBoolThenTimePhase("ask");
    } else if (current.answerType === "multi") {
      setMultiValue([]);
      setBoolThenTimePhase("ask");
    } else if (current.answerType === "time") {
      const now = new Date();
      const hh = String(now.getHours()).padStart(2, "0");
      const mm = String(now.getMinutes()).padStart(2, "0");
      setTimeValue(`${hh}:${mm}`);
      setBoolThenTimePhase("ask");
    } else if (current.answerType === "boolean_then_time") {
      const now = new Date();
      const hh = String(now.getHours()).padStart(2, "0");
      const mm = String(now.getMinutes()).padStart(2, "0");
      setTimeValue(`${hh}:${mm}`);
      setBoolThenTimePhase("ask");
    }
  }, [current?.id]);

  const progressLabel = useMemo(() => {
    if (!questions.length) return "";
    return `${index + 1}/${questions.length}`;
  }, [index, questions.length]);

  useEffect(() => {
    let cancelled = false;
    if (!isFocused) return;

    async function bootstrap() {
      setLoadState({ kind: "loading" });
      try {
        if (!isSupabaseConfigured()) {
          throw new Error(
            "Supabase nicht konfiguriert. Bitte setze EXPO_PUBLIC_SUPABASE_URL und EXPO_PUBLIC_SUPABASE_ANON_KEY.",
          );
        }

        const loaded: Question[] = await supaGetQuestions();

        if (!cancelled) {
          const now = new Date();
          const today = now.toISOString().slice(0, 10);
          const hour = now.getHours();
          const isEvening = hour >= 18;

          // Honor timeOfDay: show all when 'both' (immer); only evening for 'evening'
          let filtered: Question[] = loaded.filter((q) => {
            const rawTimeOfDay = q.timeOfDay ?? "both";
            const tod = rawTimeOfDay === "evening" ? "evening" : "both";
            return tod === "both" || (tod === "evening" && isEvening);
          });

          try {
            const keepFlags = await Promise.all(
              filtered.map(async (q) => {
                if (q.askOncePerDay) {
                  const answered = await supaHasAnsweredQuestionOnDate(
                    q.id,
                    today,
                  );
                  return !answered;
                }
                return true;
              }),
            );
            filtered = filtered.filter((_, idx) => keepFlags[idx]);
          } catch {
            // Keep timeOfDay filtering even if this fails
            filtered = filtered;
          }

          const qid = (route as any)?.params?.questionId;
          const startIdx =
            typeof qid === "number"
              ? filtered.findIndex((q) => q.id === qid)
              : -1;

          setQuestions(filtered);
          setIndex(startIdx >= 0 ? startIdx : 0);
          setLoadState({ kind: "ready" });
        }
      } catch (err: any) {
        if (!cancelled) {
          setLoadState({
            kind: "error",
            error: err?.message || "Fehler beim Laden der Fragen.",
          });
        }
      }
    }

    bootstrap();
    return () => {
      cancelled = true;
    };
  }, [isFocused, (route as any)?.params?.questionId]);

  const handleSubmit = useCallback(
    async (explicitValue?: EntryValue) => {
      if (!current) return;

      // Determine the value to persist
      const value = (() => {
        if (typeof explicitValue !== "undefined") return explicitValue;
        switch (current.answerType) {
          case "text":
            return textValue;
          case "number":
          case "scale": {
            const n = Number(numberValue);
            if (!Number.isFinite(n)) return null;
            return n;
          }
          case "time": {
            const v = String(timeValue).trim();
            const m = /^(\d{2}):(\d{2})$/.exec(v);
            if (!m) return null;
            const h = Number(m[1]);
            const mi = Number(m[2]);
            if (
              !Number.isFinite(h) ||
              !Number.isFinite(mi) ||
              h < 0 ||
              h > 23 ||
              mi < 0 ||
              mi > 59
            ) {
              return null;
            }
            return v;
          }
          case "multi":
            return multiValue;
          default:
            return null;
        }
      })();

      // Basic validation for text/number/scale/multi
      if (value === null) {
        Alert.alert("Ungültige Eingabe", "Bitte gib einen gültigen Wert ein.");
        return;
      }
      if (
        (current.answerType === "text" && String(value).trim().length === 0) ||
        (current.answerType === "multi" && (value as string[]).length === 0)
      ) {
        Alert.alert("Hinweis", "Bitte gib eine Antwort ein.");
        return;
      }

      // Prepare entry payload
      const now = new Date();
      const date = now.toISOString().slice(0, 10); // YYYY-MM-DD
      const time = now.toTimeString().slice(0, 5); // HH:mm
      const entry: DiaryEntry = {
        id: 0,
        questionID: current.id,
        date,
        time,
        value,
        forDay: (current.refDay ?? "today") as "today" | "yesterday",
      };

      // Try remote (if configured) then fallback to local
      try {
        await supaInsertDiaryEntry(entry);

        // Move to next question or finish
        if (index < questions.length - 1) {
          setIndex((i) => i + 1);
        } else {
          setLoadState({ kind: "done" });
          Alert.alert("Fertig!", "Du hast alle Fragen beantwortet.");
        }
      } catch (err: any) {
        Alert.alert(
          "Fehler",
          err?.message || "Antwort konnte nicht gespeichert werden.",
        );
      } finally {
        Keyboard.dismiss();
      }
    },
    [current, index, numberValue, questions.length, textValue, multiValue],
  );

  const handleSkip = useCallback(async () => {
    if (!current) return;

    const now = new Date();
    const date = now.toISOString().slice(0, 10); // YYYY-MM-DD
    const time = now.toTimeString().slice(0, 5); // HH:mm

    const entry: DiaryEntry = {
      id: 0,
      questionID: current.id,
      date,
      time,
      value: null,
      forDay: (current.refDay ?? "today") as "today" | "yesterday",
    };

    try {
      await supaInsertDiaryEntry(entry);

      if (index < questions.length - 1) {
        setIndex((i) => i + 1);
      } else {
        setLoadState({ kind: "done" });
        Alert.alert("Fertig!", "Du hast alle Fragen beantwortet.");
      }
    } catch (err: any) {
      Alert.alert(
        "Fehler",
        err?.message || "Antwort konnte nicht gespeichert werden.",
      );
    } finally {
      Keyboard.dismiss();
    }
  }, [current, index, questions.length]);

  const renderAnswerControl = () => {
    if (!current) return null;

    const commonStyles = {
      button: {
        paddingVertical: 14,
        paddingHorizontal: 16,
        backgroundColor: THEME.primary,
        borderRadius: 6,
        alignItems: "center" as const,
        marginVertical: 6,
      },
      buttonText: {
        color: "#FFF",
        fontSize: 18,
      },
      outlineButton: {
        paddingVertical: 14,
        paddingHorizontal: 16,
        borderWidth: 1,
        borderColor: THEME.primary,
        borderRadius: 6,
        alignItems: "center" as const,
        marginVertical: 6,
      },
      outlineButtonText: {
        color: THEME.primary,
        fontSize: 18,
      },
      label: {
        color: THEME.text,
        fontSize: 16,
        marginBottom: 8,
      },
      input: {
        borderWidth: 1,
        borderColor: THEME.border,
        backgroundColor: "#FFFFFF",
        color: THEME.text,
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderRadius: 6,
        fontSize: 16,
      },
    };

    switch (current.answerType) {
      case "boolean":
        return (
          <View>
            <TouchableOpacity
              style={commonStyles.button}
              onPress={() => handleSubmit(true)}
            >
              <Text style={commonStyles.buttonText}>Ja</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={commonStyles.outlineButton}
              onPress={() => handleSubmit(false)}
            >
              <Text style={commonStyles.outlineButtonText}>Nein</Text>
            </TouchableOpacity>
          </View>
        );

      case "text":
        return (
          <View>
            <Text style={commonStyles.label}>
              {current.placeholder || "Antwort"}
            </Text>
            <TextInput
              style={commonStyles.input}
              value={textValue}
              onChangeText={setTextValue}
              placeholder={current.placeholder || "Tippe deine Antwort..."}
              placeholderTextColor={THEME.muted}
              multiline
            />
            <View style={{ height: 12 }} />
            <Button
              color={THEME.primary}
              title="Speichern"
              onPress={() => handleSubmit()}
            />
          </View>
        );

      case "number":
      case "scale": {
        const unit = current.unit ? ` ${current.unit}` : "";
        const hint =
          typeof current.min === "number" && typeof current.max === "number"
            ? ` (${current.min} - ${current.max}${unit})`
            : unit;

        return (
          <View>
            <Text style={commonStyles.label}>Wert{hint}</Text>
            <TextInput
              style={commonStyles.input}
              value={numberValue}
              onChangeText={setNumberValue}
              keyboardType="numeric"
              placeholder={`Zahl${hint}`}
              placeholderTextColor={THEME.muted}
            />
            <View style={{ height: 12 }} />
            <Button
              color={THEME.primary}
              title="Speichern"
              onPress={() => handleSubmit()}
            />
          </View>
        );
      }

      case "time": {
        const now = new Date();
        const initialDate = (() => {
          const m = /^(\d{2}):(\d{2})$/.exec(String(timeValue).trim());
          if (m) {
            const d = new Date();
            d.setHours(Number(m[1]), Number(m[2]), 0, 0);
            return d;
          }
          return now;
        })();
        return (
          <View>
            <Text style={commonStyles.label}>Uhrzeit (HH:mm)</Text>
            <View
              style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
            >
              <Text style={{ color: THEME.text, fontSize: 16 }}>
                {timeValue || "--:--"}
              </Text>
              <Button
                color={THEME.primary}
                title="Uhrzeit wählen"
                onPress={() => setShowTimePicker(true)}
              />
            </View>
            {DTP && showTimePicker && (
              <DTP
                value={initialDate}
                mode="time"
                is24Hour
                display="default"
                onChange={(_event: any, selectedDate?: Date) => {
                  if (Platform.OS === "android") setShowTimePicker(false);
                  const selected = selectedDate ?? initialDate;
                  if (selected) {
                    const hh = String(selected.getHours()).padStart(2, "0");
                    const mm = String(selected.getMinutes()).padStart(2, "0");
                    setTimeValue(`${hh}:${mm}`);
                  }
                }}
              />
            )}
            <View style={{ height: 12 }} />
            <Button
              color={THEME.primary}
              title="Speichern"
              onPress={() => handleSubmit()}
            />
          </View>
        );
      }

      case "multi": {
        const options = Array.isArray(current.options) ? current.options : [];
        return (
          <View>
            <Text style={{ color: THEME.text, fontSize: 16, marginBottom: 8 }}>
              Wähle eine oder mehrere Optionen
            </Text>
            <View style={{ gap: 8 }}>
              {options.map((opt) => {
                const selected = multiValue.includes(opt);
                return (
                  <TouchableOpacity
                    key={opt}
                    onPress={() => {
                      setMultiValue((prev) =>
                        prev.includes(opt)
                          ? prev.filter((o) => o !== opt)
                          : [...prev, opt],
                      );
                    }}
                    style={{
                      paddingVertical: 12,
                      paddingHorizontal: 12,
                      borderRadius: 6,
                      borderWidth: 1,
                      borderColor: selected ? THEME.primary : THEME.border,
                      backgroundColor: selected ? "#FFFFFF" : "#FFFFFF",
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <Text style={{ color: THEME.text, fontSize: 16 }}>
                      {opt}
                    </Text>
                    <View
                      style={{
                        width: 18,
                        height: 18,
                        borderRadius: 3,
                        borderWidth: 1,
                        borderColor: selected ? THEME.primary : THEME.border,
                        backgroundColor: selected
                          ? THEME.primary
                          : "transparent",
                      }}
                    />
                  </TouchableOpacity>
                );
              })}
            </View>
            <View style={{ height: 12 }} />
            <Button
              color={THEME.primary}
              title="Speichern"
              onPress={() => handleSubmit()}
            />
          </View>
        );
      }

      case "boolean_then_time": {
        if (boolThenTimePhase === "ask") {
          return (
            <View>
              <TouchableOpacity
                style={commonStyles.button}
                onPress={() => setBoolThenTimePhase("time")}
              >
                <Text style={commonStyles.buttonText}>Ja</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={commonStyles.outlineButton}
                onPress={() => handleSubmit(false)}
              >
                <Text style={commonStyles.outlineButtonText}>Nein</Text>
              </TouchableOpacity>
            </View>
          );
        }
        const now = new Date();
        const initialDate = (() => {
          const m = /^(\d{2}):(\d{2})$/.exec(String(timeValue).trim());
          if (m) {
            const d = new Date();
            d.setHours(Number(m[1]), Number(m[2]), 0, 0);
            return d;
          }
          return now;
        })();
        return (
          <View>
            <Text style={commonStyles.label}>Uhrzeit (HH:mm)</Text>
            <View
              style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
            >
              <Text style={{ color: THEME.text, fontSize: 16 }}>
                {timeValue || "--:--"}
              </Text>
              <Button
                color={THEME.primary}
                title="Uhrzeit wählen"
                onPress={() => setShowTimePicker(true)}
              />
            </View>
            {DTP && showTimePicker && (
              <DTP
                value={initialDate}
                mode="time"
                is24Hour
                display="default"
                onChange={(_event: any, selectedDate?: Date) => {
                  if (Platform.OS === "android") setShowTimePicker(false);
                  const selected = selectedDate ?? initialDate;
                  if (selected) {
                    const hh = String(selected.getHours()).padStart(2, "0");
                    const mm = String(selected.getMinutes()).padStart(2, "0");
                    setTimeValue(`${hh}:${mm}`);
                  }
                }}
              />
            )}
            <View style={{ height: 12 }} />
            <Button
              color={THEME.primary}
              title="Speichern"
              onPress={() => handleSubmit(timeValue)}
            />
          </View>
        );
      }

      default:
        return (
          <View>
            <Text style={{ color: THEME.text, marginBottom: 8 }}>
              Dieser Fragetyp wird noch nicht unterstützt.
            </Text>
            <Button
              color={THEME.primary}
              title="Überspringen"
              onPress={() =>
                setIndex((i) => Math.min(i + 1, questions.length - 1))
              }
            />
          </View>
        );
    }
  };

  if (loadState.kind === "loading" || loadState.kind === "idle") {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: THEME.background,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <ActivityIndicator size="large" color={THEME.text} />
        <Text style={{ color: THEME.text, marginTop: 16 }}>Lade Fragen...</Text>
      </View>
    );
  }

  if (loadState.kind === "error") {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: THEME.background,
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
        }}
      >
        <Text style={{ color: THEME.text, textAlign: "center" }}>
          Fehler beim Laden: {loadState.error}
        </Text>
        <View style={{ height: 16 }} />
        <Button
          title="Erneut versuchen"
          color={THEME.primary}
          onPress={() => {
            // simple reload via toggling state
            setLoadState({ kind: "idle" });
            setQuestions([]);
            setIndex(0);
          }}
        />
      </View>
    );
  }

  if (loadState.kind === "done") {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: THEME.background,
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
        }}
      >
        <Text style={{ color: THEME.text, fontSize: 18, marginBottom: 8 }}>
          Alle Fragen beantwortet 🎉
        </Text>
        <Button
          title="Nochmal starten"
          color={THEME.primary}
          onPress={() => {
            setIndex(0);
            setLoadState({ kind: "ready" });
          }}
        />
      </View>
    );
  }

  if (!current) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: THEME.background,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text style={{ color: THEME.text }}>Keine Fragen gefunden.</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: THEME.background }}>
      <ScrollView contentContainerStyle={{ padding: 20 }}>
        {/* Progress */}
        <Text style={{ color: THEME.muted, fontSize: 14, marginBottom: 8 }}>
          Frage {progressLabel}
        </Text>

        {/* Question */}
        <Text style={{ color: THEME.text, fontSize: 20, marginBottom: 20 }}>
          {current.question}
        </Text>

        {/* Answer control */}
        {renderAnswerControl()}

        {/* Secondary controls */}
        <View style={{ height: 16 }} />
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <View style={{ flex: 1, marginRight: 8 }}>
            <Button
              color={THEME.muted}
              title="Zurück"
              disabled={index === 0}
              onPress={() => setIndex((i) => Math.max(0, i - 1))}
            />
          </View>
          <View style={{ flex: 1, marginLeft: 8 }}>
            <Button
              color={THEME.muted}
              title="Überspringen"
              onPress={handleSkip}
            />
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
