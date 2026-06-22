# OpenBand

OpenBand is an AI music platform prototype. The repo is split into a mobile client and a FastAPI backend. Music generation, prompt generation, and Suno browser automation are backend modules.

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

The backend uses FastAPI and includes three internal modules:

- `music_taste_rec`: tag/style association model and FastAPI routes
- `openband.prompt_generation`: profile, playlist, prompt, and lyrics generation
- `openband.suno_browser`: Suno browser automation wrapper module

The current FastAPI app exposes:

- `GET /health`
- `GET /v1/tags/{tag}/similar`
- `POST /v1/profile`
- `POST /v1/score`
- `POST /v1/rank`

Tests use local fixtures and FastAPI `TestClient`, so they can run without Kaggle data or the production model file.

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

Training datasets, generated model files, Suno browser sessions, downloaded MP3s, screenshots, `.env` files, and profile/runtime state are intentionally ignored.
