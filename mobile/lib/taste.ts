import { ApiError, authFetch } from "@/lib/auth";

export type MusicTagsResponse = {
  tags: string[];
  updated_at: string | null;
};

export type MusicProfileRequest = {
  favorite_bands?: string;
  favorite_songs?: string;
  favorite_anime?: string;
  favorite_movies?: string;
  notes?: string;
  profile_input?: string;
  save?: boolean;
};

export type MusicProfileResponse = MusicTagsResponse & {
  input_text: string;
  reference_summary: string;
  source_notes: string;
  raw_tags: string[];
  known_tags: string[];
  corrected_tags: Array<{ raw: string; corrected: string; method: string }>;
  unknown_tags: string[];
};

type MusicTagsListener = (response: MusicTagsResponse) => void;

const musicTagsListeners = new Set<MusicTagsListener>();

export function subscribeMusicTags(listener: MusicTagsListener): () => void {
  musicTagsListeners.add(listener);
  return () => {
    musicTagsListeners.delete(listener);
  };
}

export async function getMusicTags(accessToken: string): Promise<MusicTagsResponse> {
  const response = await authFetch("/v1/me/music-tags", accessToken);
  await assertOk(response);
  return (await response.json()) as MusicTagsResponse;
}

export async function setMusicTags(accessToken: string, tags: string[]): Promise<MusicTagsResponse> {
  const response = await authFetch("/v1/me/music-tags", accessToken, {
    body: JSON.stringify({ tags }),
    headers: {
      "Content-Type": "application/json",
    },
    method: "PUT",
  });
  await assertOk(response);
  const body = (await response.json()) as MusicTagsResponse;
  notifyMusicTags(body);
  return body;
}

export async function generateMusicProfile(
  accessToken: string,
  request: MusicProfileRequest,
): Promise<MusicProfileResponse> {
  const response = await authFetch("/v1/me/music-tags/profile", accessToken, {
    body: JSON.stringify(request),
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  await assertOk(response);
  const body = (await response.json()) as MusicProfileResponse;
  if (request.save !== false) {
    notifyMusicTags(body);
  }
  return body;
}

function notifyMusicTags(response: MusicTagsResponse): void {
  musicTagsListeners.forEach((listener) => {
    listener(response);
  });
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
