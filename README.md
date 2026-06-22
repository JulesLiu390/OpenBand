# OpenBand

OpenBand is a private, friends-only, non-profit AI music platform prototype. The repo is split into a mobile client and a FastAPI backend. Music generation, prompt generation, Suno browser automation, authentication, the MP3 song library, and tag-based recommendation live behind the backend.

## Structure

```text
OpenBand/
  mobile/      Expo React Native client
  backend/     FastAPI backend, tag/style model, generation modules, and tests
```

## Mobile Frontend

```bash
cd mobile
npm install
EXPO_PUBLIC_API_URL=http://127.0.0.1:8000 npm run web
# or
npm run ios
# or
npm run android
```

Current tabs:

- `Library`
- `Daily`
- `Play Lists`

The bottom player opens the full music player screen.

The mobile app uses a first-login invite key. The backend returns a short-lived
access token plus a refresh token; iOS/Android store the session with
`expo-secure-store`, while web previews use `localStorage`.

Songs come from the backend song library. The app fetches song metadata from
FastAPI, downloads MP3 files on demand, and stores cached MP3s with
`expo-file-system`. MP3 cover art can stay embedded in the file; the first
library version does not require a separate cover image table.

## Backend

```bash
cd backend
uv sync
uv run pytest
OPENBAND_ADMIN_KEY=change-me uv run music-rec serve --model-path models/style_model.joblib --port 8000
```

The backend uses FastAPI and includes three internal modules:

- `music_taste_rec`: tag/style association model and FastAPI routes
- `openband.prompt_generation`: profile, playlist, prompt, and lyrics generation
- `openband.suno_browser`: Suno browser automation wrapper module

The current FastAPI app exposes:

- `GET /health`
- `POST /v1/auth/invite-keys`
- `POST /v1/auth/login`
- `POST /v1/auth/refresh`
- `GET /v1/me`
- `GET/PUT /v1/me/music-tags`
- `POST /v1/songs`
- `GET /v1/songs`
- `GET /v1/songs/daily`
- `GET /v1/songs/{song_id}/audio`
- `GET /v1/tags/{tag}/similar`
- `POST /v1/profile`
- `POST /v1/score`
- `POST /v1/rank`

Tests use local fixtures and FastAPI `TestClient`, so they can run without Kaggle data or the production model file.

Create a one-time invite key:

```bash
curl -X POST http://127.0.0.1:8000/v1/auth/invite-keys \
  -H "Content-Type: application/json" \
  -H "X-Admin-Key: change-me" \
  -d '{"label":"Alice"}'
```

The response includes a raw key, a QR/deep-link payload like
`openband://login?key=...`, and `qr_svg` for distribution. After first login,
clients call protected APIs with:

```text
Authorization: Bearer <access_token>
```

Upload an MP3 into the backend song library:

```bash
curl -X POST http://127.0.0.1:8000/v1/songs \
  -H "X-Admin-Key: change-me" \
  -F "title=Lake Light" \
  -F "artist=Suno Sketch" \
  -F "album=Midnight Sketches" \
  -F "tags=ambient; piano; sleep" \
  -F "duration_seconds=138" \
  -F "source=suno" \
  -F "file=@/path/to/lake-light.mp3;type=audio/mpeg"
```

By default, MP3 files are stored under `backend/storage/songs` and local SQLite
state under `backend/runtime`. Both are ignored by git.

Generation helpers:

```bash
cd backend
uv run openband-prompt --help
uv run openband-suno-browser --help
```

The Suno browser module wraps Playwright scripts. Install its local Node
dependencies before running browser jobs:

```bash
cd backend/src/openband/suno_browser/playwright
npm install
```

## Local-Only Assets

Training datasets, generated model files, backend MP3 storage, Suno browser sessions, downloaded MP3s, screenshots, `.env` files, and profile/runtime state are intentionally ignored.
