from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from pathlib import Path

import pandas as pd

from music_taste_rec.data import expand_tags_text, parse_tags


LASTFM_320K_FILES = (
    "lastfm_tracks.csv",
    "Last.fm 320K Music Tracks.csv",
    "tracks.csv",
)


@dataclass(frozen=True)
class LastfmCoverageResult:
    stats: dict[str, float | int]
    merged: pd.DataFrame
    matched: pd.DataFrame
    new_tag_examples: list[str]


@dataclass(frozen=True)
class LastfmFusionResult:
    music: pd.DataFrame
    coverage: LastfmCoverageResult
    stats: dict[str, object]


NOISY_LASTFM_TAG_PATTERNS = (
    re.compile(r"^\d+$"),
    re.compile(r"^\d{4}s?$"),
    re.compile(r"^\d0s$"),
    re.compile(r"^\d+\s+of\s+10\s+stars$"),
    re.compile(r"^<3$"),
    re.compile(r"^seen live$"),
    re.compile(r"^favorites?$"),
    re.compile(r"^favourites?$"),
    re.compile(r"^favorite songs?$"),
    re.compile(r"^favourite songs?$"),
    re.compile(r"^loved tracks?$"),
    re.compile(r"^my .*$"),
    re.compile(r"^title is .*$"),
    re.compile(r"^spotify$"),
    re.compile(r"^lastfm$"),
)


def load_lastfm320k(path: Path) -> pd.DataFrame:
    """Load the Last.fm 320K tracks CSV from a file or containing directory."""
    path = Path(path)
    if path.is_file():
        return pd.read_csv(path)

    if not path.exists():
        raise FileNotFoundError(f"Last.fm 320K path does not exist: {path}")

    for candidate in LASTFM_320K_FILES:
        csv_path = path / candidate
        if csv_path.exists():
            return pd.read_csv(csv_path)

    csv_files = sorted(path.glob("*.csv"))
    if len(csv_files) == 1:
        return pd.read_csv(csv_files[0])

    names = ", ".join(LASTFM_320K_FILES)
    raise FileNotFoundError(f"Could not find one of [{names}] in {path}")


def compute_lastfm320k_coverage(music: pd.DataFrame, lastfm: pd.DataFrame) -> LastfmCoverageResult:
    """Match a normalized music catalog to Last.fm 320K by normalized artist + title."""
    required_music = {"track_id", "name", "artist", "tags", "tags_text"}
    required_lastfm = {"track_name", "artist", "tags"}
    _require_columns(music, required_music, "music")
    _require_columns(lastfm, required_lastfm, "lastfm")

    music_for_match = music.copy()
    lastfm_for_match = _normalize_lastfm320k(lastfm)

    music_for_match["match_artist"] = music_for_match["artist"].map(normalize_match_text)
    music_for_match["match_title"] = music_for_match["name"].map(normalize_match_text)
    music_for_match["match_key"] = make_track_match_key(
        music_for_match["artist"],
        music_for_match["name"],
    )

    main_valid = music_for_match[_has_match_key(music_for_match)].copy()
    lastfm_valid = lastfm_for_match[_has_match_key(lastfm_for_match)].copy()
    lastfm_dedup = (
        lastfm_valid.sort_values(["lastfm_tag_count", "lastfm_avg_rank"], ascending=[False, True])
        .drop_duplicates("match_key", keep="first")
        .reset_index(drop=True)
    )

    merged = main_valid.merge(
        lastfm_dedup[
            [
                "match_key",
                "lastfm_track_name",
                "lastfm_artist",
                "lastfm_tags",
                "lastfm_parsed_tags",
                "lastfm_tag_count",
                "lastfm_avg_rank",
            ]
        ],
        on="match_key",
        how="left",
    )
    matched = merged[merged["lastfm_track_name"].notna()].copy()

    main_vocab = {tag for tags in music_for_match["tags"] for tag in tags}
    matched_lastfm_vocab = {tag for tags in matched["lastfm_parsed_tags"] for tag in tags}
    new_vocab = sorted(matched_lastfm_vocab - main_vocab)

    main_count = len(music_for_match)
    valid_count = len(main_valid)
    matched_count = len(matched)
    stats: dict[str, object] = {
        "main_tracks": main_count,
        "main_valid_keys": valid_count,
        "main_unique_keys": int(main_valid["match_key"].nunique()),
        "lastfm_rows": len(lastfm_for_match),
        "lastfm_valid_rows": len(lastfm_valid),
        "lastfm_unique_keys": int(lastfm_valid["match_key"].nunique()),
        "matched_tracks": matched_count,
        "coverage_pct_of_main": _pct(matched_count, main_count),
        "coverage_pct_of_valid": _pct(matched_count, valid_count),
        "main_tag_vocab_size": len(main_vocab),
        "matched_lastfm_tag_vocab_size": len(matched_lastfm_vocab),
        "new_tag_vocab_from_matched": len(new_vocab),
    }

    return LastfmCoverageResult(
        stats=stats,
        merged=merged,
        matched=matched,
        new_tag_examples=new_vocab[:40],
    )


def fuse_lastfm320k_tags(
    music: pd.DataFrame,
    lastfm: pd.DataFrame,
    filter_noisy_tags: bool = True,
    filter_profile: str = "broad",
) -> LastfmFusionResult:
    """Add matched Last.fm 320K tags to a normalized music catalog."""
    coverage = compute_lastfm320k_coverage(music=music, lastfm=lastfm)
    matched_tags = coverage.matched.set_index("match_key")["lastfm_parsed_tags"].to_dict()

    fused = music.copy()
    fused["catalog_tags"] = fused["tags"].map(lambda tags: list(tags))
    fused["match_key"] = make_track_match_key(fused["artist"], fused["name"])
    fused["lastfm320k_tags"] = fused["match_key"].map(matched_tags)
    fused["lastfm320k_tags"] = fused["lastfm320k_tags"].map(
        lambda tags: clean_lastfm_tags(
            tags,
            filter_noisy_tags=filter_noisy_tags,
            filter_profile=filter_profile,
        )
    )

    original_counts = fused["tags"].map(len)
    fused["tags"] = [
        _dedupe_tags([*original_tags, *lastfm_tags])
        for original_tags, lastfm_tags in zip(fused["tags"], fused["lastfm320k_tags"], strict=True)
    ]
    fused["tags_text"] = fused["tags"].map(expand_tags_text)

    added_counts = fused["tags"].map(len) - original_counts
    tracks_with_added_tags = int((added_counts > 0).sum())
    stats: dict[str, float | int] = {
        "lastfm320k_matched_tracks": int(coverage.stats["matched_tracks"]),
        "lastfm320k_coverage_pct_of_main": coverage.stats["coverage_pct_of_main"],
        "lastfm320k_coverage_pct_of_valid": coverage.stats["coverage_pct_of_valid"],
        "lastfm320k_tracks_with_added_tags": tracks_with_added_tags,
        "lastfm320k_added_tag_assignments": int(added_counts.sum()),
        "lastfm320k_filter_noisy_tags": int(filter_noisy_tags),
        "lastfm320k_filter_profile": filter_profile,
    }

    return LastfmFusionResult(music=fused, coverage=coverage, stats=stats)


def clean_lastfm_tags(
    tags: object,
    filter_noisy_tags: bool = True,
    filter_profile: str = "broad",
) -> list[str]:
    parsed = parse_tags(tags)
    if filter_noisy_tags:
        parsed = [
            tag
            for tag in parsed
            if not is_noisy_lastfm_tag(tag)
            and (filter_profile != "ai" or is_ai_relevant_lastfm_tag(tag))
        ]
    return _dedupe_tags(parsed)


def is_noisy_lastfm_tag(tag: object) -> bool:
    text = str(tag).strip().lower()
    if not text:
        return True
    return any(pattern.match(text) for pattern in NOISY_LASTFM_TAG_PATTERNS)


def is_ai_relevant_lastfm_tag(tag: object) -> bool:
    text = str(tag).strip().lower()
    if not text:
        return False
    return text not in LOW_AI_RELEVANCE_LASTFM_TAGS


def normalize_match_text(value: object) -> str:
    text = "" if pd.isna(value) else str(value)
    text = unicodedata.normalize("NFKD", text)
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = text.lower()
    text = re.sub(r"\b(feat|ft|featuring)\.?\b.*$", "", text)
    text = re.sub(r"\([^)]*\)|\[[^]]*\]", " ", text)
    text = text.replace("&", " and ")
    text = re.sub(r"[^a-z0-9]+", " ", text)
    text = re.sub(r"\b(the|a|an)\b", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def make_track_match_key(artist: pd.Series | object, title: pd.Series | object) -> pd.Series | str:
    if isinstance(artist, pd.Series) and isinstance(title, pd.Series):
        artists = artist.map(normalize_match_text)
        titles = title.map(normalize_match_text)
        return artists + " || " + titles
    return f"{normalize_match_text(artist)} || {normalize_match_text(title)}"


def write_lastfm320k_match_outputs(
    result: LastfmCoverageResult,
    report_path: Path,
    sample_path: Path | None = None,
    sample_size: int = 20,
) -> None:
    report_path.parent.mkdir(parents=True, exist_ok=True)
    result.merged[_report_columns(result.merged)].to_csv(report_path, index=False)

    if sample_path is not None:
        sample_path.parent.mkdir(parents=True, exist_ok=True)
        result.matched[_sample_columns(result.matched)].head(sample_size).to_csv(sample_path, index=False)


def _normalize_lastfm320k(lastfm: pd.DataFrame) -> pd.DataFrame:
    frame = pd.DataFrame()
    frame["lastfm_track_name"] = lastfm["track_name"].fillna("").astype(str).str.strip()
    frame["lastfm_artist"] = lastfm["artist"].fillna("").astype(str).str.strip()
    frame["lastfm_tags"] = lastfm["tags"].fillna("").astype(str)
    frame["lastfm_parsed_tags"] = frame["lastfm_tags"].map(parse_tags)

    if "tag_count" in lastfm:
        frame["lastfm_tag_count"] = pd.to_numeric(lastfm["tag_count"], errors="coerce").fillna(0)
    else:
        frame["lastfm_tag_count"] = frame["lastfm_parsed_tags"].map(len)

    if "avg_rank" in lastfm:
        frame["lastfm_avg_rank"] = pd.to_numeric(lastfm["avg_rank"], errors="coerce").fillna(float("inf"))
    else:
        frame["lastfm_avg_rank"] = float("inf")

    frame["match_artist"] = frame["lastfm_artist"].map(normalize_match_text)
    frame["match_title"] = frame["lastfm_track_name"].map(normalize_match_text)
    frame["match_key"] = frame["match_artist"] + " || " + frame["match_title"]
    return frame


def _has_match_key(frame: pd.DataFrame) -> pd.Series:
    return frame["match_artist"].str.len().gt(0) & frame["match_title"].str.len().gt(0)


def _pct(numerator: int, denominator: int) -> float:
    if denominator == 0:
        return 0.0
    return round(numerator / denominator * 100, 2)


def _require_columns(frame: pd.DataFrame, columns: set[str], name: str) -> None:
    missing = sorted(columns - set(frame.columns))
    if missing:
        raise ValueError(f"{name} is missing columns: {missing}")


def _report_columns(frame: pd.DataFrame) -> list[str]:
    preferred = [
        "track_id",
        "name",
        "artist",
        "genre",
        "tags_text",
        "lastfm_track_name",
        "lastfm_artist",
        "lastfm_tags",
        "lastfm_tag_count",
        "lastfm_avg_rank",
        "match_key",
    ]
    return [column for column in preferred if column in frame.columns]


def _sample_columns(frame: pd.DataFrame) -> list[str]:
    preferred = [
        "track_id",
        "name",
        "artist",
        "genre",
        "tags_text",
        "lastfm_tags",
        "lastfm_tag_count",
        "lastfm_avg_rank",
    ]
    return [column for column in preferred if column in frame.columns]


def _dedupe_tags(tags: list[str]) -> list[str]:
    return [tag for tag in dict.fromkeys(tags) if tag]


LOW_AI_RELEVANCE_LASTFM_TAGS = {
    "american",
    "australian",
    "belgian",
    "british",
    "canadian",
    "danish",
    "dutch",
    "finnish",
    "french",
    "german",
    "icelandic",
    "irish",
    "italian",
    "japanese",
    "norwegian",
    "polish",
    "russian",
    "scottish",
    "sex",
    "spanish",
    "swedish",
}
