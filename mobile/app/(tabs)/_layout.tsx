import { Redirect, Tabs } from "expo-router";
import { ActivityIndicator, ColorValue, StyleSheet, Text, View } from "react-native";

import { useAuth } from "@/components/AuthProvider";
import { theme } from "@/lib/theme";

function TabIcon({ color, label }: { color: ColorValue; label: string }) {
  return <Text style={{ color, fontSize: 19, fontWeight: "900", lineHeight: 20 }}>{label}</Text>;
}

export default function TabLayout() {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={theme.colors.tint} />
      </View>
    );
  }

  if (!isAuthenticated) {
    return <Redirect href="/login" />;
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.colors.tint,
        tabBarInactiveTintColor: theme.colors.tertiaryText,
        tabBarStyle: {
          backgroundColor: "rgba(255,255,255,0.96)",
          borderTopColor: theme.colors.hairline,
          height: 76,
          paddingBottom: 14,
          paddingTop: 10,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: "800",
        },
      }}>
      <Tabs.Screen
        name="library"
        options={{
          title: "Library",
          tabBarIcon: ({ color }) => <TabIcon color={color} label="♪" />,
        }}
      />
      <Tabs.Screen
        name="index"
        options={{
          title: "Daily",
          tabBarIcon: ({ color }) => <TabIcon color={color} label="●" />,
        }}
      />
      <Tabs.Screen
        name="playlists"
        options={{
          title: "Play Lists",
          tabBarIcon: ({ color }) => <TabIcon color={color} label="≡" />,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  loading: {
    alignItems: "center",
    backgroundColor: theme.colors.background,
    flex: 1,
    justifyContent: "center",
  },
});
