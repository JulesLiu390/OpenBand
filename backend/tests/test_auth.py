import sqlite3
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from fastapi.testclient import TestClient

from music_taste_rec.api import create_app


ADMIN_KEY = "admin-test-key"


def test_invite_login_refresh_and_music_tag_preferences(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("OPENBAND_PUBLIC_BASE_URL", "http://testserver")
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
    invite_qs = parse_qs(urlparse(invite_body["qr_payload"]).query)
    assert invite_qs["key"] == [invite_body["key"]]
    assert invite_qs["base_url"] == ["http://testserver"]
    assert invite_body["qr_svg"].startswith("<?xml")
    assert "<svg" in invite_body["qr_svg"]

    invalid_base_url = client.post(
        "/v1/auth/invite-keys",
        headers={"X-Admin-Key": ADMIN_KEY},
        json={"label": "Bad Base URL", "base_url": "openband://login"},
    )
    assert invalid_base_url.status_code == 422

    invite_with_base_url = client.post(
        "/v1/auth/invite-keys",
        headers={"X-Admin-Key": ADMIN_KEY},
        json={
            "label": "Android Tester",
            "base_url": "http://192.168.2.151:8000/",
        },
    )
    assert invite_with_base_url.status_code == 200
    invite_with_base_url_body = invite_with_base_url.json()
    assert "base_url=http%3A%2F%2F192.168.2.151%3A8000" in invite_with_base_url_body["qr_payload"]

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

    bound_invite = client.post(
        "/v1/auth/invite-keys",
        headers={"X-Admin-Key": ADMIN_KEY},
        json={"label": "Alice Recovery", "note": "existing-user recovery"},
    )
    assert bound_invite.status_code == 200
    bound_invite_body = bound_invite.json()
    with sqlite3.connect(tmp_path / "auth.sqlite3") as conn:
        conn.execute(
            "UPDATE invite_keys SET claimed_by_user_id = ? WHERE id = ?",
            (token_body["user"]["id"], bound_invite_body["id"]),
        )
    bound_login = client.post(
        "/v1/auth/login",
        json={"key": bound_invite_body["key"], "device_name": "Recovered Device"},
    )
    assert bound_login.status_code == 200
    assert bound_login.json()["user"]["id"] == token_body["user"]["id"]
    with sqlite3.connect(tmp_path / "auth.sqlite3") as conn:
        assert conn.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 1

    reused = client.post(
        "/v1/auth/login",
        json={"key": invite_body["key"], "device_name": "Android"},
    )
    assert reused.status_code == 401

    headers = {"Authorization": f"Bearer {token_body['access_token']}"}
    me = client.get("/v1/me", headers=headers)
    assert me.status_code == 200
    assert me.json()["user"]["label"] == "Alice"

    renamed = client.patch("/v1/me", headers=headers, json={"label": "Alice Beats"})
    assert renamed.status_code == 200
    assert renamed.json()["user"]["id"] == token_body["user"]["id"]
    assert renamed.json()["user"]["label"] == "Alice Beats"

    renamed_me = client.get("/v1/me", headers=headers)
    assert renamed_me.status_code == 200
    assert renamed_me.json()["user"]["label"] == "Alice Beats"

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
    assert refreshed_body["user"]["label"] == "Alice Beats"

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
