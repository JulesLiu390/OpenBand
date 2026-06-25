import { ApiError, authFetch, loadStoredSession } from "@/lib/auth";
import { readUserCache, writeUserCache } from "@/lib/cache";
import { mergeSongCatalog } from "@/lib/songs";
import { Song } from "@/lib/songs";

export type DailySunoBatch = {
  id: string;
  daily_job_id: string;
  batch_index: number;
  position_start: number;
  position_end: number;
  status: "queued" | "running" | "succeeded" | "failed" | string;
  stage: string;
  error: string;
  prompt_files: string[];
  state_path: string;
  result: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
};

export type DailyJob = {
  id: string;
  date: string;
  daily_playlist_id: string;
  status: "queued" | "running" | "succeeded" | "failed" | string;
  stage: string;
  error: string;
  result: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
  batches: DailySunoBatch[];
};

export type DailySong = {
  position: number;
  tags: string[];
  generation_status: string;
  prompt_file: string;
  suno_url: string;
  metadata: Record<string, unknown>;
  song: Song;
};

export type DailyPlaylistSummary = {
  id: string;
  date: string;
  title: string;
  status: string;
  song_count: number;
  job_id: string | null;
  error: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

export type DailyPlaylist = DailyPlaylistSummary & {
  prompt_seed: Record<string, unknown>;
  songs: DailySong[];
};

export type DailyTodayResponse = {
  date: string;
  status: string;
  playlist: DailyPlaylist | null;
  active_job: DailyJob | null;
};

export type GenerateDailyResponse = {
  date: string;
  status: string;
  playlist: DailyPlaylist | null;
  job: DailyJob | null;
};

export type DailyHistoryResponse = {
  playlists: DailyPlaylistSummary[];
  total: number;
  limit: number;
  offset: number;
};

export type CachedDailyToday = DailyTodayResponse & {
  cacheUpdatedAt: string;
  isStale: boolean;
};

export type CachedDailyHistory = DailyHistoryResponse & {
  cacheUpdatedAt: string;
  isStale: boolean;
  nextOffset: number;
  hasMore: boolean;
};

export type CachedDailyPlaylist = DailyPlaylist & {
  cacheUpdatedAt: string;
  isStale: boolean;
};

type DailyCacheSnapshot = {
  todayByDate: Record<string, CachedDailyToday>;
  history: CachedDailyHistory | null;
  playlistsByDate: Record<string, CachedDailyPlaylist>;
};

export async function getTodayDaily(accessToken: string, date?: string): Promise<DailyTodayResponse> {
  const query = date ? `?date=${encodeURIComponent(date)}` : "";
  const response = await authFetch(`/v1/daily/today${query}`, accessToken);
  await assertOk(response);
  const body = (await response.json()) as DailyTodayResponse;
  const session = await loadStoredSession();
  await saveCachedDailyToday(session?.user.id, body);
  if (body.playlist) {
    await saveCachedDailyPlaylist(session?.user.id, body.playlist);
    await mergeSongCatalog(session?.user.id, body.playlist.songs.map((entry) => entry.song));
  }
  return body;
}

export async function generateTodayDaily(
  accessToken: string,
  options: { date?: string; force?: boolean; resume?: boolean; jobId?: string | null } = {},
): Promise<GenerateDailyResponse> {
  const response = await authFetch("/v1/daily/today/generate", accessToken, {
    body: JSON.stringify({
      date: options.date,
      force: Boolean(options.force),
      resume: Boolean(options.resume),
      job_id: options.jobId || undefined,
    }),
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  await assertOk(response);
  const body = (await response.json()) as GenerateDailyResponse;
  const session = await loadStoredSession();
  await markDailyCachesStale(session?.user.id);
  if (body.playlist) {
    await saveCachedDailyPlaylist(session?.user.id, body.playlist);
    await mergeSongCatalog(session?.user.id, body.playlist.songs.map((entry) => entry.song));
  }
  return body;
}

export async function getDailyPlaylist(accessToken: string, date: string): Promise<DailyPlaylist> {
  const response = await authFetch(`/v1/daily/${encodeURIComponent(date)}`, accessToken);
  await assertOk(response);
  const body = (await response.json()) as DailyPlaylist;
  const session = await loadStoredSession();
  await saveCachedDailyPlaylist(session?.user.id, body);
  await mergeSongCatalog(session?.user.id, body.songs.map((entry) => entry.song));
  return body;
}

export async function listDailyHistory(accessToken: string, limit = 30, offset = 0): Promise<DailyHistoryResponse> {
  const response = await authFetch(`/v1/daily/history?limit=${limit}&offset=${offset}`, accessToken);
  await assertOk(response);
  const body = (await response.json()) as DailyHistoryResponse;
  const session = await loadStoredSession();
  await saveCachedDailyHistory(session?.user.id, body, { append: offset > 0 });
  return body;
}

export async function loadCachedDailyToday(
  userId: number | null | undefined,
  date?: string | null,
): Promise<CachedDailyToday | null> {
  const snapshot = await readDailyCacheSnapshot(userId);
  if (date) {
    return snapshot.todayByDate[date] ?? null;
  }
  const values = Object.values(snapshot.todayByDate);
  return values.sort((left, right) => right.date.localeCompare(left.date))[0] ?? null;
}

export async function saveCachedDailyToday(
  userId: number | null | undefined,
  response: DailyTodayResponse,
): Promise<CachedDailyToday> {
  const snapshot = await readDailyCacheSnapshot(userId);
  const cached: CachedDailyToday = {
    ...response,
    cacheUpdatedAt: new Date().toISOString(),
    isStale: false,
  };
  snapshot.todayByDate[response.date] = cached;
  await writeDailyCacheSnapshot(userId, snapshot);
  return cached;
}

export async function loadCachedDailyHistory(
  userId: number | null | undefined,
): Promise<CachedDailyHistory | null> {
  return (await readDailyCacheSnapshot(userId)).history;
}

export async function saveCachedDailyHistory(
  userId: number | null | undefined,
  response: DailyHistoryResponse,
  options: { append?: boolean } = {},
): Promise<CachedDailyHistory> {
  const snapshot = await readDailyCacheSnapshot(userId);
  const playlists = options.append
    ? uniqueDailySummaries([...(snapshot.history?.playlists ?? []), ...response.playlists])
    : response.playlists;
  const nextOffset = Math.max(response.offset + response.playlists.length, playlists.length);
  const cached: CachedDailyHistory = {
    playlists,
    total: response.total,
    limit: response.limit,
    offset: 0,
    cacheUpdatedAt: new Date().toISOString(),
    isStale: false,
    nextOffset,
    hasMore: nextOffset < response.total,
  };
  snapshot.history = cached;
  await writeDailyCacheSnapshot(userId, snapshot);
  return cached;
}

export async function loadCachedDailyPlaylist(
  userId: number | null | undefined,
  date: string,
): Promise<CachedDailyPlaylist | null> {
  return (await readDailyCacheSnapshot(userId)).playlistsByDate[date] ?? null;
}

export async function saveCachedDailyPlaylist(
  userId: number | null | undefined,
  playlist: DailyPlaylist,
): Promise<CachedDailyPlaylist> {
  const snapshot = await readDailyCacheSnapshot(userId);
  const cached: CachedDailyPlaylist = {
    ...playlist,
    cacheUpdatedAt: new Date().toISOString(),
    isStale: false,
  };
  snapshot.playlistsByDate[playlist.date] = cached;
  await writeDailyCacheSnapshot(userId, snapshot);
  return cached;
}

export async function markDailyCachesStale(userId: number | null | undefined): Promise<void> {
  const snapshot = await readDailyCacheSnapshot(userId);
  snapshot.history = snapshot.history ? { ...snapshot.history, isStale: true } : null;
  snapshot.todayByDate = Object.fromEntries(
    Object.entries(snapshot.todayByDate).map(([date, item]) => [date, { ...item, isStale: true }]),
  );
  snapshot.playlistsByDate = Object.fromEntries(
    Object.entries(snapshot.playlistsByDate).map(([date, item]) => [date, { ...item, isStale: true }]),
  );
  await writeDailyCacheSnapshot(userId, snapshot);
}

async function readDailyCacheSnapshot(userId: number | null | undefined): Promise<DailyCacheSnapshot> {
  const snapshot = await readUserCache<DailyCacheSnapshot>("daily", userId);
  if (!snapshot?.data || typeof snapshot.data !== "object") {
    return { todayByDate: {}, history: null, playlistsByDate: {} };
  }
  return {
    todayByDate: snapshot.data.todayByDate ?? {},
    history: snapshot.data.history ?? null,
    playlistsByDate: snapshot.data.playlistsByDate ?? {},
  };
}

async function writeDailyCacheSnapshot(
  userId: number | null | undefined,
  snapshot: DailyCacheSnapshot,
): Promise<void> {
  await writeUserCache("daily", userId, snapshot);
}

function uniqueDailySummaries(playlists: DailyPlaylistSummary[]): DailyPlaylistSummary[] {
  const byDate = new Map<string, DailyPlaylistSummary>();
  for (const playlist of playlists) {
    byDate.set(playlist.date, playlist);
  }
  return Array.from(byDate.values()).sort((left, right) => right.date.localeCompare(left.date));
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
