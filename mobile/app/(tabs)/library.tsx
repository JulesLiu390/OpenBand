import { StyleSheet, Text, View } from "react-native";

import { AlbumArt } from "@/components/AlbumArt";
import { Section } from "@/components/AppShell";
import { MusicPage } from "@/components/MusicPage";
import { libraryAlbums, libraryShortcuts } from "@/lib/demo";
import { artworkPalettes, theme } from "@/lib/theme";

export default function LibraryScreen() {
  return (
    <MusicPage>
      <Section>
        <Text style={styles.eyebrow}>Collection</Text>
        <Text style={styles.title}>Library</Text>
      </Section>

      <Section>
        <View style={styles.shortcutGrid}>
          {libraryShortcuts.map((shortcut) => (
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
          {libraryAlbums.map((album, index) => (
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
});
