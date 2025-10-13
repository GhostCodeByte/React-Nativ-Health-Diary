import React from "react";
import { Button, View } from "react-native";
import { useNavigation } from "@react-navigation/native";

const THEME = {
  background: "#F5F5DC",
  primary: "#808080",
};

export default function SettingsScreen() {
  const navigation = useNavigation<any>();

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
