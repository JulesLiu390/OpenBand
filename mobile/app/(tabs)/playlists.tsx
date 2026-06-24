import { useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { AlbumArt } from "@/components/AlbumArt";
import { Section } from "@/components/AppShell";
import { useAuth } from "@/components/AuthProvider";
import { MusicPage } from "@/components/MusicPage";
import { usePlayer } from "@/components/PlayerProvider";
import { SongActionMenu } from "@/components/SongActionMenu";
import { SongArtwork } from "@/components/SongArtwork";
import {
  createPlaylist,
  getPlaylist,
  listPlaylists,
  PlaylistDetail,
  PlaylistSummary,
} from "@/lib/playlists";
import {
  Song,
  SongCacheStatus,
  cacheSong,
  getSongCacheStatuses,
  listAllSongs,
  loadCachedSongs,
  mergeSongCatalog,
  songTagSummary,
} from "@/lib/songs";
import { artworkPalettes, theme } from "@/lib/theme";

export default function PlaylistsScreen() {
  const { session } = useAuth();
  const { busySongId, currentSong, isPlaying, playSong, updateCurrentSongLike } = usePlayer();
  const [catalogSongs, setCatalogSongs] = useState<Song[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(false);
  const [newName, setNewName] = useState("");
  const [playlists, setPlaylists] = useState<PlaylistSummary[]>([]);
  const [selectedPlaylist, setSelectedPlaylist] = useState<PlaylistDetail | null>(null);
  const [cacheStatus, setCacheStatus] = useState<Record<string, SongCacheStatus>>({});

  const selectedPlaylistId = selectedPlaylist?.id;

  useFocusEffect(
    useCallback(() => {
      let mounted = true;

      async function load() {
        if (!session) {
          setCatalogSongs([]);
          setPlaylists([]);
          setSelectedPlaylist(null);
          setCacheStatus({});
          setLoading(false);
          return;
        }
        setLoading(true);
        try {
          const [playlistResponse, songResponse] = await Promise.all([
            listPlaylists(session.accessToken),
            listAllSongs(session.accessToken),
          ]);
          if (!mounted) {
            return;
          }
          const nextSelected = selectedPlaylistId
            ? playlistResponse.playlists.find((playlist) => playlist.id === selectedPlaylistId)
            : undefined;
          const nextSelectedDetail = nextSelected ? await getPlaylist(session.accessToken, nextSelected.id) : null;
          const statusSongs = [...songResponse.songs, ...(nextSelectedDetail?.songs ?? [])];
          await mergeSongCatalog(session.user.id, statusSongs);
          const statuses = await getSongCacheStatuses(statusSongs);
          if (!mounted) {
            return;
          }
          setCatalogSongs(songResponse.songs);
          setPlaylists(playlistResponse.playlists);
          setSelectedPlaylist(nextSelectedDetail);
          setCacheStatus(statuses);
        } catch {
          const cachedSongs = session ? await loadCachedSongs(session.user.id) : [];
          const statuses = await getSongCacheStatuses(cachedSongs);
          if (mounted) {
            setCatalogSongs(cachedSongs);
            setPlaylists([]);
            setSelectedPlaylist(null);
            setCacheStatus(statuses);
          }
        } finally {
          if (mounted) {
            setLoading(false);
          }
        }
      }

      load();

      return () => {
        mounted = false;
      };
    }, [selectedPlaylistId, session]),
  );

  const availableSongs = useMemo(() => {
    const selectedIds = new Set(selectedPlaylist?.songs.map((song) => song.id) ?? []);
    return catalogSongs.filter((song) => !selectedIds.has(song.id)).slice(0, 8);
  }, [catalogSongs, selectedPlaylist]);

  async function refreshPlaylists(selectedId?: string) {
    if (!session) {
      return;
    }
    const playlistResponse = await listPlaylists(session.accessToken);
    setPlaylists(playlistResponse.playlists);
    const nextSelected = selectedId
      ? playlistResponse.playlists.find((playlist) => playlist.id === selectedId)
      : playlistResponse.playlists.find((playlist) => playlist.id === selectedPlaylist?.id);
    if (nextSelected) {
      const detail = await getPlaylist(session.accessToken, nextSelected.id);
      await mergeSongCatalog(session.user.id, detail.songs);
      const statuses = await getSongCacheStatuses(detail.songs);
      setSelectedPlaylist(detail);
      setCacheStatus((current) => ({ ...current, ...statuses }));
    } else {
      setSelectedPlaylist(null);
    }
  }

  async function submitPlaylist() {
    const name = newName.trim();
    if (!session || !name || creating) {
      return;
    }
    setCreating(true);
    try {
      const playlist = await createPlaylist(session.accessToken, name);
      setNewName("");
      setCreateOpen(false);
      await refreshPlaylists(playlist.id);
    } finally {
      setCreating(false);
    }
  }

  async function selectPlaylist(playlist: PlaylistSummary) {
    if (selectedPlaylist?.id === playlist.id) {
      setSelectedPlaylist(null);
      return;
    }
    if (!session) {
      return;
    }
    const detail = await getPlaylist(session.accessToken, playlist.id);
    await mergeSongCatalog(session.user.id, detail.songs);
    const statuses = await getSongCacheStatuses(detail.songs);
    setSelectedPlaylist(detail);
    setCacheStatus((current) => ({ ...current, ...statuses }));
  }

  async function playFromPlaylist(song: Song) {
    if (!selectedPlaylist) {
      return;
    }
    if (cacheStatus[song.id] !== "cached") {
      setCacheStatus((current) => ({ ...current, [song.id]: "downloading" }));
    }
    try {
      const result = await playSong(song, selectedPlaylist.songs, { playlistId: selectedPlaylist.id, source: "playlist" });
      if (result) {
        setCacheStatus((current) => ({ ...current, [song.id]: result.cached ? "cached" : "remote" }));
      } else if (cacheStatus[song.id] !== "cached") {
        setCacheStatus((current) => ({ ...current, [song.id]: "remote" }));
      }
    } catch {
      setCacheStatus((current) => ({ ...current, [song.id]: "remote" }));
    }
  }

  async function playSelectedPlaylist() {
    const firstSong = selectedPlaylist?.songs[0];
    if (!firstSong) {
      return;
    }
    await playFromPlaylist(firstSong);
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
    setCatalogSongs((current) =>
      current.map((song) => (song.id === songId ? { ...song, is_liked: isLiked, liked_at: likedAt } : song)),
    );
    setSelectedPlaylist((current) => {
      if (!current) {
        return current;
      }
      if (current.is_system && !isLiked) {
        return {
          ...current,
          song_count: Math.max(0, current.song_count - 1),
          songs: current.songs.filter((song) => song.id !== songId),
        };
      }
      return {
        ...current,
        songs: current.songs.map((song) => (song.id === songId ? { ...song, is_liked: isLiked, liked_at: likedAt } : song)),
      };
    });
    updateCurrentSongLike(songId, isLiked, likedAt);
  }

  async function refreshAfterPlaylistChange() {
    await refreshPlaylists(selectedPlaylist?.id);
  }

  const heroSong = selectedPlaylist?.songs[0] ?? null;
  const selectedIsSystem = Boolean(selectedPlaylist?.is_system);

  return (
    <MusicPage>
      <Section>
        <View style={styles.header}>
          <View>
            <Text style={styles.eyebrow}>Your Mixes</Text>
            <Text style={styles.title}>Play Lists</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={() => setCreateOpen((open) => !open)}
            style={({ pressed }) => [styles.addButton, pressed && styles.pressed]}>
            <Text style={styles.addIcon}>＋</Text>
          </Pressable>
        </View>
      </Section>

      {createOpen ? (
        <Section>
          <View style={styles.createPanel}>
            <TextInput
              autoCapitalize="words"
              onChangeText={setNewName}
              placeholder="Playlist name"
              placeholderTextColor={theme.colors.tertiaryText}
              style={styles.input}
              value={newName}
            />
            <Pressable
              disabled={!newName.trim() || creating}
              onPress={submitPlaylist}
              style={({ pressed }) => [styles.createButton, pressed && styles.pressed, (!newName.trim() || creating) && styles.disabled]}>
              <Text style={styles.createButtonText}>{creating ? "Creating" : "Create"}</Text>
            </Pressable>
          </View>
        </Section>
      ) : null}

      <Section>
        <View style={styles.featured}>
          {heroSong ? (
            <SongArtwork accessToken={session?.accessToken ?? null} colors={artworkPalettes[3]} size={96} song={heroSong} />
          ) : (
            <AlbumArt colors={artworkPalettes[3]} size={96} />
          )}
          <View style={styles.featuredCopy}>
            <Text style={styles.featuredLabel}>Selected List</Text>
            <Text style={styles.featuredTitle} numberOfLines={1}>
              {selectedPlaylist?.name ?? "No List Selected"}
            </Text>
            <Text style={styles.featuredMeta} numberOfLines={2}>
              {selectedPlaylist
                ? `${selectedPlaylist.song_count} songs · ${selectedIsSystem ? "System list" : "Personal list"}`
                : playlists.length
                  ? "Select a list to view songs"
                  : "Create a list and add songs from your library"}
            </Text>
          </View>
          {selectedPlaylist?.songs.length ? (
            <Pressable
              accessibilityLabel="Play selected playlist"
              accessibilityRole="button"
              onPress={playSelectedPlaylist}
              style={({ pressed }) => [styles.playButton, pressed && styles.pressed]}>
              <Text style={styles.playButtonText}>Play All</Text>
            </Pressable>
          ) : null}
        </View>
      </Section>

      <Section>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>All Play Lists</Text>
          {loading ? <ActivityIndicator color={theme.colors.tint} size="small" /> : null}
        </View>
        <View style={styles.grid}>
          {playlists.map((playlist, index) => (
            <Pressable
              key={playlist.id}
              onPress={() => selectPlaylist(playlist)}
              style={({ pressed }) => [
                styles.card,
                selectedPlaylist?.id === playlist.id && styles.selectedCard,
                pressed && styles.pressed,
              ]}>
              <AlbumArt colors={artworkPalettes[index % artworkPalettes.length]} size={72} />
              <Text style={styles.cardTitle} numberOfLines={1}>
                {playlist.name}
              </Text>
              <Text style={styles.cardSubtitle} numberOfLines={2}>
                {playlist.description || (playlist.is_system ? "System playlist" : "Personal playlist")}
              </Text>
              <Text style={styles.cardCount}>{playlist.song_count} songs</Text>
            </Pressable>
          ))}
        </View>
      </Section>

      {selectedPlaylist ? (
        <Section>
          <Text style={styles.sectionTitle}>Songs In List</Text>
          <View style={styles.list}>
            {selectedPlaylist.songs.length ? (
              selectedPlaylist.songs.map((song, index) => {
                const displaySong = currentSong?.id === song.id ? currentSong : song;
                const tagPreview = songTagSummary(displaySong);
                return (
                  <Pressable
                    key={song.id}
                    onPress={() => playFromPlaylist(song)}
                    style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
                    <SongArtwork
                      accessToken={session?.accessToken ?? null}
                      colors={artworkPalettes[index % artworkPalettes.length]}
                      size={54}
                      song={displaySong}
                    />
                    <View style={styles.rowCopy}>
                      <View style={styles.titleLine}>
                        <Text style={styles.rowTitle} numberOfLines={1}>
                          {displaySong.title}
                        </Text>
                        {displaySong.is_liked ? <Text style={styles.likeBadge}>♥</Text> : null}
                      </View>
                      {tagPreview ? (
                        <Text style={styles.rowMeta} numberOfLines={1}>
                          {tagPreview}
                        </Text>
                      ) : null}
                      <Text style={[styles.rowDetail, currentSong?.id === song.id && styles.activeText]}>
                        {busySongId === song.id || cacheStatus[song.id] === "downloading"
                          ? "Loading"
                          : currentSong?.id === song.id && isPlaying
                            ? "Playing"
                            : cacheStatus[song.id] === "cached"
                              ? "Downloaded"
                              : selectedIsSystem
                                ? "Liked"
                                : "In playlist"}
                      </Text>
                    </View>
                    <SongActionMenu
                      accessToken={session?.accessToken ?? null}
                      canRemoveFromPlaylist
                      currentPlaylistId={selectedPlaylist.id}
                      isDownloaded={cacheStatus[displaySong.id] === "cached"}
                      isLiked={Boolean(displaySong.is_liked)}
                      onAddedToPlaylist={refreshAfterPlaylistChange}
                      onDownload={downloadSong}
                      onLikeChanged={updateSongLike}
                      onRemovedFromPlaylist={refreshAfterPlaylistChange}
                      removeFromPlaylistLabel={selectedIsSystem ? "Remove from Liked Music" : "Remove from This List"}
                      song={displaySong}
                    />
                  </Pressable>
                );
              })
            ) : (
              <View style={styles.emptyState}>
                <Text style={styles.emptyTitle}>Empty list</Text>
                <Text style={styles.emptyText}>{selectedIsSystem ? "Like songs from Library or Daily" : "Add songs below"}</Text>
              </View>
            )}
          </View>
        </Section>
      ) : null}

      {selectedPlaylist && !selectedIsSystem ? (
        <Section>
          <Text style={styles.sectionTitle}>Add Songs</Text>
          <View style={styles.list}>
            {availableSongs.map((song, index) => {
              const tagPreview = songTagSummary(song);
              return (
                <View key={song.id} style={styles.row}>
                  <SongArtwork
                    accessToken={session?.accessToken ?? null}
                    colors={artworkPalettes[(index + 2) % artworkPalettes.length]}
                    size={54}
                    song={song}
                  />
                  <View style={styles.rowCopy}>
                    <View style={styles.titleLine}>
                      <Text style={styles.rowTitle} numberOfLines={1}>
                        {song.title}
                      </Text>
                      {song.is_liked ? <Text style={styles.likeBadge}>♥</Text> : null}
                    </View>
                    {tagPreview ? (
                      <Text style={styles.rowMeta} numberOfLines={1}>
                        {tagPreview}
                      </Text>
                    ) : null}
                  </View>
                  <SongActionMenu
                    accessToken={session?.accessToken ?? null}
                    isDownloaded={cacheStatus[song.id] === "cached"}
                    isLiked={Boolean(song.is_liked)}
                    onAddedToPlaylist={refreshAfterPlaylistChange}
                    onDownload={downloadSong}
                    onLikeChanged={updateSongLike}
                    song={song}
                  />
                </View>
              );
            })}
          </View>
        </Section>
      ) : null}
    </MusicPage>
  );
}

const styles = StyleSheet.create({
  header: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  eyebrow: {
    color: theme.colors.tint,
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: 0,
  },
  title: {
    color: theme.colors.text,
    fontSize: 40,
    fontWeight: "900",
  },
  addButton: {
    alignItems: "center",
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.hairline,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  addIcon: {
    color: theme.colors.tint,
    fontSize: 25,
    fontWeight: "900",
    lineHeight: 27,
  },
  createPanel: {
    alignItems: "center",
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    flexDirection: "row",
    gap: 10,
    padding: 10,
  },
  input: {
    backgroundColor: "#F2F2F6",
    borderRadius: 8,
    color: theme.colors.text,
    flex: 1,
    fontSize: 15,
    fontWeight: "700",
    minHeight: 42,
    paddingHorizontal: 12,
  },
  createButton: {
    alignItems: "center",
    backgroundColor: theme.colors.tint,
    borderRadius: 999,
    height: 42,
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  createButtonText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "900",
  },
  featured: {
    alignItems: "center",
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    flexDirection: "row",
    gap: 14,
    padding: 12,
  },
  featuredCopy: {
    flex: 1,
    minWidth: 0,
  },
  featuredLabel: {
    color: theme.colors.tint,
    fontSize: 12,
    fontWeight: "900",
  },
  featuredTitle: {
    color: theme.colors.text,
    fontSize: 22,
    fontWeight: "900",
    marginTop: 3,
  },
  featuredMeta: {
    color: theme.colors.secondaryText,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4,
  },
  playButton: {
    alignItems: "center",
    backgroundColor: theme.colors.tint,
    borderRadius: 999,
    minHeight: 42,
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  playButtonText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "900",
    lineHeight: 18,
  },
  sectionHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  sectionTitle: {
    color: theme.colors.text,
    fontSize: 20,
    fontWeight: "900",
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  card: {
    backgroundColor: theme.colors.surface,
    borderColor: "transparent",
    borderRadius: theme.radius.md,
    borderWidth: 1,
    flexBasis: "48%",
    flexGrow: 1,
    gap: 6,
    minHeight: 184,
    padding: 10,
  },
  selectedCard: {
    borderColor: "rgba(255,45,85,0.32)",
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
  cardCount: {
    color: theme.colors.tertiaryText,
    fontSize: 12,
    fontWeight: "800",
    marginTop: "auto",
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
    minHeight: 74,
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
    fontSize: 15,
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
    fontSize: 12,
    marginTop: 3,
  },
  rowDetail: {
    color: theme.colors.tertiaryText,
    fontSize: 12,
    marginTop: 2,
  },
  activeText: {
    color: theme.colors.tint,
  },
  emptyState: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    padding: 18,
  },
  emptyTitle: {
    color: theme.colors.text,
    fontSize: 16,
    fontWeight: "900",
  },
  emptyText: {
    color: theme.colors.secondaryText,
    fontSize: 13,
    marginTop: 3,
  },
  disabled: {
    opacity: 0.45,
  },
  pressed: {
    opacity: 0.75,
  },
});
