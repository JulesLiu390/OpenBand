from pathlib import Path

from fastapi.testclient import TestClient

from music_taste_rec.api import create_app
from music_taste_rec.style_model import StyleTrainingConfig, train_style_model


FIXTURE_ROOT = Path(__file__).parent / "fixtures"
FIXTURE_RAW = FIXTURE_ROOT / "raw"


def test_api_profiles_scores_and_ranks_songs(tmp_path: Path) -> None:
    model_path = tmp_path / "style_model.joblib"
    model = train_style_model(
        StyleTrainingConfig(
            raw_dir=FIXTURE_RAW,
            model_path=model_path,
            min_tag_tracks=1,
            max_tags=50,
            n_components=3,
        )
    )
    model.save(model_path)
    client = TestClient(create_app(model_path=model_path))

    health = client.get("/health")
    assert health.status_code == 200
    assert health.json()["tags"] == len(model.tags)

    profile = client.post(
        "/v1/profile",
        json={"user_tags": "ambient; piano; sleep", "top_n": 5},
    )
    assert profile.status_code == 200
    assert "ambient" in profile.json()["known_user_tags"]
    assert len(profile.json()["expanded_tags"]) == 5

    score = client.post(
        "/v1/score",
        json={
            "user_tags": "ambient; piano; sleep",
            "song_tags": "ambient; piano",
        },
    )
    assert score.status_code == 200
    assert score.json()["score"] > 0

    ranking = client.post(
        "/v1/rank",
        json={
            "user_tags": "ambient; piano; sleep",
            "songs": [
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
            ],
            "top_n": 2,
        },
    )
    assert ranking.status_code == 200
    assert ranking.json()["ranked_songs"][0]["track_id"] == "ai_ambient"
