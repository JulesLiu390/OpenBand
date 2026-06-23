import { ApiError, authFetch } from "@/lib/auth";
import { Song } from "@/lib/songs";

export type PlaylistSummary = {
  id: string;
  name: string;
  description: string;
  song_count: number;
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

export async function listPlaylists(accessToken: string): Promise<PlaylistListResponse> {
  const response = await authFetch("/v1/playlists", accessToken);
  await assertOk(response);
  return (await response.json()) as PlaylistListResponse;
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
  return (await response.json()) as PlaylistSummary;
}

export async function getPlaylist(accessToken: string, playlistId: string): Promise<PlaylistDetail> {
  const response = await authFetch(`/v1/playlists/${playlistId}`, accessToken);
  await assertOk(response);
  return (await response.json()) as PlaylistDetail;
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
  return (await response.json()) as PlaylistDetail;
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
  return (await response.json()) as PlaylistDetail;
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
