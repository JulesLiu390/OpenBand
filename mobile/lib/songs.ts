import * as FileSystem from "expo-file-system/legacy";
import { Platform } from "react-native";

import { API_BASE_URL, ApiError, authFetch } from "@/lib/auth";

const CACHE_DIR = `${FileSystem.documentDirectory ?? ""}openband-songs/`;

export type Song = {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration_seconds: number | null;
  source: string;
  original_filename: string;
  file_size: number;
  file_sha256: string;
  mime_type: string;
  tags: string[];
  audio_url: string;
  download_url: string;
  created_at: string;
  updated_at: string;
};

type SongListResponse = {
  songs: Song[];
  limit: number;
  offset: number;
  total: number;
};

export type SongCacheResult = {
  uri: string;
  cached: boolean;
};

export async function listSongs(accessToken: string, limit = 50): Promise<SongListResponse> {
  const response = await authFetch(`/v1/songs?limit=${limit}`, accessToken);
  await assertOk(response);
  return (await response.json()) as SongListResponse;
}

export async function listDailySongs(accessToken: string, limit = 20): Promise<SongListResponse> {
  const response = await authFetch(`/v1/songs/daily?limit=${limit}`, accessToken);
  await assertOk(response);
  return (await response.json()) as SongListResponse;
}

export async function getCachedSongUri(song: Song): Promise<string | null> {
  if (!canUseNativeCache()) {
    return null;
  }
  const uri = cacheUriForSong(song);
  const info = await FileSystem.getInfoAsync(uri);
  return info.exists ? uri : null;
}

export async function cacheSong(song: Song, accessToken: string): Promise<SongCacheResult> {
  if (!canUseNativeCache()) {
    return { uri: absoluteUrl(song.download_url), cached: false };
  }

  const cachedUri = await getCachedSongUri(song);
  if (cachedUri) {
    return { uri: cachedUri, cached: true };
  }

  await ensureCacheDirectory();
  const uri = cacheUriForSong(song);
  const result = await FileSystem.downloadAsync(absoluteUrl(song.download_url), uri, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (result.status < 200 || result.status >= 300) {
    await FileSystem.deleteAsync(uri, { idempotent: true });
    throw new ApiError(`Download failed with status ${result.status}.`, result.status);
  }
  return { uri: result.uri, cached: true };
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) {
    return "--:--";
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.max(0, seconds % 60);
  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

export function songSubtitle(song: Song): string {
  return song.album ? `${song.artist} · ${song.album}` : song.artist;
}

export function readableFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function cacheUriForSong(song: Song): string {
  return `${CACHE_DIR}${song.id}-${song.file_sha256.slice(0, 16)}.mp3`;
}

async function ensureCacheDirectory(): Promise<void> {
  const info = await FileSystem.getInfoAsync(CACHE_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(CACHE_DIR, { intermediates: true });
  }
}

function canUseNativeCache(): boolean {
  return Platform.OS !== "web" && Boolean(FileSystem.documentDirectory);
}

function absoluteUrl(path: string): string {
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }
  return `${API_BASE_URL}${path}`;
}

async function assertOk(response: Response): Promise<void> {
  if (response.ok) {
    return;
  }
  let message = `Request failed with status ${response.status}.`;
  const text = await response.text();
  try {
    const body = JSON.parse(text) as { detail?: string };
    if (body.detail) {
      message = body.detail;
    }
  } catch {
    if (text) {
      message = text;
    }
  }
  throw new ApiError(message, response.status);
}
