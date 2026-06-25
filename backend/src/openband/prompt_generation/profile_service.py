from __future__ import annotations

import re
from dataclasses import dataclass
from types import SimpleNamespace

from openband.prompt_generation import cli as prompt_cli


@dataclass(frozen=True)
class GeneratedMusicProfile:
    input_text: str
    reference_summary: str
    source_notes: str
    tags: list[str]
    raw_tags: list[str]
    known_tags: list[str]
    corrected_tags: list[dict[str, str]]
    unknown_tags: list[str]
    tag_meanings: list[dict[str, str]]
    profile_output_text: str


def generate_music_profile(
    *,
    input_text: str,
    api_key: str,
    url: str,
    model: str,
    allowed_tags: list[str],
    flat: bool = False,
) -> GeneratedMusicProfile:
    clean_input = input_text.strip()
    if not clean_input:
        raise ValueError("No profile input provided.")

    profile_prompt = prompt_cli.read_text(
        prompt_cli.PROMPT_ROOT / prompt_cli.PROMPT_FILES["profile"]
    )
    if allowed_tags:
        tag_list = "\n".join(f"- {tag}" for tag in allowed_tags)
        profile_prompt = (
            f"{profile_prompt}\n\n"
            "Allowed TAGS whitelist:\n"
            f"{tag_list}\n\n"
            "When using music/style/sound tags, copy them exactly from the whitelist above."
        )

    args = SimpleNamespace(url=url, model=model, flat=flat)
    profile_text, _profile_data = prompt_cli.run_prompt(
        args,
        api_key,
        profile_prompt,
        "用户输入:\n" + clean_input,
    )
    sections = prompt_cli.parse_profile_sections(profile_text)
    raw_tags = prompt_cli.parse_tag_text(sections.get("tags", ""))
    raw_tag_meanings = _parse_tag_meanings(sections.get("tag_meanings", ""))
    if not raw_tags:
        raw_tags = prompt_cli.dedupe(
            [
                *prompt_cli.parse_tag_text(sections.get("style_tags", "")),
                *prompt_cli.parse_tag_text(sections.get("lyric_tags", "")),
                *prompt_cli.parse_tag_text(sections.get("negative_tags", "")),
            ]
        )

    if allowed_tags:
        positive_raw_tags = [
            tag
            for tag in raw_tags
            if not prompt_cli.canonical_tag(tag).startswith("no ")
        ]
        negative_tags = [
            prompt_cli.negative_tag(prompt_cli.canonical_tag(tag)[3:])
            for tag in raw_tags
            if prompt_cli.canonical_tag(tag).startswith("no ")
        ]
        style_tags, corrections, unknown_tags, known_tags = prompt_cli.correct_style_tags(
            positive_raw_tags,
            allowed_tags,
        )
        tags = prompt_cli.dedupe([*style_tags, *negative_tags, *unknown_tags])
    else:
        tags = raw_tags
        corrections = []
        unknown_tags = []
        known_tags = raw_tags

    tag_meanings = _resolve_tag_meanings(raw_tag_meanings, tags, corrections)

    return GeneratedMusicProfile(
        input_text=clean_input,
        reference_summary=sections.get("reference_summary", ""),
        source_notes=sections.get("source_notes", ""),
        tags=tags,
        raw_tags=raw_tags,
        known_tags=known_tags,
        corrected_tags=corrections,
        unknown_tags=unknown_tags,
        tag_meanings=tag_meanings,
        profile_output_text=profile_text,
    )


def _parse_tag_meanings(text: str) -> dict[str, str]:
    meanings: dict[str, str] = {}
    for raw_line in text.splitlines():
        line = raw_line.strip()
        line = re.sub(r"^[-*•]\s*", "", line)
        line = re.sub(r"^\d+[.)]\s*", "", line)
        if not line:
            continue

        match = re.match(r"(.+?)\s*[:：]\s*(.+)$", line)
        if match is None:
            match = re.match(r"(.+?)\s+[-–—]\s+(.+)$", line)
        if match is None:
            continue

        tag = match.group(1).strip().strip("'\"`[](){}")
        meaning = re.sub(r"\s+", " ", match.group(2).strip())
        key = prompt_cli.canonical_tag(tag)
        if key and meaning:
            meanings[key] = _trim_meaning(meaning)
    return meanings


def _resolve_tag_meanings(
    raw_meanings: dict[str, str],
    tags: list[str],
    corrections: list[dict[str, str]],
) -> list[dict[str, str]]:
    raw_keys_by_final: dict[str, list[str]] = {}
    for correction in corrections:
        raw_key = prompt_cli.canonical_tag(correction.get("raw", ""))
        final_key = prompt_cli.canonical_tag(correction.get("corrected", ""))
        if raw_key and final_key:
            raw_keys_by_final.setdefault(final_key, []).append(raw_key)

    meanings: list[dict[str, str]] = []
    seen: set[str] = set()
    for tag in tags:
        key = prompt_cli.canonical_tag(tag)
        if not key or key in seen:
            continue

        meaning = raw_meanings.get(key)
        if not meaning:
            for raw_key in raw_keys_by_final.get(key, []):
                meaning = raw_meanings.get(raw_key)
                if meaning:
                    break

        meanings.append(
            {
                "tag": tag,
                "meaning": meaning or _fallback_tag_meaning(tag),
            }
        )
        seen.add(key)
    return meanings


def _fallback_tag_meaning(tag: str) -> str:
    clean = tag.strip()
    canonical = prompt_cli.canonical_tag(clean)
    if canonical.startswith("no "):
        target = clean[3:].strip() if clean.lower().startswith("no ") else canonical[3:]
        return f"Avoids {target} elements in music recommendations and generation prompts."
    return (
        f"Signals a preference for {clean} in the music's style, sound, mood, "
        "arrangement, or production."
    )


def _trim_meaning(meaning: str, limit: int = 220) -> str:
    if len(meaning) <= limit:
        return meaning
    return meaning[: limit - 3].rstrip() + "..."
