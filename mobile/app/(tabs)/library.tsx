import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { AlbumArt } from "@/components/AlbumArt";
import { Section } from "@/components/AppShell";
import { useAuth } from "@/components/AuthProvider";
import { MusicPage } from "@/components/MusicPage";
import { usePlayer } from "@/components/PlayerProvider";
import { SongActionMenu } from "@/components/SongActionMenu";
import { SongArtwork } from "@/components/SongArtwork";
import { libraryAlbums } from "@/lib/demo";
import {
  Song,
  SongCacheStatus,
  cacheSong,
  cacheSongs,
  getSongCacheStatuses,
  listAllSongs,
  loadCachedSongs,
  readableFileSize,
  saveSongCatalog,
  songSubtitle,
} from "@/lib/songs";
import { artworkPalettes, theme } from "@/lib/theme";

export default function LibraryScreen() {
  const { session } = useAuth();
  const { busySongId, currentSong, isPlaying, playSong, updateCurrentSongLike } = usePlayer();
  const [songs, setSongs] = useState<Song[]>([]);
  const [cacheStatus, setCacheStatus] = useState<Record<string, SongCacheStatus>>({});
  const [bulkDownloading, setBulkDownloading] = useState(false);
  const [bulkProgress, setBulkProgress] = useState("");
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [playerTrack, setPlayerTrack] = useState({
    title: "Lake Light",
    subtitle: "Suno Sketch",
  });

  useEffect(() => {
    let mounted = true;

    async function loadSongs() {
      if (!session) {
        setSongs([]);
        setCacheStatus({});
        return;
      }
      try {
        const response = await listAllSongs(session.accessToken);
        await saveSongCatalog(session.user.id, response.songs);
        const statuses = await getSongCacheStatuses(response.songs);
        if (mounted) {
          setSongs(response.songs);
          setCacheStatus(statuses);
          setSyncMessage(null);
        }
      } catch {
        const cachedSongs = await loadCachedSongs(session.user.id);
        const statuses = await getSongCacheStatuses(cachedSongs);
        if (mounted) {
          setSongs(cachedSongs);
          setCacheStatus(statuses);
          setSyncMessage(cachedSongs.length ? "Offline library loaded from this phone." : "Library could not load.");
        }
      }
    }

    loadSongs();

    return () => {
      mounted = false;
    };
  }, [session]);

  const shortcuts = useMemo(() => {
    const downloaded = Object.values(cacheStatus).filter((status) => status === "cached").length;
    const tags = new Set(songs.flatMap((song) => song.tags).filter(Boolean));
    return [
      { label: "Tags", value: String(tags.size) },
      { label: "Downloaded", value: String(downloaded) },
    ];
  }, [cacheStatus, songs]);

  async function selectSong(song: Song) {
    setPlayerTrack({ title: song.title, subtitle: songSubtitle(song) });
    if (!session || cacheStatus[song.id] === "downloading") {
      return;
    }

    if (cacheStatus[song.id] !== "cached") {
      setCacheStatus((current) => ({ ...current, [song.id]: "downloading" }));
    }
    try {
      const result = await playSong(song, undefined, { source: "library" });
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
      setCacheStatus((current) => ({ ...current, [song.id]: "cached" }));
    } catch (exc) {
      setCacheStatus((current) => ({ ...current, [song.id]: "remote" }));
      throw exc;
    }
  }

  async function downloadAllSongs() {
    if (!session || bulkDownloading) {
      return;
    }
    const pendingSongs = songs.filter((song) => cacheStatus[song.id] !== "cached");
    if (pendingSongs.length === 0) {
      setSyncMessage("All songs are already downloaded.");
      return;
    }

    setBulkDownloading(true);
    setBulkProgress(`0/${pendingSongs.length}`);
    setSyncMessage(null);
    setCacheStatus((current) => {
      const next = { ...current };
      for (const song of pendingSongs) {
        next[song.id] = "downloading";
      }
      return next;
    });

    let failed = 0;
    try {
      await cacheSongs(pendingSongs, session.accessToken, {
        concurrency: 3,
        onProgress: (item, completed, total) => {
          if (item.error) {
            failed += 1;
          }
          setBulkProgress(`${completed}/${total}`);
          setCacheStatus((current) => ({
            ...current,
            [item.song.id]: item.error ? "remote" : "cached",
          }));
        },
      });
      setSyncMessage(failed ? `${failed} songs could not be downloaded.` : "Offline download complete.");
    } finally {
      setBulkDownloading(false);
    }
  }

  function updateSongLike(songId: string, isLiked: boolean, likedAt: string | null) {
    setSongs((current) =>
      current.map((song) => (song.id === songId ? { ...song, is_liked: isLiked, liked_at: likedAt } : song)),
    );
    updateCurrentSongLike(songId, isLiked, likedAt);
  }

  const hasRemoteSongs = songs.length > 0;
  const pendingDownloadCount = songs.filter((song) => cacheStatus[song.id] !== "cached").length;

  return (
    <MusicPage playerTitle={playerTrack.title} playerSubtitle={playerTrack.subtitle}>
      <Section>
        <Text style={styles.eyebrow}>Collection</Text>
        <Text style={styles.title}>Library</Text>
      </Section>

      <Section>
        <View style={styles.shortcutGrid}>
          {shortcuts.map((shortcut) => (
            <View key={shortcut.label} style={styles.shortcut}>
              <Text style={styles.shortcutValue}>{shortcut.value}</Text>
              <Text style={styles.shortcutLabel}>{shortcut.label}</Text>
            </View>
          ))}
        </View>
        {hasRemoteSongs ? (
          <Pressable
            accessibilityRole="button"
            disabled={bulkDownloading || pendingDownloadCount === 0}
            onPress={downloadAllSongs}
            style={({ pressed }) => [
              styles.downloadAllButton,
              pressed && styles.pressed,
              (bulkDownloading || pendingDownloadCount === 0) && styles.disabled,
            ]}>
            <Text style={styles.downloadAllText}>
              {bulkDownloading
                ? `Downloading ${bulkProgress}`
                : pendingDownloadCount === 0
                  ? "All Songs Downloaded"
                  : `Download All (${pendingDownloadCount})`}
            </Text>
          </Pressable>
        ) : null}
        {syncMessage ? <Text style={styles.syncMessage}>{syncMessage}</Text> : null}
      </Section>

      <Section>
        <Text style={styles.sectionTitle}>Recently Added</Text>
        <View style={styles.list}>
          {hasRemoteSongs
            ? songs.map((song, index) => {
                const displaySong = currentSong?.id === song.id ? currentSong : song;
                return (
                  <Pressable
                    key={song.id}
                    onPress={() => selectSong(song)}
                    style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
                    <SongArtwork
                      accessToken={session?.accessToken ?? null}
                      colors={artworkPalettes[index % artworkPalettes.length]}
                      size={58}
                      song={displaySong}
                    />
                    <View style={styles.rowCopy}>
                      <View style={styles.titleLine}>
                        <Text style={styles.rowTitle} numberOfLines={1}>
                          {displaySong.title}
                        </Text>
                        {displaySong.is_liked ? <Text style={styles.likeBadge}>♥</Text> : null}
                      </View>
                      <Text style={styles.rowMeta} numberOfLines={1}>
                        {songSubtitle(displaySong)}
                      </Text>
                      <Text style={styles.rowDetail} numberOfLines={1}>
                        {songDetailText(song, cacheStatus[song.id], busySongId, currentSong?.id, isPlaying)}
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
            : libraryAlbums.map((album, index) => (
                <View key={album.title} style={styles.row}>
                  <AlbumArt colors={artworkPalettes[index % artworkPalettes.length]} size={58} />
                  <View style={styles.rowCopy}>
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {album.title}
                    </Text>
                    <Text style={styles.rowMeta} numberOfLines={1}>
                      {album.artist}
                    </Text>
                    <Text style={styles.rowDetail} numberOfLines={1}>
                      {album.detail}
                    </Text>
                  </View>
                  <Text style={styles.more}>⋯</Text>
                </View>
              ))}
        </View>
      </Section>
    </MusicPage>
  );
}

function songDetailText(
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
  return `${readableFileSize(song.file_size)} · ${song.tags.slice(0, 3).join(", ")}`;
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
  shortcutGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  shortcut: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    flexBasis: "48%",
    flexGrow: 1,
    minHeight: 86,
    padding: 14,
  },
  shortcutValue: {
    color: theme.colors.tint,
    fontSize: 24,
    fontWeight: "900",
  },
  shortcutLabel: {
    color: theme.colors.secondaryText,
    fontSize: 13,
    fontWeight: "800",
    marginTop: 6,
  },
  downloadAllButton: {
    alignItems: "center",
    backgroundColor: theme.colors.tint,
    borderRadius: theme.radius.pill,
    minHeight: 42,
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  downloadAllText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "900",
  },
  syncMessage: {
    color: theme.colors.secondaryText,
    fontSize: 12,
    fontWeight: "800",
  },
  sectionTitle: {
    color: theme.colors.text,
    fontSize: 20,
    fontWeight: "900",
  },
  list: {
    gap: 9,
  },
  row: {
    alignItems: "center",
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    flexDirection: "row",
    gap: 12,
    minHeight: 78,
    padding: 10,
  },
  rowCopy: {
    flex: 1,
    minWidth: 0,
  },
  titleLine: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
    minWidth: 0,
  },
  rowTitle: {
    color: theme.colors.text,
    flexShrink: 1,
    fontSize: 16,
    fontWeight: "900",
  },
  likeBadge: {
    color: theme.colors.tint,
    fontSize: 13,
    fontWeight: "900",
    lineHeight: 14,
  },
  rowMeta: {
    color: theme.colors.secondaryText,
    fontSize: 13,
    marginTop: 3,
  },
  rowDetail: {
    color: theme.colors.tertiaryText,
    fontSize: 12,
    marginTop: 2,
  },
  more: {
    color: theme.colors.tertiaryText,
    fontSize: 24,
    fontWeight: "900",
    lineHeight: 24,
    width: 28,
  },
  pressed: {
    opacity: 0.78,
  },
  disabled: {
    opacity: 0.52,
  },
});
