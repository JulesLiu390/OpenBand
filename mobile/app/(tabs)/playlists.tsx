import { Pressable, StyleSheet, Text, View } from "react-native";

import { AlbumArt } from "@/components/AlbumArt";
import { Section } from "@/components/AppShell";
import { MusicPage } from "@/components/MusicPage";
import { playlists } from "@/lib/demo";
import { artworkPalettes, theme } from "@/lib/theme";

export default function PlaylistsScreen() {
  return (
    <MusicPage>
      <Section>
        <View style={styles.header}>
          <View>
            <Text style={styles.eyebrow}>Your Mixes</Text>
            <Text style={styles.title}>Play Lists</Text>
          </View>
          <Pressable style={({ pressed }) => [styles.addButton, pressed && styles.pressed]}>
            <Text style={styles.addIcon}>＋</Text>
          </Pressable>
        </View>
      </Section>

      <Section>
        <View style={styles.featured}>
          <AlbumArt colors={artworkPalettes[3]} size={96} />
          <View style={styles.featuredCopy}>
            <Text style={styles.featuredLabel}>Featured List</Text>
            <Text style={styles.featuredTitle}>Late Night Drive</Text>
            <Text style={styles.featuredMeta}>Synth, pulse, and soft neon edges</Text>
          </View>
        </View>
      </Section>

      <Section>
        <Text style={styles.sectionTitle}>All Play Lists</Text>
        <View style={styles.grid}>
          {playlists.map((playlist, index) => (
            <View key={playlist.title} style={styles.card}>
              <AlbumArt colors={artworkPalettes[index % artworkPalettes.length]} size={96} />
              <Text style={styles.cardTitle} numberOfLines={1}>
                {playlist.title}
              </Text>
              <Text style={styles.cardSubtitle} numberOfLines={2}>
                {playlist.subtitle}
              </Text>
              <Text style={styles.cardCount}>{playlist.count}</Text>
            </View>
          ))}
        </View>
      </Section>
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
    borderRadius: theme.radius.md,
    flexBasis: "48%",
    flexGrow: 1,
    gap: 6,
    minHeight: 198,
    padding: 10,
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
  pressed: {
    opacity: 0.75,
  },
});
