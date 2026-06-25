import { ApiError, authFetch, loadStoredSession } from "@/lib/auth";
import { readUserCache, writeUserCache } from "@/lib/cache";

export type MusicTagsResponse = {
  tags: string[];
  updated_at: string | null;
};

export type MusicTagCatalogResponse = {
  tags: string[];
  total: number;
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
  tag_meanings: Array<{ tag: string; meaning: string }>;
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
  const body = (await response.json()) as MusicTagsResponse;
  const session = await loadStoredSession();
  await saveCachedMusicTags(session?.user.id, body);
  return body;
}

export async function getMusicTagCatalog(accessToken: string): Promise<MusicTagCatalogResponse> {
  const response = await authFetch("/v1/me/music-tags/catalog", accessToken);
  await assertOk(response);
  const body = (await response.json()) as MusicTagCatalogResponse;
  const session = await loadStoredSession();
  await saveCachedMusicTagCatalog(session?.user.id, body);
  return body;
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
  const session = await loadStoredSession();
  await saveCachedMusicTags(session?.user.id, body);
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
    const session = await loadStoredSession();
    await saveCachedMusicTags(session?.user.id, body);
    notifyMusicTags(body);
  }
  return body;
}

export async function loadCachedMusicTags(
  userId: number | null | undefined,
): Promise<MusicTagsResponse | null> {
  const snapshot = await readUserCache<MusicTagsResponse>("music-tags", userId);
  return snapshot?.data ?? null;
}

export async function loadCachedMusicTagCatalog(
  userId: number | null | undefined,
): Promise<MusicTagCatalogResponse | null> {
  const snapshot = await readUserCache<MusicTagCatalogResponse>("music-tag-catalog", userId);
  return snapshot?.data ?? null;
}

export async function saveCachedMusicTags(
  userId: number | null | undefined,
  response: MusicTagsResponse,
): Promise<void> {
  await writeUserCache("music-tags", userId, response);
}

export async function saveCachedMusicTagCatalog(
  userId: number | null | undefined,
  response: MusicTagCatalogResponse,
): Promise<void> {
  await writeUserCache("music-tag-catalog", userId, response);
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
