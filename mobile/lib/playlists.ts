import { ApiError, authFetch, loadStoredSession } from "@/lib/auth";
import { readUserCache, writeUserCache } from "@/lib/cache";
import { mergeSongCatalog } from "@/lib/songs";
import { Song } from "@/lib/songs";

export type PlaylistSummary = {
  id: string;
  name: string;
  description: string;
  song_count: number;
  cover_song_id: string | null;
  kind: "user" | "liked" | string;
  is_system: boolean;
  can_delete: boolean;
  created_at: string;
  updated_at: string;
};

export type PlaylistDetail = PlaylistSummary & {
  songs: Song[];
};

type PlaylistListResponse = {
  playlists: PlaylistSummary[];
  total: number;
};

export type CachedPlaylistList = PlaylistListResponse & {
  updatedAt: string;
  isStale: boolean;
};

export type CachedPlaylistDetail = PlaylistDetail & {
  cacheUpdatedAt: string;
  isStale: boolean;
};

type PlaylistCacheSnapshot = {
  list: CachedPlaylistList | null;
  details: Record<string, CachedPlaylistDetail>;
};

export async function listPlaylists(accessToken: string): Promise<PlaylistListResponse> {
  const response = await authFetch("/v1/playlists", accessToken);
  await assertOk(response);
  const body = (await response.json()) as PlaylistListResponse;
  const session = await loadStoredSession();
  await saveCachedPlaylists(session?.user.id, body);
  return body;
}

export async function createPlaylist(
  accessToken: string,
  name: string,
  description = "",
): Promise<PlaylistSummary> {
  const response = await authFetch("/v1/playlists", accessToken, {
    body: JSON.stringify({ name, description }),
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  await assertOk(response);
  const body = (await response.json()) as PlaylistSummary;
  const session = await loadStoredSession();
  await markPlaylistCachesStale(session?.user.id);
  return body;
}

export async function updatePlaylist(
  accessToken: string,
  playlistId: string,
  updates: { name?: string; description?: string; cover_song_id?: string | null },
): Promise<PlaylistDetail> {
  const response = await authFetch(`/v1/playlists/${playlistId}`, accessToken, {
    body: JSON.stringify(updates),
    headers: {
      "Content-Type": "application/json",
    },
    method: "PATCH",
  });
  await assertOk(response);
  const body = (await response.json()) as PlaylistDetail;
  const session = await loadStoredSession();
  await saveCachedPlaylistDetail(session?.user.id, body);
  await markPlaylistCachesStale(session?.user.id);
  await mergeSongCatalog(session?.user.id, body.songs);
  return body;
}

export async function getPlaylist(accessToken: string, playlistId: string): Promise<PlaylistDetail> {
  const response = await authFetch(`/v1/playlists/${playlistId}`, accessToken);
  await assertOk(response);
  const body = (await response.json()) as PlaylistDetail;
  const session = await loadStoredSession();
  await saveCachedPlaylistDetail(session?.user.id, body);
  await mergeSongCatalog(session?.user.id, body.songs);
  return body;
}

export async function addPlaylistSong(
  accessToken: string,
  playlistId: string,
  songId: string,
): Promise<PlaylistDetail> {
  const response = await authFetch(`/v1/playlists/${playlistId}/songs`, accessToken, {
    body: JSON.stringify({ song_id: songId }),
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  await assertOk(response);
  const body = (await response.json()) as PlaylistDetail;
  const session = await loadStoredSession();
  await saveCachedPlaylistDetail(session?.user.id, body);
  await markPlaylistCachesStale(session?.user.id);
  await mergeSongCatalog(session?.user.id, body.songs);
  return body;
}

export async function removePlaylistSong(
  accessToken: string,
  playlistId: string,
  songId: string,
): Promise<PlaylistDetail> {
  const response = await authFetch(`/v1/playlists/${playlistId}/songs/${songId}`, accessToken, {
    method: "DELETE",
  });
  await assertOk(response);
  const body = (await response.json()) as PlaylistDetail;
  const session = await loadStoredSession();
  await saveCachedPlaylistDetail(session?.user.id, body);
  await markPlaylistCachesStale(session?.user.id);
  await mergeSongCatalog(session?.user.id, body.songs);
  return body;
}

export async function loadCachedPlaylists(userId: number | null | undefined): Promise<CachedPlaylistList | null> {
  return (await readPlaylistCacheSnapshot(userId)).list;
}

export async function saveCachedPlaylists(
  userId: number | null | undefined,
  response: PlaylistListResponse,
): Promise<CachedPlaylistList> {
  const snapshot = await readPlaylistCacheSnapshot(userId);
  const cached: CachedPlaylistList = {
    ...response,
    updatedAt: new Date().toISOString(),
    isStale: false,
  };
  snapshot.list = cached;
  await writePlaylistCacheSnapshot(userId, snapshot);
  return cached;
}

export async function loadCachedPlaylistDetail(
  userId: number | null | undefined,
  playlistId: string,
): Promise<CachedPlaylistDetail | null> {
  const snapshot = await readPlaylistCacheSnapshot(userId);
  return snapshot.details[playlistId] ?? null;
}

export async function saveCachedPlaylistDetail(
  userId: number | null | undefined,
  detail: PlaylistDetail,
): Promise<CachedPlaylistDetail> {
  const snapshot = await readPlaylistCacheSnapshot(userId);
  const cached: CachedPlaylistDetail = {
    ...detail,
    cacheUpdatedAt: new Date().toISOString(),
    isStale: false,
  };
  snapshot.details[detail.id] = cached;
  await writePlaylistCacheSnapshot(userId, snapshot);
  return cached;
}

export async function markPlaylistCachesStale(userId: number | null | undefined): Promise<void> {
  const snapshot = await readPlaylistCacheSnapshot(userId);
  if (snapshot.list) {
    snapshot.list = { ...snapshot.list, isStale: true };
  }
  snapshot.details = Object.fromEntries(
    Object.entries(snapshot.details).map(([playlistId, detail]) => [playlistId, { ...detail, isStale: true }]),
  );
  await writePlaylistCacheSnapshot(userId, snapshot);
}

export async function patchCachedPlaylistLike(
  userId: number | null | undefined,
  songId: string,
  isLiked: boolean,
  likedAt: string | null,
): Promise<void> {
  const snapshot = await readPlaylistCacheSnapshot(userId);
  let changed = false;
  for (const [playlistId, detail] of Object.entries(snapshot.details)) {
    let songs = detail.songs.map((song) =>
      song.id === songId ? { ...song, is_liked: isLiked, liked_at: likedAt } : song,
    );
    if (detail.kind === "liked" && !isLiked) {
      songs = songs.filter((song) => song.id !== songId);
    }
    if (detail.songs.some((song) => song.id === songId) || detail.kind === "liked") {
      snapshot.details[playlistId] = {
        ...detail,
        isStale: true,
        song_count: detail.kind === "liked" && !isLiked ? Math.max(0, detail.song_count - 1) : detail.song_count,
        songs,
      };
      changed = true;
    }
  }
  if (changed) {
    await writePlaylistCacheSnapshot(userId, snapshot);
  }
}

async function readPlaylistCacheSnapshot(userId: number | null | undefined): Promise<PlaylistCacheSnapshot> {
  const snapshot = await readUserCache<PlaylistCacheSnapshot>("playlists", userId);
  if (!snapshot?.data || typeof snapshot.data !== "object") {
    return { list: null, details: {} };
  }
  return {
    list: snapshot.data.list ?? null,
    details: snapshot.data.details ?? {},
  };
}

async function writePlaylistCacheSnapshot(
  userId: number | null | undefined,
  snapshot: PlaylistCacheSnapshot,
): Promise<void> {
  await writeUserCache("playlists", userId, snapshot);
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
