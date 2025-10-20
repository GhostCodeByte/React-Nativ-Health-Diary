import "react-native-gesture-handler";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Button,
  SafeAreaView,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import {
  NavigationContainer,
  DefaultTheme,
  Theme,
} from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import {
  createDrawerNavigator,
  DrawerScreenProps,
} from "@react-navigation/drawer";

// External screens
import FocusScreen from "./src/screens/FocusScreen";
import SettingsScreen from "./src/screens/SettingsScreen";
import GroupManagerScreen from "./src/screens/GroupManagerScreen";
import QuestionManagerScreen from "./src/screens/QuestionManagerScreen";
import NotificationsScreen from "./src/screens/NotificationsScreen";
import CalendarScreen from "./src/screens/CalendarScreen";

import type { Question } from "./src/types";

const THEME = {
  background: "#F5F5DC",
  text: "#808080",
  border: "#C0C0C0",
  primary: "#808080",
};

const NavTheme: Theme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary: THEME.primary,
    background: THEME.background,
    card: THEME.background,
    text: THEME.text,
    border: THEME.border,
    notification: THEME.primary,
  },
};

type RootStackParamList = {
  RootDrawer: undefined;
};

type RootDrawerParamList = {
  Focus: { questionId?: number } | undefined;
  Settings: undefined;
  Calendar: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();
const Drawer = createDrawerNavigator<RootDrawerParamList>();

function MainScreen({ navigation }: any) {
  const [loading, setLoading] = useState(true);
  const [groups, setGroups] = useState<any[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const supa = require("./src/services/supabase");
        if (!supa.isSupabaseConfigured()) {
          setGroups([]);
          setQuestions([]);
          return;
        }
        const [gs, qs] = await Promise.all([
          supa.supaGetGroups(),
          supa.supaGetQuestions(),
        ]);
        if (!cancelled) {
          setGroups(gs || []);
          setQuestions(qs || []);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const grouped = useMemo(() => {
    const map: Record<string, Question[]> = {};
    for (const g of groups) map[String(g.id)] = [];
    for (const q of questions) {
      const key = q.groupId == null ? "__none__" : String(q.groupId);
      if (!map[key]) map[key] = [];
      map[key].push(q);
    }
    return map;
  }, [groups, questions]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: THEME.background }}>
      <ScrollView contentContainerStyle={{ padding: 20 }}>
        {loading ? (
          <View style={{ alignItems: "center", padding: 20 }}>
            <ActivityIndicator size="large" color={THEME.text} />
          </View>
        ) : (
          <>
            {groups.map((g) => {
              const qs = grouped[String(g.id)] || [];
              if (!qs.length) return null;
              return (
                <View key={g.id} style={{ marginBottom: 16 }}>
                  <Text
                    style={{ color: THEME.text, fontSize: 18, marginBottom: 8 }}
                  >
                    {g.name}
                  </Text>
                  <View style={{ gap: 8 }}>
                    {qs.map((q) => (
                      <TouchableOpacity
                        key={q.id}
                        onPress={() =>
                          navigation.navigate("Focus", { questionId: q.id })
                        }
                        style={{
                          paddingVertical: 12,
                          paddingHorizontal: 12,
                          borderRadius: 6,
                          borderWidth: 1,
                          borderColor: THEME.border,
                          backgroundColor: "#FFFFFF",
                        }}
                      >
                        <Text style={{ color: THEME.text, fontSize: 16 }}>
                          {q.question}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              );
            })}
            {(grouped["__none__"] || []).length > 0 && (
              <View style={{ marginBottom: 16 }}>
                <Text
                  style={{ color: THEME.text, fontSize: 18, marginBottom: 8 }}
                >
                  Ohne Gruppe
                </Text>
                <View style={{ gap: 8 }}>
                  {grouped["__none__"].map((q) => (
                    <TouchableOpacity
                      key={q.id}
                      onPress={() =>
                        navigation.navigate("Focus", { questionId: q.id })
                      }
                      style={{
                        paddingVertical: 12,
                        paddingHorizontal: 12,
                        borderRadius: 6,
                        borderWidth: 1,
                        borderColor: THEME.border,
                        backgroundColor: "#FFFFFF",
                      }}
                    >
                      <Text style={{ color: THEME.text, fontSize: 16 }}>
                        {q.question}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function RootDrawer() {
  const SettingsStack = createNativeStackNavigator();
  return (
    <Drawer.Navigator
      initialRouteName="Focus"
      screenOptions={{
        headerStyle: { backgroundColor: THEME.background },
        headerTintColor: THEME.text,
        headerTitleStyle: { color: THEME.text },
        drawerActiveTintColor: THEME.primary,
        drawerInactiveTintColor: THEME.text,
        drawerStyle: { backgroundColor: THEME.background },
      }}
    >
      <Drawer.Screen
        name="Focus"
        component={FocusScreen}
        options={{ title: "Fokus" }}
      />
      <Drawer.Screen
        name="Settings"
        options={{ title: "Einstellungen", headerShown: false }}
      >
        {() => (
          <SettingsStack.Navigator
            screenOptions={{
              headerStyle: { backgroundColor: THEME.background },
              headerTintColor: THEME.text,
              headerTitleStyle: { color: THEME.text },
              contentStyle: { backgroundColor: THEME.background },
            }}
          >
            <SettingsStack.Screen
              name="SettingsHome"
              component={SettingsScreen}
              options={{ title: "Einstellungen" }}
            />
            <SettingsStack.Screen
              name="GroupManager"
              component={GroupManagerScreen}
              options={{ title: "Gruppen" }}
            />
            <SettingsStack.Screen
              name="QuestionManager"
              component={QuestionManagerScreen}
              options={{ title: "Fragen" }}
            />
            <SettingsStack.Screen
              name="Notifications"
              component={NotificationsScreen}
              options={{ title: "Benachrichtigungen" }}
            />
          </SettingsStack.Navigator>
        )}
      </Drawer.Screen>
      <Drawer.Screen
        name="Calendar"
        component={CalendarScreen}
        options={{ title: "Kalender" }}
      />
    </Drawer.Navigator>
  );
}

export default function App() {
  return (
    <NavigationContainer theme={NavTheme}>
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: THEME.background },
        }}
      >
        <Stack.Screen name="RootDrawer" component={RootDrawer} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
