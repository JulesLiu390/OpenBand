import { Pressable, StyleSheet, Text, View } from "react-native";

import { AlbumArt } from "@/components/AlbumArt";
import { artworkPalettes, theme } from "@/lib/theme";

type Props = {
  title?: string;
  subtitle?: string;
  onPress?: () => void;
};

export function PlayerBar({ title = "Lake Light", subtitle = "Ambient · 02:18", onPress }: Props) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => [styles.bar, pressed && styles.pressed]}>
      <AlbumArt colors={artworkPalettes[0]} size={40} />
      <View style={styles.copy}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.subtitle} numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
      <View style={styles.button}>
        <Text style={styles.buttonIcon}>⏮</Text>
      </View>
      <View style={styles.play}>
        <Text style={styles.playIcon}>▶</Text>
      </View>
      <View style={styles.button}>
        <Text style={styles.buttonIcon}>⏭</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    alignItems: "center",
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.hairline,
    borderRadius: theme.radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: 8,
    marginBottom: 8,
    marginHorizontal: 16,
    padding: 8,
  },
  copy: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    color: theme.colors.text,
    fontSize: 14,
    fontWeight: "800",
  },
  subtitle: {
    color: theme.colors.secondaryText,
    fontSize: 12,
    marginTop: 2,
  },
  button: {
    alignItems: "center",
    backgroundColor: "#F1F1F4",
    borderRadius: 999,
    height: 32,
    justifyContent: "center",
    width: 32,
  },
  buttonIcon: {
    color: theme.colors.secondaryText,
    fontSize: 13,
    fontWeight: "900",
    lineHeight: 15,
  },
  play: {
    alignItems: "center",
    backgroundColor: theme.colors.tint,
    borderRadius: 999,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  playIcon: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "900",
    lineHeight: 18,
  },
  pressed: {
    opacity: 0.75,
  },
});
