import { ApiError, authFetch } from "@/lib/auth";
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

type DailyHistoryResponse = {
  playlists: DailyPlaylistSummary[];
  total: number;
  limit: number;
  offset: number;
};

export async function getTodayDaily(accessToken: string, date?: string): Promise<DailyTodayResponse> {
  const query = date ? `?date=${encodeURIComponent(date)}` : "";
  const response = await authFetch(`/v1/daily/today${query}`, accessToken);
  await assertOk(response);
  return (await response.json()) as DailyTodayResponse;
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
  return (await response.json()) as GenerateDailyResponse;
}

export async function getDailyPlaylist(accessToken: string, date: string): Promise<DailyPlaylist> {
  const response = await authFetch(`/v1/daily/${encodeURIComponent(date)}`, accessToken);
  await assertOk(response);
  return (await response.json()) as DailyPlaylist;
}

export async function listDailyHistory(accessToken: string, limit = 30): Promise<DailyHistoryResponse> {
  const response = await authFetch(`/v1/daily/history?limit=${limit}`, accessToken);
  await assertOk(response);
  return (await response.json()) as DailyHistoryResponse;
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
