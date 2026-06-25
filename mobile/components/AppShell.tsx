import { PropsWithChildren, useRef } from "react";
import {
  NativeScrollEvent,
  NativeSyntheticEvent,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";

import { theme } from "@/lib/theme";

type AppShellProps = PropsWithChildren<{
  endReachedThreshold?: number;
  onEndReached?: () => void;
}>;

export function AppShell({ children, endReachedThreshold = 220, onEndReached }: AppShellProps) {
  const endReachedFiredRef = useRef(false);

  function handleScroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
    if (!onEndReached) {
      return;
    }

    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const distanceFromEnd = contentSize.height - (contentOffset.y + layoutMeasurement.height);
    if (distanceFromEnd <= endReachedThreshold) {
      if (!endReachedFiredRef.current) {
        endReachedFiredRef.current = true;
        onEndReached();
      }
      return;
    }

    if (distanceFromEnd > endReachedThreshold * 1.5) {
      endReachedFiredRef.current = false;
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        onContentSizeChange={() => {
          endReachedFiredRef.current = false;
        }}
        onScroll={handleScroll}
        scrollEventThrottle={120}
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}>
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
    paddingTop: 44,
  },
  section: {
    gap: 10,
  },
});
