import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { PropsWithChildren, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Platform } from "react-native";

import { useAuth } from "@/components/AuthProvider";
import { ApiError, getFreshAccessToken } from "@/lib/auth";
import { absoluteSongUrl, cacheSong, Song, SongCacheResult } from "@/lib/songs";

export type PlaybackOrder = "sequence" | "shuffle";
export type RepeatMode = "pause" | "loop";
export type PlaySongSource = "playlist" | "daily" | "library" | "adHoc";

type PlaySongOptions = {
  playlistId?: string;
  source?: PlaySongSource;
};

type PlayerContextValue = {
  currentSong: Song | null;
  queue: Song[];
  playbackOrder: PlaybackOrder;
  repeatMode: RepeatMode;
  busySongId: string | null;
  error: string | null;
  isPlaying: boolean;
  isBuffering: boolean;
  currentTime: number;
  duration: number;
  playSong: (song: Song, queue?: Song[], options?: PlaySongOptions) => Promise<SongCacheResult | null>;
  playNext: (song: Song) => void;
  nextSong: () => Promise<boolean>;
  previousSong: () => Promise<boolean>;
  togglePlayPause: () => void;
  pause: () => void;
  seekTo: (seconds: number) => Promise<void>;
  cyclePlaybackOrder: () => void;
  cycleRepeatMode: () => void;
  setPlaybackOrder: (order: PlaybackOrder) => void;
  setRepeatMode: (mode: RepeatMode) => void;
  updateCurrentSongLike: (songId: string, isLiked: boolean, likedAt: string | null) => void;
};

const PlayerContext = createContext<PlayerContextValue | null>(null);

export function PlayerProvider({ children }: PropsWithChildren) {
  const { session } = useAuth();
  const player = useAudioPlayer(null, {
    keepAudioSessionActive: true,
    updateInterval: 500,
  });
  const status = useAudioPlayerStatus(player);
  const [currentSong, setCurrentSong] = useState<Song | null>(null);
  const [queue, setQueue] = useState<Song[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [currentUri, setCurrentUri] = useState<string | null>(null);
  const [playbackOrder, setPlaybackOrderState] = useState<PlaybackOrder>("sequence");
  const [repeatMode, setRepeatModeState] = useState<RepeatMode>("pause");
  const [busySongId, setBusySongId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const webObjectUrlRef = useRef<string | null>(null);
  const currentSongRef = useRef<Song | null>(null);
  const queueRef = useRef<Song[]>([]);
  const currentIndexRef = useRef(-1);
  const currentUriRef = useRef<string | null>(null);
  const playbackOrderRef = useRef<PlaybackOrder>("sequence");
  const repeatModeRef = useRef<RepeatMode>("pause");
  const busySongIdRef = useRef<string | null>(null);
  const shufflePlayedIdsRef = useRef<Set<string>>(new Set());
  const previousSongIdsRef = useRef<string[]>([]);
  const playNextSongIdsRef = useRef<string[]>([]);
  const lastAutoAdvanceKeyRef = useRef<string | null>(null);
  const autoAdvanceInFlightRef = useRef(false);

  useEffect(() => {
    currentSongRef.current = currentSong;
  }, [currentSong]);

  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);

  useEffect(() => {
    currentIndexRef.current = currentIndex;
  }, [currentIndex]);

  useEffect(() => {
    currentUriRef.current = currentUri;
  }, [currentUri]);

  useEffect(() => {
    playbackOrderRef.current = playbackOrder;
  }, [playbackOrder]);

  useEffect(() => {
    repeatModeRef.current = repeatMode;
  }, [repeatMode]);

  useEffect(() => {
    busySongIdRef.current = busySongId;
  }, [busySongId]);

  const revokeWebObjectUrl = useCallback(() => {
    if (Platform.OS !== "web" || !webObjectUrlRef.current) {
      return;
    }
    URL.revokeObjectURL(webObjectUrlRef.current);
    webObjectUrlRef.current = null;
  }, []);

  useEffect(() => {
    setAudioModeAsync({
      allowsRecording: false,
      interruptionMode: "doNotMix",
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      shouldRouteThroughEarpiece: false,
    }).catch(() => {
      // The web shim and some simulator states can reject audio mode changes.
    });
  }, []);

  useEffect(() => {
    if (session) {
      return;
    }
    player.pause();
    setCurrentSong(null);
    setQueue([]);
    setCurrentIndex(-1);
    setCurrentUri(null);
    setBusySongId(null);
    previousSongIdsRef.current = [];
    playNextSongIdsRef.current = [];
    shufflePlayedIdsRef.current = new Set();
    revokeWebObjectUrl();
  }, [player, revokeWebObjectUrl, session]);

  useEffect(() => {
    return () => {
      player.pause();
      revokeWebObjectUrl();
    };
  }, [player, revokeWebObjectUrl]);

  const startSong = useCallback(
    async (
      song: Song,
      options: {
        queue?: Song[];
        index?: number;
        preserveQueue?: boolean;
        resetShuffle?: boolean;
        rememberHistory?: boolean;
      } = {},
    ) => {
      if (!session) {
        const nextError = "Login is required before playing music.";
        setError(nextError);
        throw new Error(nextError);
      }
      if (busySongIdRef.current) {
        return null;
      }

      const nextQueue = options.preserveQueue ? queueRef.current : normalizeQueue(song, options.queue ?? queueRef.current);
      const nextIndex = options.preserveQueue ? -1 : (options.index ?? findSongIndex(nextQueue, song.id));
      if (!options.preserveQueue) {
        queueRef.current = nextQueue;
        currentIndexRef.current = nextIndex;
        setQueue(nextQueue);
        setCurrentIndex(nextIndex);
      }

      const current = currentSongRef.current;
      if (options.rememberHistory && current && current.id !== song.id) {
        previousSongIdsRef.current.push(current.id);
      }
      if (options.resetShuffle && !options.preserveQueue) {
        previousSongIdsRef.current = [];
        shufflePlayedIdsRef.current = new Set([song.id]);
      } else if (playbackOrderRef.current === "shuffle") {
        shufflePlayedIdsRef.current.add(song.id);
      }

      if (current?.id === song.id && currentUriRef.current) {
        setError(null);
        lastAutoAdvanceKeyRef.current = null;
        player.play();
        return { uri: currentUriRef.current, cached: Platform.OS !== "web" };
      }

      setBusySongId(song.id);
      busySongIdRef.current = song.id;
      setError(null);
      try {
        revokeWebObjectUrl();
        const playable = await preparePlayableSong(song, session.accessToken);
        if (Platform.OS === "web") {
          webObjectUrlRef.current = playable.uri;
        }
        currentSongRef.current = song;
        currentUriRef.current = playable.uri;
        lastAutoAdvanceKeyRef.current = null;
        setCurrentSong(song);
        setCurrentUri(playable.uri);
        player.replace({ uri: playable.uri, name: song.title });
        try {
          player.setActiveForLockScreen(true, {
            albumTitle: song.album || undefined,
            artist: song.artist,
            title: song.title,
          });
        } catch {
          // Lock screen metadata is best-effort across Expo targets.
        }
        player.play();
        return playable;
      } catch (exc) {
        const message = exc instanceof Error ? exc.message : "Song playback failed.";
        setError(message);
        throw exc;
      } finally {
        setBusySongId(null);
        busySongIdRef.current = null;
      }
    },
    [player, revokeWebObjectUrl, session],
  );

  const playSong = useCallback(
    async (song: Song, nextQueue?: Song[], options: PlaySongOptions = {}) => {
      const preserveQueue = options.source === "library" && nextQueue === undefined;
      const normalizedQueue = normalizeQueue(song, nextQueue ?? queueRef.current);
      return startSong(song, {
        index: findSongIndex(normalizedQueue, song.id),
        queue: normalizedQueue,
        preserveQueue,
        resetShuffle: !preserveQueue,
      });
    },
    [startSong],
  );

  const nextSong = useCallback(async () => {
    const next = pickNextSong();
    if (!next) {
      return false;
    }
    await startSong(next.song, {
      index: next.index,
      rememberHistory: true,
    });
    return true;
  }, [startSong]);

  const playNext = useCallback((song: Song) => {
    const current = currentSongRef.current;
    if (current?.id === song.id) {
      return;
    }

    const currentQueue = queueRef.current;
    let nextQueue = currentQueue.filter((candidate) => candidate.id !== song.id);
    let nextIndex = currentIndexRef.current;

    if (current) {
      const currentQueueIndex = findSongIndex(nextQueue, current.id);
      if (currentQueueIndex >= 0) {
        nextQueue = [
          ...nextQueue.slice(0, currentQueueIndex + 1),
          song,
          ...nextQueue.slice(currentQueueIndex + 1),
        ];
        nextIndex = currentQueueIndex;
      } else {
        nextQueue = [current, song, ...nextQueue];
        nextIndex = 0;
      }
    } else {
      nextQueue = [song, ...nextQueue];
      nextIndex = -1;
    }

    queueRef.current = nextQueue;
    currentIndexRef.current = nextIndex;
    setQueue(nextQueue);
    setCurrentIndex(nextIndex);
    playNextSongIdsRef.current = [song.id, ...playNextSongIdsRef.current.filter((songId) => songId !== song.id)];
  }, []);

  const previousSong = useCallback(async () => {
    const previous = pickPreviousSong();
    if (!previous) {
      return false;
    }
    await startSong(previous.song, {
      index: previous.index,
      rememberHistory: false,
    });
    return true;
  }, [startSong]);

  useEffect(() => {
    const song = currentSongRef.current;
    if (!song) {
      lastAutoAdvanceKeyRef.current = null;
      return;
    }

    const effectiveDuration = status.duration > 0 ? status.duration : (song.duration_seconds ?? 0);
    const effectiveTime = status.currentTime > 0 ? status.currentTime : 0;
    const nearEnd = effectiveDuration > 0 && effectiveTime >= Math.max(0, effectiveDuration - 0.75);
    const finished = Boolean(status.didJustFinish) || (nearEnd && !status.playing && !status.isBuffering);

    if (!finished) {
      if (effectiveDuration > 0 && effectiveTime < Math.max(0, effectiveDuration - 2)) {
        lastAutoAdvanceKeyRef.current = null;
      }
      return;
    }

    const autoAdvanceKey = `${song.id}:${Math.floor(effectiveDuration || 0)}`;
    if (lastAutoAdvanceKeyRef.current === autoAdvanceKey || autoAdvanceInFlightRef.current) {
      return;
    }
    lastAutoAdvanceKeyRef.current = autoAdvanceKey;
    autoAdvanceInFlightRef.current = true;
    nextSong()
      .catch(() => {
        // Keep the player stable if automatic advance cannot prepare the next song.
      })
      .finally(() => {
        autoAdvanceInFlightRef.current = false;
      });
  }, [nextSong, status.currentTime, status.didJustFinish, status.duration, status.isBuffering, status.playing]);

  const togglePlayPause = useCallback(() => {
    if (!currentSongRef.current) {
      return;
    }
    if (status.playing) {
      player.pause();
      return;
    }
    player.play();
  }, [player, status.playing]);

  const pause = useCallback(() => {
    player.pause();
  }, [player]);

  const seekTo = useCallback(
    async (seconds: number) => {
      await player.seekTo(Math.max(0, seconds));
    },
    [player],
  );

  const setPlaybackOrder = useCallback((order: PlaybackOrder) => {
    setPlaybackOrderState(order);
    playbackOrderRef.current = order;
    shufflePlayedIdsRef.current = currentSongRef.current ? new Set([currentSongRef.current.id]) : new Set();
  }, []);

  const cyclePlaybackOrder = useCallback(() => {
    setPlaybackOrder(playbackOrderRef.current === "sequence" ? "shuffle" : "sequence");
  }, [setPlaybackOrder]);

  const setRepeatMode = useCallback((mode: RepeatMode) => {
    setRepeatModeState(mode);
    repeatModeRef.current = mode;
  }, []);

  const cycleRepeatMode = useCallback(() => {
    setRepeatMode(repeatModeRef.current === "pause" ? "loop" : "pause");
  }, [setRepeatMode]);

  const updateCurrentSongLike = useCallback((songId: string, isLiked: boolean, likedAt: string | null) => {
    const updateSong = (song: Song) => (song.id === songId ? { ...song, is_liked: isLiked, liked_at: likedAt } : song);
    setCurrentSong((song) => (song ? updateSong(song) : song));
    setQueue((songs) => songs.map(updateSong));
    if (currentSongRef.current?.id === songId) {
      currentSongRef.current = updateSong(currentSongRef.current);
    }
    queueRef.current = queueRef.current.map(updateSong);
  }, []);

  const duration = status.duration > 0 ? status.duration : (currentSong?.duration_seconds ?? 0);
  const currentTime = status.currentTime > 0 ? Math.min(status.currentTime, duration || status.currentTime) : 0;

  const value = useMemo<PlayerContextValue>(
    () => ({
      currentSong,
      queue,
      playbackOrder,
      repeatMode,
      busySongId,
      error,
      isPlaying: Boolean(status.playing),
      isBuffering: Boolean(status.isBuffering),
      currentTime,
      duration,
      playSong,
      playNext,
      nextSong,
      previousSong,
      togglePlayPause,
      pause,
      seekTo,
      cyclePlaybackOrder,
      cycleRepeatMode,
      setPlaybackOrder,
      setRepeatMode,
      updateCurrentSongLike,
    }),
    [
      busySongId,
      currentSong,
      currentTime,
      cyclePlaybackOrder,
      cycleRepeatMode,
      duration,
      error,
      nextSong,
      pause,
      playNext,
      playSong,
      playbackOrder,
      previousSong,
      queue,
      repeatMode,
      seekTo,
      setPlaybackOrder,
      setRepeatMode,
      status.isBuffering,
      status.playing,
      togglePlayPause,
      updateCurrentSongLike,
    ],
  );

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;

  function pickNextSong(): { song: Song; index: number } | null {
    const songs = queueRef.current;
    const current = currentSongRef.current;
    if (!current || songs.length === 0) {
      return null;
    }
    const order = playbackOrderRef.current;
    const repeat = repeatModeRef.current;
    const index = findSongIndex(songs, current.id);

    while (playNextSongIdsRef.current.length > 0) {
      const playNextSongId = playNextSongIdsRef.current.shift();
      if (!playNextSongId || playNextSongId === current.id) {
        continue;
      }
      const playNextIndex = findSongIndex(songs, playNextSongId);
      if (playNextIndex >= 0) {
        return { song: songs[playNextIndex], index: playNextIndex };
      }
    }

    if (order === "sequence") {
      const resolvedIndex = index >= 0 ? index : currentIndexRef.current;
      const nextIndex = resolvedIndex >= 0 ? resolvedIndex + 1 : 0;
      if (nextIndex < songs.length) {
        return { song: songs[nextIndex], index: nextIndex };
      }
      if (repeat === "loop") {
        return { song: songs[0], index: 0 };
      }
      return null;
    }

    const candidates = unplayedShuffleSongs(songs, current.id, shufflePlayedIdsRef.current);
    if (candidates.length > 0) {
      return pickRandomSong(candidates);
    }
    if (repeat === "loop") {
      shufflePlayedIdsRef.current = new Set([current.id]);
      const resetCandidates = songs
        .map((song, songIndex) => ({ song, index: songIndex }))
        .filter((candidate) => candidate.song.id !== current.id);
      const currentIndex = index >= 0 ? index : Math.max(0, currentIndexRef.current);
      return pickRandomSong(resetCandidates.length > 0 ? resetCandidates : [{ song: current, index: currentIndex }]);
    }
    return null;
  }

  function pickPreviousSong(): { song: Song; index: number } | null {
    const songs = queueRef.current;
    const current = currentSongRef.current;
    if (!current || songs.length === 0) {
      return null;
    }

    const previousSongId = previousSongIdsRef.current.pop();
    if (previousSongId) {
      const previousIndex = findSongIndex(songs, previousSongId);
      if (previousIndex >= 0) {
        return { song: songs[previousIndex], index: previousIndex };
      }
    }

    const index = resolveCurrentIndex(songs, current.id);
    if (index > 0) {
      return { song: songs[index - 1], index: index - 1 };
    }
    if (repeatModeRef.current === "loop" && songs.length > 1) {
      return { song: songs[songs.length - 1], index: songs.length - 1 };
    }
    return null;
  }
}

export function usePlayer() {
  const value = useContext(PlayerContext);
  if (!value) {
    throw new Error("usePlayer must be used inside PlayerProvider.");
  }
  return value;
}

async function preparePlayableSong(song: Song, accessToken: string): Promise<SongCacheResult> {
  if (Platform.OS !== "web") {
    return cacheSong(song, accessToken);
  }

  const freshAccessToken = await getFreshAccessToken(accessToken);
  const response = await fetch(absoluteSongUrl(song.download_url), {
    headers: {
      Authorization: `Bearer ${freshAccessToken}`,
    },
  });
  if (!response.ok) {
    throw new ApiError(`Playback download failed with status ${response.status}.`, response.status);
  }
  const blob = await response.blob();
  return { uri: URL.createObjectURL(blob), cached: false };
}

function normalizeQueue(song: Song, queue: Song[]): Song[] {
  const byId = new Map<string, Song>();
  for (const candidate of queue) {
    byId.set(candidate.id, candidate);
  }
  byId.set(song.id, song);
  return Array.from(byId.values());
}

function findSongIndex(queue: Song[], songId: string): number {
  return queue.findIndex((song) => song.id === songId);
}

function resolveCurrentIndex(queue: Song[], songId: string): number {
  const currentIndex = currentIndexSafe(queue, songId);
  return currentIndex >= 0 ? currentIndex : 0;
}

function currentIndexSafe(queue: Song[], songId: string): number {
  return findSongIndex(queue, songId);
}

function pickRandomSong(candidates: Array<{ song: Song; index: number }>): { song: Song; index: number } | null {
  if (candidates.length === 0) {
    return null;
  }
  return candidates[Math.floor(Math.random() * candidates.length)];
}

function unplayedShuffleSongs(queue: Song[], currentSongId: string, playedIds: Set<string>): Array<{ song: Song; index: number }> {
  return queue
    .map((song, index) => ({ song, index }))
    .filter((candidate) => candidate.song.id !== currentSongId && !playedIds.has(candidate.song.id));
}
