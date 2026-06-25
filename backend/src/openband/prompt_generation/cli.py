#!/usr/bin/env python3
import argparse
import difflib
import hashlib
import json
import os
import random
import re
import sys
import urllib.error
import urllib.request
from collections import Counter
from datetime import datetime
from pathlib import Path


BACKEND_ROOT = Path(__file__).resolve().parents[3]
PACKAGE_ROOT = Path(__file__).resolve().parent
PROMPT_ROOT = PACKAGE_ROOT / "prompts"
PROMPT_FILES = {
    "brief_candidates": "brief_candidates.prompt.md",
    "profile": "profile.prompt.md",
    "playlist": "playlist.prompt.md",
    "style": "style.prompt.md",
    "lyrics": "lyrics.prompt.md",
    "original": "original.prompt.md",
}
KINDS = ("both", "style", "lyrics", "original")
DEFAULT_PROFILE_FILE = "runtime/suno/profiles/user_profile.json"
DEFAULT_PLAYLIST_HISTORY_FILE = "runtime/suno/profiles/playlist_history.json"
DEFAULT_TAG_MODEL_PATH = "models/style_model.joblib"
DEFAULT_PLAYLIST_TOTAL = 10
DEFAULT_PLAYLIST_PROFILE_ONLY = 7
DEFAULT_PLAYLIST_TAGS_PER_SONG = 6
DEFAULT_PLAYLIST_CANDIDATE_COUNT = 120
DEFAULT_PLAYLIST_DIVERSITY_WEIGHT = 0.35
DEFAULT_PLAYLIST_MAX_CLUSTER_SIMILARITY = 0.88
DEFAULT_PLAYLIST_HISTORY_DAYS = 7
DEFAULT_PLAYLIST_HISTORY_WEIGHT = 0.65
DEFAULT_PLAYLIST_HISTORY_TAG_WEIGHT = 0.45
BRIEF_FIELDS = (
    "title_seed",
    "concept",
    "sound_direction",
    "performance_direction",
    "lyric_angle",
    "arrangement_hook",
)
STYLE_TAG_ALIASES = {
    "arena pop rock": "rock",
    "arena rock": "rock",
    "dark electronic": "dark electro",
    "electro rock": "electronic",
    "electronic rock": "electronic",
    "glam rock": "glam metal",
    "heavy distorted guitars": "hard rock",
    "heavy guitar riffs": "hard rock",
    "industrial electronic": "industrial",
    "industrial electronics": "industrial",
    "rap metal": "rapcore",
    "rap rock": "rapcore",
    "retro futuristic synths": "electronic",
    "vocoder vocals": "electronic",
}
PROFILE_INPUT_PROMPT = (
    "一次性告诉我你的音乐口味。可以写你喜欢的歌、音乐人、影视、动画、游戏、"
    "场景/关卡/镜头,以及你喜欢它们的哪些点:人声、鼓、速度感、氛围、世界观、"
    "情绪、重吉他、合成器、爵士/funk、歌词主题等。也可以写不喜欢什么。"
)


def load_dotenv(path: Path) -> None:
    if not path.exists():
        return

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        name, value = line.split("=", 1)
        name = name.strip()
        value = value.strip()
        if not name:
            continue

        if (value.startswith('"') and value.endswith('"')) or (
            value.startswith("'") and value.endswith("'")
        ):
            value = value[1:-1]

        os.environ.setdefault(name, value)


def read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8").strip()
    except FileNotFoundError:
        raise SystemExit(f"Prompt file not found: {path}")


def dedupe(items: list[str]) -> list[str]:
    seen = set()
    result = []
    for item in items:
        clean = item.strip()
        if not clean or clean in seen:
            continue
        seen.add(clean)
        result.append(clean)
    return result


def profile_path(args: argparse.Namespace) -> Path:
    path = Path(args.profile_file)
    if not path.is_absolute():
        path = BACKEND_ROOT / path
    return path


def playlist_history_path(args: argparse.Namespace) -> Path:
    path = Path(
        getattr(args, "playlist_history_file", DEFAULT_PLAYLIST_HISTORY_FILE)
    )
    if not path.is_absolute():
        path = BACKEND_ROOT / path
    return path


def parse_playlist_date(value: object):
    try:
        return datetime.strptime(str(value)[:10], "%Y-%m-%d").date()
    except ValueError:
        return None


def playlist_profile_key(user_tags: list[str]) -> str:
    digest = hashlib.sha256(
        "\n".join(sorted(user_tags)).encode("utf-8")
    ).hexdigest()
    return digest[:16]


def collect_profile_input(args: argparse.Namespace) -> dict:
    if args.message is not None:
        text = args.message.strip()
    elif not sys.stdin.isatty():
        text = sys.stdin.read().strip()
    else:
        print("初始化用户偏好 tags")
        print(PROFILE_INPUT_PROMPT)
        print()
        print(
            "例: 我喜欢 A 歌的副歌爆发、B 游戏的高速赛博感、C 动画的战斗配乐;"
            " 喜欢女主唱+男说唱、重吉他、breakbeat; 不喜欢 EDM drop 和太甜的流行。"
        )
        print()
        text = input("> ").strip()

    return {"profile_input": text}


def list_value(value: object) -> list[str]:
    if isinstance(value, list):
        return [str(item) for item in value]
    if isinstance(value, str):
        return [part.strip() for part in re.split(r"[,，\n]", value) if part.strip()]
    return []


def negative_tag(tag: str) -> str:
    clean = tag.strip()
    if not clean:
        return clean
    if clean.lower().startswith("no "):
        return clean
    return f"no {clean}"


def tag_model_path(args: argparse.Namespace) -> Path:
    path = Path(args.tag_model_path)
    if not path.is_absolute():
        path = BACKEND_ROOT / path
    return path.resolve()


def load_tag_model(args: argparse.Namespace):
    path = tag_model_path(args)
    if not path.exists():
        raise SystemExit(f"Tag model not found: {path}")

    parent_src = BACKEND_ROOT / "src"
    if parent_src.exists():
        sys.path.insert(0, str(parent_src))

    from music_taste_rec.style_model import StyleAssociationModel

    return StyleAssociationModel.load(path)


def allowed_style_tags(args: argparse.Namespace) -> list[str]:
    return [str(tag) for tag in load_tag_model(args).tags]


def canonical_tag(tag: object) -> str:
    text = str(tag).strip().lower()
    text = text.strip("'\"[](){}")
    text = re.sub(r"[_-]+", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text


def parse_profile_sections(text: str) -> dict[str, str]:
    section_names = {
        "reference_summary": ("reference summary", "summary", "参考总结"),
        "tags": ("tags", "user tags", "preference tags", "偏好标签"),
        "style_tags": ("style tags", "allowed style tags", "风格标签"),
        "lyric_tags": ("lyric tags", "lyrics tags", "歌词标签"),
        "negative_tags": ("negative tags", "exclude tags", "负向标签"),
        "tag_meanings": ("tag meanings", "tags meanings", "tag descriptions", "标签含义"),
        "source_notes": ("source notes", "notes", "source preferences", "参考说明"),
    }
    heading_to_key = {
        canonical_tag(heading): key
        for key, headings in section_names.items()
        for heading in headings
    }
    sections = {key: [] for key in section_names}
    current: str | None = None

    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            continue

        normalized_line = canonical_tag(line.rstrip(":"))
        if normalized_line in heading_to_key:
            current = heading_to_key[normalized_line]
            continue

        matched_heading = False
        for heading, key in heading_to_key.items():
            prefix = f"{heading}:"
            if canonical_tag(line).startswith(prefix):
                current = key
                rest = line.split(":", 1)[1].strip()
                if rest:
                    sections[current].append(rest)
                matched_heading = True
                break
        if matched_heading:
            continue

        if current:
            sections[current].append(line)

    return {key: "\n".join(lines).strip() for key, lines in sections.items()}


def parse_tag_text(text: str) -> list[str]:
    tags: list[str] = []
    for line in text.splitlines():
        clean = line.strip()
        clean = re.sub(r"^[-*•]\s*", "", clean)
        clean = re.sub(r"^\d+[.)]\s*", "", clean)
        if not clean:
            continue
        for part in re.split(r"[,，;；]", clean):
            tag = part.strip()
            tag = re.split(r"\s+[-–—]\s+", tag, maxsplit=1)[0].strip()
            tag = tag.strip("'\"`[](){}")
            if tag:
                tags.append(tag)
    return dedupe(tags)


def correct_style_tags(
    raw_tags: list[str],
    allowed_tags: list[str],
    fuzzy_cutoff: float = 0.88,
) -> tuple[list[str], list[dict[str, str]], list[str], list[str]]:
    allowed_by_canonical = {canonical_tag(tag): tag for tag in allowed_tags}
    allowed_keys = list(allowed_by_canonical)
    exact_tags: list[str] = []
    corrected_tags: list[str] = []
    corrections: list[dict[str, str]] = []
    rejected_tags: list[str] = []

    for raw_tag in raw_tags:
        canonical = canonical_tag(raw_tag)
        if not canonical:
            continue

        resolved = allowed_by_canonical.get(canonical)
        method = "exact"

        if resolved is None:
            alias = STYLE_TAG_ALIASES.get(canonical)
            if alias and canonical_tag(alias) in allowed_by_canonical:
                resolved = allowed_by_canonical[canonical_tag(alias)]
                method = "alias"

        if resolved is None:
            matches = difflib.get_close_matches(canonical, allowed_keys, n=1, cutoff=fuzzy_cutoff)
            if matches:
                resolved = allowed_by_canonical[matches[0]]
                method = "fuzzy"

        if resolved is None:
            rejected_tags.append(canonical)
            continue

        corrected_tags.append(resolved)
        if method == "exact":
            exact_tags.append(resolved)
        else:
            corrections.append({"raw": raw_tag, "corrected": resolved, "method": method})

    return dedupe(corrected_tags), corrections, rejected_tags, dedupe(exact_tags)


def profile_prompt_with_allowed_tags(args: argparse.Namespace) -> tuple[str, list[str]]:
    profile_prompt = read_text(PROMPT_ROOT / PROMPT_FILES["profile"])
    if args.no_tag_filter:
        return profile_prompt, []

    tags = allowed_style_tags(args)
    tag_list = "\n".join(f"- {tag}" for tag in tags)
    prompt = (
        f"{profile_prompt}\n\n"
        "Allowed TAGS whitelist:\n"
        f"{tag_list}\n\n"
        "When using music/style/sound tags, copy them exactly from the whitelist above."
    )
    return prompt, tags


def apply_tag_filter(profile: dict, args: argparse.Namespace) -> dict:
    if args.no_tag_filter:
        return profile

    source_tags = (
        profile.get("raw_tags")
        or profile.get("tags")
        or [
            *list_value(profile.get("style_tags", [])),
            *list_value(profile.get("lyric_tags", [])),
            *list_value(profile.get("negative_tags", [])),
        ]
    )
    source_tags = dedupe(list_value(source_tags))
    if not source_tags:
        return profile

    allowed_tags = allowed_style_tags(args)
    positive_raw_tags = [
        tag for tag in source_tags if not canonical_tag(tag).startswith("no ")
    ]
    negative_tags = [
        negative_tag(canonical_tag(tag)[3:])
        for tag in source_tags
        if canonical_tag(tag).startswith("no ")
    ]
    filtered_tags, corrections, rejected_tags, exact_tags = correct_style_tags(
        positive_raw_tags,
        allowed_tags,
    )
    final_tags = dedupe([*filtered_tags, *negative_tags, *rejected_tags])
    profile["raw_tags"] = source_tags
    profile["known_tags"] = exact_tags
    profile["corrected_tags"] = corrections
    profile["unknown_tags"] = rejected_tags
    profile.pop("expanded_style_tags", None)
    profile.pop("dropped_expanded_style_tags", None)
    profile["tags"] = final_tags
    profile["tag_filter"] = {
        "model_path": str(tag_model_path(args)),
        "tag_count": len(allowed_tags),
        "method": "whitelist_text_parse",
    }
    return profile


def run_profile_setup(args: argparse.Namespace, api_key: str) -> Path:
    answers = collect_profile_input(args)
    if not any(value.strip() for value in answers.values()):
        raise SystemExit("No profile answers provided.")

    profile_prompt, allowed_tags = profile_prompt_with_allowed_tags(args)
    profile_input = "用户输入:\n" + answers["profile_input"]
    profile_text, _profile_data = run_prompt(args, api_key, profile_prompt, profile_input)

    sections = parse_profile_sections(profile_text)
    raw_tags = parse_tag_text(sections.get("tags", ""))
    if not raw_tags:
        raw_tags = dedupe(
            [
                *parse_tag_text(sections.get("style_tags", "")),
                *parse_tag_text(sections.get("lyric_tags", "")),
                *parse_tag_text(sections.get("negative_tags", "")),
            ]
        )

    if args.no_tag_filter:
        tags = raw_tags
        corrections: list[dict[str, str]] = []
        unknown_tags: list[str] = []
        known_tags = raw_tags
    else:
        positive_raw_tags = [
            tag for tag in raw_tags if not canonical_tag(tag).startswith("no ")
        ]
        negative_tags = [
            negative_tag(canonical_tag(tag)[3:])
            for tag in raw_tags
            if canonical_tag(tag).startswith("no ")
        ]
        style_tags, corrections, unknown_tags, known_tags = correct_style_tags(
            positive_raw_tags,
            allowed_tags,
        )
        tags = dedupe([*style_tags, *negative_tags, *unknown_tags])

    profile = {
        "version": 4,
        "created_at": datetime.now().isoformat(timespec="seconds"),
        "raw_answers": answers,
        "profile_output_text": profile_text,
        "reference_summary": sections.get("reference_summary", ""),
        "source_notes": sections.get("source_notes", ""),
        "tags": tags,
        "raw_tags": raw_tags,
        "known_tags": known_tags,
        "corrected_tags": corrections,
        "unknown_tags": unknown_tags,
        "tag_filter": {
            "model_path": str(tag_model_path(args)) if not args.no_tag_filter else "",
            "tag_count": len(allowed_tags),
            "method": "whitelist_text_parse",
        },
    }

    path = profile_path(args)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(profile, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


def load_profile(args: argparse.Namespace) -> dict | None:
    if args.no_profile:
        return None

    path = profile_path(args)
    if not path.exists():
        return None

    try:
        return apply_tag_filter(json.loads(path.read_text(encoding="utf-8")), args)
    except json.JSONDecodeError as error:
        raise SystemExit(f"Invalid profile JSON: {path}\n{error}") from error


def profile_context(profile: dict) -> str:
    compact = {
        "tags": profile.get("tags", []),
    }
    return json.dumps(compact, ensure_ascii=False, indent=2)


def positive_profile_tags(profile: dict, model) -> list[str]:
    tags = [
        tag
        for tag in list_value(profile.get("tags", []))
        if not canonical_tag(tag).startswith("no ")
    ]
    return model.known_tags(tags)


def tag_similarity(model, left: str, right: str) -> float:
    left_index = model.tag_to_index[left]
    right_index = model.tag_to_index[right]
    return float(model.tag_embeddings[left_index] @ model.tag_embeddings[right_index])


def average_similarity(model, tag: str, cluster: list[str]) -> float:
    if not cluster:
        return 0.0
    return sum(tag_similarity(model, tag, item) for item in cluster) / len(cluster)


def cluster_vector(model, tags: list[str]):
    indices = [model.tag_to_index[tag] for tag in tags]
    vector = model.tag_embeddings[indices].mean(axis=0)
    norm = float((vector @ vector) ** 0.5)
    if norm <= 1e-12:
        return vector
    return vector / norm


def cluster_similarity(left, right) -> float:
    return float(left @ right)


def cluster_intra_score(model, tags: list[str]) -> float:
    if len(tags) < 2:
        return 0.0

    total = 0.0
    pair_count = 0
    for left_index, left_tag in enumerate(tags):
        for right_tag in tags[left_index + 1 :]:
            total += tag_similarity(model, left_tag, right_tag)
            pair_count += 1
    return total / pair_count


def make_cluster_candidate(model, tags: list[str], mode: str) -> dict:
    return {
        "mode": mode,
        "tags": tags,
        "vector": cluster_vector(model, tags),
        "intra_score": cluster_intra_score(model, tags),
    }


def load_playlist_history_data(args: argparse.Namespace) -> dict:
    path = playlist_history_path(args)
    if not path.exists():
        return {"version": 1, "entries": []}

    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise SystemExit(f"Invalid playlist history JSON: {path}\n{error}") from error

    if not isinstance(data, dict):
        return {"version": 1, "entries": []}
    if not isinstance(data.get("entries"), list):
        data["entries"] = []
    data.setdefault("version", 1)
    return data


def history_entries_for_playlist(
    args: argparse.Namespace,
    profile_key: str,
) -> list[dict]:
    if getattr(args, "no_playlist_history", False):
        return []

    current_date = parse_playlist_date(args.playlist_date)
    history_days = getattr(
        args,
        "playlist_history_days",
        DEFAULT_PLAYLIST_HISTORY_DAYS,
    )
    entries = []
    for entry in load_playlist_history_data(args).get("entries", []):
        if entry.get("profile_key") != profile_key:
            continue

        entry_date = parse_playlist_date(entry.get("date"))
        if current_date is not None and entry_date is not None:
            age = (current_date - entry_date).days
            if age <= 0 or age > history_days:
                continue

        entries.append(entry)

    return entries


def history_candidates(model, entries: list[dict]) -> list[dict]:
    candidates = []
    for entry in entries:
        for song in entry.get("songs", []):
            tags = model.known_tags(list_value(song.get("tags", [])))
            if len(tags) < 2:
                continue

            candidate = make_cluster_candidate(model, tags, "history")
            candidate["date"] = entry.get("date", "")
            candidate["index"] = song.get("index")
            candidates.append(candidate)

    return candidates


def save_playlist_history(args: argparse.Namespace, seed: dict) -> Path | None:
    if getattr(args, "no_playlist_history", False) or getattr(
        args,
        "no_save",
        False,
    ):
        return None

    path = playlist_history_path(args)
    data = load_playlist_history_data(args)
    profile_key = seed.get("profile_key", "")
    date_value = seed.get("date", "")
    entries = [
        entry
        for entry in data.get("entries", [])
        if not (
            entry.get("profile_key") == profile_key
            and entry.get("date") == date_value
        )
    ]
    entries.append(
        {
            "date": date_value,
            "profile_key": profile_key,
            "created_at": datetime.now().isoformat(timespec="seconds"),
            "songs": [
                {"index": song["index"], "tags": song["tags"]}
                for song in seed.get("songs", [])
            ],
            "metrics": seed.get("metrics", {}),
            "constraints": seed.get("constraints", {}),
        }
    )

    entries.sort(key=lambda entry: str(entry.get("date", "")))
    data["entries"] = entries[-120:]
    data["updated_at"] = datetime.now().isoformat(timespec="seconds")

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


def choose_anchor(tags: list[str], usage: Counter[str], rng: random.Random) -> str:
    candidates = list(tags)
    rng.shuffle(candidates)
    candidates.sort(key=lambda tag: (usage[tag], rng.random()))
    return candidates[0]


def coherent_cluster(
    *,
    model,
    candidates: list[str],
    size: int,
    usage: Counter[str],
    rng: random.Random,
    anchor: str | None = None,
) -> list[str]:
    if size <= 0:
        return []
    if len(candidates) < size:
        raise SystemExit(
            f"Need at least {size} known profile tags, got {len(candidates)}."
        )

    remaining = list(dict.fromkeys(candidates))
    cluster = [anchor or choose_anchor(remaining, usage, rng)]
    remaining = [tag for tag in remaining if tag not in cluster]

    while len(cluster) < size:
        scored = []
        for tag in remaining:
            score = (
                average_similarity(model, tag, cluster)
                - 0.12 * usage[tag]
                + rng.random() * 0.015
            )
            scored.append((score, tag))
        scored.sort(reverse=True)
        chosen = scored[0][1]
        cluster.append(chosen)
        remaining.remove(chosen)

    for tag in cluster:
        usage[tag] += 1
    return cluster


def add_unique_candidate(candidates: list[dict], seen: set[tuple[str, ...]], candidate: dict) -> None:
    key = tuple(sorted(candidate["tags"]))
    if key in seen:
        return

    seen.add(key)
    candidates.append(candidate)


def profile_cluster_candidates(
    *,
    model,
    user_tags: list[str],
    size: int,
    count: int,
    rng: random.Random,
) -> list[dict]:
    candidates: list[dict] = []
    seen: set[tuple[str, ...]] = set()
    usage: Counter[str] = Counter()
    attempts = max(count * 4, count + 20)

    for _attempt in range(attempts):
        if len(candidates) >= count:
            break

        tags = coherent_cluster(
            model=model,
            candidates=user_tags,
            size=size,
            usage=usage,
            rng=rng,
        )
        add_unique_candidate(
            candidates,
            seen,
            make_cluster_candidate(model, tags, "profile"),
        )

    return candidates


def related_cluster(
    *,
    model,
    user_part: list[str],
    user_tags: set[str],
    size: int,
    usage: Counter[str],
    rng: random.Random,
    top_n: int,
) -> list[str]:
    if size <= 0:
        return []

    expanded = model.expand_tags(
        user_part,
        top_n=max(top_n, size * 4),
        min_user_count=0,
    )
    candidates = [
        str(tag)
        for tag in expanded["tag"].tolist()
        if str(tag) not in user_tags and not canonical_tag(tag).startswith("no ")
    ]
    candidates = list(dict.fromkeys(candidates))
    if len(candidates) < size:
        raise SystemExit(
            f"Need at least {size} related model tags, got {len(candidates)}."
        )

    cluster: list[str] = []
    remaining = list(candidates)
    while len(cluster) < size:
        scored = []
        base = [*user_part, *cluster]
        for tag in remaining:
            score = (
                average_similarity(model, tag, base)
                - 0.10 * usage[tag]
                + rng.random() * 0.015
            )
            scored.append((score, tag))
        scored.sort(reverse=True)
        chosen = scored[0][1]
        cluster.append(chosen)
        remaining.remove(chosen)

    for tag in cluster:
        usage[tag] += 1
    return cluster


def hybrid_cluster_candidates(
    *,
    model,
    user_tags: list[str],
    user_part_size: int,
    related_part_size: int,
    count: int,
    rng: random.Random,
    top_n: int,
) -> list[dict]:
    candidates: list[dict] = []
    seen: set[tuple[str, ...]] = set()
    usage: Counter[str] = Counter()
    user_tag_set = set(user_tags)
    attempts = max(count * 4, count + 20)

    for _attempt in range(attempts):
        if len(candidates) >= count:
            break

        user_part = coherent_cluster(
            model=model,
            candidates=user_tags,
            size=user_part_size,
            usage=usage,
            rng=rng,
        )
        related_part = related_cluster(
            model=model,
            user_part=user_part,
            user_tags=user_tag_set,
            size=related_part_size,
            usage=usage,
            rng=rng,
            top_n=top_n,
        )
        add_unique_candidate(
            candidates,
            seen,
            make_cluster_candidate(model, [*user_part, *related_part], "hybrid"),
        )

    return candidates


def nearest_selected_similarity(candidate: dict, selected: list[dict]) -> float:
    if not selected:
        return 0.0
    return max(
        cluster_similarity(candidate["vector"], item["vector"])
        for item in selected
    )


def nearest_selected_overlap(candidate: dict, selected: list[dict]) -> float:
    if not selected:
        return 0.0

    candidate_tags = set(candidate["tags"])
    return max(
        len(candidate_tags & set(item["tags"])) / len(candidate_tags)
        for item in selected
    )


def select_diverse_candidates(
    *,
    candidates: list[dict],
    count: int,
    selected: list[dict],
    history: list[dict],
    usage: Counter[str],
    diversity_weight: float,
    max_cluster_similarity: float,
    history_weight: float,
    history_tag_weight: float,
    rng: random.Random,
) -> list[dict]:
    if len(candidates) < count:
        raise SystemExit(
            f"Need at least {count} playlist cluster candidates, got {len(candidates)}."
        )

    picked: list[dict] = []
    available = list(candidates)
    while len(picked) < count:
        comparison_set = [*selected, *picked]
        remaining_needed = count - len(picked)
        filtered_available = [
            candidate
            for candidate in available
            if nearest_selected_similarity(candidate, comparison_set)
            <= max_cluster_similarity
        ]
        scoring_pool = (
            filtered_available
            if len(filtered_available) >= remaining_needed
            else available
        )
        scored = []
        for candidate in scoring_pool:
            nearest_similarity = nearest_selected_similarity(
                candidate,
                comparison_set,
            )
            nearest_overlap = nearest_selected_overlap(candidate, comparison_set)
            history_similarity = nearest_selected_similarity(candidate, history)
            history_overlap = nearest_selected_overlap(candidate, history)
            usage_penalty = sum(usage[tag] for tag in candidate["tags"]) / len(
                candidate["tags"]
            )
            score = (
                candidate["intra_score"]
                - diversity_weight * nearest_similarity
                - diversity_weight * 0.5 * nearest_overlap
                - history_weight * history_similarity
                - history_tag_weight * history_overlap
                - 0.12 * usage_penalty
                + rng.random() * 0.001
            )
            scored.append((score, candidate))

        scored.sort(key=lambda item: item[0], reverse=True)
        chosen = scored[0][1]
        available.remove(chosen)
        picked.append(chosen)
        for tag in chosen["tags"]:
            usage[tag] += 1

    return picked


def playlist_similarity_metrics(selected: list[dict]) -> dict:
    intra_scores = [candidate["intra_score"] for candidate in selected]
    inter_scores = []
    for left_index, left_candidate in enumerate(selected):
        for right_candidate in selected[left_index + 1 :]:
            inter_scores.append(
                cluster_similarity(left_candidate["vector"], right_candidate["vector"])
            )

    return {
        "avg_intra_cluster_similarity": sum(intra_scores) / len(intra_scores)
        if intra_scores
        else 0.0,
        "avg_inter_cluster_similarity": sum(inter_scores) / len(inter_scores)
        if inter_scores
        else 0.0,
        "max_inter_cluster_similarity": max(inter_scores) if inter_scores else 0.0,
    }


def playlist_history_metrics(selected: list[dict], history: list[dict]) -> dict:
    if not history:
        return {
            "avg_history_cluster_similarity": 0.0,
            "max_history_cluster_similarity": 0.0,
            "history_clusters": 0,
        }

    similarities = [
        nearest_selected_similarity(candidate, history)
        for candidate in selected
    ]
    return {
        "avg_history_cluster_similarity": sum(similarities) / len(similarities)
        if similarities
        else 0.0,
        "max_history_cluster_similarity": max(similarities) if similarities else 0.0,
        "history_clusters": len(history),
    }


def build_daily_playlist_seed(args: argparse.Namespace, profile: dict) -> dict:
    model = load_tag_model(args)
    user_tags = positive_profile_tags(profile, model)
    profile_key = playlist_profile_key(user_tags)
    history_days = getattr(args, "playlist_history_days", DEFAULT_PLAYLIST_HISTORY_DAYS)
    history_weight = getattr(
        args,
        "playlist_history_weight",
        DEFAULT_PLAYLIST_HISTORY_WEIGHT,
    )
    history_tag_weight = getattr(
        args,
        "playlist_history_tag_weight",
        DEFAULT_PLAYLIST_HISTORY_TAG_WEIGHT,
    )
    weekly_history = history_candidates(
        model,
        history_entries_for_playlist(args, profile_key),
    )
    if len(user_tags) < max(
        args.playlist_tags_per_song,
        args.playlist_user_tags_per_hybrid,
    ):
        raise SystemExit(
            "Not enough known user tags for playlist generation. "
            f"Known tags: {', '.join(user_tags) or 'none'}"
        )

    hybrid_count = args.playlist_total - args.playlist_profile_only
    if hybrid_count < 0:
        raise SystemExit("--playlist-profile-only cannot exceed --playlist-total.")
    if args.playlist_tags_per_song % 2 != 0:
        raise SystemExit(
            "--playlist-tags-per-song must be even for 50/50 hybrid songs."
        )

    user_part_size = args.playlist_user_tags_per_hybrid
    related_part_size = args.playlist_tags_per_song - user_part_size
    if user_part_size != related_part_size:
        raise SystemExit(
            "Hybrid songs must be 50/50. Use matching --playlist-tags-per-song "
            "and --playlist-user-tags-per-hybrid values."
        )

    rng = random.Random(f"{args.playlist_date}:{'|'.join(user_tags)}")
    candidate_count = max(args.playlist_candidate_count, args.playlist_total * 4)
    selected: list[dict] = []
    selected_usage: Counter[str] = Counter()
    profile_candidates = profile_cluster_candidates(
        model=model,
        user_tags=user_tags,
        size=args.playlist_tags_per_song,
        count=candidate_count,
        rng=rng,
    )
    selected.extend(
        select_diverse_candidates(
            candidates=profile_candidates,
            count=args.playlist_profile_only,
            selected=selected,
            history=weekly_history,
            usage=selected_usage,
            diversity_weight=args.playlist_diversity_weight,
            max_cluster_similarity=args.playlist_max_cluster_similarity,
            history_weight=history_weight,
            history_tag_weight=history_tag_weight,
            rng=rng,
        )
    )

    user_tag_set = set(user_tags)
    hybrid_candidates = hybrid_cluster_candidates(
        model=model,
        user_tags=user_tags,
        user_part_size=user_part_size,
        related_part_size=related_part_size,
        count=candidate_count,
        rng=rng,
        top_n=args.playlist_related_top_n,
    )
    selected.extend(
        select_diverse_candidates(
            candidates=hybrid_candidates,
            count=hybrid_count,
            selected=selected,
            history=weekly_history,
            usage=selected_usage,
            diversity_weight=args.playlist_diversity_weight,
            max_cluster_similarity=args.playlist_max_cluster_similarity,
            history_weight=history_weight,
            history_tag_weight=history_tag_weight,
            rng=rng,
        )
    )

    songs = []
    previous_candidates: list[dict] = []
    for index, candidate in enumerate(selected, start=1):
        tags = candidate["tags"]
        if index <= args.playlist_profile_only:
            assert all(tag in user_tag_set for tag in tags)
        else:
            assert sum(tag in user_tag_set for tag in tags) == user_part_size
            assert sum(tag not in user_tag_set for tag in tags) == related_part_size

        songs.append(
            {
                "index": index,
                "tags": tags,
                "intra_similarity": round(candidate["intra_score"], 4),
                "nearest_previous_similarity": round(
                    nearest_selected_similarity(candidate, previous_candidates),
                    4,
                ),
                "nearest_history_similarity": round(
                    nearest_selected_similarity(candidate, weekly_history),
                    4,
                ),
            }
        )
        previous_candidates.append(candidate)

    metrics = playlist_similarity_metrics(selected)
    metrics.update(playlist_history_metrics(selected, weekly_history))
    metrics = {key: round(value, 4) for key, value in metrics.items()}

    return {
        "date": args.playlist_date,
        "profile_key": profile_key,
        "user_tags": user_tags,
        "songs": songs,
        "constraints": {
            "total": args.playlist_total,
            "profile_only": args.playlist_profile_only,
            "hybrid": hybrid_count,
            "tags_per_song": args.playlist_tags_per_song,
            "hybrid_user_tags": user_part_size,
            "hybrid_related_tags": related_part_size,
            "candidate_count": candidate_count,
            "diversity_weight": args.playlist_diversity_weight,
            "max_cluster_similarity": args.playlist_max_cluster_similarity,
            "history_days": history_days,
            "history_weight": history_weight,
            "history_tag_weight": history_tag_weight,
            "related_top_n": args.playlist_related_top_n,
        },
        "metrics": metrics,
    }


def playlist_llm_input(seed: dict) -> str:
    lines = [f"Date: {seed['date']}", "", "Song tags:"]
    for song in seed["songs"]:
        lines.append(f"{song['index']}. {', '.join(song['tags'])}")
    return "\n".join(lines)


def format_playlist_result(seed: dict, playlist_text: str) -> str:
    sections = [
        "# Daily Playlist Prompt",
        "",
        f"- Generated: {datetime.now().isoformat(timespec='seconds')}",
        f"- Date seed: {seed['date']}",
        "",
        "## Tag Seeds",
        "",
    ]
    for song in seed["songs"]:
        sections.append(f"{song['index']}. {', '.join(song['tags'])}")

    metrics = seed.get("metrics", {})
    if metrics:
        sections.extend(
            [
                "",
                "## Diversity Metrics",
                "",
                f"- Avg intra-cluster cosine: {metrics.get('avg_intra_cluster_similarity')}",
                f"- Avg inter-cluster cosine: {metrics.get('avg_inter_cluster_similarity')}",
                f"- Max inter-cluster cosine: {metrics.get('max_inter_cluster_similarity')}",
                f"- Avg history cosine: {metrics.get('avg_history_cluster_similarity')}",
                f"- Max history cosine: {metrics.get('max_history_cluster_similarity')}",
                f"- History clusters: {metrics.get('history_clusters')}",
            ]
        )

    sections.extend(["", "## Playlist Prompt Draft", "", playlist_text, ""])
    return "\n".join(sections)


def run_daily_playlist(args: argparse.Namespace, api_key: str) -> Path | None:
    profile = load_profile(args)
    if not profile:
        raise SystemExit("No profile found. Run --init-profile first.")

    seed = build_daily_playlist_seed(args, profile)
    playlist_prompt = read_text(PROMPT_ROOT / PROMPT_FILES["playlist"])
    playlist_text, _data = run_prompt(
        args,
        api_key,
        playlist_prompt,
        playlist_llm_input(seed),
    )

    output = format_playlist_result(seed, playlist_text)
    original_kind = args.kind
    try:
        args.kind = "playlist"
        result_path = write_result(args, output, f"daily playlist {seed['date']}")
    finally:
        args.kind = original_kind
    history_path = save_playlist_history(args, seed)

    print(output)
    if result_path:
        print(f"Saved result: {result_path}")
    if history_path:
        print(f"Saved playlist history: {history_path}")
    return result_path


def song_tags_from_args(args: argparse.Namespace) -> list[str]:
    raw_tags = parse_tag_text(args.song_tags or "")
    if not raw_tags:
        raise SystemExit("Missing song tags. Pass --song-tags \"tag1, tag2\".")

    if args.no_tag_filter:
        return raw_tags

    allowed_tags = allowed_style_tags(args)
    tags, corrections, rejected_tags, _exact_tags = correct_style_tags(
        raw_tags,
        allowed_tags,
    )
    if rejected_tags:
        raise SystemExit(f"Unknown song tags: {', '.join(rejected_tags)}")

    if corrections:
        print(
            "Corrected song tags: "
            + ", ".join(
                f"{item['raw']} -> {item['corrected']}" for item in corrections
            )
        )

    return tags


def brief_candidates_input(args: argparse.Namespace, tags: list[str]) -> str:
    lines = [
        f"Date seed: {args.playlist_date}",
        f"Song index: {args.song_index}",
        "",
        "Song tags:",
        ", ".join(tags),
    ]
    if args.message:
        lines.extend(["", "Extra user direction:", args.message.strip()])
    return "\n".join(lines)


def extract_json_array(text: str):
    clean = text.strip()
    if clean.startswith("```"):
        clean = re.sub(r"^```(?:json)?\s*", "", clean)
        clean = re.sub(r"\s*```$", "", clean)

    start = clean.find("[")
    end = clean.rfind("]")
    if start < 0 or end < start:
        raise SystemExit(f"Brief candidates response is not a JSON list:\n{clean}")

    try:
        return json.loads(clean[start : end + 1])
    except json.JSONDecodeError as error:
        raise SystemExit(f"Invalid brief candidates JSON:\n{clean}") from error


def normalize_brief_candidates(value) -> list[dict[str, str]]:
    if not isinstance(value, list) or len(value) != 3:
        raise SystemExit("Brief candidates JSON must be a list with exactly 3 objects.")

    normalized = []
    for index, item in enumerate(value, start=1):
        if not isinstance(item, dict):
            raise SystemExit(f"Brief candidate {index} is not an object.")

        candidate = {}
        missing = []
        for field in BRIEF_FIELDS:
            text = str(item.get(field, "")).strip()
            if not text:
                missing.append(field)
            candidate[field] = text

        if missing:
            raise SystemExit(
                f"Brief candidate {index} is missing fields: {', '.join(missing)}"
            )

        normalized.append(candidate)

    return normalized


def choose_brief_candidate(
    args: argparse.Namespace,
    tags: list[str],
    candidates: list[dict[str, str]],
) -> tuple[int, dict[str, str]]:
    seed = args.brief_choice_seed or (
        f"{args.playlist_date}:{args.song_index}:{'|'.join(tags)}"
    )
    rng = random.Random(seed)
    selected_index = rng.randrange(len(candidates))
    return selected_index, candidates[selected_index]


def run_brief_candidates(
    args: argparse.Namespace,
    api_key: str,
    tags: list[str],
) -> tuple[list[dict[str, str]], int, dict[str, str]]:
    prompt = read_text(PROMPT_ROOT / PROMPT_FILES["brief_candidates"])
    text, _data = run_prompt(args, api_key, prompt, brief_candidates_input(args, tags))
    candidates = normalize_brief_candidates(extract_json_array(text))
    selected_index, selected = choose_brief_candidate(args, tags, candidates)
    return candidates, selected_index, selected


def selected_brief_user_text(
    args: argparse.Namespace,
    tags: list[str],
    selected: dict[str, str],
) -> str:
    parts = [
        "Song tags:",
        ", ".join(tags),
        "",
        "Selected song brief:",
        json.dumps(selected, ensure_ascii=False, indent=2),
    ]
    if args.message:
        parts.extend(["", "Extra user direction:", args.message.strip()])
    return "\n".join(parts)


def format_song_brief_result(
    *,
    tags: list[str],
    candidates: list[dict[str, str]],
    selected_index: int,
    selected: dict[str, str],
    flow_output: str | None = None,
) -> str:
    sections = [
        "# Song Brief Result",
        "",
        f"- Generated: {datetime.now().isoformat(timespec='seconds')}",
        f"- Selected: {selected_index + 1}",
        "",
        "## Song Tags",
        "",
        ", ".join(tags),
        "",
        "## Brief Candidates",
        "",
        "```json",
        json.dumps(candidates, ensure_ascii=False, indent=2),
        "```",
        "",
        "## Selected Brief",
        "",
        "```json",
        json.dumps(selected, ensure_ascii=False, indent=2),
        "```",
    ]
    if flow_output:
        sections.extend(["", "## Generated Output", "", flow_output])
    sections.append("")
    return "\n".join(sections)


def run_generation_flow(
    args: argparse.Namespace,
    api_key: str,
    user_text: str,
) -> tuple[str, str]:
    if args.kind == "both":
        if args.prompt_file:
            raise SystemExit("--prompt-file cannot be used with --kind both.")

        style_prompt = read_text(PROMPT_ROOT / PROMPT_FILES["style"])
        lyrics_prompt = read_text(PROMPT_ROOT / PROMPT_FILES["lyrics"])

        style_text, style_data = run_prompt(args, api_key, style_prompt, user_text)
        lyrics_input = (
            "原始需求:\n"
            f"{user_text}\n\n"
            "Style prompt:\n"
            f"{style_text}\n\n"
            "请根据原始需求和 Style prompt 生成 Suno 歌词栏内容。"
        )
        lyrics_text, lyrics_data = run_prompt(args, api_key, lyrics_prompt, lyrics_input)

        if args.print_json:
            output = json.dumps(
                {
                    "style_text": style_text,
                    "lyrics_text": lyrics_text,
                    "style_response": style_data,
                    "lyrics_response": lyrics_data,
                },
                ensure_ascii=False,
                indent=2,
            )
        else:
            output = (
                "STYLE PROMPT\n\n"
                f"{style_text}\n\n"
                "LYRICS\n\n"
                f"{lyrics_text}"
            )

        result_content = format_result(
            "both",
            user_text,
            style_text=style_text,
            lyrics_text=lyrics_text,
        )
        return output, result_content

    prompt_path = (
        Path(args.prompt_file)
        if args.prompt_file
        else PROMPT_ROOT / PROMPT_FILES[args.kind]
    )
    prompt_text = read_text(prompt_path)
    text, data = run_prompt(args, api_key, prompt_text, user_text)

    output = json.dumps(data, ensure_ascii=False, indent=2) if args.print_json else text
    result_content = format_result(args.kind, user_text, single_text=text)
    return output, result_content


def run_song_tags_flow(args: argparse.Namespace, api_key: str) -> Path | None:
    tags = song_tags_from_args(args)
    candidates, selected_index, selected = run_brief_candidates(args, api_key, tags)

    brief_text = (
        "BRIEF CANDIDATES\n\n"
        f"{json.dumps(candidates, ensure_ascii=False, indent=2)}\n\n"
        "SELECTED BRIEF\n\n"
        f"{json.dumps(selected, ensure_ascii=False, indent=2)}"
    )

    flow_output = None
    result_content = format_song_brief_result(
        tags=tags,
        candidates=candidates,
        selected_index=selected_index,
        selected=selected,
    )

    if not args.brief_only:
        profile = load_profile(args)
        brief_user_text = selected_brief_user_text(args, tags, selected)
        user_text = apply_profile(brief_user_text, profile)
        flow_output, flow_result = run_generation_flow(
            args,
            api_key,
            user_text,
        )
        result_content = format_song_brief_result(
            tags=tags,
            candidates=candidates,
            selected_index=selected_index,
            selected=selected,
            flow_output=flow_result,
        )

    original_kind = args.kind
    try:
        args.kind = "song-brief" if args.brief_only else f"song-{original_kind}"
        result_path = write_result(args, result_content, "song tags")
    finally:
        args.kind = original_kind

    print(brief_text if args.brief_only else f"{brief_text}\n\n{flow_output}")
    if result_path:
        print()
        print(f"Saved result: {result_path}")
    return result_path


def apply_profile(user_text: str, profile: dict | None) -> str:
    if not profile:
        return user_text

    return (
        "用户偏好 tags:\n"
        f"{profile_context(profile)}\n\n"
        "当前需求:\n"
        f"{user_text}"
    )


def response_text(data: dict) -> str:
    if isinstance(data.get("output_text"), str):
        return data["output_text"]

    parts = []
    for item in data.get("output", []) or []:
        if item.get("type") != "message":
            continue
        for content in item.get("content", []) or []:
            text = content.get("text")
            if isinstance(text, str):
                parts.append(text)

    if parts:
        return "\n".join(parts)

    return json.dumps(data, ensure_ascii=False, indent=2)


def build_payload(args: argparse.Namespace, prompt_text: str, user_text: str) -> dict:
    if args.flat:
        input_value = (
            f"{prompt_text}\n\n"
            "用户需求:\n"
            f"{user_text}"
        )
    else:
        input_value = [
            {"role": "developer", "content": prompt_text},
            {"role": "user", "content": user_text},
        ]

    return {
        "model": args.model,
        "input": input_value,
        "stream": False,
    }


def run_prompt(
    args: argparse.Namespace,
    api_key: str,
    prompt_text: str,
    user_text: str,
) -> tuple[str, dict]:
    payload = build_payload(args, prompt_text, user_text)
    data = call_responses(args.url, api_key, payload)
    return response_text(data).strip(), data


def call_responses(url: str, api_key: str, payload: dict) -> dict:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
    )

    try:
        with urllib.request.urlopen(request, timeout=180) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise SystemExit(f"HTTP {error.code}\n{detail}") from error
    except urllib.error.URLError as error:
        raise SystemExit(f"Request failed: {error.reason}") from error


def safe_slug(text: str, max_length: int = 48) -> str:
    slug = re.sub(r"[^\w\u4e00-\u9fff]+", "-", text, flags=re.UNICODE)
    slug = slug.strip("-_").lower()
    if not slug:
        return "request"
    return slug[:max_length].strip("-_") or "request"


def format_result(
    kind: str,
    user_text: str,
    style_text: str | None = None,
    lyrics_text: str | None = None,
    single_text: str | None = None,
) -> str:
    timestamp = datetime.now().isoformat(timespec="seconds")
    sections = [
        f"# Suno Prompt Result",
        "",
        f"- Generated: {timestamp}",
        f"- Kind: {kind}",
        "",
        "## Request",
        "",
        user_text,
        "",
    ]

    if kind == "both":
        sections.extend(
            [
                "## Style Prompt",
                "",
                style_text or "",
                "",
                "## Lyrics",
                "",
                lyrics_text or "",
                "",
            ]
        )
    else:
        title = {
            "style": "Style Prompt",
            "lyrics": "Lyrics",
            "original": "Output",
        }.get(kind, "Output")
        sections.extend([f"## {title}", "", single_text or "", ""])

    return "\n".join(sections)


def write_result(args: argparse.Namespace, content: str, user_text: str) -> Path | None:
    if args.no_save:
        return None

    output_dir = Path(args.output_dir)
    if not output_dir.is_absolute():
        output_dir = BACKEND_ROOT / output_dir
    output_dir.mkdir(parents=True, exist_ok=True)

    if args.output_file:
        output_path = Path(args.output_file)
        if not output_path.is_absolute():
            output_path = output_dir / output_path
    else:
        timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        output_path = output_dir / f"{timestamp}-{args.kind}-{safe_slug(user_text)}.md"

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(content, encoding="utf-8")
    return output_path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Call a local Responses API with the Suno prompt files."
    )
    parser.add_argument(
        "--kind",
        choices=KINDS,
        default="both",
        help="Which prompt flow to use.",
    )
    parser.add_argument(
        "--prompt-file",
        help="Override the prompt file path.",
    )
    parser.add_argument(
        "--message",
        "-m",
        help="User request. If omitted, stdin is used.",
    )
    parser.add_argument(
        "--song-tags",
        help="Comma-separated tags for one song; generates 3 brief candidates and picks 1.",
    )
    parser.add_argument(
        "--song-index",
        type=int,
        default=int(os.environ.get("SONG_INDEX", 1)),
        help="Stable song index seed for --song-tags brief selection.",
    )
    parser.add_argument(
        "--brief-choice-seed",
        help="Override the stable random seed used to choose 1 of 3 brief candidates.",
    )
    parser.add_argument(
        "--brief-only",
        action="store_true",
        help="With --song-tags, stop after selecting the song brief.",
    )
    parser.add_argument(
        "--init-profile",
        action="store_true",
        help="Run a one-shot setup to save user preference tags.",
    )
    parser.add_argument(
        "--daily-playlist",
        action="store_true",
        help="Generate a 10-song daily playlist prompt from saved preference tags.",
    )
    parser.add_argument(
        "--profile-file",
        default=os.environ.get("PROFILE_FILE", DEFAULT_PROFILE_FILE),
        help="Path to the saved user preference tags JSON.",
    )
    parser.add_argument(
        "--playlist-history-file",
        default=os.environ.get("PLAYLIST_HISTORY_FILE", DEFAULT_PLAYLIST_HISTORY_FILE),
        help="Path to saved daily playlist seed history.",
    )
    parser.add_argument(
        "--no-profile",
        action="store_true",
        help="Do not inject saved user preference tags into generation requests.",
    )
    parser.add_argument(
        "--no-playlist-history",
        action="store_true",
        help="Do not read or write daily playlist history.",
    )
    parser.add_argument(
        "--tag-model-path",
        default=os.environ.get("TAG_MODEL_PATH", DEFAULT_TAG_MODEL_PATH),
        help="Path to the filtered tag vocabulary model.",
    )
    parser.add_argument(
        "--no-tag-filter",
        action="store_true",
        help="Do not map style tags onto the filtered tag model vocabulary.",
    )
    parser.add_argument(
        "--playlist-date",
        default=os.environ.get("PLAYLIST_DATE", datetime.now().date().isoformat()),
        help="Stable date seed for --daily-playlist.",
    )
    parser.add_argument(
        "--playlist-total",
        type=int,
        default=int(os.environ.get("PLAYLIST_TOTAL", DEFAULT_PLAYLIST_TOTAL)),
        help="Total songs for --daily-playlist.",
    )
    parser.add_argument(
        "--playlist-profile-only",
        type=int,
        default=int(
            os.environ.get("PLAYLIST_PROFILE_ONLY", DEFAULT_PLAYLIST_PROFILE_ONLY)
        ),
        help="Songs that use only saved profile tags.",
    )
    parser.add_argument(
        "--playlist-tags-per-song",
        type=int,
        default=int(
            os.environ.get("PLAYLIST_TAGS_PER_SONG", DEFAULT_PLAYLIST_TAGS_PER_SONG)
        ),
        help="Tag count per playlist song.",
    )
    parser.add_argument(
        "--playlist-user-tags-per-hybrid",
        type=int,
        default=int(
            os.environ.get(
                "PLAYLIST_USER_TAGS_PER_HYBRID",
                DEFAULT_PLAYLIST_TAGS_PER_SONG // 2,
            )
        ),
        help="User-profile tag count for each hybrid playlist song.",
    )
    parser.add_argument(
        "--playlist-related-top-n",
        type=int,
        default=int(os.environ.get("PLAYLIST_RELATED_TOP_N", 40)),
        help="Related model-tag pool size for each hybrid playlist song.",
    )
    parser.add_argument(
        "--playlist-candidate-count",
        type=int,
        default=int(
            os.environ.get(
                "PLAYLIST_CANDIDATE_COUNT",
                DEFAULT_PLAYLIST_CANDIDATE_COUNT,
            )
        ),
        help="Candidate cluster count before diversity selection.",
    )
    parser.add_argument(
        "--playlist-diversity-weight",
        type=float,
        default=float(
            os.environ.get(
                "PLAYLIST_DIVERSITY_WEIGHT",
                DEFAULT_PLAYLIST_DIVERSITY_WEIGHT,
            )
        ),
        help="Penalty weight for cosine similarity to already selected clusters.",
    )
    parser.add_argument(
        "--playlist-max-cluster-similarity",
        type=float,
        default=float(
            os.environ.get(
                "PLAYLIST_MAX_CLUSTER_SIMILARITY",
                DEFAULT_PLAYLIST_MAX_CLUSTER_SIMILARITY,
            )
        ),
        help="Soft maximum cosine similarity between selected playlist clusters.",
    )
    parser.add_argument(
        "--playlist-history-days",
        type=int,
        default=int(
            os.environ.get("PLAYLIST_HISTORY_DAYS", DEFAULT_PLAYLIST_HISTORY_DAYS)
        ),
        help="Recent history window used for cross-day playlist diversity.",
    )
    parser.add_argument(
        "--playlist-history-weight",
        type=float,
        default=float(
            os.environ.get("PLAYLIST_HISTORY_WEIGHT", DEFAULT_PLAYLIST_HISTORY_WEIGHT)
        ),
        help="Penalty weight for cosine similarity to recent playlist history.",
    )
    parser.add_argument(
        "--playlist-history-tag-weight",
        type=float,
        default=float(
            os.environ.get(
                "PLAYLIST_HISTORY_TAG_WEIGHT",
                DEFAULT_PLAYLIST_HISTORY_TAG_WEIGHT,
            )
        ),
        help="Penalty weight for tag overlap with recent playlist history.",
    )
    parser.add_argument(
        "--url",
        default=os.environ.get("RESPONSES_URL", "http://127.0.0.1:8080/v1/responses"),
        help="Responses API URL.",
    )
    parser.add_argument(
        "--model",
        default=os.environ.get("RESPONSES_MODEL", "gpt-5.5"),
        help="Model name.",
    )
    parser.add_argument(
        "--api-key-env",
        default="OPENAI_API_KEY",
        help="Environment variable containing the bearer token.",
    )
    parser.add_argument(
        "--flat",
        action="store_true",
        help="Send prompt and user request as one string input, closer to the curl example.",
    )
    parser.add_argument(
        "--print-json",
        action="store_true",
        help="Print the full JSON response instead of extracted text.",
    )
    parser.add_argument(
        "--output-dir",
        default=os.environ.get("RESULTS_DIR", "results"),
        help="Directory for saved result files.",
    )
    parser.add_argument(
        "--output-file",
        help="Optional result filename. Relative paths are placed under --output-dir.",
    )
    parser.add_argument(
        "--no-save",
        action="store_true",
        help="Print only; do not write a result file.",
    )
    return parser.parse_args()


def main() -> int:
    load_dotenv(BACKEND_ROOT / ".env")

    args = parse_args()
    api_key = os.environ.get(args.api_key_env)
    if not api_key:
        raise SystemExit(f"Missing API key. Set {args.api_key_env}.")

    if args.init_profile:
        path = run_profile_setup(args, api_key)
        profile = json.loads(path.read_text(encoding="utf-8"))
        print()
        print(f"Saved profile: {path}")
        print()
        print("TAGS")
        print(", ".join(profile.get("tags", [])))
        if profile.get("raw_tags"):
            print()
            print("RAW TAGS")
            print(", ".join(profile.get("raw_tags", [])))
        if profile.get("corrected_tags"):
            print()
            print("CORRECTED TAGS")
            print(
                ", ".join(
                    f"{item['raw']} -> {item['corrected']}"
                    for item in profile.get("corrected_tags", [])
                )
            )
        if profile.get("unknown_tags"):
            print()
            print("UNKNOWN TAGS")
            print(", ".join(profile.get("unknown_tags", [])))
        return 0

    if args.daily_playlist:
        run_daily_playlist(args, api_key)
        return 0

    if args.song_tags:
        run_song_tags_flow(args, api_key)
        return 0

    raw_user_text = args.message if args.message is not None else sys.stdin.read().strip()
    if not raw_user_text:
        raise SystemExit("Missing user request. Pass --message or pipe text to stdin.")
    profile = load_profile(args)
    user_text = apply_profile(raw_user_text, profile)
    output, result_content = run_generation_flow(args, api_key, user_text)
    result_path = write_result(args, result_content, raw_user_text)

    print(output)
    if result_path:
        print()
        print(f"Saved result: {result_path}")

    return 0
