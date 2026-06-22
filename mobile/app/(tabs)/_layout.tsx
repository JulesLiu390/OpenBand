import { Tabs } from "expo-router";
import { ColorValue, Text } from "react-native";

import { theme } from "@/lib/theme";

function TabIcon({ color, label }: { color: ColorValue; label: string }) {
  return <Text style={{ color, fontSize: 19, fontWeight: "900", lineHeight: 20 }}>{label}</Text>;
}

export default function TabLayout() {
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
