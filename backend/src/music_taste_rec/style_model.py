from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

import joblib
import numpy as np
import pandas as pd
from scipy import sparse
from sklearn.decomposition import TruncatedSVD
from sklearn.feature_extraction.text import TfidfTransformer
from sklearn.preprocessing import normalize

from music_taste_rec.data import load_raw_dataset, normalize_history, normalize_music_info, parse_tags
from music_taste_rec.tag_fusion import fuse_lastfm320k_tags, load_lastfm320k


@dataclass(frozen=True)
class StyleTrainingConfig:
    raw_dir: Path = Path("data/raw")
    model_path: Path = Path("models/style_model.joblib")
    max_interactions: int | None = None
    min_tag_tracks: int = 5
    max_tags: int = 5_000
    n_components: int = 64
    include_genre: bool = True
    lastfm320k_path: Path | None = None
    filter_lastfm_noise: bool = True
    lastfm_filter_profile: str = "broad"
    catalog_tag_weight: float = 1.0
    genre_tag_weight: float = 1.0
    lastfm_tag_weight: float = 1.0
    random_state: int = 42


@dataclass
class StyleAssociationModel:
    tags: list[str]
    tag_to_index: dict[str, int]
    tag_embeddings: np.ndarray
    tag_stats: pd.DataFrame
    config: dict[str, object]

    def save(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        joblib.dump(self, path, compress=3)

    @classmethod
    def load(cls, path: Path) -> "StyleAssociationModel":
        return joblib.load(path)

    def known_tags(self, tags: str | Iterable[str]) -> list[str]:
        return [tag for tag in parse_style_tags(tags) if tag in self.tag_to_index]

    def unknown_tags(self, tags: str | Iterable[str]) -> list[str]:
        return [tag for tag in parse_style_tags(tags) if tag not in self.tag_to_index]

    def embed_tags(self, tags: str | Iterable[str]) -> np.ndarray:
        known = self.known_tags(tags)
        if not known:
            return np.zeros(self.tag_embeddings.shape[1], dtype=np.float32)
        indices = [self.tag_to_index[tag] for tag in known]
        vector = self.tag_embeddings[indices].mean(axis=0)
        norm = np.linalg.norm(vector)
        if norm <= 1e-12:
            return vector.astype(np.float32)
        return (vector / norm).astype(np.float32)

    def similar_tags(self, tag: str, top_n: int = 20, min_user_count: int = 0) -> pd.DataFrame:
        canonical = canonicalize_tag(tag)
        if canonical not in self.tag_to_index:
            raise KeyError(f"Unknown tag: {tag}")
        query = self.tag_embeddings[self.tag_to_index[canonical]]
        scores = self.tag_embeddings @ query
        scores[self.tag_to_index[canonical]] = -np.inf
        self._apply_support_filter(scores, min_user_count=min_user_count)
        indices = _top_indices(scores, top_n)
        return self._tag_result(indices, scores)

    def expand_tags(
        self,
        tags: str | Iterable[str],
        top_n: int = 20,
        min_user_count: int = 0,
    ) -> pd.DataFrame:
        vector = self.embed_tags(tags)
        if not np.any(vector):
            raise ValueError(f"No known tags in query: {tags}")
        scores = self.tag_embeddings @ vector
        for tag in self.known_tags(tags):
            scores[self.tag_to_index[tag]] = -np.inf
        self._apply_support_filter(scores, min_user_count=min_user_count)
        indices = _top_indices(scores, top_n)
        return self._tag_result(indices, scores)

    def score_tags(self, user_tags: str | Iterable[str], song_tags: str | Iterable[str]) -> dict[str, object]:
        user_known = self.known_tags(user_tags)
        song_known = self.known_tags(song_tags)
        user_vector = self.embed_tags(user_known)
        song_vector = self.embed_tags(song_known)
        embedding_score = float(user_vector @ song_vector) if np.any(user_vector) and np.any(song_vector) else 0.0
        overlap_score = _overlap_score(user_known, song_known)
        score = 0.85 * embedding_score + 0.15 * overlap_score
        return {
            "score": float(score),
            "embedding_score": embedding_score,
            "overlap_score": overlap_score,
            "known_user_tags": user_known,
            "known_song_tags": song_known,
            "unknown_user_tags": self.unknown_tags(user_tags),
            "unknown_song_tags": self.unknown_tags(song_tags),
        }

    def rank_songs(
        self,
        songs: pd.DataFrame,
        user_tags: str | Iterable[str],
        top_n: int = 20,
    ) -> pd.DataFrame:
        music, _ = normalize_music_info(songs)
        rows: list[dict[str, object]] = []
        for _, song in music.iterrows():
            result = self.score_tags(user_tags=user_tags, song_tags=song["tags"])
            rows.append(
                {
                    "score": result["score"],
                    "embedding_score": result["embedding_score"],
                    "overlap_score": result["overlap_score"],
                    "track_id": song["track_id"],
                    "name": song["name"],
                    "artist": song["artist"],
                    "genre": song["genre"],
                    "tags_text": song["tags_text"],
                    "known_song_tags": ", ".join(result["known_song_tags"]),
                    "unknown_song_tags": ", ".join(result["unknown_song_tags"]),
                }
            )
        ranked = pd.DataFrame(rows).sort_values("score", ascending=False)
        return ranked.head(top_n).reset_index(drop=True)

    def _tag_result(self, indices: np.ndarray, scores: np.ndarray) -> pd.DataFrame:
        frame = pd.DataFrame(
            {
                "tag": [self.tags[index] for index in indices],
                "score": scores[indices],
            }
        )
        return frame.merge(self.tag_stats, on="tag", how="left")

    def _apply_support_filter(self, scores: np.ndarray, min_user_count: int) -> None:
        if min_user_count <= 0:
            return
        low_support = self.tag_stats["user_count"].to_numpy() < min_user_count
        scores[low_support] = -np.inf


def train_style_model(config: StyleTrainingConfig) -> StyleAssociationModel:
    raw = load_raw_dataset(config.raw_dir)
    music, _ = normalize_music_info(raw.music)
    history = normalize_history(raw.history)
    fusion_stats: dict[str, object] = {}
    if config.lastfm320k_path is not None:
        lastfm = load_lastfm320k(config.lastfm320k_path)
        fusion = fuse_lastfm320k_tags(
            music=music,
            lastfm=lastfm,
            filter_noisy_tags=config.filter_lastfm_noise,
            filter_profile=config.lastfm_filter_profile,
        )
        music = fusion.music
        fusion_stats = fusion.stats
    if config.max_interactions and len(history) > config.max_interactions:
        history = history.sample(config.max_interactions, random_state=config.random_state)
    model = train_style_model_from_frames(music=music, history=history, config=config)
    model.config.update(fusion_stats)
    return model


def train_style_model_from_frames(
    music: pd.DataFrame,
    history: pd.DataFrame,
    config: StyleTrainingConfig,
) -> StyleAssociationModel:
    track_tag_weights = build_track_tag_weights(
        music=music,
        include_genre=config.include_genre,
        catalog_tag_weight=config.catalog_tag_weight,
        genre_tag_weight=config.genre_tag_weight,
        lastfm_tag_weight=config.lastfm_tag_weight,
    )
    tag_counts = Counter(tag for tags in track_tag_weights.values() for tag in tags)
    tags = [
        tag
        for tag, count in tag_counts.most_common(config.max_tags)
        if count >= config.min_tag_tracks
    ]
    if len(tags) < 2:
        raise ValueError("Not enough tags to train style associations. Lower min_tag_tracks.")

    tag_to_index = {tag: index for index, tag in enumerate(tags)}
    track_ids = pd.Index(music["track_id"].astype(str))
    track_to_index = {track_id: index for index, track_id in enumerate(track_ids)}

    track_tag_matrix = build_track_tag_matrix(
        track_ids=track_ids,
        track_tag_weights=track_tag_weights,
        tag_to_index=tag_to_index,
    )
    history = history[history["track_id"].isin(track_to_index)].reset_index(drop=True)
    if history.empty:
        raise ValueError("No listening history rows match the music catalog track_id values.")

    user_item_matrix, user_to_index = build_user_item_matrix(history=history, track_to_index=track_to_index)
    user_tag_matrix = (user_item_matrix @ track_tag_matrix).tocsr()
    user_tag_matrix.eliminate_zeros()

    transformer = TfidfTransformer(norm="l2", use_idf=True, sublinear_tf=True)
    weighted_user_tags = transformer.fit_transform(user_tag_matrix)
    components = min(config.n_components, min(weighted_user_tags.shape) - 1)
    if components < 2:
        raise ValueError("Not enough users/tags to train style embeddings.")

    svd = TruncatedSVD(n_components=components, random_state=config.random_state)
    svd.fit(weighted_user_tags)
    tag_embeddings = normalize(svd.components_.T, norm="l2").astype(np.float32)
    tag_stats = build_tag_stats(tags=tags, track_counts=tag_counts, user_tag_matrix=user_tag_matrix)

    return StyleAssociationModel(
        tags=tags,
        tag_to_index=tag_to_index,
        tag_embeddings=tag_embeddings,
        tag_stats=tag_stats,
        config={
            "raw_dir": str(config.raw_dir),
            "max_interactions": config.max_interactions,
            "min_tag_tracks": config.min_tag_tracks,
            "max_tags": config.max_tags,
            "n_components": components,
            "include_genre": config.include_genre,
            "lastfm320k_path": str(config.lastfm320k_path) if config.lastfm320k_path is not None else "",
            "filter_lastfm_noise": config.filter_lastfm_noise,
            "lastfm_filter_profile": config.lastfm_filter_profile,
            "catalog_tag_weight": config.catalog_tag_weight,
            "genre_tag_weight": config.genre_tag_weight,
            "lastfm_tag_weight": config.lastfm_tag_weight,
            "users": len(user_to_index),
            "interactions": len(history),
        },
    )


def build_track_tags(music: pd.DataFrame, include_genre: bool = True) -> dict[str, list[str]]:
    track_tag_weights = build_track_tag_weights(music=music, include_genre=include_genre)
    return {track_id: sorted(weights) for track_id, weights in track_tag_weights.items()}


def build_track_tag_weights(
    music: pd.DataFrame,
    include_genre: bool = True,
    catalog_tag_weight: float = 1.0,
    genre_tag_weight: float = 1.0,
    lastfm_tag_weight: float = 1.0,
) -> dict[str, dict[str, float]]:
    result: dict[str, dict[str, float]] = {}
    for _, row in music.iterrows():
        weights: dict[str, float] = {}
        catalog_tags = row.get("catalog_tags", row.get("tags", []))
        for tag in catalog_tags:
            _add_tag_weight(weights, tag, catalog_tag_weight)
        if include_genre and row.get("genre"):
            for tag in parse_tags(row["genre"]):
                _add_tag_weight(weights, tag, genre_tag_weight)
        for tag in row.get("lastfm320k_tags", []):
            _add_tag_weight(weights, tag, lastfm_tag_weight)
        result[str(row["track_id"])] = weights
    return result


def build_track_tag_matrix(
    track_ids: pd.Index,
    track_tag_weights: dict[str, dict[str, float]],
    tag_to_index: dict[str, int],
) -> sparse.csr_matrix:
    rows: list[int] = []
    cols: list[int] = []
    values: list[float] = []
    for row_index, track_id in enumerate(track_ids):
        for tag, weight in track_tag_weights.get(str(track_id), {}).items():
            col_index = tag_to_index.get(tag)
            if col_index is not None:
                rows.append(row_index)
                cols.append(col_index)
                values.append(weight)
    data = np.asarray(values, dtype=np.float32)
    return sparse.coo_matrix((data, (rows, cols)), shape=(len(track_ids), len(tag_to_index))).tocsr()


def build_user_item_matrix(
    history: pd.DataFrame,
    track_to_index: dict[str, int],
) -> tuple[sparse.csr_matrix, dict[str, int]]:
    users = pd.Index(history["user_id"].drop_duplicates())
    user_to_index = {user: index for index, user in enumerate(users)}
    rows = history["user_id"].map(user_to_index).to_numpy()
    cols = history["track_id"].map(track_to_index).to_numpy()
    data = np.log1p(history["play_count"].astype(np.float32).to_numpy())
    matrix = sparse.coo_matrix((data, (rows, cols)), shape=(len(users), len(track_to_index))).tocsr()
    return matrix, user_to_index


def build_tag_stats(
    tags: list[str],
    track_counts: Counter[str],
    user_tag_matrix: sparse.csr_matrix,
) -> pd.DataFrame:
    user_counts = np.asarray((user_tag_matrix > 0).sum(axis=0)).ravel()
    total_weights = np.asarray(user_tag_matrix.sum(axis=0)).ravel()
    return pd.DataFrame(
        {
            "tag": tags,
            "track_count": [track_counts[tag] for tag in tags],
            "user_count": user_counts.astype(int),
            "total_weight": total_weights.astype(float),
        }
    )


def parse_style_tags(tags: str | Iterable[str]) -> list[str]:
    if isinstance(tags, str):
        pieces = parse_tags(tags)
        if len(pieces) == 1 and " " in pieces[0]:
            pieces.extend(pieces[0].split())
    else:
        pieces = list(tags)
    canonical = [canonicalize_tag(tag) for tag in pieces]
    return [tag for tag in dict.fromkeys(canonical) if tag]


def canonicalize_tag(tag: object) -> str:
    text = str(tag).strip().lower()
    text = text.strip("'\"[](){}")
    text = re.sub(r"[_-]+", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text


def _add_tag_weight(weights: dict[str, float], tag: object, weight: float) -> None:
    if weight <= 0:
        return
    canonical = canonicalize_tag(tag)
    if not canonical:
        return
    weights[canonical] = max(float(weight), weights.get(canonical, 0.0))


def _overlap_score(user_tags: list[str], song_tags: list[str]) -> float:
    if not user_tags or not song_tags:
        return 0.0
    user_set = set(user_tags)
    song_set = set(song_tags)
    return len(user_set & song_set) / np.sqrt(len(user_set) * len(song_set))


def _top_indices(scores: np.ndarray, top_n: int) -> np.ndarray:
    finite = np.isfinite(scores)
    if not finite.any():
        return np.array([], dtype=int)
    limit = max(1, min(top_n, int(finite.sum())))
    candidates = np.argpartition(-scores, limit - 1)[:limit]
    return candidates[np.argsort(-scores[candidates])]
