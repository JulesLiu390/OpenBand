import { Pressable, StyleSheet, Text, View } from "react-native";

import { SongArtwork } from "@/components/SongArtwork";
import { Song } from "@/lib/songs";
import { artworkPalettes, theme } from "@/lib/theme";

type Props = {
  accessToken?: string | null;
  isPlaying?: boolean;
  song?: Song | null;
  title?: string;
  subtitle?: string;
  onNext?: () => void;
  onPrevious?: () => void;
  onTogglePlay?: () => void;
  onPress?: () => void;
};

export function PlayerBar({
  accessToken,
  isPlaying = false,
  song,
  title = "Lake Light",
  subtitle = "Ambient · 02:18",
  onNext,
  onPrevious,
  onPress,
  onTogglePlay,
}: Props) {
  return (
    <View style={styles.bar}>
      <Pressable
        accessibilityLabel="Open player"
        accessibilityRole="button"
        disabled={!onPress}
        onPress={onPress}
        style={({ pressed }) => [styles.trackArea, pressed && styles.pressed]}>
        <SongArtwork accessToken={accessToken} colors={artworkPalettes[0]} size={40} song={song} />
        <View style={styles.copy}>
          <Text style={styles.title} numberOfLines={1}>
            {song?.title ?? title}
          </Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {song ? (song.album ? `${song.artist} · ${song.album}` : song.artist) : subtitle}
          </Text>
        </View>
      </Pressable>
      <Pressable
        accessibilityLabel="Previous song"
        accessibilityRole="button"
        disabled={!onPrevious}
        onPress={onPrevious}
        style={({ pressed }) => [styles.button, pressed && styles.buttonPressed, !onPrevious && styles.disabledButton]}>
        <Text style={styles.buttonIcon}>⏮</Text>
      </Pressable>
      <Pressable
        accessibilityLabel={isPlaying ? "Pause song" : "Play song"}
        accessibilityRole="button"
        disabled={!onTogglePlay}
        onPress={(event) => {
          event.stopPropagation();
          onTogglePlay?.();
        }}
        style={({ pressed }) => [styles.play, pressed && styles.playPressed]}>
        <Text style={[styles.playIcon, isPlaying && styles.pauseIcon]}>{isPlaying ? "Ⅱ" : "▶"}</Text>
      </Pressable>
      <Pressable
        accessibilityLabel="Next song"
        accessibilityRole="button"
        disabled={!onNext}
        onPress={onNext}
        style={({ pressed }) => [styles.button, pressed && styles.buttonPressed, !onNext && styles.disabledButton]}>
        <Text style={styles.buttonIcon}>⏭</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    alignItems: "center",
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.hairline,
    borderRadius: theme.radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: 8,
    marginBottom: 8,
    marginHorizontal: 16,
    padding: 8,
  },
  trackArea: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: 8,
    minWidth: 0,
  },
  copy: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    color: theme.colors.text,
    fontSize: 14,
    fontWeight: "800",
  },
  subtitle: {
    color: theme.colors.secondaryText,
    fontSize: 12,
    marginTop: 2,
  },
  button: {
    alignItems: "center",
    backgroundColor: "#F1F1F4",
    borderRadius: 999,
    height: 32,
    justifyContent: "center",
    width: 32,
  },
  buttonIcon: {
    color: theme.colors.secondaryText,
    fontSize: 13,
    fontWeight: "900",
    lineHeight: 15,
  },
  buttonPressed: {
    opacity: 0.72,
  },
  disabledButton: {
    opacity: 0.45,
  },
  play: {
    alignItems: "center",
    backgroundColor: theme.colors.tint,
    borderRadius: 999,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  playIcon: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "900",
    lineHeight: 18,
  },
  pauseIcon: {
    fontSize: 14,
    lineHeight: 16,
    marginLeft: 0,
  },
  playPressed: {
    opacity: 0.75,
  },
  pressed: {
    opacity: 0.75,
  },
});
