from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


MODULE_ROOT = Path(__file__).resolve().parent
PLAYWRIGHT_ROOT = MODULE_ROOT / "playwright"
SCRIPTS_ROOT = PLAYWRIGHT_ROOT / "scripts"


@dataclass(frozen=True)
class SunoBrowserCommand:
    """Result from a local Suno browser automation command."""

    command: list[str]
    returncode: int
    stdout: str
    stderr: str

    def json_output(self) -> object | None:
        stdout = self.stdout.strip()
        try:
            return json.loads(stdout)
        except json.JSONDecodeError:
            pass

        decoder = json.JSONDecoder()
        for index, character in enumerate(stdout):
            if character != "{":
                continue
            try:
                value, end = decoder.raw_decode(stdout[index:])
            except json.JSONDecodeError:
                continue
            if stdout[index + end :].strip():
                continue
            return value
        return None


def run_suno_browser_command(
    script_name: str,
    args: Iterable[str] = (),
    *,
    timeout_seconds: int | None = None,
) -> SunoBrowserCommand:
    script_path = SCRIPTS_ROOT / script_name
    if not script_path.exists():
        raise FileNotFoundError(f"Suno browser script not found: {script_path}")

    command = ["node", str(script_path), *list(args)]
    completed = subprocess.run(
        command,
        cwd=PLAYWRIGHT_ROOT,
        capture_output=True,
        check=False,
        text=True,
        timeout=timeout_seconds,
    )
    return SunoBrowserCommand(
        command=command,
        returncode=completed.returncode,
        stdout=completed.stdout,
        stderr=completed.stderr,
    )
