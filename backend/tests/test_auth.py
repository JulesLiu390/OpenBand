from pathlib import Path

from fastapi.testclient import TestClient

from music_taste_rec.api import create_app


ADMIN_KEY = "admin-test-key"


def test_invite_login_refresh_and_music_tag_preferences(tmp_path: Path) -> None:
    client = TestClient(
        create_app(
            model_path=tmp_path / "missing-model.joblib",
            auth_db_path=tmp_path / "auth.sqlite3",
            admin_key=ADMIN_KEY,
        )
    )

    forbidden = client.post("/v1/auth/invite-keys", json={"label": "Alice"})
    assert forbidden.status_code == 403

    invite = client.post(
        "/v1/auth/invite-keys",
        headers={"X-Admin-Key": ADMIN_KEY},
        json={"label": "Alice", "note": "friends-only beta"},
    )
    assert invite.status_code == 200
    invite_body = invite.json()
    assert invite_body["label"] == "Alice"
    assert invite_body["key"].startswith("ob_key_")
    assert invite_body["key"] in invite_body["qr_payload"]
    assert invite_body["qr_svg"].startswith("<?xml")
    assert "<svg" in invite_body["qr_svg"]

    login = client.post(
        "/v1/auth/login",
        json={"key": invite_body["key"], "device_name": "iPhone"},
    )
    assert login.status_code == 200
    token_body = login.json()
    assert token_body["access_token"].startswith("ob_at_")
    assert token_body["refresh_token"].startswith("ob_rt_")
    assert token_body["token_type"] == "bearer"
    assert token_body["user"]["label"] == "Alice"

    reused = client.post(
        "/v1/auth/login",
        json={"key": invite_body["key"], "device_name": "Android"},
    )
    assert reused.status_code == 401

    headers = {"Authorization": f"Bearer {token_body['access_token']}"}
    me = client.get("/v1/me", headers=headers)
    assert me.status_code == 200
    assert me.json()["user"]["label"] == "Alice"

    updated_tags = client.put(
        "/v1/me/music-tags",
        headers=headers,
        json={"tags": ["Dream Pop", "synth", "dream_pop", "", "Synth"]},
    )
    assert updated_tags.status_code == 200
    assert updated_tags.json()["tags"] == ["dream pop", "synth"]

    fetched_tags = client.get("/v1/me/music-tags", headers=headers)
    assert fetched_tags.status_code == 200
    assert fetched_tags.json()["tags"] == ["dream pop", "synth"]
    assert fetched_tags.json()["updated_at"]

    refresh = client.post(
        "/v1/auth/refresh",
        json={"refresh_token": token_body["refresh_token"]},
    )
    assert refresh.status_code == 200
    refreshed_body = refresh.json()
    assert refreshed_body["access_token"] != token_body["access_token"]
    assert refreshed_body["refresh_token"] != token_body["refresh_token"]

    old_refresh = client.post(
        "/v1/auth/refresh",
        json={"refresh_token": token_body["refresh_token"]},
    )
    assert old_refresh.status_code == 401

    logout = client.post(
        "/v1/me/logout",
        headers={"Authorization": f"Bearer {refreshed_body['access_token']}"},
        json={"refresh_token": refreshed_body["refresh_token"]},
    )
    assert logout.status_code == 200

    revoked_refresh = client.post(
        "/v1/auth/refresh",
        json={"refresh_token": refreshed_body["refresh_token"]},
    )
    assert revoked_refresh.status_code == 401
