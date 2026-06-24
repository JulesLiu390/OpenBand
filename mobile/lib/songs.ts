import * as FileSystem from "expo-file-system/legacy";
import { Platform } from "react-native";

import { ApiError, authFetch, getApiBaseUrl, getFreshAccessToken } from "@/lib/auth";

const CACHE_DIR = `${FileSystem.documentDirectory ?? ""}openband-songs/`;
const COVER_CACHE_DIR = `${FileSystem.documentDirectory ?? ""}openband-covers/`;
const SONG_CATALOG_STORAGE_KEY_PREFIX = "openband.songs.catalog";

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
  cover_url: string;
  is_liked: boolean;
  liked_at: string | null;
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

export type SongCacheStatus = "cached" | "downloading" | "remote";

export type SongCacheBatchItem = {
  song: Song;
  result?: SongCacheResult;
  error?: Error;
};

type SongCatalogSnapshot = {
  updatedAt: string;
  songs: Song[];
};

export type SongLikeResponse = {
  song_id: string;
  is_liked: boolean;
  liked_at: string | null;
};

export async function listSongs(accessToken: string, limit = 50, offset = 0): Promise<SongListResponse> {
  const response = await authFetch(`/v1/songs?limit=${limit}&offset=${offset}`, accessToken);
  await assertOk(response);
  return (await response.json()) as SongListResponse;
}

export async function listAllSongs(
  accessToken: string,
  options: { pageSize?: number; concurrency?: number } = {},
): Promise<SongListResponse> {
  const pageSize = Math.max(1, Math.min(options.pageSize ?? 200, 200));
  const firstPage = await listSongs(accessToken, pageSize, 0);
  if (firstPage.songs.length >= firstPage.total) {
    return firstPage;
  }

  const offsets: number[] = [];
  for (let offset = firstPage.offset + firstPage.limit; offset < firstPage.total; offset += pageSize) {
    offsets.push(offset);
  }
  const pages = await mapConcurrent(
    offsets,
    Math.max(1, options.concurrency ?? 4),
    (offset) => listSongs(accessToken, pageSize, offset),
  );
  const songs = uniqueSongsById([firstPage, ...pages].flatMap((page) => page.songs));
  return {
    songs,
    limit: songs.length,
    offset: 0,
    total: firstPage.total,
  };
}

export async function listDailySongs(accessToken: string, limit = 20): Promise<SongListResponse> {
  const response = await authFetch(`/v1/songs/daily?limit=${limit}`, accessToken);
  await assertOk(response);
  return (await response.json()) as SongListResponse;
}

export async function listLikedSongs(accessToken: string, limit = 50): Promise<SongListResponse> {
  const response = await authFetch(`/v1/songs/liked?limit=${limit}`, accessToken);
  await assertOk(response);
  return (await response.json()) as SongListResponse;
}

export async function getSong(accessToken: string, songId: string): Promise<Song> {
  const response = await authFetch(`/v1/songs/${songId}`, accessToken);
  await assertOk(response);
  return (await response.json()) as Song;
}

export async function setSongLiked(accessToken: string, songId: string, liked: boolean): Promise<SongLikeResponse> {
  const response = await authFetch(`/v1/songs/${songId}/like`, accessToken, {
    method: liked ? "PUT" : "DELETE",
  });
  await assertOk(response);
  return (await response.json()) as SongLikeResponse;
}

export async function saveSongCatalog(userId: number | null | undefined, songs: Song[]): Promise<void> {
  const snapshot: SongCatalogSnapshot = {
    updatedAt: new Date().toISOString(),
    songs: uniqueSongsById(songs),
  };
  const value = JSON.stringify(snapshot);

  if (Platform.OS === "web") {
    globalThis.localStorage?.setItem(songCatalogStorageKey(userId), value);
    return;
  }

  if (!canUseNativeCache()) {
    return;
  }
  await ensureCacheDirectory();
  await FileSystem.writeAsStringAsync(songCatalogPath(userId), value);
}

export async function mergeSongCatalog(userId: number | null | undefined, songs: Song[]): Promise<void> {
  if (songs.length === 0) {
    return;
  }
  const currentSongs = await loadSongCatalog(userId);
  await saveSongCatalog(userId, [...currentSongs, ...songs]);
}

export async function loadSongCatalog(userId: number | null | undefined): Promise<Song[]> {
  let value: string | null = null;

  if (Platform.OS === "web") {
    value = globalThis.localStorage?.getItem(songCatalogStorageKey(userId)) ?? null;
  } else if (canUseNativeCache()) {
    const path = songCatalogPath(userId);
    const info = await FileSystem.getInfoAsync(path);
    if (info.exists) {
      value = await FileSystem.readAsStringAsync(path);
    }
  }

  if (!value) {
    return [];
  }

  try {
    const snapshot = JSON.parse(value) as Partial<SongCatalogSnapshot>;
    return Array.isArray(snapshot.songs) ? uniqueSongsById(snapshot.songs) : [];
  } catch {
    if (Platform.OS === "web") {
      globalThis.localStorage?.removeItem(songCatalogStorageKey(userId));
    } else if (canUseNativeCache()) {
      await FileSystem.deleteAsync(songCatalogPath(userId), { idempotent: true });
    }
    return [];
  }
}

export async function loadCachedSongs(userId: number | null | undefined): Promise<Song[]> {
  const songs = await loadSongCatalog(userId);
  const cachedPairs = await Promise.all(
    songs.map(async (song) => ({
      song,
      cached: Boolean(await getCachedSongUri(song)),
    })),
  );
  return cachedPairs.filter((pair) => pair.cached).map((pair) => pair.song);
}

export async function getSongCacheStatuses(songs: Song[]): Promise<Record<string, SongCacheStatus>> {
  const statuses: Record<string, SongCacheStatus> = {};
  await Promise.all(
    songs.map(async (song) => {
      statuses[song.id] = (await getCachedSongUri(song)) ? "cached" : "remote";
    }),
  );
  return statuses;
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
    return { uri: absoluteSongUrl(song.download_url), cached: false };
  }

  const cachedUri = await getCachedSongUri(song);
  if (cachedUri) {
    return { uri: cachedUri, cached: true };
  }

  await ensureCacheDirectory();
  const uri = cacheUriForSong(song);
  const freshAccessToken = await getFreshAccessToken(accessToken);
  const result = await FileSystem.downloadAsync(absoluteSongUrl(song.download_url), uri, {
    headers: {
      Authorization: `Bearer ${freshAccessToken}`,
    },
  });
  if (result.status < 200 || result.status >= 300) {
    await FileSystem.deleteAsync(uri, { idempotent: true });
    throw new ApiError(`Download failed with status ${result.status}.`, result.status);
  }
  return { uri: result.uri, cached: true };
}

export async function cacheSongs(
  songs: Song[],
  accessToken: string,
  options: {
    concurrency?: number;
    onProgress?: (item: SongCacheBatchItem, completed: number, total: number) => void;
  } = {},
): Promise<SongCacheBatchItem[]> {
  const uniqueSongs = uniqueSongsById(songs);
  const total = uniqueSongs.length;
  const results: SongCacheBatchItem[] = new Array(total);
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 3, total || 1));
  let nextIndex = 0;
  let completed = 0;

  async function worker() {
    while (nextIndex < total) {
      const index = nextIndex;
      nextIndex += 1;
      const song = uniqueSongs[index];
      try {
        const result = await cacheSong(song, accessToken);
        results[index] = { song, result };
      } catch (exc) {
        results[index] = {
          song,
          error: exc instanceof Error ? exc : new Error("Song download failed."),
        };
      }
      completed += 1;
      options.onProgress?.(results[index], completed, total);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return results;
}

export async function getCachedSongCoverUri(song: Song): Promise<string | null> {
  if (!canUseNativeCache() || !song.cover_url) {
    return null;
  }
  const uri = coverCacheUriForSong(song);
  const info = await FileSystem.getInfoAsync(uri);
  return info.exists ? uri : null;
}

export async function cacheSongCover(song: Song, accessToken: string): Promise<SongCacheResult | null> {
  if (!song.cover_url) {
    return null;
  }
  if (!canUseNativeCache()) {
    return { uri: absoluteSongUrl(song.cover_url), cached: false };
  }

  const cachedUri = await getCachedSongCoverUri(song);
  if (cachedUri) {
    return { uri: cachedUri, cached: true };
  }

  await ensureCoverCacheDirectory();
  const uri = coverCacheUriForSong(song);
  const freshAccessToken = await getFreshAccessToken(accessToken);
  const result = await FileSystem.downloadAsync(absoluteSongUrl(song.cover_url), uri, {
    headers: {
      Authorization: `Bearer ${freshAccessToken}`,
    },
  });
  if (result.status < 200 || result.status >= 300) {
    await FileSystem.deleteAsync(uri, { idempotent: true });
    throw new ApiError(`Cover download failed with status ${result.status}.`, result.status);
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

export function songTagSummary(song: Song, limit = 3): string {
  const tags = song.tags.filter(Boolean);
  const visibleTags = tags.slice(0, limit);
  if (visibleTags.length === 0) {
    return "";
  }
  return `${visibleTags.join(", ")}${tags.length > limit ? ", ..." : ""}`;
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

function coverCacheUriForSong(song: Song): string {
  return `${COVER_CACHE_DIR}${song.id}-${song.file_sha256.slice(0, 16)}.jpg`;
}

function songCatalogPath(userId: number | null | undefined): string {
  return `${CACHE_DIR}catalog-${songCatalogId(userId)}.json`;
}

function songCatalogStorageKey(userId: number | null | undefined): string {
  return `${SONG_CATALOG_STORAGE_KEY_PREFIX}.${songCatalogId(userId)}`;
}

function songCatalogId(userId: number | null | undefined): string {
  return userId === null || userId === undefined ? "default" : String(userId);
}

function uniqueSongsById(songs: Song[]): Song[] {
  const byId = new Map<string, Song>();
  for (const song of songs) {
    if (song?.id) {
      byId.set(song.id, song);
    }
  }
  return Array.from(byId.values());
}

async function mapConcurrent<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length || 1));

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

async function ensureCacheDirectory(): Promise<void> {
  const info = await FileSystem.getInfoAsync(CACHE_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(CACHE_DIR, { intermediates: true });
  }
}

async function ensureCoverCacheDirectory(): Promise<void> {
  const info = await FileSystem.getInfoAsync(COVER_CACHE_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(COVER_CACHE_DIR, { intermediates: true });
  }
}

function canUseNativeCache(): boolean {
  return Platform.OS !== "web" && Boolean(FileSystem.documentDirectory);
}

export function absoluteSongUrl(path: string): string {
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }
  return `${getApiBaseUrl()}${path}`;
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
