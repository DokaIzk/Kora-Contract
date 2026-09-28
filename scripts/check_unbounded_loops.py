#!/usr/bin/env python3
"""Static check for unbounded loops in Soroban contracts.

Scans Rust source files under ``contracts/`` for ``for``/``while``/``loop``
constructs that are not guarded by an explicit, bounded iteration limit.

A loop is considered *bounded* when, within the loop's body or its immediate
preceding lines, there is a reference to a constant/limit identifier that
matches one of the known bound patterns (e.g. ``MAX_BATCH_SIZE``,
``MAX_INVOICES``, ``MAX_ITEMS``, ``LIMIT``, ``CAP``).

Known, reviewed exceptions are recorded in
``scripts/unbounded_loop_baseline.txt`` (one ``path:line`` entry per line).
Any unbounded loop not present in the baseline fails the check.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
CONTRACTS_DIR = REPO_ROOT / "contracts"
BASELINE_FILE = Path(__file__).resolve().parent / "unbounded_loop_baseline.txt"

LOOP_RE = re.compile(r"\b(for|while|loop)\b")

# Identifiers that indicate an explicit, reviewed upper bound.
BOUND_PATTERNS = (
    "MAX_BATCH_SIZE",
    "MAX_BATCH_MINT_SIZE",  # New: batch minting bound (wave feature)
    "MAX_BATCH",
    "MAX_INVOICES",
    "MAX_VERIFIERS",  # New: multi-verifier aggregation bound (wave feature)
    "MAX_ATTESTORS",  # New: alternative attestor bound naming
    "MAX_WITHDRAWAL_QUEUE",  # New: withdrawal queue processing bound (wave feature)
    "MAX_ITEMS",
    "MAX_LEN",
    "MAX_COUNT",
    "MAX_SIZE",
    "BATCH_LIMIT",
    "MAX_LOOP",
    "MAX_NETTING_INVOICES",  # New: cross-invoice netting bound
    "MAX_POSITIONS",  # New: position enumeration bound
    "LIMIT",
    "CAP",
)

# How many lines after a loop header to inspect for a bound reference.
LOOKAHEAD = 12


def load_baseline() -> set[str]:
    if not BASELINE_FILE.exists():
        return set()
    entries: set[str] = set()
    for raw in BASELINE_FILE.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        entries.add(line)
    return entries


def has_bound(lines: list[str], index: int) -> bool:
    """Return True if a bound identifier appears near the loop at ``index``."""
    window = lines[index : index + LOOKAHEAD]
    for candidate in window:
        for pattern in BOUND_PATTERNS:
            if pattern in candidate:
                return True
    return False


def scan_file(path: Path) -> list[str]:
    findings: list[str] = []
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except (OSError, UnicodeDecodeError):
        return findings

    for idx, line in enumerate(lines):
        stripped = line.strip()
        if stripped.startswith("//") or stripped.startswith("#"):
            continue
        if not LOOP_RE.search(line):
            continue
        # Skip iterator-style closures that are not contract loops.
        if ".iter()" in line and "for" not in line:
            continue
        if has_bound(lines, idx):
            continue
        rel = path.relative_to(REPO_ROOT).as_posix()
        findings.append(f"{rel}:{idx + 1}")
    return findings


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--update-baseline",
        action="store_true",
        help="Rewrite the baseline with the currently detected findings.",
    )
    args = parser.parse_args()

    baseline = load_baseline()
    findings: list[str] = []

    if CONTRACTS_DIR.exists():
        for path in sorted(CONTRACTS_DIR.rglob("*.rs")):
            findings.extend(scan_file(path))

    if args.update_baseline:
        header = (
            "# Reviewed unbounded-loop exceptions (path:line).\n"
            "# Regenerate with: python scripts/check_unbounded_loops.py --update-baseline\n"
        )
        body = "\n".join(sorted(findings))
        BASELINE_FILE.write_text(header + body + ("\n" if body else ""), encoding="utf-8")
        print(f"Baseline updated with {len(findings)} entr{'y' if len(findings) == 1 else 'ies'}.")
        return 0

    new_findings = [f for f in findings if f not in baseline]

    if new_findings:
        print("Unbounded loops detected that are not in the baseline:")
        for finding in new_findings:
            print(f"  {finding}")
        print(
            "\nAdd an explicit bound (e.g. MAX_BATCH_SIZE) or, if reviewed and safe, "
            "record it in scripts/unbounded_loop_baseline.txt."
        )
        return 1

    print(f"OK: no new unbounded loops ({len(findings)} known exception(s)).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
