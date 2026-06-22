import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { AlbumArt } from "@/components/AlbumArt";
import { Section } from "@/components/AppShell";
import { useAuth } from "@/components/AuthProvider";
import { MusicPage } from "@/components/MusicPage";
import { currentTrack, dailyCards, dailyTracks } from "@/lib/demo";
import { Song, cacheSong, formatDuration, getCachedSongUri, listDailySongs, songSubtitle } from "@/lib/songs";
import { artworkPalettes, theme } from "@/lib/theme";

type CacheStatus = "cached" | "downloading" | "remote";

export default function DailyScreen() {
  const { session } = useAuth();
  const [selectedTrack, setSelectedTrack] = useState({
    title: currentTrack.name,
    subtitle: currentTrack.artist,
  });
  const [songs, setSongs] = useState<Song[]>([]);
  const [cacheStatus, setCacheStatus] = useState<Record<string, CacheStatus>>({});
  const [loadingSongs, setLoadingSongs] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function loadSongs() {
      if (!session) {
        return;
      }
      setLoadingSongs(true);
      try {
        const response = await listDailySongs(session.accessToken, 20);
        const statuses: Record<string, CacheStatus> = {};
        await Promise.all(
          response.songs.map(async (song) => {
            statuses[song.id] = (await getCachedSongUri(song)) ? "cached" : "remote";
          }),
        );
        if (mounted) {
          setSongs(response.songs);
          setCacheStatus(statuses);
        }
      } catch {
        if (mounted) {
          setSongs([]);
        }
      } finally {
        if (mounted) {
          setLoadingSongs(false);
        }
      }
    }

    loadSongs();

    return () => {
      mounted = false;
    };
  }, [session]);

  async function selectSong(song: Song) {
    setSelectedTrack({ title: song.title, subtitle: songSubtitle(song) });
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
    <MusicPage playerTitle={selectedTrack.title} playerSubtitle={selectedTrack.subtitle}>
      <Section>
        <Text style={styles.eyebrow}>Today</Text>
        <Text style={styles.title}>Daily</Text>
      </Section>

      <Section>
        <View style={styles.hero}>
          <AlbumArt colors={artworkPalettes[1]} size={112} />
          <View style={styles.heroCopy}>
            <Text style={styles.heroLabel}>Daily Pulse</Text>
            <Text style={styles.heroTitle}>New Music Flow</Text>
            <Text style={styles.heroMeta}>
              {hasRemoteSongs ? `${songs.length} fresh tracks ready` : "Fresh tracks for the day"}
            </Text>
          </View>
        </View>
      </Section>

      <Section>
        <View style={styles.cardGrid}>
          {dailyCards.map((card, index) => (
            <View key={card.title} style={styles.dailyCard}>
              <AlbumArt colors={artworkPalettes[(index + 2) % artworkPalettes.length]} size={64} />
              <Text style={styles.cardTitle} numberOfLines={1}>
                {card.title}
              </Text>
              <Text style={styles.cardSubtitle} numberOfLines={2}>
                {card.subtitle}
              </Text>
              <Text style={styles.cardMeta}>{card.meta}</Text>
            </View>
          ))}
        </View>
      </Section>

      <Section>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Fresh Today</Text>
          {loadingSongs ? <ActivityIndicator color={theme.colors.tint} size="small" /> : null}
        </View>
        <View style={styles.list}>
          {hasRemoteSongs
            ? songs.map((song, index) => (
                <Pressable
                  key={song.id}
                  onPress={() => selectSong(song)}
                  style={({ pressed }) => [styles.trackRow, pressed && styles.pressed]}>
                  <AlbumArt colors={artworkPalettes[index % artworkPalettes.length]} size={50} />
                  <View style={styles.trackCopy}>
                    <Text style={styles.trackTitle} numberOfLines={1}>
                      {song.title}
                    </Text>
                    <Text style={styles.trackMeta} numberOfLines={1}>
                      {songSubtitle(song)}
                    </Text>
                  </View>
                  <Text style={[styles.duration, cacheStatus[song.id] === "cached" && styles.cached]}>
                    {cacheStatus[song.id] === "downloading"
                      ? "Saving"
                      : cacheStatus[song.id] === "cached"
                        ? "Cached"
                        : formatDuration(song.duration_seconds)}
                  </Text>
                </Pressable>
              ))
            : dailyTracks.map((track, index) => (
                <Pressable
                  key={track.id}
                  onPress={() => setSelectedTrack({ title: track.name, subtitle: track.artist })}
                  style={({ pressed }) => [styles.trackRow, pressed && styles.pressed]}>
                  <AlbumArt colors={artworkPalettes[index % artworkPalettes.length]} size={50} />
                  <View style={styles.trackCopy}>
                    <Text style={styles.trackTitle} numberOfLines={1}>
                      {track.name}
                    </Text>
                    <Text style={styles.trackMeta} numberOfLines={1}>
                      {track.artist} · {track.collection}
                    </Text>
                  </View>
                  <Text style={styles.duration}>{track.duration}</Text>
                </Pressable>
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
  hero: {
    alignItems: "flex-start",
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
  cardGrid: {
    flexDirection: "row",
    gap: 10,
  },
  dailyCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    flex: 1,
    gap: 6,
    minHeight: 168,
    padding: 12,
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
  trackTitle: {
    color: theme.colors.text,
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
  cached: {
    color: theme.colors.tint,
  },
  pressed: {
    opacity: 0.78,
  },
});
