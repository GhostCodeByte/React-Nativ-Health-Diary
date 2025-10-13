import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";
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
// eslint-disable-next-line @typescript-eslint/no-var-requires
const RNDraggable = require("react-native-draggable-flatlist");
const DraggableFlatList = (RNDraggable?.default ?? RNDraggable) as any;
import {
  useIsFocused,
  useNavigation,
  useRoute,
} from "@react-navigation/native";
import type { AnswerType, Question } from "../types";
import {
  getSupabaseClient,
  isSupabaseConfigured,
  supaUpdateQuestion,
} from "../services/supabase";

type RouteParams = {
  groupId: number;
  groupName?: string;
};

const THEME = {
  background: "#F5F5DC",
  text: "#808080",
  border: "#C0C0C0",
  primary: "#808080",
  muted: "#A9A9A9",
  surface: "#FFFFFF",
};

type QuestionForm = {
  id?: number;
  question: string;
  answerType: AnswerType;
  min?: string;
  max?: string;
  step?: string;
  optionsText?: string;
  placeholder?: string;
  unit?: string;
  active: boolean;
};

export default function QuestionManagerScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const isFocused = useIsFocused();

  const { groupId, groupName } = (route.params || {}) as RouteParams;

  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(false);
  const [savingOrder, setSavingOrder] = useState(false);

  // Add/Edit modal state
  const [modalVisible, setModalVisible] = useState(false);
  const [form, setForm] = useState<QuestionForm | null>(null);
  const isEditing = !!form?.id;

  // Header: title and + button
  useLayoutEffect(() => {
    navigation.setOptions?.({
      title: groupName ? `Fragen – ${groupName}` : "Fragen",
      headerRight: () => (
        <TouchableOpacity
          onPress={startCreate}
          accessibilityRole="button"
          style={{ paddingHorizontal: 12, paddingVertical: 4 }}
        >
          <Text
            style={{ color: THEME.primary, fontSize: 22, fontWeight: "700" }}
          >
            +
          </Text>
        </TouchableOpacity>
      ),
    });
  }, [navigation, groupName]);

  // Load questions when focused or group changes
  useEffect(() => {
    if (isFocused) {
      void loadQuestions();
    }
  }, [isFocused, groupId]);

  const loadQuestions = useCallback(async () => {
    if (!isSupabaseConfigured()) {
      Alert.alert(
        "Supabase nicht konfiguriert",
        "Bitte setze EXPO_PUBLIC_SUPABASE_URL und EXPO_PUBLIC_SUPABASE_ANON_KEY in deiner .env.",
      );
      return;
    }
    setLoading(true);
    try {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from("questions")
        .select(
          [
            "id",
            "group_id",
            "question",
            "answer_type",
            "min",
            "max",
            "step",
            "options",
            "placeholder",
            "unit",
            "order",
            "active",
          ].join(", "),
        )
        .eq("group_id", groupId)
        .order("order", { ascending: true, nullsFirst: true })
        .order("id", { ascending: true });

      if (error) throw new Error(error.message || "Supabase Fehler");

      const items: Question[] = (data || []).map((row: any) => {
        const opts = Array.isArray(row.options)
          ? row.options.map(String)
          : row.options && typeof row.options === "string"
            ? tryParseStringArray(row.options)
            : undefined;
        return {
          id: Number(row.id),
          groupId:
            row.group_id === null || row.group_id === undefined
              ? null
              : Number(row.group_id),
          question: String(row.question ?? ""),
          answerType: String(row.answer_type ?? "") as Question["answerType"],
          min:
            row.min === null || row.min === undefined
              ? undefined
              : Number(row.min),
          max:
            row.max === null || row.max === undefined
              ? undefined
              : Number(row.max),
          step:
            row.step === null || row.step === undefined
              ? undefined
              : Number(row.step),
          options: opts,
          placeholder:
            row.placeholder === null || row.placeholder === undefined
              ? undefined
              : String(row.placeholder),
          unit:
            row.unit === null || row.unit === undefined
              ? undefined
              : String(row.unit),
          order:
            row.order === null || row.order === undefined
              ? undefined
              : Number(row.order),
          active:
            row.active === null || row.active === undefined
              ? undefined
              : Boolean(row.active),
        };
      });

      setQuestions(items);
    } catch (err: any) {
      Alert.alert(
        "Fehler",
        err?.message || "Fragen konnten nicht geladen werden.",
      );
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  const startCreate = useCallback(() => {
    setForm({
      question: "",
      answerType: "text",
      min: "",
      max: "",
      step: "",
      optionsText: "",
      placeholder: "",
      unit: "",
      active: true,
    });
    setModalVisible(true);
  }, []);

  const startEdit = useCallback((q: Question) => {
    setForm({
      id: q.id,
      question: q.question,
      answerType: q.answerType,
      min:
        typeof q.min === "number" && Number.isFinite(q.min)
          ? String(q.min)
          : "",
      max:
        typeof q.max === "number" && Number.isFinite(q.max)
          ? String(q.max)
          : "",
      step:
        typeof q.step === "number" && Number.isFinite(q.step)
          ? String(q.step)
          : "",
      optionsText: Array.isArray(q.options) ? q.options.join(", ") : "",
      placeholder: q.placeholder ?? "",
      unit: q.unit ?? "",
      active: q.active !== false,
    });
    setModalVisible(true);
  }, []);

  const closeModal = useCallback(() => {
    setModalVisible(false);
    setForm(null);
  }, []);

  // Save add/edit
  const handleSave = useCallback(async () => {
    if (!form) return;
    const text = form.question.trim();
    if (!text) {
      Alert.alert("Hinweis", "Bitte eine Frage eingeben.");
      return;
    }
    const payload = {
      group_id: groupId,
      question: text,
      answer_type: form.answerType,
      min: parseFloatOrNull(form.min),
      max: parseFloatOrNull(form.max),
      step: parseFloatOrNull(form.step),
      options: toOptionsArray(form.optionsText),
      placeholder: emptyToNull(form.placeholder),
      unit: emptyToNull(form.unit),
      active: form.active,
    };

    try {
      const supabase = getSupabaseClient();

      if (form.id) {
        const { error } = await supabase
          .from("questions")
          .update(payload)
          .eq("id", form.id);
        if (error)
          throw new Error(error.message || "Speichern fehlgeschlagen.");
        Alert.alert("Gespeichert", "Frage wurde aktualisiert.");
      } else {
        // place new question at end (order)
        const nextOrder = (questions?.length || 0) + 1;
        const { error } = await supabase
          .from("questions")
          .insert({ ...payload, order: nextOrder });
        if (error)
          throw new Error(error.message || "Erstellen fehlgeschlagen.");
        Alert.alert("Gespeichert", "Frage wurde erstellt.");
      }

      closeModal();
      await loadQuestions();
    } catch (err: any) {
      Alert.alert(
        "Fehler",
        err?.message || "Frage konnte nicht gespeichert werden.",
      );
    }
  }, [form, groupId, questions?.length, loadQuestions, closeModal]);

  // Drag end -> persist order
  const handleDragEnd = useCallback(
    async ({ data }: { data: Question[] }) => {
      // Compute new order values (1-based)
      const next = data.map((q, idx) => ({ ...q, order: idx + 1 }));
      setQuestions(next);

      // Determine changes to persist vs. previous positions
      const changes = next.filter(
        (q, idx) => q.order !== ((questions[idx]?.order as number) ?? idx + 1),
      );
      if (changes.length === 0) return;

      setSavingOrder(true);
      try {
        await Promise.all(
          changes.map((q) => supaUpdateQuestion(q.id, { order: q.order })),
        );
      } catch (err: any) {
        Alert.alert(
          "Fehler",
          err?.message || "Reihenfolge konnte nicht gespeichert werden.",
        );
        // Reload to recover from potential partial updates
        await loadQuestions();
      } finally {
        setSavingOrder(false);
      }
    },
    [questions, loadQuestions],
  );

  const renderItem = useCallback(
    ({ item, drag, isActive }: any) => {
      return (
        <TouchableOpacity
          onLongPress={drag}
          delayLongPress={150}
          activeOpacity={0.9}
          onPress={() => startEdit(item)}
          style={[
            styles.row,
            {
              borderColor: isActive ? THEME.primary : THEME.border,
              backgroundColor: THEME.surface,
            },
          ]}
        >
          <View style={styles.rowLeft}>
            <Text style={styles.rowTitle}>{item.question}</Text>
            <Text style={styles.rowSubtitle}>
              Typ: {labelForAnswerType(item.answerType)}
              {item.active === false ? " • inaktiv" : ""}
              {typeof item.order === "number" ? ` • #${item.order}` : ""}
            </Text>
          </View>
          <View style={styles.dragHint}>
            <Text style={{ color: THEME.muted, fontSize: 14 }}>
              {Platform.select({
                ios: "Lange drücken",
                android: "Lange drücken",
                default: "Drag",
              })}
            </Text>
          </View>
        </TouchableOpacity>
      );
    },
    [startEdit],
  );

  const empty = useMemo(
    () => !loading && questions.length === 0,
    [loading, questions.length],
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: THEME.background }}>
      <View style={styles.container}>
        <View style={styles.headerRow}>
          <Text style={styles.headerText}>
            {groupName ? `Fragen in Gruppe: ${groupName}` : "Fragen"}
          </Text>
          <View style={{ marginLeft: 8 }}>
            <Button
              title="Aktualisieren"
              color={THEME.primary}
              onPress={() => void loadQuestions()}
            />
          </View>
        </View>

        {loading && (
          <View style={styles.centerArea}>
            <ActivityIndicator size="large" color={THEME.text} />
            <Text style={{ color: THEME.text, marginTop: 8 }}>
              Lade Fragen…
            </Text>
          </View>
        )}

        {empty && (
          <View style={styles.centerArea}>
            <Text style={{ color: THEME.text, marginBottom: 12 }}>
              Noch keine Fragen vorhanden.
            </Text>
            <Button
              title="Neue Frage"
              color={THEME.primary}
              onPress={startCreate}
            />
          </View>
        )}

        {!loading && questions.length > 0 && (
          <>
            {savingOrder && (
              <View style={styles.banner}>
                <ActivityIndicator size="small" color={THEME.muted} />
                <Text style={styles.bannerText}>Speichere Reihenfolge…</Text>
              </View>
            )}
            <DraggableFlatList
              data={questions}
              keyExtractor={(item: any) => String(item.id)}
              onDragEnd={handleDragEnd}
              renderItem={renderItem}
              containerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
            />
          </>
        )}
      </View>

      {/* Add/Edit modal */}
      <Modal
        visible={modalVisible}
        animationType="slide"
        transparent
        onRequestClose={closeModal}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>
              {isEditing ? "Frage bearbeiten" : "Neue Frage erstellen"}
            </Text>

            {/* Form fields */}
            <LabeledInput
              label="Frage"
              value={form?.question ?? ""}
              onChangeText={(v) =>
                setForm((s) => (s ? { ...s, question: v } : s))
              }
            />

            <AnswerTypeSelector
              value={form?.answerType ?? "text"}
              onChange={(t) =>
                setForm((s) => (s ? { ...s, answerType: t } : s))
              }
            />

            {(form?.answerType === "number" ||
              form?.answerType === "scale") && (
              <>
                <LabeledInput
                  label="Min (optional)"
                  value={form?.min ?? ""}
                  keyboardType="numeric"
                  onChangeText={(v) =>
                    setForm((s) => (s ? { ...s, min: onlyNumberFloat(v) } : s))
                  }
                />
                <LabeledInput
                  label="Max (optional)"
                  value={form?.max ?? ""}
                  keyboardType="numeric"
                  onChangeText={(v) =>
                    setForm((s) => (s ? { ...s, max: onlyNumberFloat(v) } : s))
                  }
                />
                <LabeledInput
                  label="Schrittweite (optional)"
                  value={form?.step ?? ""}
                  keyboardType="numeric"
                  onChangeText={(v) =>
                    setForm((s) => (s ? { ...s, step: onlyNumberFloat(v) } : s))
                  }
                />
              </>
            )}

            {form?.answerType === "multi" && (
              <LabeledInput
                label="Optionen (Komma oder Zeilen getrennt)"
                value={form?.optionsText ?? ""}
                onChangeText={(v) =>
                  setForm((s) => (s ? { ...s, optionsText: v } : s))
                }
                multiline
              />
            )}

            <LabeledInput
              label="Platzhalter (optional)"
              value={form?.placeholder ?? ""}
              onChangeText={(v) =>
                setForm((s) => (s ? { ...s, placeholder: v } : s))
              }
            />
            <LabeledInput
              label="Einheit (optional)"
              value={form?.unit ?? ""}
              onChangeText={(v) => setForm((s) => (s ? { ...s, unit: v } : s))}
            />

            <ToggleRow
              label="Aktiv"
              value={form?.active ?? true}
              onToggle={() =>
                setForm((s) => (s ? { ...s, active: !s.active } : s))
              }
            />

            <View style={styles.modalButtons}>
              <View style={{ flex: 1, marginRight: 6 }}>
                <Button
                  title="Speichern"
                  color={THEME.primary}
                  onPress={handleSave}
                />
              </View>
              <View style={{ flex: 1, marginLeft: 6 }}>
                <Button
                  title="Abbrechen"
                  color={THEME.muted}
                  onPress={closeModal}
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
 * UI helpers
 */
function LabeledInput({
  label,
  value,
  onChangeText,
  keyboardType,
  multiline,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  keyboardType?: "default" | "numeric" | "url" | "email-address" | "phone-pad";
  multiline?: boolean;
}) {
  return (
    <View style={{ marginBottom: 10 }}>
      <Text style={{ color: THEME.text, fontSize: 14, marginBottom: 6 }}>
        {label}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType}
        multiline={multiline}
        placeholderTextColor={THEME.muted}
        style={{
          borderWidth: 1,
          borderColor: THEME.border,
          backgroundColor: "#FFFFFF",
          color: THEME.text,
          paddingHorizontal: 12,
          paddingVertical: multiline ? 10 : 8,
          borderRadius: 6,
          fontSize: 16,
          minHeight: multiline ? 80 : undefined,
        }}
      />
    </View>
  );
}

function AnswerTypeSelector({
  value,
  onChange,
}: {
  value: AnswerType;
  onChange: (t: AnswerType) => void;
}) {
  // Ensure new types like "time" and "boolean_then_time" are selectable
  const types: AnswerType[] = [
    "boolean",
    "number",
    "scale",
    "text",
    "multi",
    "time",
    "boolean_then_time",
  ];
  return (
    <View style={{ marginBottom: 10 }}>
      <Text style={{ color: THEME.text, fontSize: 14, marginBottom: 6 }}>
        Antworttyp
      </Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {types.map((t) => {
          const selected = t === value;
          return (
            <TouchableOpacity
              key={t}
              onPress={() => onChange(t)}
              style={{
                paddingVertical: 8,
                paddingHorizontal: 12,
                borderRadius: 6,
                borderWidth: 1,
                borderColor: selected ? THEME.primary : THEME.border,
                backgroundColor: selected ? THEME.primary : "#FFFFFF",
              }}
            >
              <Text
                style={{
                  color: selected ? "#FFFFFF" : THEME.text,
                  fontSize: 14,
                }}
              >
                {labelForAnswerType(t)}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

function ToggleRow({
  label,
  value,
  onToggle,
}: {
  label: string;
  value: boolean;
  onToggle: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onToggle}
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingVertical: 10,
        marginBottom: 8,
      }}
    >
      <Text style={{ color: THEME.text, fontSize: 16 }}>{label}</Text>
      <View
        style={{
          width: 40,
          height: 24,
          borderRadius: 12,
          backgroundColor: value ? THEME.primary : THEME.border,
          justifyContent: "center",
          padding: 3,
        }}
      >
        <View
          style={{
            width: 18,
            height: 18,
            borderRadius: 9,
            backgroundColor: "#FFFFFF",
            alignSelf: value ? "flex-end" : "flex-start",
          }}
        />
      </View>
    </TouchableOpacity>
  );
}

/**
 * Utils
 */
function labelForAnswerType(t: AnswerType): string {
  // Includes labels for new types "time" and "boolean_then_time"
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

function parseFloatOrNull(v?: string): number | null {
  if (!v || !String(v).trim()) return null;
  const n = Number.parseFloat(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function onlyNumberFloat(v: string) {
  return v.replace(/[^0-9,.\-]/g, "").replace(",", ".");
}

function emptyToNull<T extends string | undefined>(v: T): string | null {
  if (v === undefined) return null;
  const t = v.trim();
  return t.length ? t : null;
}

function tryParseStringArray(v: string): string[] | undefined {
  try {
    const arr = JSON.parse(v);
    return Array.isArray(arr) ? arr.map(String) : undefined;
  } catch {
    // fallback to comma separated
    return v
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
}

function toOptionsArray(v?: string): string[] | null {
  if (!v) return null;
  const parts = v
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length ? parts : null;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  headerRow: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    flexDirection: "row",
    alignItems: "center",
  },
  headerText: {
    flex: 1,
    color: THEME.text,
    fontSize: 18,
    fontWeight: "600",
  },
  centerArea: {
    flex: 1,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  row: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    marginBottom: 10,
    flexDirection: "row",
    alignItems: "center",
  },
  rowLeft: {
    flex: 1,
  },
  rowTitle: {
    color: THEME.text,
    fontSize: 16,
    fontWeight: "600",
  },
  rowSubtitle: {
    color: THEME.muted,
    fontSize: 12,
    marginTop: 2,
  },
  dragHint: {
    marginLeft: 12,
  },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  bannerText: {
    color: THEME.muted,
    marginLeft: 8,
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
  modalTitle: {
    color: THEME.text,
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 12,
  },
  modalButtons: {
    flexDirection: "row",
    marginTop: 4,
  },
});
