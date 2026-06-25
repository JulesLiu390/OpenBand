from pathlib import Path

from fastapi.testclient import TestClient

from music_taste_rec.api import create_app
from music_taste_rec.style_model import StyleTrainingConfig, train_style_model


FIXTURE_ROOT = Path(__file__).parent / "fixtures"
FIXTURE_RAW = FIXTURE_ROOT / "raw"
ADMIN_KEY = "admin-test-key"


def _auth_headers(client: TestClient) -> dict[str, str]:
    invite = client.post(
        "/v1/auth/invite-keys",
        headers={"X-Admin-Key": ADMIN_KEY},
        json={"label": "Test Friend"},
    )
    assert invite.status_code == 200
    login = client.post(
        "/v1/auth/login",
        json={"key": invite.json()["key"], "device_name": "pytest"},
    )
    assert login.status_code == 200
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


def test_api_profiles_scores_and_ranks_songs(tmp_path: Path, monkeypatch) -> None:
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
    client = TestClient(
        create_app(
            model_path=model_path,
            auth_db_path=tmp_path / "auth.sqlite3",
            admin_key=ADMIN_KEY,
        )
    )
    headers = _auth_headers(client)

    health = client.get("/health")
    assert health.status_code == 200
    assert health.json()["tags"] == len(model.tags)

    unauthenticated = client.post(
        "/v1/profile",
        json={"user_tags": "ambient; piano; sleep", "top_n": 5},
    )
    assert unauthenticated.status_code == 401

    profile = client.post(
        "/v1/profile",
        headers=headers,
        json={"user_tags": "ambient; piano; sleep", "top_n": 5},
    )
    assert profile.status_code == 200
    assert "ambient" in profile.json()["known_user_tags"]
    assert len(profile.json()["expanded_tags"]) == 5

    score = client.post(
        "/v1/score",
        headers=headers,
        json={
            "user_tags": "ambient; piano; sleep",
            "song_tags": "ambient; piano",
        },
    )
    assert score.status_code == 200
    assert score.json()["score"] > 0

    ranking = client.post(
        "/v1/rank",
        headers=headers,
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

    from openband.prompt_generation.profile_service import GeneratedMusicProfile

    def fake_generate_music_profile(**kwargs) -> GeneratedMusicProfile:
        assert "Cowboy Bebop" in kwargs["input_text"]
        return GeneratedMusicProfile(
            input_text=kwargs["input_text"],
            reference_summary="用户喜欢氛围钢琴和爵士原声。",
            source_notes="Cowboy Bebop -> jazz soundtrack.",
            tags=["ambient", "piano", "jazz"],
            raw_tags=["ambient", "piano", "jazz"],
            known_tags=["ambient", "piano", "jazz"],
            corrected_tags=[],
            unknown_tags=[],
            tag_meanings=[
                {"tag": "ambient", "meaning": "Creates a spacious, atmospheric mood."},
                {"tag": "piano", "meaning": "Centers the arrangement on piano tone."},
                {"tag": "jazz", "meaning": "Adds jazz harmony, groove, or instrumentation."},
            ],
            profile_output_text="TAGS:\nambient, piano, jazz",
        )

    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.setattr("music_taste_rec.api.generate_music_profile", fake_generate_music_profile)

    seeded = client.post(
        "/v1/me/music-tags/profile",
        headers=headers,
        json={
            "favorite_bands": "ambient piano",
            "favorite_anime": "Cowboy Bebop",
        },
    )
    assert seeded.status_code == 200
    seeded_body = seeded.json()
    assert "ambient" in seeded_body["tags"]
    assert "piano" in seeded_body["tags"]
    assert seeded_body["tag_meanings"][0] == {
        "tag": "ambient",
        "meaning": "Creates a spacious, atmospheric mood.",
    }
    assert seeded_body["updated_at"]

    fetched_tags = client.get("/v1/me/music-tags", headers=headers)
    assert fetched_tags.status_code == 200
    assert fetched_tags.json()["tags"] == seeded_body["tags"]
