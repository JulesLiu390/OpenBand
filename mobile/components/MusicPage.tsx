import { useRouter } from "expo-router";
import { PropsWithChildren } from "react";
import { StyleSheet, View } from "react-native";

import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/components/AuthProvider";
import { PlayerBar } from "@/components/PlayerBar";
import { usePlayer } from "@/components/PlayerProvider";
import { currentTrack } from "@/lib/demo";
import { songSubtitle } from "@/lib/songs";
import { theme } from "@/lib/theme";

type Props = PropsWithChildren<{
  playerTitle?: string;
  playerSubtitle?: string;
}>;

export function MusicPage({ children, playerTitle = currentTrack.name, playerSubtitle = currentTrack.artist }: Props) {
  const router = useRouter();
  const { session } = useAuth();
  const { currentSong, isPlaying, nextSong, previousSong, togglePlayPause } = usePlayer();
  const title = currentSong?.title ?? playerTitle;
  const subtitle = currentSong ? songSubtitle(currentSong) : playerSubtitle;

  return (
    <View style={styles.root}>
      <AppShell>{children}</AppShell>
      <View style={styles.dock}>
        <PlayerBar
          onPress={() =>
            router.push({
              pathname: "/player",
              params: { title, subtitle },
            })
          }
          accessToken={session?.accessToken ?? null}
          isPlaying={isPlaying}
          onNext={() => {
            nextSong();
          }}
          onPrevious={() => {
            previousSong();
          }}
          onTogglePlay={togglePlayPause}
          song={currentSong}
          title={title}
          subtitle={subtitle}
        />
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
