from __future__ import annotations

import argparse
import sys

from openband.suno_browser.client import run_suno_browser_command


SCRIPT_BY_COMMAND = {
    "open": "open-suno-chrome.mjs",
    "inspect": "inspect-suno.mjs",
    "create": "create-suno.mjs",
    "download": "download-suno.mjs",
    "generate-download": "generate-download-suno.mjs",
    "batch": "batch-suno.mjs",
}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Run Suno browser automation scripts from the backend module."
    )
    parser.add_argument("command", choices=sorted(SCRIPT_BY_COMMAND))
    parser.add_argument("args", nargs=argparse.REMAINDER)
    parser.add_argument("--timeout-seconds", type=int)
    namespace = parser.parse_args(argv)

    result = run_suno_browser_command(
        SCRIPT_BY_COMMAND[namespace.command],
        namespace.args,
        timeout_seconds=namespace.timeout_seconds,
    )
    if result.stdout:
        print(result.stdout, end="")
    if result.stderr:
        print(result.stderr, end="", file=sys.stderr)
    return result.returncode


if __name__ == "__main__":
    raise SystemExit(main())

