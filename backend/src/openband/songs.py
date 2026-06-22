from __future__ import annotations

import hashlib
import secrets
import shutil
import sqlite3
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from music_taste_rec.style_model import parse_style_tags
from openband.auth import AuthUser, current_user_dependency


DEFAULT_SONG_STORAGE_ROOT = Path("storage/songs")
SONG_STORAGE_ROOT_ENV = "OPENBAND_SONG_STORAGE_ROOT"
MP3_CHUNK_SIZE = 1024 * 1024


@dataclass(frozen=True)
class StoredSong:
    id: str
    title: str
    artist: str
    album: str
    duration_seconds: int | None
    source: str
    original_filename: str
    file_path: str
    file_size: int
    file_sha256: str
    mime_type: str
    created_at: str
    updated_at: str
    tags: list[str]


class SongResponse(BaseModel):
    id: str
    title: str
    artist: str
    album: str
    duration_seconds: int | None
    source: str
    original_filename: str
    file_size: int
    file_sha256: str
    mime_type: str
    tags: list[str]
    audio_url: str
    download_url: str
    created_at: str
    updated_at: str


class SongListResponse(BaseModel):
    songs: list[SongResponse]
    limit: int
    offset: int
    total: int


class SongStore:
    def __init__(self, db_path: Path, storage_root: Path = DEFAULT_SONG_STORAGE_ROOT):
        self.db_path = Path(db_path)
        self.storage_root = Path(storage_root)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.storage_root.mkdir(parents=True, exist_ok=True)
        self._initialize()

    async def create_song_from_upload(
        self,
        *,
        upload: UploadFile,
        title: str,
        artist: str = "AI",
        album: str = "",
        tags: str | list[str] = "",
        duration_seconds: int | None = None,
        source: str = "manual",
    ) -> StoredSong:
        filename = Path(upload.filename or "song.mp3").name
        if filename.lower().endswith(".mp3") is False:
            raise ValueError("Only .mp3 files are supported.")

        song_id = f"song_{secrets.token_urlsafe(12).replace('-', '').replace('_', '')}"
        temp_path = self.storage_root / f"{song_id}.uploading"
        final_path = self.storage_root / f"{song_id}.mp3"
        hasher = hashlib.sha256()
        file_size = 0

        try:
            with temp_path.open("wb") as output:
                while chunk := await upload.read(MP3_CHUNK_SIZE):
                    file_size += len(chunk)
                    hasher.update(chunk)
                    output.write(chunk)
            if file_size == 0:
                raise ValueError("MP3 file is empty.")
            shutil.move(str(temp_path), final_path)
        finally:
            temp_path.unlink(missing_ok=True)

        now = utc_now()
        clean_tags = _clean_song_tags(tags)
        song = StoredSong(
            id=song_id,
            title=title.strip(),
            artist=artist.strip() or "AI",
            album=album.strip(),
            duration_seconds=duration_seconds,
            source=source.strip() or "manual",
            original_filename=filename,
            file_path=str(final_path),
            file_size=file_size,
            file_sha256=hasher.hexdigest(),
            mime_type=upload.content_type or "audio/mpeg",
            created_at=now,
            updated_at=now,
            tags=clean_tags,
        )
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO songs (
                    id, title, artist, album, duration_seconds, source,
                    original_filename, file_path, file_size, file_sha256,
                    mime_type, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    song.id,
                    song.title,
                    song.artist,
                    song.album,
                    song.duration_seconds,
                    song.source,
                    song.original_filename,
                    song.file_path,
                    song.file_size,
                    song.file_sha256,
                    song.mime_type,
                    song.created_at,
                    song.updated_at,
                ),
            )
            self._replace_tags(conn, song.id, song.tags)
        return song

    def list_songs(
        self,
        *,
        limit: int = 50,
        offset: int = 0,
        tag: str | None = None,
    ) -> tuple[list[StoredSong], int]:
        clean_tags = _clean_song_tags([tag]) if tag else []
        clean_tag = clean_tags[0] if clean_tags else None
        where = "WHERE songs.deleted_at IS NULL"
        params: list[Any] = []
        if clean_tag:
            where += " AND EXISTS (SELECT 1 FROM song_tags WHERE song_tags.song_id = songs.id AND tag = ?)"
            params.append(clean_tag)

        with self._connect() as conn:
            total = int(
                conn.execute(
                    f"SELECT COUNT(*) AS count FROM songs {where}",
                    params,
                ).fetchone()["count"]
            )
            rows = conn.execute(
                f"""
                SELECT songs.*
                FROM songs
                {where}
                ORDER BY datetime(created_at) DESC, id DESC
                LIMIT ? OFFSET ?
                """,
                [*params, limit, offset],
            ).fetchall()
            songs = [self._song_from_row(conn, row) for row in rows]
        return songs, total

    def get_song(self, song_id: str) -> StoredSong:
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT *
                FROM songs
                WHERE id = ? AND deleted_at IS NULL
                """,
                (song_id,),
            ).fetchone()
            if row is None:
                raise KeyError(song_id)
            return self._song_from_row(conn, row)

    def _replace_tags(self, conn: sqlite3.Connection, song_id: str, tags: list[str]) -> None:
        conn.execute("DELETE FROM song_tags WHERE song_id = ?", (song_id,))
        conn.executemany(
            """
            INSERT INTO song_tags (song_id, tag, position)
            VALUES (?, ?, ?)
            """,
            [(song_id, tag, index) for index, tag in enumerate(tags)],
        )

    def _song_from_row(self, conn: sqlite3.Connection, row: sqlite3.Row) -> StoredSong:
        tag_rows = conn.execute(
            """
            SELECT tag
            FROM song_tags
            WHERE song_id = ?
            ORDER BY position ASC, tag ASC
            """,
            (row["id"],),
        ).fetchall()
        return StoredSong(
            id=row["id"],
            title=row["title"],
            artist=row["artist"],
            album=row["album"],
            duration_seconds=row["duration_seconds"],
            source=row["source"],
            original_filename=row["original_filename"],
            file_path=row["file_path"],
            file_size=int(row["file_size"]),
            file_sha256=row["file_sha256"],
            mime_type=row["mime_type"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
            tags=[tag_row["tag"] for tag_row in tag_rows],
        )

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        return conn

    def _initialize(self) -> None:
        with self._connect() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS songs (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    artist TEXT NOT NULL DEFAULT 'AI',
                    album TEXT NOT NULL DEFAULT '',
                    duration_seconds INTEGER,
                    source TEXT NOT NULL DEFAULT 'manual',
                    original_filename TEXT NOT NULL,
                    file_path TEXT NOT NULL,
                    file_size INTEGER NOT NULL,
                    file_sha256 TEXT NOT NULL,
                    mime_type TEXT NOT NULL DEFAULT 'audio/mpeg',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    deleted_at TEXT
                );

                CREATE TABLE IF NOT EXISTS song_tags (
                    song_id TEXT NOT NULL,
                    tag TEXT NOT NULL,
                    position INTEGER NOT NULL DEFAULT 0,
                    PRIMARY KEY(song_id, tag),
                    FOREIGN KEY(song_id) REFERENCES songs(id) ON DELETE CASCADE
                );

                CREATE INDEX IF NOT EXISTS idx_songs_created_at
                ON songs(created_at);

                CREATE INDEX IF NOT EXISTS idx_song_tags_tag
                ON song_tags(tag);
                """
            )


def create_song_router(
    *,
    store: SongStore,
    auth_store: Any,
    admin_key: str | None = None,
    require_auth: bool = True,
) -> APIRouter:
    router = APIRouter(prefix="/v1/songs", tags=["songs"])
    current_user = current_user_dependency(auth_store) if require_auth else _anonymous_user

    def require_admin(x_admin_key: Annotated[str | None, Header()] = None) -> None:
        if not admin_key:
            raise HTTPException(status_code=503, detail="Admin key is not configured.")
        if not x_admin_key or not secrets.compare_digest(x_admin_key, admin_key):
            raise HTTPException(status_code=403, detail="Invalid admin key.")

    @router.post("", response_model=SongResponse, dependencies=[Depends(require_admin)])
    async def upload_song(
        file: Annotated[UploadFile, File()],
        title: Annotated[str, Form(min_length=1, max_length=180)],
        artist: Annotated[str, Form(max_length=180)] = "AI",
        album: Annotated[str, Form(max_length=180)] = "",
        tags: Annotated[str, Form(max_length=1000)] = "",
        duration_seconds: Annotated[int | None, Form(ge=0, le=60 * 60 * 4)] = None,
        source: Annotated[str, Form(max_length=120)] = "manual",
    ) -> SongResponse:
        try:
            song = await store.create_song_from_upload(
                upload=file,
                title=title,
                artist=artist,
                album=album,
                tags=tags,
                duration_seconds=duration_seconds,
                source=source,
            )
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        return song_response(song)

    @router.get("", response_model=SongListResponse)
    def list_songs(
        limit: int = Query(default=50, ge=1, le=200),
        offset: int = Query(default=0, ge=0),
        tag: str | None = Query(default=None, min_length=1, max_length=120),
        _user: AuthUser | None = Depends(current_user),
    ) -> SongListResponse:
        songs, total = store.list_songs(limit=limit, offset=offset, tag=tag)
        return SongListResponse(
            songs=[song_response(song) for song in songs],
            limit=limit,
            offset=offset,
            total=total,
        )

    @router.get("/daily", response_model=SongListResponse)
    def daily_songs(
        limit: int = Query(default=20, ge=1, le=100),
        _user: AuthUser | None = Depends(current_user),
    ) -> SongListResponse:
        songs, total = store.list_songs(limit=limit, offset=0)
        return SongListResponse(
            songs=[song_response(song) for song in songs],
            limit=limit,
            offset=0,
            total=total,
        )

    @router.get("/{song_id}", response_model=SongResponse)
    def get_song(
        song_id: str,
        _user: AuthUser | None = Depends(current_user),
    ) -> SongResponse:
        try:
            return song_response(store.get_song(song_id))
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="Song not found.") from exc

    @router.get("/{song_id}/audio")
    def song_audio(
        song_id: str,
        _user: AuthUser | None = Depends(current_user),
    ) -> FileResponse:
        try:
            song = store.get_song(song_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="Song not found.") from exc
        path = Path(song.file_path)
        if not path.exists():
            raise HTTPException(status_code=404, detail="Song file not found.")
        return FileResponse(
            path,
            media_type=song.mime_type or "audio/mpeg",
            filename=song.original_filename,
            headers={
                "ETag": song.file_sha256,
                "Cache-Control": "private, max-age=31536000, immutable",
            },
        )

    return router


def song_response(song: StoredSong) -> SongResponse:
    audio_url = f"/v1/songs/{song.id}/audio"
    return SongResponse(
        id=song.id,
        title=song.title,
        artist=song.artist,
        album=song.album,
        duration_seconds=song.duration_seconds,
        source=song.source,
        original_filename=song.original_filename,
        file_size=song.file_size,
        file_sha256=song.file_sha256,
        mime_type=song.mime_type,
        tags=song.tags,
        audio_url=audio_url,
        download_url=audio_url,
        created_at=song.created_at,
        updated_at=song.updated_at,
    )


def utc_now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def _clean_song_tags(tags: str | list[str]) -> list[str]:
    return list(dict.fromkeys(parse_style_tags(tags)))


def _anonymous_user() -> None:
    return None
