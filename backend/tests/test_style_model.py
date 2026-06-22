from pathlib import Path

import pandas as pd

from music_taste_rec.style_model import StyleTrainingConfig, build_track_tag_weights, train_style_model


FIXTURE_ROOT = Path(__file__).parent / "fixtures"
FIXTURE_RAW = FIXTURE_ROOT / "raw"


def test_style_model_scores_matching_tags_higher() -> None:
    model = train_style_model(
        StyleTrainingConfig(
            raw_dir=FIXTURE_RAW,
            min_tag_tracks=1,
            max_tags=50,
            n_components=3,
        )
    )

    good = model.score_tags("ambient; piano; sleep", "ambient; piano")
    bad = model.score_tags("ambient; piano; sleep", "rock; punk; guitar")

    assert good["score"] > bad["score"]
    assert "ambient" in good["known_user_tags"]


def test_style_model_expands_related_tags() -> None:
    model = train_style_model(
        StyleTrainingConfig(
            raw_dir=FIXTURE_RAW,
            min_tag_tracks=1,
            max_tags=50,
            n_components=3,
        )
    )

    related = model.expand_tags("rock; guitar", top_n=5)

    assert len(related) == 5
    assert "tag" in related.columns


def test_style_model_ranks_ai_songs_by_user_taste() -> None:
    model = train_style_model(
        StyleTrainingConfig(
            raw_dir=FIXTURE_RAW,
            min_tag_tracks=1,
            max_tags=50,
            n_components=3,
        )
    )
    songs = pd.DataFrame(
        [
            {
                "track_id": "ai_ambient",
                "name": "Lake Light",
                "artist": "AI",
                "genre": "Ambient",
                "tags": "ambient; piano; sleep",
            },
            {
                "track_id": "ai_rock",
                "name": "Static Teeth",
                "artist": "AI",
                "genre": "Rock",
                "tags": "rock; punk; guitar",
            },
        ]
    )

    ranked = model.rank_songs(songs, user_tags="ambient; piano; sleep", top_n=2)

    assert ranked.iloc[0]["track_id"] == "ai_ambient"


def test_track_tag_weights_preserve_tag_sources() -> None:
    music = pd.DataFrame(
        [
            {
                "track_id": "t1",
                "tags": ["rock"],
                "catalog_tags": ["rock"],
                "lastfm320k_tags": ["shoegaze"],
                "genre": "Rock",
            }
        ]
    )

    weights = build_track_tag_weights(
        music,
        catalog_tag_weight=1.0,
        genre_tag_weight=0.8,
        lastfm_tag_weight=0.35,
    )

    assert weights["t1"]["rock"] == 1.0
    assert weights["t1"]["shoegaze"] == 0.35
