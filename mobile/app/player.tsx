import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type DimensionValue,
} from "react-native";
import { VolumeManager } from "react-native-volume-manager";

import { useAuth } from "@/components/AuthProvider";
import { PlaybackOrder, RepeatMode, usePlayer } from "@/components/PlayerProvider";
import { SongArtwork } from "@/components/SongArtwork";
import { currentTrack } from "@/lib/demo";
import { formatDuration, setSongLiked, songSubtitle } from "@/lib/songs";
import { artworkPalettes, theme } from "@/lib/theme";

export default function PlayerScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const {
    currentSong,
    currentTime,
    duration,
    isPlaying,
    nextSong,
    playbackOrder,
    playSong,
    previousSong,
    queue,
    repeatMode,
    cyclePlaybackOrder,
    cycleRepeatMode,
    togglePlayPause,
    updateCurrentSongLike,
  } = usePlayer();
  const [likeBusy, setLikeBusy] = useState(false);
  const [queueMounted, setQueueMounted] = useState(false);
  const [queueVisible, setQueueVisible] = useState(false);
  const [systemVolume, setSystemVolume] = useState(1);
  const queueAnimation = useRef(new Animated.Value(0)).current;
  const params = useLocalSearchParams<{ title?: string | string[]; subtitle?: string | string[] }>();
  const title = Array.isArray(params.title) ? params.title[0] : params.title;
  const subtitle = Array.isArray(params.subtitle) ? params.subtitle[0] : params.subtitle;
  const displayTitle = currentSong?.title ?? title ?? currentTrack.name;
  const displaySubtitle = currentSong ? songSubtitle(currentSong) : (subtitle ?? currentTrack.artist);
  const displayDuration = duration || currentSong?.duration_seconds || 0;
  const progress = displayDuration > 0 ? Math.min(100, Math.max(0, (currentTime / displayDuration) * 100)) : 0;
  const knobPosition = `${Math.min(96, progress)}%` as DimensionValue;
  const volumeLevel = clampVolume(systemVolume);
  const volumeWidth = `${Math.round(volumeLevel * 100)}%` as DimensionValue;
  const isLiked = Boolean(currentSong?.is_liked);
  const queueMotion = useMemo(
    () => ({
      backdropOpacity: queueAnimation.interpolate({
        inputRange: [0, 1],
        outputRange: [0, 1],
      }),
      sheetTranslateY: queueAnimation.interpolate({
        inputRange: [0, 1],
        outputRange: [360, 0],
      }),
    }),
    [queueAnimation],
  );

  useEffect(() => {
    if (Platform.OS === "web") {
      return;
    }

    let mounted = true;
    VolumeManager.getVolume()
      .then(({ volume }) => {
        if (mounted) {
          setSystemVolume(clampVolume(volume));
        }
      })
      .catch(() => {
        // System volume is display-only; playback should continue if native volume is unavailable.
      });

    const subscription = VolumeManager.addVolumeListener(({ volume }) => {
      setSystemVolume(clampVolume(volume));
    });

    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (!queueMounted) {
      return;
    }

    queueAnimation.stopAnimation();
    Animated.timing(queueAnimation, {
      duration: queueVisible ? 220 : 170,
      easing: queueVisible ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
      toValue: queueVisible ? 1 : 0,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished && !queueVisible) {
        setQueueMounted(false);
      }
    });
  }, [queueAnimation, queueMounted, queueVisible]);

  function openQueue() {
    queueAnimation.stopAnimation();
    queueAnimation.setValue(0);
    setQueueMounted(true);
    setQueueVisible(true);
  }

  function closeQueue() {
    setQueueVisible(false);
  }

  async function toggleLike() {
    if (!session || !currentSong || likeBusy) {
      return;
    }
    setLikeBusy(true);
    try {
      const result = await setSongLiked(session.accessToken, currentSong.id, !isLiked);
      updateCurrentSongLike(currentSong.id, result.is_liked, result.liked_at);
    } finally {
      setLikeBusy(false);
    }
  }

  async function playQueuedSong(songId: string) {
    const song = queue.find((candidate) => candidate.id === songId);
    if (!song) {
      return;
    }
    await playSong(song, queue, { source: "adHoc" });
    closeQueue();
  }

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
          <SongArtwork accessToken={session?.accessToken ?? null} colors={artworkPalettes[0]} size={312} song={currentSong} />
        </View>

        <View style={styles.trackBlock}>
          <View style={styles.titleRow}>
            <View style={styles.trackCopy}>
              <Text style={styles.songTitle} numberOfLines={1}>
                {displayTitle}
              </Text>
              <Text style={styles.artist} numberOfLines={1}>
                {displaySubtitle}
              </Text>
            </View>
            <Pressable
              accessibilityLabel={isLiked ? "Unlike song" : "Like song"}
              accessibilityRole="button"
              disabled={!currentSong || likeBusy}
              onPress={toggleLike}
              style={({ pressed }) => [styles.favorite, pressed && styles.pressed, (!currentSong || likeBusy) && styles.disabledButton]}>
              <Text style={[styles.favoriteIcon, isLiked && styles.favoriteIconActive]}>{isLiked ? "♥" : "♡"}</Text>
            </Pressable>
          </View>

          <View style={styles.progressBlock}>
            <View style={styles.trackLine}>
              <View style={[styles.playedLine, { width: `${progress}%` }]} />
              <View style={[styles.knob, { left: knobPosition }]} />
            </View>
            <View style={styles.timeRow}>
              <Text style={styles.time}>{formatDuration(Math.floor(currentTime))}</Text>
              <Text style={styles.time}>
                {displayDuration > 0 ? formatDuration(Math.floor(displayDuration)) : currentTrack.duration}
              </Text>
            </View>
          </View>

          <View style={styles.controls}>
            <Pressable
              accessibilityLabel="Previous song"
              accessibilityRole="button"
              disabled={!currentSong}
              onPress={() => {
                previousSong();
              }}
              style={({ pressed }) => [styles.controlButton, pressed && styles.pressed, !currentSong && styles.disabledButton]}>
              <Text style={styles.controlIcon}>⏮</Text>
            </Pressable>
            <Pressable
              accessibilityLabel={isPlaying ? "Pause song" : "Play song"}
              accessibilityRole="button"
              disabled={!currentSong}
              onPress={togglePlayPause}
              style={({ pressed }) => [styles.mainButton, pressed && styles.pressed, !currentSong && styles.disabledButton]}>
              <Text style={[styles.mainIcon, isPlaying && styles.pauseMainIcon]}>{isPlaying ? "Ⅱ" : "▶"}</Text>
            </Pressable>
            <Pressable
              accessibilityLabel="Next song"
              accessibilityRole="button"
              disabled={!currentSong}
              onPress={() => {
                nextSong();
              }}
              style={({ pressed }) => [styles.controlButton, pressed && styles.pressed, !currentSong && styles.disabledButton]}>
              <Text style={styles.controlIcon}>⏭</Text>
            </Pressable>
          </View>

          <View style={styles.volumeRow}>
            <Text style={styles.volumeIcon}>♪</Text>
            <View style={styles.volumeTrack}>
              <View style={[styles.volumeFill, { width: volumeWidth }]} />
            </View>
            <Text style={styles.volumeValue}>{Math.round(volumeLevel * 100)}%</Text>
            <Text style={styles.volumeIcon}>♫</Text>
          </View>
        </View>

        <View style={styles.bottomActions}>
          <Pressable
            accessibilityLabel={repeatModeLabel(repeatMode)}
            accessibilityRole="button"
            onPress={cycleRepeatMode}
            style={({ pressed }) => [styles.actionButton, repeatMode === "loop" && styles.activeActionButton, pressed && styles.pressed]}>
            <Text style={[styles.actionIcon, repeatMode === "loop" && styles.activeActionIcon]}>{repeatModeIcon(repeatMode)}</Text>
          </Pressable>
          <Pressable
            accessibilityLabel={playbackOrderLabel(playbackOrder)}
            accessibilityRole="button"
            onPress={cyclePlaybackOrder}
            style={({ pressed }) => [styles.actionButton, playbackOrder === "shuffle" && styles.activeActionButton, pressed && styles.pressed]}>
            <Text style={[styles.actionIcon, playbackOrder === "shuffle" && styles.activeActionIcon]}>{playbackOrderIcon(playbackOrder)}</Text>
          </Pressable>
          <Pressable
            accessibilityLabel="Show queue list"
            accessibilityRole="button"
            onPress={openQueue}
            style={({ pressed }) => [styles.actionButton, pressed && styles.pressed]}>
            <Text style={styles.actionIcon}>≡</Text>
          </Pressable>
        </View>

        <Modal animationType="none" transparent visible={queueMounted} onRequestClose={closeQueue}>
          <View style={styles.queueModal}>
            <Animated.View style={[styles.queueBackdrop, { opacity: queueMotion.backdropOpacity }]} />
            <Pressable accessibilityLabel="Close queue" style={styles.queueDismissArea} onPress={closeQueue} />
            <Animated.View style={[styles.queueSheet, { transform: [{ translateY: queueMotion.sheetTranslateY }] }]}>
              <View style={styles.queueHeader}>
                <View>
                  <Text style={styles.queueLabel}>Queue</Text>
                  <Text style={styles.queueTitle}>{queue.length ? `${queue.length} songs` : "No songs queued"}</Text>
                </View>
                <Pressable
                  accessibilityLabel="Close queue"
                  accessibilityRole="button"
                  onPress={closeQueue}
                  style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}>
                  <Text style={styles.closeIcon}>×</Text>
                </Pressable>
              </View>
              <ScrollView contentContainerStyle={styles.queueList} showsVerticalScrollIndicator={false}>
                {queue.length === 0 ? (
                  <Text style={styles.emptyQueue}>Play a song from Daily, Library, or Play Lists to build a queue.</Text>
                ) : (
                  queue.map((song, index) => {
                    const active = currentSong?.id === song.id;
                    return (
                      <Pressable
                        accessibilityRole="button"
                        key={song.id}
                        onPress={() => {
                          playQueuedSong(song.id);
                        }}
                        style={({ pressed }) => [styles.queueRow, active && styles.queueRowActive, pressed && styles.pressed]}>
                        <Text style={[styles.queueIndex, active && styles.queueIndexActive]}>{index + 1}</Text>
                        <View style={styles.queueCopy}>
                          <Text style={[styles.queueSongTitle, active && styles.queueSongTitleActive]} numberOfLines={1}>
                            {song.title}
                          </Text>
                          <Text style={styles.queueSongMeta} numberOfLines={1}>
                            {songSubtitle(song)}
                          </Text>
                        </View>
                        <Text style={styles.queueDuration}>{formatDuration(song.duration_seconds)}</Text>
                      </Pressable>
                    );
                  })
                )}
              </ScrollView>
            </Animated.View>
          </View>
        </Modal>
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
    paddingTop: 30,
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
  favoriteIconActive: {
    color: theme.colors.tint,
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
  pauseMainIcon: {
    fontSize: 26,
    lineHeight: 28,
    marginLeft: 0,
  },
  disabledButton: {
    opacity: 0.45,
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
  volumeValue: {
    color: theme.colors.tertiaryText,
    fontSize: 12,
    fontWeight: "800",
    textAlign: "right",
    width: 34,
  },
  volumeFill: {
    backgroundColor: theme.colors.secondaryText,
    borderRadius: 999,
    height: 6,
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
  activeActionButton: {
    borderColor: "rgba(255,45,85,0.32)",
  },
  activeActionIcon: {
    color: theme.colors.tint,
  },
  pressed: {
    opacity: 0.72,
  },
  queueModal: {
    flex: 1,
    justifyContent: "flex-end",
  },
  queueBackdrop: {
    backgroundColor: "rgba(0,0,0,0.18)",
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  queueDismissArea: {
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  queueSheet: {
    backgroundColor: theme.colors.background,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    maxHeight: "72%",
    paddingBottom: 28,
    paddingHorizontal: 20,
    paddingTop: 18,
  },
  queueHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  queueLabel: {
    color: theme.colors.tint,
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 0,
    textTransform: "uppercase",
  },
  queueTitle: {
    color: theme.colors.text,
    fontSize: 22,
    fontWeight: "900",
    marginTop: 2,
  },
  closeButton: {
    alignItems: "center",
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.hairline,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  closeIcon: {
    color: theme.colors.text,
    fontSize: 28,
    fontWeight: "900",
    lineHeight: 30,
  },
  queueList: {
    gap: 8,
    paddingBottom: 16,
  },
  emptyQueue: {
    color: theme.colors.secondaryText,
    fontSize: 15,
    fontWeight: "700",
    lineHeight: 22,
    paddingVertical: 28,
    textAlign: "center",
  },
  queueRow: {
    alignItems: "center",
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.hairline,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: 12,
    minHeight: 62,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  queueRowActive: {
    borderColor: "rgba(255,45,85,0.38)",
  },
  queueIndex: {
    color: theme.colors.tertiaryText,
    fontSize: 13,
    fontWeight: "900",
    textAlign: "center",
    width: 26,
  },
  queueIndexActive: {
    color: theme.colors.tint,
  },
  queueCopy: {
    flex: 1,
    minWidth: 0,
  },
  queueSongTitle: {
    color: theme.colors.text,
    fontSize: 16,
    fontWeight: "900",
  },
  queueSongTitleActive: {
    color: theme.colors.tint,
  },
  queueSongMeta: {
    color: theme.colors.secondaryText,
    fontSize: 13,
    fontWeight: "700",
    marginTop: 2,
  },
  queueDuration: {
    color: theme.colors.tertiaryText,
    fontSize: 12,
    fontWeight: "800",
  },
});

function repeatModeIcon(mode: RepeatMode): string {
  return mode === "loop" ? "↻" : "Ⅱ";
}

function clampVolume(value: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.max(0, Math.min(1, value));
}

function repeatModeLabel(mode: RepeatMode): string {
  return mode === "loop" ? "Loop list after ending" : "Pause after list ends";
}

function playbackOrderIcon(order: PlaybackOrder): string {
  return order === "shuffle" ? "⌁" : "→";
}

function playbackOrderLabel(order: PlaybackOrder): string {
  return order === "shuffle" ? "Shuffle playback order" : "Sequence playback order";
}
