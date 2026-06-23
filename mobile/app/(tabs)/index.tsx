import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { AlbumArt } from "@/components/AlbumArt";
import { Section } from "@/components/AppShell";
import { useAuth } from "@/components/AuthProvider";
import { MusicPage } from "@/components/MusicPage";
import { usePlayer } from "@/components/PlayerProvider";
import { SongActionMenu } from "@/components/SongActionMenu";
import { SongArtwork } from "@/components/SongArtwork";
import {
  DailyPlaylist,
  DailyPlaylistSummary,
  DailyTodayResponse,
  generateTodayDaily,
  getDailyPlaylist,
  getTodayDaily,
  listDailyHistory,
} from "@/lib/daily";
import {
  Song,
  SongCacheStatus,
  cacheSong,
  formatDuration,
  getSongCacheStatuses,
  mergeSongCatalog,
  songSubtitle,
} from "@/lib/songs";
import { artworkPalettes, theme } from "@/lib/theme";

const WORKING_STATUSES = new Set([
  "queued",
  "generating_tags",
  "generating_playlist_prompt",
  "generating_song_prompts",
  "suno_queue",
  "submitting_to_suno",
  "importing",
]);
const RESUMABLE_STATUSES = new Set(["failed", "captcha_required"]);

export default function DailyScreen() {
  const { session } = useAuth();
  const { busySongId, currentSong, isPlaying, playSong, updateCurrentSongLike } = usePlayer();
  const [today, setToday] = useState<DailyTodayResponse | null>(null);
  const [history, setHistory] = useState<DailyPlaylistSummary[]>([]);
  const [selectedTrack, setSelectedTrack] = useState({
    title: "Daily",
    subtitle: "OpenBand",
  });
  const [cacheStatus, setCacheStatus] = useState<Record<string, SongCacheStatus>>({});
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const playlist = today?.playlist ?? null;
  const songs = useMemo(() => playlist?.songs.map((entry) => entry.song) ?? [], [playlist]);
  const activeJob = today?.active_job ?? null;
  const isWorking = Boolean(activeJob && (activeJob.status === "queued" || activeJob.status === "running")) ||
    WORKING_STATUSES.has(today?.status ?? "");

  const refreshDaily = useCallback(
    async (options: { showSpinner?: boolean; date?: string } = {}) => {
      if (!session) {
        return;
      }
      if (options.showSpinner) {
        setLoading(true);
      }
      setError(null);
      try {
        const [todayResponse, historyResponse] = await Promise.all([
          getTodayDaily(session.accessToken, options.date),
          listDailyHistory(session.accessToken, 20),
        ]);
        setToday(todayResponse);
        setHistory(historyResponse.playlists);
        const nextSongs = todayResponse.playlist?.songs.map((entry) => entry.song) ?? [];
        await mergeSongCatalog(session.user.id, nextSongs);
        await updateCacheStatuses(nextSongs);
      } catch (exc) {
        setError(exc instanceof Error ? exc.message : "Daily could not load.");
      } finally {
        if (options.showSpinner) {
          setLoading(false);
        }
      }
    },
    [session],
  );

  useEffect(() => {
    refreshDaily({ showSpinner: true });
  }, [refreshDaily]);

  useEffect(() => {
    if (!session || !isWorking) {
      return;
    }
    const timer = setInterval(() => {
      refreshDaily();
    }, 5000);
    return () => clearInterval(timer);
  }, [isWorking, refreshDaily, session]);

  async function updateCacheStatuses(nextSongs: Song[]) {
    setCacheStatus(await getSongCacheStatuses(nextSongs));
  }

  async function startDailyGeneration() {
    if (!session || generating || isWorking) {
      return;
    }
    setGenerating(true);
    setError(null);
    try {
      const resume = RESUMABLE_STATUSES.has(today?.status ?? "");
      const response = await generateTodayDaily(session.accessToken, {
        date: today?.date,
        resume,
        jobId: resume ? (today?.active_job?.id ?? today?.playlist?.job_id) : null,
      });
      setToday({
        date: response.date,
        status: response.status,
        playlist: response.playlist,
        active_job: response.job,
      });
      const nextSongs = response.playlist?.songs.map((entry) => entry.song) ?? [];
      await mergeSongCatalog(session.user.id, nextSongs);
      await updateCacheStatuses(nextSongs);
      await refreshDaily();
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Daily generation could not start.");
    } finally {
      setGenerating(false);
    }
  }

  async function selectHistoryPlaylist(item: DailyPlaylistSummary) {
    if (!session) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const detail: DailyPlaylist = await getDailyPlaylist(session.accessToken, item.date);
      setToday({
        date: detail.date,
        status: detail.status,
        playlist: detail,
        active_job: null,
      });
      const nextSongs = detail.songs.map((entry) => entry.song);
      await mergeSongCatalog(session.user.id, nextSongs);
      await updateCacheStatuses(nextSongs);
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Daily playlist could not load.");
    } finally {
      setLoading(false);
    }
  }

  async function selectSong(song: Song) {
    setSelectedTrack({ title: song.title, subtitle: songSubtitle(song) });
    if (!session || cacheStatus[song.id] === "downloading") {
      return;
    }

    if (cacheStatus[song.id] !== "cached") {
      setCacheStatus((current) => ({ ...current, [song.id]: "downloading" }));
    }
    try {
      const result = await playSong(song, songs, { source: "daily" });
      if (result) {
        setCacheStatus((current) => ({ ...current, [song.id]: result.cached ? "cached" : "remote" }));
      } else if (cacheStatus[song.id] !== "cached") {
        setCacheStatus((current) => ({ ...current, [song.id]: "remote" }));
      }
    } catch {
      setCacheStatus((current) => ({ ...current, [song.id]: "remote" }));
    }
  }

  async function downloadSong(song: Song) {
    if (!session || cacheStatus[song.id] === "downloading") {
      return;
    }
    setCacheStatus((current) => ({ ...current, [song.id]: "downloading" }));
    try {
      await cacheSong(song, session.accessToken);
      await mergeSongCatalog(session.user.id, [song]);
      setCacheStatus((current) => ({ ...current, [song.id]: "cached" }));
    } catch (exc) {
      setCacheStatus((current) => ({ ...current, [song.id]: "remote" }));
      throw exc;
    }
  }

  function updateSongLike(songId: string, isLiked: boolean, likedAt: string | null) {
    setToday((current) => {
      if (!current?.playlist) {
        return current;
      }
      return {
        ...current,
        playlist: {
          ...current.playlist,
          songs: current.playlist.songs.map((entry) =>
            entry.song.id === songId ? { ...entry, song: { ...entry.song, is_liked: isLiked, liked_at: likedAt } } : entry,
          ),
        },
      };
    });
    updateCurrentSongLike(songId, isLiked, likedAt);
  }

  const heroSong = songs[0];
  const heroTitle = playlist?.title ?? "Daily";
  const heroMeta = dailyHeroMeta(today, songs.length);
  const generateDisabled = generating || isWorking || loading;

  return (
    <MusicPage playerTitle={selectedTrack.title} playerSubtitle={selectedTrack.subtitle}>
      <Section>
        <Text style={styles.eyebrow}>{today?.date ?? "Today"}</Text>
        <Text style={styles.title}>Daily</Text>
      </Section>

      <Section>
        <View style={styles.hero}>
          {heroSong ? (
            <SongArtwork accessToken={session?.accessToken ?? null} colors={artworkPalettes[1]} size={112} song={heroSong} />
          ) : (
            <AlbumArt colors={artworkPalettes[1]} size={112} />
          )}
          <View style={styles.heroCopy}>
            <Text style={styles.heroLabel}>{statusLabel(today?.status ?? "not_started")}</Text>
            <Text style={styles.heroTitle} numberOfLines={2}>
              {heroTitle}
            </Text>
            <Text style={styles.heroMeta} numberOfLines={2}>
              {heroMeta}
            </Text>
            {playlist?.status === "ready" ? null : (
              <Pressable
                accessibilityRole="button"
                disabled={generateDisabled}
                onPress={startDailyGeneration}
                style={({ pressed }) => [
                  styles.generateButton,
                  pressed && styles.pressed,
                  generateDisabled && styles.disabled,
                ]}>
                <Text style={styles.generateButtonText}>{generateButtonText(today?.status, generating, isWorking)}</Text>
              </Pressable>
            )}
          </View>
        </View>
      </Section>

      <Section>
        <View style={styles.cardGrid}>
          <View style={styles.dailyCard}>
            <Text style={styles.cardLabel}>Status</Text>
            <Text style={styles.cardTitle} numberOfLines={1}>
              {statusLabel(today?.status ?? "not_started")}
            </Text>
            <Text style={styles.cardSubtitle} numberOfLines={2}>
              {activeJob ? statusLabel(activeJob.stage) : playlist?.error || "Personal generation queue"}
            </Text>
            <Text style={styles.cardMeta}>{playlist ? `${playlist.song_count} songs` : "No songs yet"}</Text>
          </View>

          <View style={styles.dailyCard}>
            <Text style={styles.cardLabel}>History</Text>
            <Text style={styles.cardTitle} numberOfLines={1}>
              {history.length ? `${history.length} days` : "Empty"}
            </Text>
            <Text style={styles.cardSubtitle} numberOfLines={2}>
              Separate from Play Lists
            </Text>
            <Text style={styles.cardMeta}>{history[0]?.date ?? "Start today"}</Text>
          </View>
        </View>
      </Section>

      {history.length > 0 ? (
        <Section>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>History</Text>
            {loading ? <ActivityIndicator color={theme.colors.tint} size="small" /> : null}
          </View>
          <View style={styles.historyGrid}>
            {history.slice(0, 6).map((item) => (
              <Pressable
                key={item.id}
                onPress={() => selectHistoryPlaylist(item)}
                style={({ pressed }) => [
                  styles.historyCard,
                  playlist?.id === item.id && styles.historyCardActive,
                  pressed && styles.pressed,
                ]}>
                <Text style={styles.historyDate}>{item.date}</Text>
                <Text style={styles.historyMeta}>{item.song_count} songs</Text>
              </Pressable>
            ))}
          </View>
        </Section>
      ) : null}

      <Section>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Today's Playlist</Text>
          {loading || isWorking ? <ActivityIndicator color={theme.colors.tint} size="small" /> : null}
        </View>
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
        <View style={styles.list}>
          {songs.length > 0 ? (
            songs.map((song, index) => {
              const displaySong = currentSong?.id === song.id ? currentSong : song;
              return (
                <Pressable
                  key={song.id}
                  onPress={() => selectSong(song)}
                  style={({ pressed }) => [styles.trackRow, pressed && styles.pressed]}>
                  <SongArtwork
                    accessToken={session?.accessToken ?? null}
                    colors={artworkPalettes[index % artworkPalettes.length]}
                    size={50}
                    song={displaySong}
                  />
                  <View style={styles.trackCopy}>
                    <View style={styles.trackTitleLine}>
                      <Text style={styles.trackTitle} numberOfLines={1}>
                        {displaySong.title}
                      </Text>
                      {displaySong.is_liked ? <Text style={styles.likeBadge}>♥</Text> : null}
                    </View>
                    <Text style={styles.trackMeta} numberOfLines={1}>
                      {songSubtitle(displaySong)}
                    </Text>
                  </View>
                  <View style={styles.trailing}>
                    <Text
                      style={[
                        styles.duration,
                        (cacheStatus[song.id] === "cached" || currentSong?.id === song.id) && styles.cached,
                      ]}>
                      {songStatusText(song, cacheStatus[song.id], busySongId, currentSong?.id, isPlaying)}
                    </Text>
                  </View>
                  <SongActionMenu
                    accessToken={session?.accessToken ?? null}
                    isDownloaded={cacheStatus[displaySong.id] === "cached"}
                    isLiked={Boolean(displaySong.is_liked)}
                    onDownload={downloadSong}
                    onLikeChanged={updateSongLike}
                    song={displaySong}
                  />
                </Pressable>
              );
            })
          ) : (
            <View style={styles.emptyPanel}>
              <Text style={styles.emptyTitle}>{isWorking ? "Generating Daily" : "No Daily Yet"}</Text>
              <Text style={styles.emptyMeta}>{isWorking ? statusLabel(activeJob?.stage ?? today?.status ?? "") : "Create today's AI playlist from your taste tags"}</Text>
            </View>
          )}
        </View>
      </Section>
    </MusicPage>
  );
}

function songStatusText(
  song: Song,
  cacheStatus: SongCacheStatus | undefined,
  busySongId: string | null,
  currentSongId: string | undefined,
  isPlaying: boolean,
): string {
  if (busySongId === song.id || cacheStatus === "downloading") {
    return "Loading";
  }
  if (currentSongId === song.id && isPlaying) {
    return "Playing";
  }
  if (cacheStatus === "cached") {
    return "Cached";
  }
  return formatDuration(song.duration_seconds);
}

function dailyHeroMeta(today: DailyTodayResponse | null, songCount: number): string {
  if (!today || today.status === "not_started") {
    return "Generate a private AI playlist for today";
  }
  if (today.status === "ready") {
    return `${songCount} songs ready`;
  }
  if (today.status === "failed") {
    return today.playlist?.error || today.active_job?.error || "Generation failed";
  }
  if (today.status === "captcha_required") {
    return today.playlist?.error || today.active_job?.error || "Suno needs human verification";
  }
  return statusLabel(today.active_job?.stage ?? today.status);
}

function generateButtonText(status: string | undefined, generating: boolean, isWorking: boolean): string {
  if (generating || isWorking) {
    return "Generating";
  }
  if (status === "failed") {
    return "Retry";
  }
  if (status === "captcha_required") {
    return "Continue";
  }
  return "Generate";
}

function statusLabel(status: string): string {
  if (status.startsWith("suno_batch_")) {
    return `Suno Batch ${status.replace("suno_batch_", "")}`;
  }
  switch (status) {
    case "not_started":
      return "Not Generated";
    case "queued":
      return "Queued";
    case "generating_tags":
      return "Tag Seeds";
    case "generating_playlist_prompt":
      return "Daily Plan";
    case "generating_song_prompts":
      return "Song Prompts";
    case "suno_queue":
      return "Suno Queue";
    case "submitting_to_suno":
      return "Suno Batch";
    case "importing":
      return "Importing";
    case "ready":
      return "Ready";
    case "captcha_required":
      return "Captcha Required";
    case "failed":
      return "Failed";
    default:
      return status ? status.replace(/_/g, " ") : "Daily";
  }
}

const styles = StyleSheet.create({
  eyebrow: {
    color: theme.colors.tint,
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: 0,
  },
  title: {
    color: theme.colors.text,
    fontSize: 42,
    fontWeight: "900",
  },
  hero: {
    alignItems: "center",
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    flexDirection: "row",
    gap: 14,
    padding: 12,
  },
  heroCopy: {
    flex: 1,
    gap: 4,
    minWidth: 0,
  },
  heroLabel: {
    color: theme.colors.tint,
    fontSize: 12,
    fontWeight: "900",
  },
  heroTitle: {
    color: theme.colors.text,
    flexShrink: 1,
    fontSize: 23,
    fontWeight: "900",
  },
  heroMeta: {
    color: theme.colors.secondaryText,
    fontSize: 13,
  },
  generateButton: {
    alignItems: "center",
    backgroundColor: theme.colors.tint,
    borderRadius: theme.radius.pill,
    justifyContent: "center",
    minHeight: 38,
    minWidth: 98,
    paddingHorizontal: 14,
  },
  generateButtonText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "900",
  },
  disabled: {
    opacity: 0.52,
  },
  cardGrid: {
    flexDirection: "row",
    gap: 10,
  },
  dailyCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    flex: 1,
    gap: 6,
    minHeight: 142,
    padding: 12,
  },
  cardLabel: {
    color: theme.colors.tint,
    fontSize: 11,
    fontWeight: "900",
  },
  cardTitle: {
    color: theme.colors.text,
    fontSize: 15,
    fontWeight: "900",
  },
  cardSubtitle: {
    color: theme.colors.secondaryText,
    fontSize: 12,
    lineHeight: 16,
  },
  cardMeta: {
    color: theme.colors.tint,
    fontSize: 12,
    fontWeight: "800",
    marginTop: "auto",
  },
  sectionTitle: {
    color: theme.colors.text,
    fontSize: 20,
    fontWeight: "900",
  },
  sectionHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 24,
  },
  historyGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  historyCard: {
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.hairline,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    minWidth: 118,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  historyCardActive: {
    backgroundColor: theme.colors.tintSoft,
    borderColor: theme.colors.tint,
  },
  historyDate: {
    color: theme.colors.text,
    fontSize: 13,
    fontWeight: "900",
  },
  historyMeta: {
    color: theme.colors.secondaryText,
    fontSize: 12,
    marginTop: 3,
  },
  list: {
    gap: 8,
  },
  trackRow: {
    alignItems: "center",
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    flexDirection: "row",
    gap: 11,
    minHeight: 64,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  trackCopy: {
    flex: 1,
    minWidth: 0,
  },
  trackTitleLine: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
    minWidth: 0,
  },
  trackTitle: {
    color: theme.colors.text,
    flexShrink: 1,
    fontSize: 15,
    fontWeight: "800",
  },
  trackMeta: {
    color: theme.colors.secondaryText,
    fontSize: 12,
    marginTop: 3,
  },
  duration: {
    color: theme.colors.tertiaryText,
    fontSize: 12,
    fontWeight: "800",
  },
  trailing: {
    alignItems: "flex-end",
    gap: 2,
    minWidth: 54,
  },
  likeBadge: {
    color: theme.colors.tint,
    fontSize: 12,
    fontWeight: "900",
    lineHeight: 14,
  },
  cached: {
    color: theme.colors.tint,
  },
  emptyPanel: {
    alignItems: "flex-start",
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    gap: 5,
    minHeight: 82,
    justifyContent: "center",
    padding: 14,
  },
  emptyTitle: {
    color: theme.colors.text,
    fontSize: 16,
    fontWeight: "900",
  },
  emptyMeta: {
    color: theme.colors.secondaryText,
    fontSize: 13,
  },
  errorText: {
    color: theme.colors.tint,
    fontSize: 13,
    fontWeight: "800",
  },
  pressed: {
    opacity: 0.78,
  },
});
