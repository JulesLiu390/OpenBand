from __future__ import annotations

import ast
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

import numpy as np
import pandas as pd


MUSIC_INFO_FILES = (
    "Music Info.csv",
    "music_info.csv",
    "music-info.csv",
    "tracks.csv",
)

LISTENING_HISTORY_FILES = (
    "User Listening History.csv",
    "user_listening_history.csv",
    "user-listening-history.csv",
    "listening_history.csv",
    "interactions.csv",
)

TRACK_ID_COLUMNS = ("track_id", "track id", "msd_track_id", "song_id", "song id", "track")
USER_ID_COLUMNS = ("user_id", "user id", "listener_id", "listener", "username", "user")
PLAY_COUNT_COLUMNS = (
    "play_count",
    "playcount",
    "play count",
    "listen_count",
    "listen count",
    "listens",
    "plays",
    "scrobbles",
    "count",
)
NAME_COLUMNS = ("name", "song_name", "song name", "title", "track_name", "track name")
ARTIST_COLUMNS = ("artist", "artist_name", "artist name", "song_artist", "song artist")
TAG_COLUMNS = ("tags", "tag", "lastfm_tags", "lastfm tags", "top_tags", "top tags")
GENRE_COLUMNS = ("genre", "genres", "primary_genre", "primary genre")
SPOTIFY_ID_COLUMNS = ("spotify_id", "spotify id", "spotify_uri", "spotify uri")
PREVIEW_URL_COLUMNS = ("spotify_preview_url", "preview_url", "preview url", "mp3", "sample_url")

AUDIO_FEATURE_COLUMNS = (
    "danceability",
    "energy",
    "key",
    "loudness",
    "mode",
    "speechiness",
    "acousticness",
    "instrumentalness",
    "liveness",
    "valence",
    "tempo",
    "duration_ms",
    "time_signature",
    "popularity",
)


@dataclass(frozen=True)
class RawDataset:
    music: pd.DataFrame
    history: pd.DataFrame
    music_path: Path
    history_path: Path


def load_raw_dataset(raw_dir: Path) -> RawDataset:
    music_path = resolve_data_file(raw_dir, MUSIC_INFO_FILES)
    history_path = resolve_data_file(raw_dir, LISTENING_HISTORY_FILES)
    music = pd.read_csv(music_path)
    history = pd.read_csv(history_path)
    return RawDataset(music=music, history=history, music_path=music_path, history_path=history_path)


def resolve_data_file(raw_dir: Path, candidates: Iterable[str]) -> Path:
    raw_dir = Path(raw_dir)
    if not raw_dir.exists():
        raise FileNotFoundError(f"Raw data directory does not exist: {raw_dir}")

    for candidate in candidates:
        path = raw_dir / candidate
        if path.exists():
            return path

    candidate_keys = {_norm_name(name) for name in candidates}
    for path in raw_dir.iterdir():
        if path.is_file() and _norm_name(path.name) in candidate_keys:
            return path

    names = ", ".join(candidates)
    raise FileNotFoundError(f"Could not find one of [{names}] in {raw_dir}")


def normalize_music_info(raw: pd.DataFrame) -> tuple[pd.DataFrame, list[str]]:
    track_col = pick_column(raw, TRACK_ID_COLUMNS)
    name_col = pick_column(raw, NAME_COLUMNS, required=False)
    artist_col = pick_column(raw, ARTIST_COLUMNS, required=False)
    tag_col = pick_column(raw, TAG_COLUMNS, required=False)
    genre_col = pick_column(raw, GENRE_COLUMNS, required=False)
    spotify_col = pick_column(raw, SPOTIFY_ID_COLUMNS, required=False)
    preview_col = pick_column(raw, PREVIEW_URL_COLUMNS, required=False)

    audio_cols = [column for column in AUDIO_FEATURE_COLUMNS if pick_column(raw, (column,), required=False)]
    audio_actual = [pick_column(raw, (column,), required=False) for column in audio_cols]

    data = pd.DataFrame()
    data["track_id"] = raw[track_col].astype(str).str.strip()
    data["name"] = _as_text(raw[name_col]) if name_col else ""
    data["artist"] = _as_text(raw[artist_col]) if artist_col else ""
    data["genre"] = _as_text(raw[genre_col]) if genre_col else ""
    data["spotify_id"] = _as_text(raw[spotify_col]) if spotify_col else ""
    data["preview_url"] = _as_text(raw[preview_col]) if preview_col else ""
    data["tags"] = _as_text(raw[tag_col]).map(parse_tags) if tag_col else [[] for _ in range(len(raw))]
    data["tags_text"] = data["tags"].map(expand_tags_text)

    for canonical, actual in zip(audio_cols, audio_actual, strict=True):
        if actual:
            data[canonical] = pd.to_numeric(raw[actual], errors="coerce")

    data = data.replace({"": np.nan})
    data = data.dropna(subset=["track_id"]).drop_duplicates("track_id").reset_index(drop=True)
    for column in ("name", "artist", "genre", "spotify_id", "preview_url", "tags_text"):
        data[column] = data[column].fillna("")

    data["display_name"] = data.apply(_display_name, axis=1)
    data["content_text"] = data.apply(_content_text, axis=1)

    return data, audio_cols


def normalize_history(raw: pd.DataFrame) -> pd.DataFrame:
    user_col = pick_column(raw, USER_ID_COLUMNS)
    track_col = pick_column(raw, TRACK_ID_COLUMNS)
    play_col = pick_column(raw, PLAY_COUNT_COLUMNS, required=False)

    data = pd.DataFrame()
    data["user_id"] = raw[user_col].astype(str).str.strip()
    data["track_id"] = raw[track_col].astype(str).str.strip()
    if play_col:
        data["play_count"] = pd.to_numeric(raw[play_col], errors="coerce").fillna(1.0)
    else:
        data["play_count"] = 1.0

    data = data.replace({"": np.nan}).dropna(subset=["user_id", "track_id"])
    data = data[data["play_count"] > 0]
    data = (
        data.groupby(["user_id", "track_id"], as_index=False, sort=False)["play_count"]
        .sum()
        .reset_index(drop=True)
    )
    return data


def pick_column(frame: pd.DataFrame, candidates: Iterable[str], required: bool = True) -> str | None:
    by_key = {_norm_name(column): column for column in frame.columns}
    for candidate in candidates:
        match = by_key.get(_norm_name(candidate))
        if match is not None:
            return match
    if required:
        formatted = ", ".join(candidates)
        raise ValueError(f"Missing required column. Tried: {formatted}. Available: {list(frame.columns)}")
    return None


def parse_tags(value: object) -> list[str]:
    if value is None or (isinstance(value, float) and np.isnan(value)):
        return []
    if isinstance(value, (list, tuple, set)):
        return [_clean_tag(part) for part in value if _clean_tag(part)]

    text = str(value).strip()
    if not text or text.lower() in {"nan", "none", "null"}:
        return []

    if text.startswith("[") and text.endswith("]"):
        try:
            parsed = ast.literal_eval(text)
            if isinstance(parsed, (list, tuple, set)):
                return [_clean_tag(part) for part in parsed if _clean_tag(part)]
        except (SyntaxError, ValueError):
            pass

    parts = re.split(r"[|,;/]", text)
    cleaned = [_clean_tag(part) for part in parts]
    return [tag for tag in cleaned if tag]


def expand_tags_text(tags: Iterable[str]) -> str:
    expanded: list[str] = []
    for tag in tags:
        if not tag:
            continue
        expanded.append(tag)
        natural = re.sub(r"[_-]+", " ", tag).strip()
        if natural and natural != tag:
            expanded.append(natural)
    return " ".join(expanded)


def _as_text(series: pd.Series) -> pd.Series:
    return series.fillna("").astype(str).str.strip()


def _clean_tag(value: object) -> str:
    text = str(value).strip().lower()
    text = text.strip("'\"[](){}")
    text = re.sub(r"\s+", " ", text)
    return text


def _display_name(row: pd.Series) -> str:
    name = row.get("name") or row.get("track_id")
    artist = row.get("artist") or "unknown artist"
    return f"{name} - {artist}"


def _content_text(row: pd.Series) -> str:
    tags = str(row.get("tags_text") or "")
    genre = str(row.get("genre") or "")
    artist = str(row.get("artist") or "")
    name = str(row.get("name") or "")
    return " ".join(
        [
            tags,
            tags,
            tags,
            genre,
            genre,
            artist,
            name,
        ]
    ).strip()


def _norm_name(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", value.lower())
