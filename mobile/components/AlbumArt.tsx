import { StyleSheet, View } from "react-native";

type Props = {
  colors: string[];
  size?: number;
};

export function AlbumArt({ colors, size = 72 }: Props) {
  const [primary, secondary, tertiary] = colors;

  return (
    <View style={[styles.art, { backgroundColor: primary, height: size, width: size }]}>
      <View style={[styles.band, styles.bandTop, { backgroundColor: secondary }]} />
      <View style={[styles.band, styles.bandBottom, { backgroundColor: tertiary }]} />
      <View style={styles.mark} />
    </View>
  );
}

const styles = StyleSheet.create({
  art: {
    borderRadius: 8,
    overflow: "hidden",
  },
  band: {
    height: "44%",
    left: -12,
    position: "absolute",
    right: -12,
    transform: [{ rotate: "-18deg" }],
  },
  bandTop: {
    top: 8,
  },
  bandBottom: {
    bottom: -8,
  },
  mark: {
    backgroundColor: "rgba(255,255,255,0.84)",
    borderRadius: 999,
    height: 18,
    position: "absolute",
    right: 10,
    top: 10,
    width: 18,
  },
});
