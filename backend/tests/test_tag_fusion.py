import pandas as pd

from music_taste_rec.tag_fusion import (
    clean_lastfm_tags,
    compute_lastfm320k_coverage,
    fuse_lastfm320k_tags,
    make_track_match_key,
)


def test_track_match_key_normalizes_common_catalog_differences() -> None:
    assert make_track_match_key("Beyoncé feat. Jay-Z", "The Midnight Light (Live)") == (
        "beyonce || midnight light"
    )


def test_lastfm320k_coverage_matches_by_normalized_artist_and_title() -> None:
    music = pd.DataFrame(
        [
            {
                "track_id": "t1",
                "name": "The Midnight Light (Live)",
                "artist": "Beyoncé feat. Jay-Z",
                "genre": "Pop",
                "tags": ["pop"],
                "tags_text": "pop",
            },
            {
                "track_id": "t2",
                "name": "Static Teeth",
                "artist": "Null Band",
                "genre": "Rock",
                "tags": ["rock"],
                "tags_text": "rock",
            },
        ]
    )
    lastfm = pd.DataFrame(
        [
            {
                "track_name": "Midnight Light",
                "artist": "Beyonce",
                "tags": "r&b|female vocalists|pop",
                "tag_count": 3,
                "avg_rank": 1.2,
            },
            {
                "track_name": "Midnight Light",
                "artist": "Beyonce",
                "tags": "low quality duplicate",
                "tag_count": 1,
                "avg_rank": 9.0,
            },
        ]
    )

    result = compute_lastfm320k_coverage(music=music, lastfm=lastfm)

    assert result.stats["matched_tracks"] == 1
    assert result.stats["coverage_pct_of_main"] == 50.0
    assert result.stats["new_tag_vocab_from_matched"] == 2
    assert result.matched.iloc[0]["lastfm_tags"] == "r&b|female vocalists|pop"


def test_fuse_lastfm320k_tags_adds_style_tags_and_filters_noise() -> None:
    music = pd.DataFrame(
        [
            {
                "track_id": "t1",
                "name": "Midnight Light",
                "artist": "Beyonce",
                "genre": "Pop",
                "tags": ["pop"],
                "tags_text": "pop",
            }
        ]
    )
    lastfm = pd.DataFrame(
        [
            {
                "track_name": "Midnight Light",
                "artist": "Beyonce",
                "tags": "r&b|female vocalists|2008|8 of 10 stars|<3|title is a full sentence",
                "tag_count": 5,
                "avg_rank": 1.0,
            }
        ]
    )

    result = fuse_lastfm320k_tags(music=music, lastfm=lastfm)

    assert result.music.iloc[0]["tags"] == ["pop", "r&b", "female vocalists"]
    assert result.stats["lastfm320k_tracks_with_added_tags"] == 1
    assert result.stats["lastfm320k_added_tag_assignments"] == 2


def test_ai_filter_profile_removes_low_ai_relevance_tags() -> None:
    tags = clean_lastfm_tags("shoegaze|dream pop|british|sex|2008", filter_profile="ai")

    assert tags == ["shoegaze", "dream pop"]
