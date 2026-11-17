#!/usr/bin/env python3
"""Extract the CLI model id from the unified model variable.

Usage:
  python3 model-cli.py '<MODEL value>' [--fallback] -> prints cli id, exit 0.
Input (env var or single JSON string), in order of preference:
  1. JSON {"cli": "...", ...} -> cli field (must be a non-empty string).
     With --fallback: JSON {"fallback_cli": "..."} -> fallback id.
  2. Legacy space-separated / bare id -> first token (--fallback: no fallback, exit 1).
Anything else (empty, malformed JSON, non-string cli) -> exit 1, message on stderr.
Mirrors scripts/model-target.ts parseModelVar (single source of truth lives there
for TS; this file is the shell-side equivalent, covered by the same contract).
No fallback_cli (missing/empty) = no fallback: --fallback exits 1 and callers
keep the old single-model behavior.
"""

import json
import sys


def extract(raw: str) -> str:
    t = (raw or "").strip()
    if not t:
        return ""
    if t.startswith("{"):
        try:
            o = json.loads(t)
        except Exception as e:
            print(f"bad model JSON: {e}", file=sys.stderr)
            return ""
        if not isinstance(o, dict):
            return ""
        cli = o.get("cli")
        return cli.strip() if isinstance(cli, str) and cli.strip() else ""
    return t.split()[0] if t.split() else ""


def extract_fallback(raw: str) -> str:
    t = (raw or "").strip()
    if not t or not t.startswith("{"):
        return ""
    try:
        o = json.loads(t)
    except Exception as e:
        print(f"bad model JSON: {e}", file=sys.stderr)
        return ""
    if not isinstance(o, dict):
        return ""
    fb = o.get("fallback_cli")
    return fb.strip() if isinstance(fb, str) and fb.strip() else ""


def main() -> int:
    args = sys.argv[1:]
    want_fallback = "--fallback" in args
    args = [a for a in args if a != "--fallback"]
    if len(args) != 1:
        print("usage: model-cli.py '<MODEL value>' [--fallback]", file=sys.stderr)
        return 1
    cli = extract_fallback(args[0]) if want_fallback else extract(args[0])
    if not cli:
        print("empty model id: refusing to guess", file=sys.stderr)
        return 1
    print(cli)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
