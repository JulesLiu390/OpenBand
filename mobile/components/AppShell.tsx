import { PropsWithChildren } from "react";
import { SafeAreaView, ScrollView, StyleSheet, View } from "react-native";

import { theme } from "@/lib/theme";

export function AppShell({ children }: PropsWithChildren) {
  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

export function Section({ children }: PropsWithChildren) {
  return <View style={styles.section}>{children}</View>;
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    flexShrink: 1,
    backgroundColor: theme.colors.background,
    minHeight: 0,
    overflow: "hidden",
  },
  scroll: {
    flex: 1,
    minHeight: 0,
    overflow: "hidden",
  },
  content: {
    gap: 16,
    paddingHorizontal: 20,
    paddingBottom: 18,
    paddingTop: 14,
  },
  section: {
    gap: 10,
  },
});
