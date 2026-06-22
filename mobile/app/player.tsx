import { useRouter } from "expo-router";
import { SafeAreaView, StyleSheet, Text, View, Pressable } from "react-native";

import { AlbumArt } from "@/components/AlbumArt";
import { artworkPalettes, theme } from "@/lib/theme";

export default function PlayerScreen() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.screen}>
        <View style={styles.header}>
          <Pressable style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]} onPress={() => router.back()}>
            <Text style={styles.headerIcon}>⌄</Text>
          </Pressable>
          <Text style={styles.headerTitle}>Now Playing</Text>
          <Pressable style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
            <Text style={styles.headerIcon}>⋯</Text>
          </Pressable>
        </View>

        <View style={styles.artWrap}>
          <AlbumArt colors={artworkPalettes[0]} size={312} />
        </View>

        <View style={styles.trackBlock}>
          <View style={styles.titleRow}>
            <View style={styles.trackCopy}>
              <Text style={styles.songTitle} numberOfLines={1}>
                Lake Light
              </Text>
              <Text style={styles.artist} numberOfLines={1}>
                Suno Sketch
              </Text>
            </View>
            <Pressable style={({ pressed }) => [styles.favorite, pressed && styles.pressed]}>
              <Text style={styles.favoriteIcon}>♡</Text>
            </Pressable>
          </View>

          <View style={styles.progressBlock}>
            <View style={styles.trackLine}>
              <View style={styles.playedLine} />
              <View style={styles.knob} />
            </View>
            <View style={styles.timeRow}>
              <Text style={styles.time}>0:42</Text>
              <Text style={styles.time}>2:18</Text>
            </View>
          </View>

          <View style={styles.controls}>
            <Pressable style={({ pressed }) => [styles.controlButton, pressed && styles.pressed]}>
              <Text style={styles.controlIcon}>⏮</Text>
            </Pressable>
            <Pressable style={({ pressed }) => [styles.mainButton, pressed && styles.pressed]}>
              <Text style={styles.mainIcon}>▶</Text>
            </Pressable>
            <Pressable style={({ pressed }) => [styles.controlButton, pressed && styles.pressed]}>
              <Text style={styles.controlIcon}>⏭</Text>
            </Pressable>
          </View>

          <View style={styles.volumeRow}>
            <Text style={styles.volumeIcon}>♪</Text>
            <View style={styles.volumeTrack}>
              <View style={styles.volumeFill} />
            </View>
            <Text style={styles.volumeIcon}>♫</Text>
          </View>
        </View>

        <View style={styles.bottomActions}>
          <Pressable style={({ pressed }) => [styles.actionButton, pressed && styles.pressed]}>
            <Text style={styles.actionIcon}>♪</Text>
          </Pressable>
          <Pressable style={({ pressed }) => [styles.actionButton, pressed && styles.pressed]}>
            <Text style={styles.actionIcon}>⌁</Text>
          </Pressable>
          <Pressable style={({ pressed }) => [styles.actionButton, pressed && styles.pressed]}>
            <Text style={styles.actionIcon}>≡</Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  screen: {
    flex: 1,
    justifyContent: "space-between",
    paddingBottom: 22,
    paddingHorizontal: 24,
    paddingTop: 10,
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  iconButton: {
    alignItems: "center",
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.hairline,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  headerIcon: {
    color: theme.colors.text,
    fontSize: 26,
    fontWeight: "900",
    lineHeight: 28,
  },
  headerTitle: {
    color: theme.colors.secondaryText,
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 0,
    textTransform: "uppercase",
  },
  artWrap: {
    alignItems: "center",
    paddingTop: 12,
  },
  trackBlock: {
    gap: 28,
  },
  titleRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 16,
  },
  trackCopy: {
    flex: 1,
    minWidth: 0,
  },
  songTitle: {
    color: theme.colors.text,
    fontSize: 28,
    fontWeight: "900",
  },
  artist: {
    color: theme.colors.tint,
    fontSize: 18,
    fontWeight: "800",
    marginTop: 4,
  },
  favorite: {
    alignItems: "center",
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.hairline,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  favoriteIcon: {
    color: theme.colors.tint,
    fontSize: 28,
    fontWeight: "800",
    lineHeight: 30,
  },
  progressBlock: {
    gap: 8,
  },
  trackLine: {
    backgroundColor: "#D9D9DF",
    borderRadius: 999,
    height: 7,
    justifyContent: "center",
  },
  playedLine: {
    backgroundColor: theme.colors.tint,
    borderRadius: 999,
    height: 7,
    width: "32%",
  },
  knob: {
    backgroundColor: theme.colors.tint,
    borderColor: theme.colors.surface,
    borderRadius: 999,
    borderWidth: 3,
    height: 18,
    left: "31%",
    position: "absolute",
    width: 18,
  },
  timeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  time: {
    color: theme.colors.tertiaryText,
    fontSize: 12,
    fontWeight: "700",
  },
  controls: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
    gap: 26,
  },
  controlButton: {
    alignItems: "center",
    height: 58,
    justifyContent: "center",
    width: 58,
  },
  controlIcon: {
    color: theme.colors.text,
    fontSize: 28,
    fontWeight: "900",
    lineHeight: 30,
  },
  mainButton: {
    alignItems: "center",
    backgroundColor: theme.colors.tint,
    borderRadius: 999,
    height: 76,
    justifyContent: "center",
    width: 76,
  },
  mainIcon: {
    color: "#FFFFFF",
    fontSize: 30,
    fontWeight: "900",
    lineHeight: 32,
    marginLeft: 3,
  },
  volumeRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
  },
  volumeTrack: {
    backgroundColor: "#D9D9DF",
    borderRadius: 999,
    flex: 1,
    height: 6,
  },
  volumeIcon: {
    color: theme.colors.tertiaryText,
    fontSize: 16,
    fontWeight: "900",
    lineHeight: 18,
    width: 18,
  },
  volumeFill: {
    backgroundColor: theme.colors.secondaryText,
    borderRadius: 999,
    height: 6,
    width: "58%",
  },
  bottomActions: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-around",
  },
  actionButton: {
    alignItems: "center",
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.hairline,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    height: 48,
    justifyContent: "center",
    width: 72,
  },
  actionIcon: {
    color: theme.colors.secondaryText,
    fontSize: 24,
    fontWeight: "900",
    lineHeight: 26,
  },
  pressed: {
    opacity: 0.72,
  },
});
