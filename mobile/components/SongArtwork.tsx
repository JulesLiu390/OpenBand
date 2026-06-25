import { useEffect, useState } from "react";
import { Image, StyleSheet } from "react-native";

import { AlbumArt } from "@/components/AlbumArt";
import { cacheSongCover, getCachedSongCoverUri, Song } from "@/lib/songs";
import { artworkPalettes } from "@/lib/theme";

type Props = {
  song?: Song | null;
  accessToken?: string | null;
  colors?: string[];
  size?: number;
};

export function SongArtwork({ song, accessToken, colors = artworkPalettes[0], size = 72 }: Props) {
  const [failed, setFailed] = useState(false);
  const [imageUri, setImageUri] = useState<string | null>(null);

  useEffect(() => {
    setFailed(false);
    setImageUri(null);

    if (!song?.cover_url) {
      return;
    }

    const currentSong: Song = song;
    const currentAccessToken = accessToken;
    let cancelled = false;

    async function loadCover() {
      try {
        const cachedUri = await getCachedSongCoverUri(currentSong);
        if (cancelled) {
          return;
        }
        if (cachedUri) {
          setImageUri(cachedUri);
          return;
        }
        if (!currentAccessToken) {
          return;
        }
        const result = await cacheSongCover(currentSong, currentAccessToken);
        if (!cancelled && result?.uri) {
          setImageUri(result.uri);
        }
      } catch {
        if (!cancelled) {
          setFailed(true);
        }
      }
    }

    loadCover();

    return () => {
      cancelled = true;
    };
  }, [accessToken, song?.cover_url, song?.id]);

  const source = imageUri && !failed ? { uri: imageUri } : null;

  if (!source) {
    return <AlbumArt colors={colors} size={size} />;
  }

  return (
    <Image
      onError={() => setFailed(true)}
      resizeMode="cover"
      source={source}
      style={[styles.image, { height: size, width: size }]}
    />
  );
}

const styles = StyleSheet.create({
  image: {
    backgroundColor: "#ECECF1",
    borderRadius: 8,
  },
});
