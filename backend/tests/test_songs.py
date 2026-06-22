from pathlib import Path

from fastapi.testclient import TestClient

from music_taste_rec.api import create_app


ADMIN_KEY = "admin-test-key"


def _login_headers(client: TestClient) -> dict[str, str]:
    invite = client.post(
        "/v1/auth/invite-keys",
        headers={"X-Admin-Key": ADMIN_KEY},
        json={"label": "Song Tester"},
    )
    assert invite.status_code == 200
    login = client.post(
        "/v1/auth/login",
        json={"key": invite.json()["key"], "device_name": "pytest"},
    )
    assert login.status_code == 200
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


def test_song_upload_list_and_audio_download(tmp_path: Path) -> None:
    client = TestClient(
        create_app(
            model_path=tmp_path / "missing-model.joblib",
            auth_db_path=tmp_path / "openband.sqlite3",
            song_storage_root=tmp_path / "songs",
            admin_key=ADMIN_KEY,
        )
    )
    headers = _login_headers(client)

    unauthorized = client.get("/v1/songs")
    assert unauthorized.status_code == 401

    forbidden_upload = client.post(
        "/v1/songs",
        data={"title": "Lake Light"},
        files={"file": ("lake-light.mp3", b"ID3\x04\x00\x00fake-mp3", "audio/mpeg")},
    )
    assert forbidden_upload.status_code == 403

    upload = client.post(
        "/v1/songs",
        headers={"X-Admin-Key": ADMIN_KEY},
        data={
            "title": "Lake Light",
            "artist": "Suno Sketch",
            "album": "Midnight Sketches",
            "tags": "ambient; piano; sleep",
            "duration_seconds": "138",
            "source": "suno",
        },
        files={"file": ("lake-light.mp3", b"ID3\x04\x00\x00fake-mp3", "audio/mpeg")},
    )
    assert upload.status_code == 200
    song = upload.json()
    assert song["id"].startswith("song_")
    assert song["title"] == "Lake Light"
    assert song["artist"] == "Suno Sketch"
    assert song["duration_seconds"] == 138
    assert song["tags"] == ["ambient", "piano", "sleep"]
    assert song["file_size"] == len(b"ID3\x04\x00\x00fake-mp3")
    assert song["audio_url"].endswith(f"/{song['id']}/audio")

    songs = client.get("/v1/songs", headers=headers)
    assert songs.status_code == 200
    songs_body = songs.json()
    assert songs_body["total"] == 1
    assert songs_body["songs"][0]["id"] == song["id"]

    filtered = client.get("/v1/songs?tag=ambient", headers=headers)
    assert filtered.status_code == 200
    assert filtered.json()["total"] == 1

    missing_filter = client.get("/v1/songs?tag=metal", headers=headers)
    assert missing_filter.status_code == 200
    assert missing_filter.json()["total"] == 0

    daily = client.get("/v1/songs/daily", headers=headers)
    assert daily.status_code == 200
    assert daily.json()["songs"][0]["id"] == song["id"]

    audio = client.get(song["audio_url"], headers=headers)
    assert audio.status_code == 200
    assert audio.content == b"ID3\x04\x00\x00fake-mp3"
    assert audio.headers["etag"] == song["file_sha256"]
    assert audio.headers["content-type"].startswith("audio/mpeg")
