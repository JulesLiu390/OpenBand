import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Section } from "@/components/AppShell";
import { useAuth } from "@/components/AuthProvider";
import { MusicPage } from "@/components/MusicPage";
import { usePlayer } from "@/components/PlayerProvider";
import { SongActionMenu } from "@/components/SongActionMenu";
import { SongArtwork } from "@/components/SongArtwork";
import {
  Song,
  SongCacheStatus,
  cacheSong,
  getSongCacheStatuses,
  listAllSongs,
  loadCachedSongs,
  readableFileSize,
  saveSongCatalog,
  songTagSummary,
} from "@/lib/songs";
import { artworkPalettes, theme } from "@/lib/theme";

export default function LibraryScreen() {
  const { session } = useAuth();
  const { busySongId, currentSong, isPlaying, playSong, updateCurrentSongLike } = usePlayer();
  const [songs, setSongs] = useState<Song[]>([]);
  const [cacheStatus, setCacheStatus] = useState<Record<string, SongCacheStatus>>({});
  const [tagBrowserOpen, setTagBrowserOpen] = useState(false);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [tagSort, setTagSort] = useState<TagSort>("count");
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

  const tagFacets = useMemo(() => buildTagFacets(songs, tagSort), [songs, tagSort]);
  const selectedTagKeys = useMemo(() => new Set(selectedTags.map(tagKey)), [selectedTags]);
  const visibleSongs = useMemo(() => {
    if (selectedTagKeys.size === 0) {
      return songs;
    }
    return songs.filter((song) => song.tags.some((tag) => selectedTagKeys.has(tagKey(tag))));
  }, [selectedTagKeys, songs]);

  useEffect(() => {
    const facetKeys = new Set(tagFacets.map((item) => tagKey(item.tag)));
    setSelectedTags((current) => current.filter((tag) => facetKeys.has(tagKey(tag))));
  }, [tagFacets]);

  async function selectSong(song: Song) {
    setPlayerTrack({ title: song.title, subtitle: songTagSummary(song) });
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

  function updateSongLike(songId: string, isLiked: boolean, likedAt: string | null) {
    setSongs((current) =>
      current.map((song) => (song.id === songId ? { ...song, is_liked: isLiked, liked_at: likedAt } : song)),
    );
    updateCurrentSongLike(songId, isLiked, likedAt);
  }

  function toggleTag(tag: string) {
    const key = tagKey(tag);
    setSelectedTags((current) =>
      current.some((item) => tagKey(item) === key) ? current.filter((item) => tagKey(item) !== key) : [...current, tag],
    );
  }

  const hasRemoteSongs = songs.length > 0;
  const selectedTitle = selectedTagsTitle(selectedTags);

  return (
    <MusicPage playerTitle={playerTrack.title} playerSubtitle={playerTrack.subtitle}>
      <Section>
        <Text style={styles.eyebrow}>Collection</Text>
        <Text style={styles.title}>Library</Text>
      </Section>

      {syncMessage ? (
        <Section>
          <Text style={styles.syncMessage}>{syncMessage}</Text>
        </Section>
      ) : null}

      {hasRemoteSongs ? (
        <Section>
          <View style={styles.libraryGrid}>
            <Pressable
              accessibilityRole="button"
              onPress={() => setTagBrowserOpen(true)}
              style={({ pressed }) => [styles.libraryTile, pressed && styles.pressed]}>
              <Text style={styles.tileLabel}>Tags</Text>
              <Text style={styles.tileTitle} numberOfLines={2}>
                {selectedTitle ?? "Tags"}
              </Text>
              <Text style={styles.tileMeta}>
                {selectedTags.length ? `${visibleSongs.length} songs` : `${tagFacets.length} tags`}
              </Text>
            </Pressable>
          </View>
        </Section>
      ) : null}

      {hasRemoteSongs && tagBrowserOpen ? (
        <Section>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Tags</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => setTagBrowserOpen(false)}
              style={({ pressed }) => [styles.closeTextButton, pressed && styles.pressed]}>
              <Text style={styles.closeText}>Done</Text>
            </Pressable>
          </View>
          <View style={styles.sortControl}>
            <Pressable
              accessibilityRole="button"
              onPress={() => setTagSort("count")}
              style={({ pressed }) => [styles.sortButton, tagSort === "count" && styles.sortButtonActive, pressed && styles.pressed]}>
              <Text style={[styles.sortText, tagSort === "count" && styles.sortTextActive]}>Song Count</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => setTagSort("az")}
              style={({ pressed }) => [styles.sortButton, tagSort === "az" && styles.sortButtonActive, pressed && styles.pressed]}>
              <Text style={[styles.sortText, tagSort === "az" && styles.sortTextActive]}>A-Z</Text>
            </Pressable>
          </View>
          <View style={styles.tagList}>
            <Pressable
              accessibilityRole="button"
              onPress={() => setSelectedTags([])}
              style={({ pressed }) => [styles.tagRow, selectedTags.length === 0 && styles.tagRowActive, pressed && styles.pressed]}>
              <Text style={[styles.tagRowTitle, selectedTags.length === 0 && styles.tagRowTitleActive]}>All Tags</Text>
              <Text style={[styles.tagRowCount, selectedTags.length === 0 && styles.tagRowCountActive]}>{songs.length}</Text>
            </Pressable>
            {tagFacets.map((item) => {
              const active = selectedTagKeys.has(tagKey(item.tag));
              return (
                <Pressable
                  accessibilityRole="button"
                  key={item.tag}
                  onPress={() => toggleTag(item.tag)}
                  style={({ pressed }) => [styles.tagRow, active && styles.tagRowActive, pressed && styles.pressed]}>
                  <Text style={[styles.tagRowTitle, active && styles.tagRowTitleActive]} numberOfLines={1}>
                    {item.tag}
                  </Text>
                  <Text style={[styles.tagRowCount, active && styles.tagRowCountActive]}>{item.count}</Text>
                </Pressable>
              );
            })}
          </View>
        </Section>
      ) : null}

      {hasRemoteSongs ? (
        <Section>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{selectedTitle ?? "Recently Added"}</Text>
            <Text style={styles.sectionMeta}>{visibleSongs.length} songs</Text>
          </View>
          <View style={styles.list}>
            {visibleSongs.map((song, index) => {
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
            })}
          </View>
        </Section>
      ) : null}
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
  const tagPreview = songTagSummary(song);
  return tagPreview ? `${readableFileSize(song.file_size)} · ${tagPreview}` : readableFileSize(song.file_size);
}

type TagFacet = {
  tag: string;
  count: number;
};

type TagSort = "count" | "az";

function buildTagFacets(songs: Song[], sort: TagSort): TagFacet[] {
  const counts = new Map<string, TagFacet>();
  for (const song of songs) {
    for (const rawTag of song.tags) {
      const tag = rawTag.trim();
      if (!tag) {
        continue;
      }
      const key = tagKey(tag);
      const current = counts.get(key);
      if (current) {
        current.count += 1;
      } else {
        counts.set(key, { tag, count: 1 });
      }
    }
  }
  return Array.from(counts.values()).sort((left, right) => {
    if (sort === "az") {
      return left.tag.localeCompare(right.tag) || right.count - left.count;
    }
    return right.count - left.count || left.tag.localeCompare(right.tag);
  });
}

function tagKey(tag: string): string {
  return tag.trim().toLowerCase();
}

function selectedTagsTitle(tags: string[]): string | null {
  if (tags.length === 0) {
    return null;
  }
  if (tags.length === 1) {
    return tags[0];
  }
  return `${tags.length} Tags`;
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
  sectionHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  sectionMeta: {
    color: theme.colors.tertiaryText,
    fontSize: 12,
    fontWeight: "800",
  },
  libraryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  libraryTile: {
    aspectRatio: 1,
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.hairline,
    borderRadius: theme.radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    flexBasis: "48%",
    flexGrow: 1,
    justifyContent: "space-between",
    maxWidth: 180,
    minHeight: 156,
    padding: 14,
  },
  tileLabel: {
    color: theme.colors.tint,
    fontSize: 12,
    fontWeight: "900",
  },
  tileTitle: {
    color: theme.colors.text,
    fontSize: 24,
    fontWeight: "900",
  },
  tileMeta: {
    color: theme.colors.secondaryText,
    fontSize: 13,
    fontWeight: "800",
  },
  closeTextButton: {
    alignItems: "center",
    minHeight: 32,
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  closeText: {
    color: theme.colors.tint,
    fontSize: 13,
    fontWeight: "900",
  },
  sortControl: {
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.hairline,
    borderRadius: theme.radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    padding: 3,
  },
  sortButton: {
    alignItems: "center",
    borderRadius: theme.radius.pill,
    flex: 1,
    minHeight: 34,
    justifyContent: "center",
  },
  sortButtonActive: {
    backgroundColor: theme.colors.tintSoft,
  },
  sortText: {
    color: theme.colors.secondaryText,
    fontSize: 12,
    fontWeight: "900",
  },
  sortTextActive: {
    color: theme.colors.tint,
  },
  tagList: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  tagRow: {
    alignItems: "center",
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.hairline,
    borderRadius: theme.radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: 7,
    minHeight: 36,
    maxWidth: "100%",
    paddingHorizontal: 12,
  },
  tagRowActive: {
    backgroundColor: theme.colors.tintSoft,
    borderColor: theme.colors.tint,
  },
  tagRowTitle: {
    color: theme.colors.text,
    flexShrink: 1,
    fontSize: 13,
    fontWeight: "900",
  },
  tagRowTitleActive: {
    color: theme.colors.tint,
  },
  tagRowCount: {
    color: theme.colors.tertiaryText,
    fontSize: 11,
    fontWeight: "900",
  },
  tagRowCountActive: {
    color: theme.colors.tint,
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
  rowDetail: {
    color: theme.colors.tertiaryText,
    fontSize: 12,
    marginTop: 4,
  },
  pressed: {
    opacity: 0.78,
  },
});
