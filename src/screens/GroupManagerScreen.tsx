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
import { useIsFocused, useNavigation } from "@react-navigation/native";
import type { Group } from "../types";
import {
  getSupabaseClient,
  isSupabaseConfigured,
  supaGetGroups,
  supaUpdateGroup,
} from "../services/supabase";

type Nav = any;

const THEME = {
  background: "#F5F5DC",
  text: "#808080",
  border: "#C0C0C0",
  primary: "#808080",
  muted: "#A9A9A9",
  surface: "#FFFFFF",
};

export default function GroupManagerScreen() {
  const navigation: Nav = useNavigation();
  const isFocused = useIsFocused();

  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(false);
  const [savingOrder, setSavingOrder] = useState(false);

  const [addVisible, setAddVisible] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [creating, setCreating] = useState(false);

  // Header: "+" button on right to open add modal
  useLayoutEffect(() => {
    navigation.setOptions({
      title: "Gruppen",
      headerRight: () => (
        <TouchableOpacity
          onPress={() => setAddVisible(true)}
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
  }, [navigation]);

  // Load groups when focused
  const loadGroups = useCallback(async () => {
    if (!isSupabaseConfigured()) {
      Alert.alert(
        "Supabase nicht konfiguriert",
        "Bitte setze EXPO_PUBLIC_SUPABASE_URL und EXPO_PUBLIC_SUPABASE_ANON_KEY in deiner .env.",
      );
      return;
    }
    setLoading(true);
    try {
      const data = await supaGetGroups();
      // Ensure stable order asc
      const ordered = [...data].sort(
        (a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id - b.id,
      );
      setGroups(ordered);
    } catch (err: any) {
      Alert.alert(
        "Fehler",
        err?.message || "Gruppen konnten nicht geladen werden.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isFocused) {
      void loadGroups();
    }
  }, [isFocused, loadGroups]);

  // Drag end handler -> persist new order
  const handleDragEnd = useCallback(
    async ({ data }: { data: Group[] }) => {
      // Compute new order values (1-based)
      const next = data.map((g, idx) => ({ ...g, order: idx + 1 }));
      setGroups(next);

      // Determine changes to persist
      const changes = next.filter(
        (g, idx) => g.order !== (groups[idx]?.order ?? idx + 1),
      );

      if (changes.length === 0) return;

      setSavingOrder(true);
      try {
        // Persist each changed group's order
        await Promise.all(
          changes.map((g) => supaUpdateGroup(g.id, { order: g.order })),
        );
      } catch (err: any) {
        Alert.alert(
          "Fehler",
          err?.message || "Reihenfolge konnte nicht gespeichert werden.",
        );
        // Reload to recover from partial updates
        await loadGroups();
      } finally {
        setSavingOrder(false);
      }
    },
    [groups, loadGroups],
  );

  // Create new group via modal
  const handleCreateGroup = useCallback(async () => {
    const name = newGroupName.trim();
    if (!name) {
      Alert.alert("Hinweis", "Bitte einen Gruppennamen eingeben.");
      return;
    }
    setCreating(true);
    try {
      const supabase = getSupabaseClient();
      // New order = end of list + 1
      const nextOrder = groups.length + 1;
      const { error } = await supabase
        .from("groups")
        .insert({ name, order: nextOrder, description: null, icon: null });
      if (error) throw new Error(error.message || "Erstellen fehlgeschlagen.");

      setAddVisible(false);
      setNewGroupName("");
      await loadGroups();
    } catch (err: any) {
      Alert.alert(
        "Fehler",
        err?.message || "Gruppe konnte nicht erstellt werden.",
      );
    } finally {
      setCreating(false);
    }
  }, [newGroupName, groups.length, loadGroups]);

  const renderItem = useCallback(
    ({ item, drag, isActive }: any) => {
      return (
        <TouchableOpacity
          onLongPress={drag}
          delayLongPress={150}
          activeOpacity={0.9}
          onPress={() =>
            navigation.navigate("QuestionManager", {
              groupId: item.id,
              groupName: item.name,
            })
          }
          style={[
            styles.row,
            {
              borderColor: isActive ? THEME.primary : THEME.border,
              backgroundColor: THEME.surface,
            },
          ]}
        >
          <View style={styles.rowLeft}>
            <Text style={styles.rowTitle}>{item.name}</Text>
            <Text style={styles.rowSubtitle}>#{item.order ?? "-"}</Text>
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
    [navigation],
  );

  const empty = useMemo(
    () => !loading && groups.length === 0,
    [loading, groups.length],
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: THEME.background }}>
      <View style={styles.container}>
        <View style={styles.headerRow}>
          <Text style={styles.headerText}>Fragen einstellen – Gruppen</Text>
          <View style={{ marginLeft: 8 }}>
            <Button
              title="Aktualisieren"
              color={THEME.primary}
              onPress={() => void loadGroups()}
            />
          </View>
        </View>

        {loading && (
          <View style={styles.centerArea}>
            <ActivityIndicator size="large" color={THEME.text} />
            <Text style={{ color: THEME.text, marginTop: 8 }}>
              Lade Gruppen…
            </Text>
          </View>
        )}

        {empty && (
          <View style={styles.centerArea}>
            <Text style={{ color: THEME.text, marginBottom: 12 }}>
              Noch keine Gruppen vorhanden.
            </Text>
            <Button
              title="Neue Gruppe"
              color={THEME.primary}
              onPress={() => setAddVisible(true)}
            />
          </View>
        )}

        {!loading && groups.length > 0 && (
          <>
            {savingOrder && (
              <View style={styles.banner}>
                <ActivityIndicator size="small" color={THEME.muted} />
                <Text style={styles.bannerText}>Speichere Reihenfolge…</Text>
              </View>
            )}

            <ScrollView style={{ paddingHorizontal: 16, paddingBottom: 24 }}>
              {groups.map((item: any) => (
                <TouchableOpacity
                  key={String(item.id)}
                  activeOpacity={0.9}
                  onPress={() =>
                    navigation.navigate("QuestionManager", {
                      groupId: item.id,
                      groupName: item.name,
                    })
                  }
                  style={[
                    styles.row,
                    {
                      borderColor: THEME.border,
                      backgroundColor: THEME.surface,
                    },
                  ]}
                >
                  <View style={styles.rowLeft}>
                    <Text style={styles.rowTitle}>{item.name}</Text>
                    <Text style={styles.rowSubtitle}>#{item.order ?? "-"}</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </>
        )}
      </View>

      {/* Add group modal */}
      <Modal
        visible={addVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setAddVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Neue Gruppe erstellen</Text>
            <Text style={styles.modalLabel}>Name</Text>
            <TextInput
              value={newGroupName}
              onChangeText={setNewGroupName}
              placeholder="z. B. Gesundheit"
              placeholderTextColor={THEME.muted}
              style={styles.modalInput}
              autoFocus
            />
            <View style={styles.modalButtons}>
              <View style={{ flex: 1, marginRight: 6 }}>
                <Button
                  title={creating ? "Erstelle…" : "Erstellen"}
                  color={THEME.primary}
                  onPress={handleCreateGroup}
                  disabled={creating}
                />
              </View>
              <View style={{ flex: 1, marginLeft: 6 }}>
                <Button
                  title="Abbrechen"
                  color={THEME.muted}
                  onPress={() => {
                    setAddVisible(false);
                    setNewGroupName("");
                  }}
                />
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
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
  modalLabel: {
    color: THEME.text,
    fontSize: 14,
    marginBottom: 6,
  },
  modalInput: {
    borderWidth: 1,
    borderColor: THEME.border,
    backgroundColor: THEME.surface,
    color: THEME.text,
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 16,
    marginBottom: 12,
  },
  modalButtons: {
    flexDirection: "row",
    marginTop: 4,
  },
});
