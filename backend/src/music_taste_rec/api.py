from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from openband.auth import (
    DEFAULT_AUTH_DB_PATH,
    AuthStore,
    AuthUser,
    create_auth_router,
    create_me_router,
    current_user_dependency,
)
from openband.songs import (
    DEFAULT_SONG_STORAGE_ROOT,
    SONG_STORAGE_ROOT_ENV,
    SongStore,
    create_song_router,
)
from pydantic import BaseModel, Field

from music_taste_rec.style_model import StyleAssociationModel, parse_style_tags


DEFAULT_MODEL_PATH = Path("models/style_model.joblib")
MODEL_PATH_ENV = "MUSIC_REC_MODEL_PATH"
AUTH_DB_PATH_ENV = "OPENBAND_AUTH_DB_PATH"
ADMIN_KEY_ENV = "OPENBAND_ADMIN_KEY"


class SongInput(BaseModel):
    track_id: str
    name: str = ""
    artist: str = "AI"
    genre: str = ""
    tags: str | list[str] = Field(default_factory=list)


class ProfileRequest(BaseModel):
    user_tags: str | list[str] = Field(default_factory=list)
    liked_songs: list[SongInput] = Field(default_factory=list)
    top_n: int = Field(default=20, ge=1, le=100)
    min_user_count: int = Field(default=0, ge=0)


class ScoreRequest(BaseModel):
    user_tags: str | list[str] = Field(default_factory=list)
    song_tags: str | list[str] = Field(default_factory=list)


class RankRequest(BaseModel):
    user_tags: str | list[str] = Field(default_factory=list)
    songs: list[SongInput] = Field(min_length=1)
    top_n: int = Field(default=20, ge=1, le=500)


def create_app(
    model_path: Path | None = None,
    auth_db_path: Path | None = None,
    song_storage_root: Path | None = None,
    admin_key: str | None = None,
    require_auth: bool = True,
) -> FastAPI:
    app = FastAPI(
        title="Music Taste Recommendation API",
        version="0.1.0",
        description="Style/tag profile and recommendation API for AI music catalogs.",
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.state.model_path = Path(model_path or os.getenv(MODEL_PATH_ENV, DEFAULT_MODEL_PATH))
    configured_auth_db_path = Path(auth_db_path or os.getenv(AUTH_DB_PATH_ENV, DEFAULT_AUTH_DB_PATH))
    app.state.auth_store = AuthStore(configured_auth_db_path)
    app.state.song_store = SongStore(
        db_path=configured_auth_db_path,
        storage_root=Path(song_storage_root or os.getenv(SONG_STORAGE_ROOT_ENV, DEFAULT_SONG_STORAGE_ROOT)),
    )
    app.state.auth_db_path = app.state.auth_store.db_path
    configured_admin_key = admin_key if admin_key is not None else os.getenv(ADMIN_KEY_ENV)
    app.include_router(create_auth_router(app.state.auth_store, configured_admin_key))
    app.include_router(create_me_router(app.state.auth_store))
    app.include_router(
        create_song_router(
            store=app.state.song_store,
            auth_store=app.state.auth_store,
            admin_key=configured_admin_key,
            require_auth=require_auth,
        )
    )
    current_user = (
        current_user_dependency(app.state.auth_store)
        if require_auth
        else _anonymous_user
    )

    def load_model_for_app() -> StyleAssociationModel:
        return _load_model(app.state.model_path)

    @app.get("/health")
    def health(model: StyleAssociationModel = Depends(load_model_for_app)) -> dict[str, Any]:
        return {
            "status": "ok",
            "model_path": str(app.state.model_path),
            "tags": len(model.tags),
            "embedding_dimensions": int(model.tag_embeddings.shape[1]),
            "model_config": model.config,
        }

    @app.get("/v1/tags/{tag}/similar")
    def similar_tags(
        tag: str,
        top_n: int = Query(default=20, ge=1, le=100),
        min_user_count: int = Query(default=0, ge=0),
        _user: AuthUser | None = Depends(current_user),
        model: StyleAssociationModel = Depends(load_model_for_app),
    ) -> dict[str, Any]:
        try:
            related = model.similar_tags(tag, top_n=top_n, min_user_count=min_user_count)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        return {"tag": tag, "similar_tags": _records(related)}

    @app.post("/v1/profile")
    def profile(
        request: ProfileRequest,
        _user: AuthUser | None = Depends(current_user),
        model: StyleAssociationModel = Depends(load_model_for_app),
    ) -> dict[str, Any]:
        tags = _profile_tags(request)
        known = model.known_tags(tags)
        unknown = model.unknown_tags(tags)
        if not known:
            raise HTTPException(status_code=422, detail="No known user tags in request.")
        expanded = model.expand_tags(
            known,
            top_n=request.top_n,
            min_user_count=request.min_user_count,
        )
        vector = model.embed_tags(known)
        return {
            "known_user_tags": known,
            "unknown_user_tags": unknown,
            "expanded_tags": _records(expanded),
            "embedding_dimensions": int(vector.shape[0]),
        }

    @app.post("/v1/score")
    def score(
        request: ScoreRequest,
        _user: AuthUser | None = Depends(current_user),
        model: StyleAssociationModel = Depends(load_model_for_app),
    ) -> dict[str, Any]:
        result = model.score_tags(user_tags=request.user_tags, song_tags=request.song_tags)
        return _jsonable(result)

    @app.post("/v1/rank")
    def rank(
        request: RankRequest,
        _user: AuthUser | None = Depends(current_user),
        model: StyleAssociationModel = Depends(load_model_for_app),
    ) -> dict[str, Any]:
        if not request.songs:
            raise HTTPException(status_code=422, detail="songs must not be empty.")
        songs = _songs_frame(request.songs)
        try:
            ranked = model.rank_songs(songs=songs, user_tags=request.user_tags, top_n=request.top_n)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        return {
            "ranked_songs": _records(ranked),
            "known_user_tags": model.known_tags(request.user_tags),
            "unknown_user_tags": model.unknown_tags(request.user_tags),
        }

    return app


def get_model() -> StyleAssociationModel:
    model_path = Path(os.getenv(MODEL_PATH_ENV, DEFAULT_MODEL_PATH))
    return _load_model(model_path)


def _anonymous_user() -> None:
    return None


@lru_cache(maxsize=8)
def _load_model(model_path: Path) -> StyleAssociationModel:
    if not model_path.exists():
        raise HTTPException(status_code=503, detail=f"Model not found: {model_path}")
    return StyleAssociationModel.load(model_path)


def _profile_tags(request: ProfileRequest) -> list[str]:
    tags = parse_style_tags(request.user_tags)
    for song in request.liked_songs:
        tags.extend(parse_style_tags(song.tags))
        if song.genre:
            tags.extend(parse_style_tags(song.genre))
    return list(dict.fromkeys(tags))


def _songs_frame(songs: list[SongInput]) -> pd.DataFrame:
    return pd.DataFrame([song.model_dump() for song in songs])


def _records(frame: pd.DataFrame) -> list[dict[str, Any]]:
    return [_jsonable(row) for row in frame.to_dict(orient="records")]


def _jsonable(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: _jsonable(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_jsonable(item) for item in value]
    if isinstance(value, np.generic):
        return value.item()
    if isinstance(value, float) and np.isnan(value):
        return None
    return value


app = create_app()
