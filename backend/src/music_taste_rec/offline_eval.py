from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd

from music_taste_rec.style_model import StyleAssociationModel, build_track_tag_weights


@dataclass(frozen=True)
class TrackEmbeddingTable:
    track_ids: list[str]
    track_to_index: dict[str, int]
    vectors: np.ndarray
    tag_sets: list[set[str]]
    valid_indices: np.ndarray
    metadata: pd.DataFrame


@dataclass(frozen=True)
class HoldoutEvaluationResult:
    metrics: dict[str, float | int]
    examples: pd.DataFrame


def evaluate_holdout(
    model: StyleAssociationModel,
    music: pd.DataFrame,
    history: pd.DataFrame,
    include_genre: bool = True,
    max_users: int = 10_000,
    min_user_interactions: int = 5,
    negative_count: int = 100,
    top_k: int = 10,
    random_state: int = 42,
    max_examples: int = 50,
) -> HoldoutEvaluationResult:
    """Evaluate whether user taste vectors rank held-out listens above random negatives."""
    rng = np.random.default_rng(random_state)
    table = build_track_embedding_table(model=model, music=music, include_genre=include_genre)
    valid_track_ids = {table.track_ids[index] for index in table.valid_indices}
    valid_history = history[history["track_id"].isin(valid_track_ids)].copy()
    if valid_history.empty:
        raise ValueError("No history rows have tracks with known model tags.")

    user_counts = valid_history.groupby("user_id")["track_id"].nunique()
    eligible_users = user_counts[user_counts >= min_user_interactions].index.to_numpy()
    if len(eligible_users) == 0:
        raise ValueError("No users have enough tagged interactions for holdout evaluation.")

    if max_users > 0 and len(eligible_users) > max_users:
        sampled_users = rng.choice(eligible_users, size=max_users, replace=False)
    else:
        sampled_users = eligible_users

    sampled_history = valid_history[valid_history["user_id"].isin(sampled_users)].copy()
    sampled_history["track_index"] = sampled_history["track_id"].map(table.track_to_index).astype(int)

    rows: list[dict[str, float | int | str]] = []
    ranks: list[int] = []
    aucs: list[float] = []
    hits: list[float] = []
    mrrs: list[float] = []
    ndcgs: list[float] = []
    positive_scores: list[float] = []
    negative_scores: list[float] = []
    negative_sample_sizes: list[int] = []
    skipped_users = 0

    for user_id, group in sampled_history.groupby("user_id", sort=False):
        if len(group) < 2:
            skipped_users += 1
            continue

        holdout_offset = int(rng.integers(len(group)))
        holdout = group.iloc[holdout_offset]
        train_group = group.drop(group.index[holdout_offset])
        train_indices = train_group["track_index"].to_numpy(dtype=int)
        weights = np.log1p(train_group["play_count"].to_numpy(dtype=np.float32))
        user_vector = _weighted_user_vector(table.vectors, train_indices, weights)
        user_tags = _union_tags(table.tag_sets, train_indices)
        if not np.any(user_vector) or not user_tags:
            skipped_users += 1
            continue

        positive_index = int(holdout["track_index"])
        listened_indices = set(group["track_index"].astype(int).tolist())
        negative_indices = _sample_negative_indices(
            valid_indices=table.valid_indices,
            forbidden_indices=listened_indices,
            count=negative_count,
            rng=rng,
        )
        if len(negative_indices) == 0:
            skipped_users += 1
            continue

        positive_score = _score_track(
            user_vector=user_vector,
            user_tags=user_tags,
            track_vector=table.vectors[positive_index],
            track_tags=table.tag_sets[positive_index],
        )
        sampled_negative_scores = np.array(
            [
                _score_track(
                    user_vector=user_vector,
                    user_tags=user_tags,
                    track_vector=table.vectors[index],
                    track_tags=table.tag_sets[index],
                )
                for index in negative_indices
            ],
            dtype=np.float32,
        )

        rank = 1 + int(np.sum(sampled_negative_scores >= positive_score))
        auc = _auc_against_negatives(positive_score, sampled_negative_scores)
        ranks.append(rank)
        aucs.append(auc)
        hits.append(float(rank <= top_k))
        mrrs.append(1.0 / rank)
        ndcgs.append(1.0 / np.log2(rank + 1) if rank <= top_k else 0.0)
        positive_scores.append(positive_score)
        negative_scores.append(float(sampled_negative_scores.mean()))
        negative_sample_sizes.append(len(negative_indices))

        if len(rows) < max_examples:
            best_negative_index = int(negative_indices[int(np.argmax(sampled_negative_scores))])
            rows.append(
                _example_row(
                    user_id=str(user_id),
                    positive_index=positive_index,
                    best_negative_index=best_negative_index,
                    table=table,
                    rank=rank,
                    positive_score=positive_score,
                    best_negative_score=float(sampled_negative_scores.max()),
                )
            )

    if not ranks:
        raise ValueError("No users could be evaluated after holdout splitting.")

    rank_array = np.array(ranks, dtype=np.float32)
    metrics: dict[str, float | int] = {
        "evaluated_users": len(ranks),
        "eligible_users": int(len(eligible_users)),
        "sampled_users": int(len(sampled_users)),
        "skipped_users": int(skipped_users),
        "catalog_tracks": int(len(table.track_ids)),
        "valid_tagged_tracks": int(len(table.valid_indices)),
        "negative_count": int(negative_count),
        "mean_negative_samples": float(np.mean(negative_sample_sizes)),
        "candidate_count": int(negative_count + 1),
        "top_k": int(top_k),
        "hit_rate_at_k": float(np.mean(hits)),
        "mrr": float(np.mean(mrrs)),
        "ndcg_at_k": float(np.mean(ndcgs)),
        "mean_auc": float(np.mean(aucs)),
        "mean_rank": float(rank_array.mean()),
        "median_rank": float(np.median(rank_array)),
        "mean_positive_score": float(np.mean(positive_scores)),
        "mean_negative_score": float(np.mean(negative_scores)),
    }
    return HoldoutEvaluationResult(metrics=metrics, examples=pd.DataFrame(rows))


def build_track_embedding_table(
    model: StyleAssociationModel,
    music: pd.DataFrame,
    include_genre: bool = True,
) -> TrackEmbeddingTable:
    track_ids = music["track_id"].astype(str).tolist()
    track_to_index = {track_id: index for index, track_id in enumerate(track_ids)}
    track_tag_weights = build_track_tag_weights(
        music=music,
        include_genre=include_genre,
        catalog_tag_weight=float(model.config.get("catalog_tag_weight", 1.0)),
        genre_tag_weight=float(model.config.get("genre_tag_weight", 1.0)),
        lastfm_tag_weight=float(model.config.get("lastfm_tag_weight", 1.0)),
    )
    vectors = np.zeros((len(track_ids), model.tag_embeddings.shape[1]), dtype=np.float32)
    tag_sets: list[set[str]] = []
    valid_indices: list[int] = []

    for index, track_id in enumerate(track_ids):
        known_weights = {
            tag: weight
            for tag, weight in track_tag_weights.get(track_id, {}).items()
            if tag in model.tag_to_index
        }
        tag_sets.append(set(known_weights))
        if not known_weights:
            continue
        tag_indices = [model.tag_to_index[tag] for tag in known_weights]
        tag_weights = np.array(list(known_weights.values()), dtype=np.float32)
        vector = np.average(model.tag_embeddings[tag_indices], axis=0, weights=tag_weights)
        norm = np.linalg.norm(vector)
        if norm <= 1e-12:
            continue
        vectors[index] = (vector / norm).astype(np.float32)
        valid_indices.append(index)

    metadata_columns = [column for column in ("track_id", "name", "artist", "genre", "tags_text") if column in music]
    return TrackEmbeddingTable(
        track_ids=track_ids,
        track_to_index=track_to_index,
        vectors=vectors,
        tag_sets=tag_sets,
        valid_indices=np.array(valid_indices, dtype=int),
        metadata=music[metadata_columns].reset_index(drop=True),
    )


def write_evaluation_outputs(
    result: HoldoutEvaluationResult,
    output_path: Path,
    examples_path: Path | None = None,
) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8") as file:
        json.dump(result.metrics, file, indent=2, sort_keys=True)
        file.write("\n")

    if examples_path is not None:
        examples_path.parent.mkdir(parents=True, exist_ok=True)
        result.examples.to_csv(examples_path, index=False)


def _weighted_user_vector(vectors: np.ndarray, track_indices: np.ndarray, weights: np.ndarray) -> np.ndarray:
    if len(track_indices) == 0:
        return np.zeros(vectors.shape[1], dtype=np.float32)
    weighted = vectors[track_indices] * weights[:, None]
    vector = weighted.sum(axis=0)
    norm = np.linalg.norm(vector)
    if norm <= 1e-12:
        return np.zeros(vectors.shape[1], dtype=np.float32)
    return (vector / norm).astype(np.float32)


def _union_tags(tag_sets: list[set[str]], track_indices: np.ndarray) -> set[str]:
    result: set[str] = set()
    for index in track_indices:
        result.update(tag_sets[int(index)])
    return result


def _sample_negative_indices(
    valid_indices: np.ndarray,
    forbidden_indices: set[int],
    count: int,
    rng: np.random.Generator,
) -> np.ndarray:
    selected: list[int] = []
    seen: set[int] = set()
    attempts = 0
    batch_size = max(32, count * 3)
    max_attempts = max(10, count * 20)

    while len(selected) < count and attempts < max_attempts:
        draws = rng.choice(valid_indices, size=batch_size, replace=True)
        for draw in draws:
            index = int(draw)
            if index in forbidden_indices or index in seen:
                continue
            selected.append(index)
            seen.add(index)
            if len(selected) >= count:
                break
        attempts += 1

    if len(selected) < count:
        remaining = np.array(
            [index for index in valid_indices if int(index) not in forbidden_indices and int(index) not in seen],
            dtype=int,
        )
        if len(remaining) > 0:
            extra_count = min(count - len(selected), len(remaining))
            selected.extend(rng.choice(remaining, size=extra_count, replace=False).astype(int).tolist())

    return np.array(selected, dtype=int)


def _score_track(
    user_vector: np.ndarray,
    user_tags: set[str],
    track_vector: np.ndarray,
    track_tags: set[str],
) -> float:
    embedding_score = float(user_vector @ track_vector)
    overlap_score = _overlap_score(user_tags, track_tags)
    return 0.85 * embedding_score + 0.15 * overlap_score


def _overlap_score(left: set[str], right: set[str]) -> float:
    if not left or not right:
        return 0.0
    return len(left & right) / np.sqrt(len(left) * len(right))


def _auc_against_negatives(positive_score: float, negative_scores: np.ndarray) -> float:
    wins = np.sum(positive_score > negative_scores)
    ties = np.sum(positive_score == negative_scores)
    return float((wins + 0.5 * ties) / len(negative_scores))


def _example_row(
    user_id: str,
    positive_index: int,
    best_negative_index: int,
    table: TrackEmbeddingTable,
    rank: int,
    positive_score: float,
    best_negative_score: float,
) -> dict[str, float | int | str]:
    positive = table.metadata.iloc[positive_index]
    negative = table.metadata.iloc[best_negative_index]
    return {
        "user_id": user_id,
        "rank": rank,
        "positive_score": positive_score,
        "best_negative_score": best_negative_score,
        "positive_track_id": positive.get("track_id", ""),
        "positive_name": positive.get("name", ""),
        "positive_artist": positive.get("artist", ""),
        "positive_genre": positive.get("genre", ""),
        "positive_tags": positive.get("tags_text", ""),
        "best_negative_track_id": negative.get("track_id", ""),
        "best_negative_name": negative.get("name", ""),
        "best_negative_artist": negative.get("artist", ""),
        "best_negative_genre": negative.get("genre", ""),
        "best_negative_tags": negative.get("tags_text", ""),
    }
