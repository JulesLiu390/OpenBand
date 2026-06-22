# OpenBand

OpenBand is an AI music platform prototype. The repo is split into a mobile client and a FastAPI backend, with local tools for generating Suno prompt material.

## Structure

```text
OpenBand/
  mobile/      Expo React Native client
  backend/     FastAPI backend, tag/style model, and mock tests
  suno/        Prompt generation tools for AI songs and daily playlists
  反代/        Local Suno browser automation helper
```

## Mobile Frontend

```bash
cd mobile
npm install
npm run ios
# or
npm run android
# or
npm run web
```

Current tabs:

- `Library`
- `Daily`
- `Play Lists`

The bottom player opens the full music player screen.

## Backend

```bash
cd backend
uv sync
uv run pytest
uv run music-rec serve --model-path models/style_model.joblib --port 8000
```

The backend uses FastAPI and exposes:

- `GET /health`
- `GET /v1/tags/{tag}/similar`
- `POST /v1/profile`
- `POST /v1/score`
- `POST /v1/rank`

Tests use local fixtures and FastAPI `TestClient`, so they can run without Kaggle data or the production model file.

## Local-Only Assets

Training datasets, generated model files, Suno browser sessions, downloaded MP3s, screenshots, `.env` files, and profile state are intentionally ignored.
