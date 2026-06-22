# Music Style Association Model

This project uses the Kaggle `Million Song Dataset + Spotify + Last.fm` data as
a **style/taste prior** for an AI music platform.

The goal is not to recommend the old catalog directly. The goal is to learn:

- which tags/styles tend to be liked by the same listeners
- how to expand a user's taste tags into adjacent tastes
- how to score new AI-generated songs that only have metadata/tags

This matches AI music platforms where songs are new, cold-started, and already
come with tags or prompt metadata.

## Setup

```bash
cd backend
uv sync
```

## Backend Modules

```text
src/music_taste_rec/             FastAPI routes and tag/style model
src/openband/prompt_generation/  Profile, playlist, prompt, and lyric generation
src/openband/suno_browser/       Suno browser automation backend module
```

`openband.prompt_generation` is Python-native. It uses the trained tag model to
build playlist/song tag seeds and calls a Responses-compatible API to draft Suno
prompts.

`openband.suno_browser` is the backend wrapper around the current Playwright
browser automation scripts. The scripts live inside the backend module now, so
FastAPI or future workers can call them through Python without treating them as
an external project.

```bash
cd backend/src/openband/suno_browser/playwright
npm install
cd ../../../..
uv run openband-suno-browser --help
```

## Data

Download the Kaggle dataset:

```bash
uv run kaggle auth login
uv run music-rec download
```

Download the richer Last.fm 320K tag dataset:

```bash
uv run kaggle datasets download \
  -d adarsh1077/last-fm-320k-music-tracks-with-tags \
  -p data/lastfm_320k/raw \
  --unzip
```

Inspect it:

```bash
uv run music-rec inspect
```

Check how much of the main catalog is covered by Last.fm 320K tags using
normalized `artist + title` matching:

```bash
uv run music-rec lastfm-coverage
```

This writes:

- `models/lastfm320k_match_report.csv`
- `models/lastfm320k_matched_sample.csv`

## Train Style Associations

Fast sample:

```bash
uv run music-rec train \
  --model-path models/style_model_sampled.joblib \
  --max-interactions 2000000 \
  --lastfm-path data/lastfm_320k/raw \
  --lastfm-filter-profile ai \
  --lastfm-tag-weight 0.5
```

Full training:

```bash
uv run music-rec train \
  --model-path models/style_model.joblib \
  --lastfm-path data/lastfm_320k/raw \
  --lastfm-filter-profile ai \
  --lastfm-tag-weight 0.5
```

The model learns tag embeddings from:

```text
user -> listened tracks -> fused track tags/genres -> user taste vector
```

When `--lastfm-path` is provided, the trainer first matches Last.fm 320K rows to
the main catalog by normalized `artist + title`, adds the matched tags, filters
obvious non-style labels such as ratings and title-description tags, then runs
SVD over the user-tag matrix to learn style associations.

The current default fusion recipe is:

```text
catalog tags: 1.0
genre tags:   1.0
Last.fm tags: 0.5
profile:      ai
```

This keeps Last.fm's richer style vocabulary while preventing the external tags
from overpowering the original listening-history catalog signal.

## Explore Tag Associations

Find tags related to one style:

```bash
uv run music-rec similar-tags ambient --model-path models/style_model.joblib
```

Expand a taste profile:

```bash
uv run music-rec expand-tags \
  "ambient; piano; sleep" \
  --model-path models/style_model.joblib
```

## Score AI Songs

Score one AI song's tags against user taste tags:

```bash
uv run music-rec score-tags \
  --user-tags "dark pop; female vocal; synth; melancholic" \
  --song-tags "synthpop; female vocalists; sad; electronic" \
  --model-path models/style_model.joblib
```

Rank a batch of AI songs:

```csv
track_id,name,artist,genre,tags
ai_001,Velvet Static,AI,Rock,"shoegaze; dream_pop; guitar; indie"
ai_002,Lake Light,AI,Ambient,"ambient; piano; sleep; minimal"
```

```bash
uv run music-rec rank-songs ai_songs.csv \
  --user-tags "ambient; piano; sleep" \
  --model-path models/style_model.joblib
```

## Serve API

Start the recommendation API:

```bash
uv run music-rec serve --model-path models/style_model.joblib --port 8000
```

Open the interactive docs at:

```text
http://127.0.0.1:8000/docs
```

Useful endpoints:

```text
GET  /health
GET  /v1/tags/{tag}/similar
POST /v1/profile
POST /v1/score
POST /v1/rank
```

Build a user taste profile:

```bash
curl -X POST http://127.0.0.1:8000/v1/profile \
  -H "Content-Type: application/json" \
  -d '{"user_tags":"shoegaze; dream pop; female vocalists","top_n":10}'
```

Rank new AI songs by tags:

```bash
curl -X POST http://127.0.0.1:8000/v1/rank \
  -H "Content-Type: application/json" \
  -d '{
    "user_tags": "ambient; piano; sleep",
    "songs": [
      {"track_id":"ai_001","name":"Lake Light","artist":"AI","genre":"Ambient","tags":"ambient; piano; sleep; minimal"},
      {"track_id":"ai_002","name":"Velvet Static","artist":"AI","genre":"Rock","tags":"shoegaze; dream pop; guitar"}
    ],
    "top_n": 2
  }'
```

## Useful Commands

```bash
uv run music-rec tag-stats --model-path models/style_model.joblib
uv run music-rec evaluate \
  --model-path models/style_model.joblib \
  --lastfm-path data/lastfm_320k/raw \
  --output-path models/offline_eval_lastfm320k.json \
  --examples-path models/offline_eval_lastfm320k_examples.csv
uv run pytest
```
