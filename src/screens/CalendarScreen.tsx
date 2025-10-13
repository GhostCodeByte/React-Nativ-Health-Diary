import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Button,
  Modal,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

// Dynamic import to avoid bundling issues if package is not installed yet
let CalendarComp: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const RNCalendars = require("react-native-calendars");
  CalendarComp = RNCalendars?.Calendar ?? RNCalendars?.default ?? null;
} catch {
  CalendarComp = null;
}

// Dynamic time picker
let DateTimePickerComp: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const DTP = require("@react-native-community/datetimepicker");
  DateTimePickerComp = DTP?.default ?? DTP;
} catch {
  DateTimePickerComp = null;
}

// Supabase helpers
import {
  isSupabaseConfigured,
  supaGetDiaryEntriesInRange,
  supaGetDiaryEntriesByDate,
  supaGetQuestions,
  supaSetDiaryEntry,
} from "../services/supabase";
import type { AnswerType, DiaryEntry, EntryValue, Question } from "../types";

const THEME = {
  background: "#F5F5DC",
  text: "#808080",
  border: "#C0C0C0",
  primary: "#808080",
  muted: "#A9A9A9",
  surface: "#FFFFFF",
  ok: "#2E7D32",
  warn: "#FB8C00",
  none: "#BDBDBD",
  accent: "#FF5722",
};

type DayKey = string; // "YYYY-MM-DD"
type EntriesByDate = Record<DayKey, DiaryEntry[]>;
type EntriesByQuestion = Record<number, DiaryEntry | undefined>;

export default function CalendarScreen() {
  const [loading, setLoading] = useState(true);
  const [monthCursor, setMonthCursor] = useState(getYYYYMM(new Date())); // "YYYY-MM"
  const [questions, setQuestions] = useState<Question[]>([]);
  const [entriesByDate, setEntriesByDate] = useState<EntriesByDate>({});
  const [selectedDate, setSelectedDate] = useState<DayKey | null>(null);
  const [dayEntries, setDayEntries] = useState<EntriesByQuestion>({});
  const [editing, setEditing] = useState<{
    question: Question | null;
    value: EntryValue;
    timeDraft: string; // for time entry
    multiDraft: string[]; // for multi
    boolThenTime:
      | { phase: "decide"; value: EntryValue }
      | { phase: "time"; value: EntryValue };
    date: DayKey | null;
  }>({
    question: null,
    value: "",
    timeDraft: defaultHHMM(new Date()),
    multiDraft: [],
    boolThenTime: { phase: "decide", value: false },
    date: null,
  });

  // Load questions and month entries
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!isSupabaseConfigured()) {
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const [qs, rangeEntries] = await Promise.all([
          supaGetQuestions(),
          loadMonthEntries(monthCursor),
        ]);
        if (cancelled) return;
        setQuestions(qs);
        setEntriesByDate(rangeEntries);
      } catch (err: any) {
        if (!cancelled) {
          Alert.alert(
            "Fehler",
            err?.message || "Kalenderdaten konnten nicht geladen werden.",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [monthCursor]);

  // Markings for calendar
  const markedDates = useMemo(() => {
    const activeQs = questions.filter((q) => q.active !== false);
    const map: Record<string, any> = {};
    const [start, end] = getMonthRange(monthCursor);
    const days = enumerateDays(start, end);
    for (const d of days) {
      const entries = entriesByDate[d] || [];
      const completion = completionRatio(entries, activeQs);
      if (completion > 0) {
        map[d] = {
          marked: true,
          dotColor: completion >= 1 ? THEME.ok : THEME.warn,
        };
      } else if (entries.length > 0) {
        // Only nulls (skips)
        map[d] = { marked: true, dotColor: THEME.none };
      }
      // Highlight today lightly
      if (d === yyyyMMdd(new Date())) {
        map[d] = {
          ...(map[d] || {}),
          selected: true,
          selectedColor: "#E0E0E0",
          selectedTextColor: THEME.text,
        };
      }
    }
    return map;
  }, [entriesByDate, questions, monthCursor]);

  // Streak: consecutive full-completion days ending at today
  const streak = useMemo(() => {
    const today = new Date();
    const activeQs = questions.filter((q) => q.active !== false);
    let streakCount = 0;
    let cursor = new Date(today);
    for (;;) {
      const d = yyyyMMdd(cursor);
      const entries = entriesByDate[d] || [];
      const ratio = completionRatio(entries, activeQs);
      if (ratio >= 1) {
        streakCount += 1;
        cursor = addDays(cursor, -1);
      } else {
        break;
      }
    }
    return streakCount;
  }, [entriesByDate, questions]);

  const onMonthChange = useCallback((monthObj: any) => {
    // monthObj: {year, month, day, ...}
    if (!monthObj || !monthObj.year || !monthObj.month) return;
    const y = String(monthObj.year);
    const m = String(monthObj.month).padStart(2, "0");
    setMonthCursor(`${y}-${m}`);
  }, []);

  const handleDayPress = useCallback(
    async (day: any) => {
      try {
        const d = day?.dateString || "";
        if (!d || !isYYYYMMDD(d)) return;

        // Fetch questions and entries for that date
        setSelectedDate(d);
        setLoading(true);
        const [qs, entries] = await Promise.all([
          questions.length ? questions : supaGetQuestions(),
          supaGetDiaryEntriesByDate(d),
        ]);

        const activeQs = qs.filter((q) => q.active !== false);
        const map: EntriesByQuestion = {};
        for (const e of entries) {
          map[e.questionID] = e;
        }
        // Ensure missing questions show as undefined
        for (const q of activeQs) {
          if (!map[q.id]) map[q.id] = undefined;
        }

        setQuestions(qs);
        setDayEntries(map);
      } catch (err: any) {
        Alert.alert(
          "Fehler",
          err?.message || "Konnte Tagesdetails nicht laden.",
        );
        setSelectedDate(null);
      } finally {
        setLoading(false);
      }
    },
    [questions],
  );

  const openEdit = useCallback(
    (q: Question) => {
      if (!selectedDate) return;
      const existing = dayEntries[q.id];
      const baseTime = existing?.time || defaultHHMM(new Date());
      const baseValue =
        existing?.value ??
        (q.answerType === "multi"
          ? []
          : q.answerType === "boolean"
            ? false
            : "");
      setEditing({
        question: q,
        value: baseValue,
        timeDraft:
          q.answerType === "time" || q.answerType === "boolean_then_time"
            ? typeof baseValue === "string" && isHHMM(baseValue)
              ? baseValue
              : baseTime
            : baseTime,
        multiDraft: Array.isArray(baseValue) ? baseValue.map(String) : [],
        boolThenTime:
          q.answerType === "boolean_then_time"
            ? typeof baseValue === "string" && isHHMM(baseValue)
              ? { phase: "time", value: baseValue }
              : { phase: "decide", value: false }
            : { phase: "decide", value: false },
        date: selectedDate,
      });
    },
    [selectedDate, dayEntries],
  );

  const closeEdit = useCallback(() => {
    setEditing({
      question: null,
      value: "",
      timeDraft: defaultHHMM(new Date()),
      multiDraft: [],
      boolThenTime: { phase: "decide", value: false },
      date: null,
    });
  }, []);

  const saveEdit = useCallback(async () => {
    if (!editing.question || !editing.date) return;
    try {
      const q = editing.question;
      const date = editing.date;

      // derive value
      let newValue: EntryValue = editing.value;
      if (q.answerType === "time") {
        newValue = editing.timeDraft;
      } else if (q.answerType === "boolean_then_time") {
        if (editing.boolThenTime.phase === "decide") {
          // If still in decide phase and value is false/true
          if (editing.boolThenTime.value === false) {
            newValue = false;
          } else {
            // shouldn't happen; fallback
            newValue = editing.timeDraft;
          }
        } else {
          // time phase
          newValue = editing.timeDraft;
        }
      } else if (q.answerType === "multi") {
        newValue = editing.multiDraft;
      }

      // use current time for non-time types
      const chosenTime =
        q.answerType === "time" || q.answerType === "boolean_then_time"
          ? typeof newValue === "string" && isHHMM(newValue)
            ? newValue
            : defaultHHMM(new Date())
          : defaultHHMM(new Date());

      const entry: DiaryEntry = {
        id: 0,
        questionID: q.id,
        date,
        time: chosenTime,
        value: newValue,
        forDay: (q.refDay ?? "today") as "today" | "yesterday",
      };

      await supaSetDiaryEntry(entry);

      // Update UI maps: dayEntries and entriesByDate for the date
      const nextDayEntries = { ...dayEntries, [q.id]: entry };
      setDayEntries(nextDayEntries);

      setEntriesByDate((prev) => {
        const arr = [...(prev[date] || [])];
        const idx = arr.findIndex((e) => e.questionID === q.id);
        if (idx >= 0) arr[idx] = entry;
        else arr.push(entry);
        return { ...prev, [date]: arr };
      });

      closeEdit();
    } catch (err: any) {
      Alert.alert(
        "Fehler",
        err?.message || "Antwort konnte nicht gespeichert werden.",
      );
    }
  }, [editing, dayEntries, closeEdit]);

  const skipEdit = useCallback(async () => {
    if (!editing.question || !editing.date) return;
    try {
      const q = editing.question;
      const date = editing.date;
      const entry: DiaryEntry = {
        id: 0,
        questionID: q.id,
        date,
        time: defaultHHMM(new Date()),
        value: null,
        forDay: (q.refDay ?? "today") as "today" | "yesterday",
      };
      await supaSetDiaryEntry(entry);

      const nextDayEntries = { ...dayEntries, [q.id]: entry };
      setDayEntries(nextDayEntries);

      setEntriesByDate((prev) => {
        const arr = [...(prev[date] || [])];
        const idx = arr.findIndex((e) => e.questionID === q.id);
        if (idx >= 0) arr[idx] = entry;
        else arr.push(entry);
        return { ...prev, [date]: arr };
      });

      closeEdit();
    } catch (err: any) {
      Alert.alert("Fehler", err?.message || "Überspringen fehlgeschlagen.");
    }
  }, [editing, dayEntries, closeEdit]);

  const selectedDayQuestions = useMemo(() => {
    if (!selectedDate) return [];
    return questions.filter((q) => q.active !== false);
  }, [selectedDate, questions]);

  const selectedDayCompletion = useMemo(() => {
    if (!selectedDate) return 0;
    const activeQs = questions.filter((q) => q.active !== false);
    const entries = entriesByDate[selectedDate] || [];
    return completionRatio(entries, activeQs);
  }, [selectedDate, entriesByDate, questions]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: THEME.background }}>
      <View style={styles.header}>
        <Text style={styles.title}>Kalender</Text>
        <View style={styles.streakRow}>
          <Text style={styles.streakFlame}>🔥</Text>
          <Text style={styles.streakText}>{streak} Tage</Text>
        </View>
      </View>

      {loading && (
        <View style={styles.centerArea}>
          <ActivityIndicator size="large" color={THEME.text} />
        </View>
      )}

      {!loading && !CalendarComp && (
        <View style={styles.centerArea}>
          <Text style={{ color: THEME.text, textAlign: "center" }}>
            Das Kalender-Paket ist nicht installiert. Bitte füge
            react-native-calendars hinzu.
          </Text>
        </View>
      )}

      {!loading && CalendarComp && (
        <CalendarComp
          onMonthChange={onMonthChange}
          onDayPress={handleDayPress}
          markedDates={markedDates}
          theme={{
            calendarBackground: THEME.background,
            dayTextColor: THEME.text,
            monthTextColor: THEME.text,
            textDisabledColor: THEME.muted,
            arrowColor: THEME.primary,
            selectedDayBackgroundColor: "#E0E0E0",
          }}
          style={{ backgroundColor: THEME.background }}
        />
      )}

      {/* Day detail modal */}
      <Modal
        visible={!!selectedDate}
        animationType="slide"
        transparent
        onRequestClose={() => setSelectedDate(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCardLarge}>
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 8,
              }}
            >
              <Text style={styles.modalTitle}>
                {selectedDate} • {Math.round(selectedDayCompletion * 100)}%
              </Text>
              <TouchableOpacity onPress={() => setSelectedDate(null)}>
                <Text style={{ color: THEME.muted, fontSize: 18 }}>✕</Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: "75%" }}>
              {selectedDayQuestions.map((q) => {
                const e = dayEntries[q.id];
                return (
                  <TouchableOpacity
                    key={q.id}
                    onPress={() => openEdit(q)}
                    style={styles.questionRow}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.questionTitle}>{q.question}</Text>
                      <Text style={styles.questionMeta}>
                        Typ: {labelForAnswerType(q.answerType)}
                      </Text>
                    </View>
                    <View style={{ marginLeft: 8 }}>
                      <Text style={styles.answerPreview}>
                        {entryPreview(e)}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
              {!selectedDayQuestions.length && (
                <Text style={{ color: THEME.muted }}>
                  Keine aktiven Fragen vorhanden.
                </Text>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Edit modal */}
      <Modal
        visible={!!editing.question}
        animationType="slide"
        transparent
        onRequestClose={closeEdit}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 8,
              }}
            >
              <Text style={styles.modalTitle}>
                {editing.question?.question}
              </Text>
              <TouchableOpacity onPress={closeEdit}>
                <Text style={{ color: THEME.muted, fontSize: 18 }}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* Controls per type */}
            {renderEditControl({
              editing,
              setEditing,
              DateTimePickerComp,
            })}

            <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
              <View style={{ flex: 1 }}>
                <Button
                  title="Speichern"
                  color={THEME.primary}
                  onPress={saveEdit}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Button
                  title="Überspringen"
                  color={THEME.muted}
                  onPress={skipEdit}
                />
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

/**
 * Render edit controls for a question based on answerType.
 */
function renderEditControl({
  editing,
  setEditing,
  DateTimePickerComp,
}: {
  editing: {
    question: Question | null;
    value: EntryValue;
    timeDraft: string;
    multiDraft: string[];
    boolThenTime:
      | { phase: "decide"; value: EntryValue }
      | { phase: "time"; value: EntryValue };
    date: DayKey | null;
  };
  setEditing: React.Dispatch<React.SetStateAction<any>>;
  DateTimePickerComp: any;
}) {
  const q = editing.question;
  if (!q) return null;

  const commonStyles = {
    label: { color: THEME.text, fontSize: 16, marginBottom: 6 } as const,
    input: {
      borderWidth: 1,
      borderColor: THEME.border,
      backgroundColor: "#FFFFFF",
      color: THEME.text,
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderRadius: 6,
      fontSize: 16,
    } as const,
    button: {
      paddingVertical: 12,
      paddingHorizontal: 16,
      backgroundColor: THEME.primary,
      borderRadius: 6,
      alignItems: "center" as const,
      marginVertical: 6,
    },
    buttonText: { color: "#FFF", fontSize: 16 } as const,
    outlineButton: {
      paddingVertical: 12,
      paddingHorizontal: 16,
      borderWidth: 1,
      borderColor: THEME.primary,
      borderRadius: 6,
      alignItems: "center" as const,
      marginVertical: 6,
    },
    outlineButtonText: { color: THEME.primary, fontSize: 16 } as const,
  };

  switch (q.answerType) {
    case "boolean":
      return (
        <View>
          <TouchableOpacity
            style={commonStyles.button}
            onPress={() => setEditing((s: any) => ({ ...s, value: true }))}
          >
            <Text style={commonStyles.buttonText}>Ja</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={commonStyles.outlineButton}
            onPress={() => setEditing((s: any) => ({ ...s, value: false }))}
          >
            <Text style={commonStyles.outlineButtonText}>Nein</Text>
          </TouchableOpacity>
        </View>
      );

    case "text":
      return (
        <View>
          <Text style={commonStyles.label}>Antwort</Text>
          <TextInput
            style={commonStyles.input}
            value={String(editing.value ?? "")}
            onChangeText={(v) => setEditing((s: any) => ({ ...s, value: v }))}
            placeholder="Tippe deine Antwort..."
            placeholderTextColor={THEME.muted}
            multiline
          />
        </View>
      );

    case "number":
    case "scale": {
      const unit = q.unit ? ` ${q.unit}` : "";
      const hint =
        typeof q.min === "number" && typeof q.max === "number"
          ? ` (${q.min} - ${q.max}${unit})`
          : unit;
      return (
        <View>
          <Text style={commonStyles.label}>Wert{hint}</Text>
          <TextInput
            style={commonStyles.input}
            value={String(editing.value ?? "")}
            onChangeText={(v) =>
              setEditing((s: any) => ({
                ...s,
                value: v.replace(/[^0-9.,-]/g, "").replace(",", "."),
              }))
            }
            keyboardType="numeric"
            placeholder={`Zahl${hint}`}
            placeholderTextColor={THEME.muted}
          />
        </View>
      );
    }

    case "multi": {
      const options = Array.isArray(q.options) ? q.options.map(String) : [];
      return (
        <View>
          <Text style={commonStyles.label}>Optionen</Text>
          <View style={{ gap: 8 }}>
            {options.map((opt) => {
              const selected = editing.multiDraft.includes(opt);
              return (
                <TouchableOpacity
                  key={opt}
                  style={{
                    paddingVertical: 10,
                    paddingHorizontal: 12,
                    borderWidth: 1,
                    borderColor: selected ? THEME.primary : THEME.border,
                    borderRadius: 6,
                    backgroundColor: "#FFFFFF",
                  }}
                  onPress={() =>
                    setEditing((s: any) => ({
                      ...s,
                      multiDraft: selected
                        ? s.multiDraft.filter((x: string) => x !== opt)
                        : [...s.multiDraft, opt],
                      value: selected
                        ? s.multiDraft.filter((x: string) => x !== opt)
                        : [...s.multiDraft, opt],
                    }))
                  }
                >
                  <Text style={{ color: THEME.text, fontSize: 16 }}>{opt}</Text>
                </TouchableOpacity>
              );
            })}
            {!options.length && (
              <Text style={{ color: THEME.muted }}>
                Keine Optionen definiert.
              </Text>
            )}
          </View>
        </View>
      );
    }

    case "time": {
      const initial = parseHHMMtoDate(editing.timeDraft);
      return (
        <View>
          <Text style={commonStyles.label}>Uhrzeit (HH:mm)</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text style={{ color: THEME.text, fontSize: 16 }}>
              {editing.timeDraft || "--:--"}
            </Text>
          </View>
          {DateTimePickerComp && (
            <DateTimePickerComp
              value={initial}
              mode="time"
              is24Hour
              display="default"
              onChange={(_e: any, dt?: Date) => {
                const d = dt ?? initial;
                const v = defaultHHMM(d);
                setEditing((s: any) => ({ ...s, timeDraft: v, value: v }));
              }}
            />
          )}
          {!DateTimePickerComp && (
            <Text style={{ color: THEME.muted }}>
              Zeit-Auswähler nicht verfügbar. Bitte installiere
              @react-native-community/datetimepicker.
            </Text>
          )}
        </View>
      );
    }

    case "boolean_then_time": {
      // Provide both a "Nein" button and a time picker for "Ja"
      const initial = parseHHMMtoDate(editing.timeDraft);
      return (
        <View>
          <Text style={commonStyles.label}>Zuerst Ja/Nein, dann Uhrzeit</Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <View style={{ flex: 1 }}>
              <TouchableOpacity
                style={commonStyles.button}
                onPress={() =>
                  setEditing((s: any) => ({
                    ...s,
                    boolThenTime: { phase: "decide", value: false },
                    value: false,
                  }))
                }
              >
                <Text style={commonStyles.buttonText}>Nein</Text>
              </TouchableOpacity>
            </View>
          </View>

          <Text style={[commonStyles.label, { marginTop: 10 }]}>
            Wenn Ja: Uhrzeit
          </Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text style={{ color: THEME.text, fontSize: 16 }}>
              {editing.timeDraft || "--:--"}
            </Text>
          </View>
          {DateTimePickerComp && (
            <DateTimePickerComp
              value={initial}
              mode="time"
              is24Hour
              display="default"
              onChange={(_e: any, dt?: Date) => {
                const d = dt ?? initial;
                const v = defaultHHMM(d);
                setEditing((s: any) => ({
                  ...s,
                  timeDraft: v,
                  boolThenTime: { phase: "time", value: v },
                  value: v,
                }));
              }}
            />
          )}
          {!DateTimePickerComp && (
            <Text style={{ color: THEME.muted }}>
              Zeit-Auswähler nicht verfügbar. Bitte installiere
              @react-native-community/datetimepicker.
            </Text>
          )}
        </View>
      );
    }

    default:
      return (
        <Text style={{ color: THEME.muted }}>
          Dieser Fragetyp wird derzeit nicht unterstützt.
        </Text>
      );
  }
}

/**
 * Helpers
 */

async function loadMonthEntries(yyyymm: string): Promise<EntriesByDate> {
  const [start, end] = getMonthRange(yyyymm);
  const items = await supaGetDiaryEntriesInRange(start, end);
  const map: EntriesByDate = {};
  for (const e of items) {
    if (!map[e.date]) map[e.date] = [];
    map[e.date].push(e);
  }
  return map;
}

function getYYYYMM(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function getMonthRange(yyyymm: string): [string, string] {
  const [yearStr, monthStr] = yyyymm.split("-");
  const y = Number(yearStr);
  const m = Number(monthStr) - 1;
  const start = new Date(y, m, 1);
  const end = new Date(y, m + 1, 0);
  return [yyyyMMdd(start), yyyyMMdd(end)];
}

function enumerateDays(startISO: string, endISO: string): string[] {
  const res: string[] = [];
  let d = parseISO(startISO);
  const end = parseISO(endISO);
  while (d <= end) {
    res.push(yyyyMMdd(d));
    d = addDays(d, 1);
  }
  return res;
}

function parseISO(s: string): Date {
  const [y, m, d] = s.split("-").map((x) => Number(x));
  return new Date(y, m - 1, d);
}

function yyyyMMdd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(d: Date, days: number): Date {
  const res = new Date(d);
  res.setDate(res.getDate() + days);
  return res;
}

function completionRatio(entries: DiaryEntry[], activeQs: Question[]): number {
  if (!activeQs.length) return 0;
  const qIds = new Set(activeQs.map((q) => q.id));
  let answered = 0;
  for (const e of entries) {
    if (!qIds.has(e.questionID)) continue;
    if (e.value !== null && typeof e.value !== "undefined") answered++;
  }
  return answered / activeQs.length;
}

function isYYYYMMDD(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function defaultHHMM(d: Date): string {
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function isHHMM(s: any): s is string {
  const v = String(s || "");
  const m = /^(\d{2}):(\d{2})$/.exec(v);
  if (!m) return false;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  return (
    Number.isFinite(h) &&
    Number.isFinite(mi) &&
    h >= 0 &&
    h <= 23 &&
    mi >= 0 &&
    mi <= 59
  );
}

function parseHHMMtoDate(s: string): Date {
  if (isHHMM(s)) {
    const d = new Date();
    const [hh, mm] = s.split(":").map((x) => Number(x));
    d.setHours(hh, mm, 0, 0);
    return d;
  }
  return new Date();
}

function labelForAnswerType(t: AnswerType): string {
  switch (t) {
    case "boolean":
      return "Ja/Nein";
    case "number":
      return "Zahl";
    case "scale":
      return "Skala";
    case "text":
      return "Text";
    case "multi":
      return "Mehrfachauswahl";
    case "time":
      return "Zeit";
    case "boolean_then_time":
      return "Ja/Nein → Zeit";
    default:
      return t;
  }
}

function entryPreview(e?: DiaryEntry) {
  if (!e) return "—";
  if (e.value === null || typeof e.value === "undefined")
    return "⟲ (übersprungen)";
  if (typeof e.value === "boolean") return e.value ? "Ja" : "Nein";
  if (typeof e.value === "number") return String(e.value);
  if (typeof e.value === "string") return e.value;
  if (Array.isArray(e.value)) return e.value.join(", ");
  try {
    return JSON.stringify(e.value);
  } catch {
    return "—";
  }
}

/**
 * Styles
 */
const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    backgroundColor: THEME.background,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: {
    color: THEME.text,
    fontSize: 20,
    fontWeight: "600",
  },
  streakRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  streakFlame: {
    fontSize: 20,
    marginRight: 6,
  },
  streakText: {
    color: THEME.accent,
    fontSize: 16,
    fontWeight: "700",
  },
  centerArea: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  modalCard: {
    width: "100%",
    backgroundColor: THEME.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: THEME.border,
    padding: 16,
  },
  modalCardLarge: {
    width: "100%",
    maxHeight: "85%",
    backgroundColor: THEME.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: THEME.border,
    padding: 16,
  },
  modalTitle: {
    color: THEME.text,
    fontSize: 18,
    fontWeight: "700",
  },
  questionRow: {
    borderWidth: 1,
    borderColor: THEME.border,
    borderRadius: 8,
    padding: 12,
    marginBottom: 10,
    backgroundColor: "#FFFFFF",
    flexDirection: "row",
    alignItems: "center",
  },
  questionTitle: {
    color: THEME.text,
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 4,
  },
  questionMeta: {
    color: THEME.muted,
    fontSize: 12,
  },
  answerPreview: {
    color: THEME.text,
    fontSize: 14,
  },
});
