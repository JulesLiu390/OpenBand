from __future__ import annotations

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

    return GeneratedMusicProfile(
        input_text=clean_input,
        reference_summary=sections.get("reference_summary", ""),
        source_notes=sections.get("source_notes", ""),
        tags=tags,
        raw_tags=raw_tags,
        known_tags=known_tags,
        corrected_tags=corrections,
        unknown_tags=unknown_tags,
        profile_output_text=profile_text,
    )
