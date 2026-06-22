from __future__ import annotations

from pathlib import Path


DATASET_SLUG = "undefinenull/million-song-dataset-spotify-lastfm"


def download_kaggle_dataset(raw_dir: Path, force: bool = False) -> list[Path]:
    """Download and unzip the Kaggle dataset into raw_dir."""
    raw_dir.mkdir(parents=True, exist_ok=True)

    existing = [path for path in raw_dir.iterdir() if path.is_file()]
    if existing and not force:
        return sorted(existing)

    try:
        from kaggle.api.kaggle_api_extended import KaggleApi
    except Exception as exc:  # pragma: no cover - depends on local install state
        raise RuntimeError(
            "Could not import the Kaggle package. Run `uv sync` and try again."
        ) from exc

    try:
        api = KaggleApi()
        api.authenticate()
        api.dataset_download_files(
            DATASET_SLUG,
            path=str(raw_dir),
            unzip=True,
            quiet=False,
            force=force,
        )
    except Exception as exc:  # pragma: no cover - depends on Kaggle credentials/network
        raise RuntimeError(
            "Kaggle download failed. Run `uv run kaggle auth login`, or set "
            "KAGGLE_API_TOKEN from https://www.kaggle.com/settings/api. Also "
            "make sure you accepted any dataset terms in the browser."
        ) from exc

    return sorted(path for path in raw_dir.iterdir() if path.is_file())
