import { useRouter } from "expo-router";
import { PropsWithChildren } from "react";
import { StyleSheet, View } from "react-native";

import { AppShell } from "@/components/AppShell";
import { PlayerBar } from "@/components/PlayerBar";
import { currentTrack } from "@/lib/demo";
import { theme } from "@/lib/theme";

type Props = PropsWithChildren<{
  playerTitle?: string;
  playerSubtitle?: string;
}>;

export function MusicPage({ children, playerTitle = currentTrack.name, playerSubtitle = currentTrack.artist }: Props) {
  const router = useRouter();

  return (
    <View style={styles.root}>
      <AppShell>{children}</AppShell>
      <View style={styles.dock}>
        <PlayerBar onPress={() => router.push("/player")} title={playerTitle} subtitle={playerSubtitle} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: theme.colors.background,
    overflow: "hidden",
  },
  dock: {
    backgroundColor: theme.colors.background,
    borderTopColor: theme.colors.hairline,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 6,
  },
});
