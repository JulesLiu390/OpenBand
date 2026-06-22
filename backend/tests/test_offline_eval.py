from pathlib import Path

from music_taste_rec.data import load_raw_dataset, normalize_history, normalize_music_info
from music_taste_rec.offline_eval import evaluate_holdout
from music_taste_rec.style_model import StyleTrainingConfig, train_style_model


FIXTURE_ROOT = Path(__file__).parent / "fixtures"
FIXTURE_RAW = FIXTURE_ROOT / "raw"


def test_holdout_evaluation_returns_ranking_metrics() -> None:
    raw = load_raw_dataset(FIXTURE_RAW)
    music, _ = normalize_music_info(raw.music)
    history = normalize_history(raw.history)
    model = train_style_model(
        StyleTrainingConfig(
            raw_dir=FIXTURE_RAW,
            min_tag_tracks=1,
            max_tags=50,
            n_components=3,
        )
    )

    result = evaluate_holdout(
        model=model,
        music=music,
        history=history,
        max_users=5,
        min_user_interactions=2,
        negative_count=3,
        top_k=2,
        random_state=7,
    )

    assert result.metrics["evaluated_users"] > 0
    assert 0.0 <= result.metrics["mean_auc"] <= 1.0
    assert 0.0 <= result.metrics["hit_rate_at_k"] <= 1.0
    assert not result.examples.empty
