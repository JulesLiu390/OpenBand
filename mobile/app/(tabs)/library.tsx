import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { AlbumArt } from "@/components/AlbumArt";
import { Section } from "@/components/AppShell";
import { useAuth } from "@/components/AuthProvider";
import { MusicPage } from "@/components/MusicPage";
import { libraryAlbums, libraryShortcuts } from "@/lib/demo";
import { Song, cacheSong, getCachedSongUri, listSongs, readableFileSize, songSubtitle } from "@/lib/songs";
import { artworkPalettes, theme } from "@/lib/theme";

type CacheStatus = "cached" | "downloading" | "remote";

export default function LibraryScreen() {
  const { session } = useAuth();
  const [songs, setSongs] = useState<Song[]>([]);
  const [songTotal, setSongTotal] = useState(0);
  const [cacheStatus, setCacheStatus] = useState<Record<string, CacheStatus>>({});
  const [playerTrack, setPlayerTrack] = useState({
    title: "Lake Light",
    subtitle: "Suno Sketch",
  });

  useEffect(() => {
    let mounted = true;

    async function loadSongs() {
      if (!session) {
        return;
      }
      try {
        const response = await listSongs(session.accessToken, 50);
        const statuses: Record<string, CacheStatus> = {};
        await Promise.all(
          response.songs.map(async (song) => {
            statuses[song.id] = (await getCachedSongUri(song)) ? "cached" : "remote";
          }),
        );
        if (mounted) {
          setSongs(response.songs);
          setSongTotal(response.total);
          setCacheStatus(statuses);
        }
      } catch {
        if (mounted) {
          setSongs([]);
          setSongTotal(0);
        }
      }
    }

    loadSongs();

    return () => {
      mounted = false;
    };
  }, [session]);

  const shortcuts = useMemo(() => {
    if (songs.length === 0) {
      return libraryShortcuts;
    }
    const artists = new Set(songs.map((song) => song.artist).filter(Boolean));
    const tags = new Set(songs.flatMap((song) => song.tags));
    const downloaded = Object.values(cacheStatus).filter((status) => status === "cached").length;
    return [
      { label: "Songs", value: String(songTotal) },
      { label: "Artists", value: String(artists.size) },
      { label: "Downloaded", value: String(downloaded) },
      { label: "Tags", value: String(tags.size) },
    ];
  }, [cacheStatus, songTotal, songs]);

  async function selectSong(song: Song) {
    setPlayerTrack({ title: song.title, subtitle: songSubtitle(song) });
    if (!session || cacheStatus[song.id] === "cached" || cacheStatus[song.id] === "downloading") {
      return;
    }

    setCacheStatus((current) => ({ ...current, [song.id]: "downloading" }));
    try {
      const result = await cacheSong(song, session.accessToken);
      setCacheStatus((current) => ({ ...current, [song.id]: result.cached ? "cached" : "remote" }));
    } catch {
      setCacheStatus((current) => ({ ...current, [song.id]: "remote" }));
    }
  }

  const hasRemoteSongs = songs.length > 0;

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
      </Section>

      <Section>
        <Text style={styles.sectionTitle}>Recently Added</Text>
        <View style={styles.list}>
          {hasRemoteSongs
            ? songs.map((song, index) => (
                <Pressable
                  key={song.id}
                  onPress={() => selectSong(song)}
                  style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
                  <AlbumArt colors={artworkPalettes[index % artworkPalettes.length]} size={58} />
                  <View style={styles.rowCopy}>
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {song.title}
                    </Text>
                    <Text style={styles.rowMeta} numberOfLines={1}>
                      {songSubtitle(song)}
                    </Text>
                    <Text style={styles.rowDetail} numberOfLines={1}>
                      {cacheStatus[song.id] === "cached"
                        ? "Cached"
                        : cacheStatus[song.id] === "downloading"
                          ? "Saving"
                          : `${readableFileSize(song.file_size)} · ${song.tags.slice(0, 3).join(", ")}`}
                    </Text>
                  </View>
                  <Text style={styles.more}>⋯</Text>
                </Pressable>
              ))
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
  rowTitle: {
    color: theme.colors.text,
    fontSize: 16,
    fontWeight: "900",
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
});
