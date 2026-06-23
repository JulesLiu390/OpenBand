from __future__ import annotations

import pytest

from openband.prompt_generation import cli as prompt_cli
from openband.daily import suno_batch_failure_message
from openband.suno_browser.client import SunoBrowserCommand, run_suno_browser_command


def test_prompt_generation_prompts_are_packaged() -> None:
    for prompt_file in prompt_cli.PROMPT_FILES.values():
        assert (prompt_cli.PROMPT_ROOT / prompt_file).exists()


def test_prompt_generation_corrects_allowed_style_tags() -> None:
    tags, corrections, rejected, exact = prompt_cli.correct_style_tags(
        ["electronic rock", "jazz", "totally unknown"],
        ["electronic", "jazz"],
    )

    assert tags == ["electronic", "jazz"]
    assert corrections == [{"raw": "electronic rock", "corrected": "electronic", "method": "alias"}]
    assert rejected == ["totally unknown"]
    assert exact == ["jazz"]


def test_suno_browser_command_json_output() -> None:
    result = SunoBrowserCommand(
        command=["node", "script.mjs"],
        returncode=0,
        stdout='{"ok": true}',
        stderr="",
    )

    assert result.json_output() == {"ok": True}


def test_suno_browser_command_json_output_ignores_stdout_noise() -> None:
    result = SunoBrowserCommand(
        command=["node", "batch-suno.mjs"],
        returncode=0,
        stdout='◇ injected env (0) from .env // tip: { debug: true }\n{"results": []}\n',
        stderr="",
    )

    assert result.json_output() == {"results": []}


def test_suno_captcha_error_gets_clear_failure_message() -> None:
    result = SunoBrowserCommand(
        command=["node", "batch-suno.mjs"],
        returncode=1,
        stdout="",
        stderr='{"code":"SUNO_CAPTCHA_REQUIRED","error":"SUNO_CAPTCHA_REQUIRED: Screenshot saved."}',
    )

    message, stage = suno_batch_failure_message(result, batch_index=2)

    assert stage == "captcha_required"
    assert "human verification" in message
    assert "Batch 2 is resumable" in message
    assert "SUNO_CAPTCHA_REQUIRED:" not in message


def test_suno_browser_missing_script_fails_fast() -> None:
    with pytest.raises(FileNotFoundError):
        run_suno_browser_command("missing-script.mjs")
