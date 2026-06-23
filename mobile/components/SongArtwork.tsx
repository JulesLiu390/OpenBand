import { useEffect, useState } from "react";
import { Image, Platform, StyleSheet } from "react-native";

import { AlbumArt } from "@/components/AlbumArt";
import { absoluteSongUrl, cacheSongCover, Song } from "@/lib/songs";
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

    const currentSong = song;
    const coverUrl = currentSong?.cover_url;
    if (!currentSong || !coverUrl || !accessToken) {
      return;
    }

    const resolvedCoverUrl: string = coverUrl;
    let cancelled = false;
    let objectUrl: string | null = null;

    if (Platform.OS !== "web") {
      cacheSongCover(currentSong, accessToken)
        .then((result) => {
          if (!cancelled && result?.uri) {
            setImageUri(result.uri);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setFailed(true);
          }
        });

      return () => {
        cancelled = true;
      };
    }

    async function loadWebCover() {
      try {
        const response = await fetch(absoluteSongUrl(resolvedCoverUrl), {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });
        if (!response.ok) {
          throw new Error(`Cover failed with status ${response.status}.`);
        }
        const blob = await response.blob();
        const nextObjectUrl = URL.createObjectURL(blob);
        if (cancelled) {
          URL.revokeObjectURL(nextObjectUrl);
          return;
        }
        objectUrl = nextObjectUrl;
        setImageUri(nextObjectUrl);
      } catch {
        if (!cancelled) {
          setFailed(true);
        }
      }
    }

    loadWebCover();

    return () => {
      cancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [accessToken, song, song?.cover_url, song?.file_sha256, song?.id]);

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
