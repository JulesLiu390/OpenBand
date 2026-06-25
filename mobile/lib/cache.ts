import * as FileSystem from "expo-file-system/legacy";
import { Platform } from "react-native";

const DATA_CACHE_DIR = `${FileSystem.documentDirectory ?? ""}openband-data-cache/`;
const STORAGE_KEY_PREFIX = "openband.data_cache";

export type PersistedCache<T> = {
  version: number;
  updatedAt: string;
  isStale: boolean;
  data: T;
};

export async function readUserCache<T>(
  namespace: string,
  userId: number | null | undefined,
): Promise<PersistedCache<T> | null> {
  let value: string | null = null;
  const key = cacheKey(namespace, userId);

  if (Platform.OS === "web") {
    value = globalThis.localStorage?.getItem(key) ?? null;
  } else if (canUseNativeCache()) {
    const path = cachePath(namespace, userId);
    const info = await FileSystem.getInfoAsync(path);
    if (info.exists) {
      value = await FileSystem.readAsStringAsync(path);
    }
  }

  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as PersistedCache<T>;
    if (!parsed || typeof parsed !== "object" || !("data" in parsed)) {
      return null;
    }
    return parsed;
  } catch {
    await deleteUserCache(namespace, userId);
    return null;
  }
}

export async function writeUserCache<T>(
  namespace: string,
  userId: number | null | undefined,
  data: T,
  options: { isStale?: boolean; version?: number } = {},
): Promise<PersistedCache<T>> {
  const snapshot: PersistedCache<T> = {
    version: options.version ?? 1,
    updatedAt: new Date().toISOString(),
    isStale: Boolean(options.isStale),
    data,
  };
  const value = JSON.stringify(snapshot);

  if (Platform.OS === "web") {
    globalThis.localStorage?.setItem(cacheKey(namespace, userId), value);
    return snapshot;
  }

  if (canUseNativeCache()) {
    await ensureDataCacheDirectory();
    await FileSystem.writeAsStringAsync(cachePath(namespace, userId), value);
  }
  return snapshot;
}

export async function markUserCacheStale(
  namespace: string,
  userId: number | null | undefined,
): Promise<void> {
  const snapshot = await readUserCache<unknown>(namespace, userId);
  if (!snapshot) {
    return;
  }
  await writeUserCache(namespace, userId, snapshot.data, {
    isStale: true,
    version: snapshot.version,
  });
}

export async function deleteUserCache(namespace: string, userId: number | null | undefined): Promise<void> {
  if (Platform.OS === "web") {
    globalThis.localStorage?.removeItem(cacheKey(namespace, userId));
    return;
  }

  if (canUseNativeCache()) {
    await FileSystem.deleteAsync(cachePath(namespace, userId), { idempotent: true });
  }
}

function cachePath(namespace: string, userId: number | null | undefined): string {
  return `${DATA_CACHE_DIR}${cacheId(namespace, userId)}.json`;
}

function cacheKey(namespace: string, userId: number | null | undefined): string {
  return `${STORAGE_KEY_PREFIX}.${cacheId(namespace, userId)}`;
}

function cacheId(namespace: string, userId: number | null | undefined): string {
  const safeNamespace = namespace.replace(/[^a-zA-Z0-9_.-]/g, "_");
  const safeUserId = userId === null || userId === undefined ? "default" : String(userId);
  return `${safeNamespace}.${safeUserId}`;
}

async function ensureDataCacheDirectory(): Promise<void> {
  const info = await FileSystem.getInfoAsync(DATA_CACHE_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(DATA_CACHE_DIR, { intermediates: true });
  }
}

function canUseNativeCache(): boolean {
  return Platform.OS !== "web" && Boolean(FileSystem.documentDirectory);
}
