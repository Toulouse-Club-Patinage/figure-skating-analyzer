"""Generate sov_2026_2027.json from the ISU Scale of Values PDF.

Source: ISU Communication 2786 (Singles & Pairs SOV), which replaces 2707.
Vendored at backend/scripts/sources/2786-SinglesPairs-SOV-2026-27.pdf.

Usage:
    uv run python scripts/build_sov.py

Requires `pdftotext` (poppler) on PATH: brew install poppler
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent
SOURCE_PDF = SCRIPTS_DIR / "sources" / "2786-SinglesPairs-SOV-2026-27.pdf"
OUTPUT = SCRIPTS_DIR.parent / "app" / "data" / "sov_2026_2027.json"

SEASON = "2026-2027"

# A data row is a code followed by 11 numbers: GOE -5..-1, BASE, GOE +1..+5.
ROW = re.compile(r"^\s*([A-Za-z0-9<>!*+qebV]+)\s+((?:-?\d+,\d+\s+){10}-?\d+,\d+)\s*$")
# Same, but the code was lost in the PDF's text layer (column artefact).
ORPHAN = re.compile(r"^\s+((?:-?\d+,\d+\s+){10}-?\d+,\d+)\s*$")

# Section header -> (type, category). Tracked while walking the document.
SECTIONS = {
    "Jumps": ("jump", "single"),
    "Spins": ("spin", "single"),
    "Spin in one position and no change of foot (upright, layback, camel or sit)": ("spin", "single"),
    "Spins with change of foot": ("spin", "single"),
    "Spin Combination with change of position and no change of foot": ("spin", "single"),
    "Spin Combination with change of position and change of foot": ("spin", "single"),
    "Step Sequence": ("step", "single"),
    "Lifts": ("lift", "pair"),
    "Twist Lifts": ("twist", "pair"),
    "Throw Jumps": ("throw", "pair"),
    "Death Spirals": ("death_spiral", "pair"),
    "Advanced Novice Death Spirals eligible for bonus (b)": ("death_spiral", "pair"),
    "Pivot Figure": ("pivot", "pair"),
    "Pair Spins": ("pair_spin", "pair"),
    "Pair Spin Combination": ("pair_spin", "pair"),
    "Choreographic Step Sequence": ("choreo", "single"),
    # Typed as a spin on purpose: the Book counts the choreographic spin among
    # the three allowed spins, so typing it "choreo" would break max_spins.
    "Choreographic Spin": ("spin", "single"),
    "Choreographic Pair Spin": ("pair_spin", "pair"),
    "Choreographic Pair Lift": ("lift", "pair"),
}

# Four rows lose their code label to a column artefact, all at base value 8.00.
# In document order they are 3A, 3Ab (before the 4T block) and 3Aq, 3Aqb
# (before the 4Tq block). The b-variants are dropped later as duplicates.
ORPHAN_CODES = ["3A", "3Ab", "3Aq", "3Aqb"]
ORPHAN_BASE_VALUE = 8.00


def extract_text(pdf: Path) -> str:
    result = subprocess.run(
        ["pdftotext", "-layout", str(pdf), "-"],
        capture_output=True, text=True, check=True,
    )
    return result.stdout


def parse(text: str) -> dict[str, dict]:
    elements: dict[str, dict] = {}
    orphans: list[list[float]] = []
    current = ("jump", "single")

    for line in text.splitlines():
        stripped = line.strip()
        if stripped in SECTIONS:
            current = SECTIONS[stripped]
            continue

        m = ROW.match(line)
        if m:
            code = m.group(1)
            values = [float(v.replace(",", ".")) for v in m.group(2).split()]
            elements[code] = {
                "category": current[1],
                "type": current[0],
                "base_value": values[5],
                "goe": values[0:5] + values[6:11],
            }
            continue

        m = ORPHAN.match(line)
        if m:
            values = [float(v.replace(",", ".")) for v in m.group(1).split()]
            orphans.append(values)

    if len(orphans) != len(ORPHAN_CODES):
        raise SystemExit(
            f"Expected {len(ORPHAN_CODES)} unlabelled rows, found {len(orphans)}. "
            "The PDF layout changed — re-inspect before trusting this output."
        )
    for code, values in zip(ORPHAN_CODES, orphans):
        if values[5] != ORPHAN_BASE_VALUE:
            raise SystemExit(
                f"Unlabelled row for {code} has base value {values[5]}, "
                f"expected {ORPHAN_BASE_VALUE}."
            )
        elements[code] = {
            "category": "single",
            "type": "jump",
            "base_value": values[5],
            "goe": values[0:5] + values[6:11],
        }

    return elements


def drop_bonus_duplicates(elements: dict[str, dict]) -> dict[str, dict]:
    """Drop b-suffixed rows: value-identical to their stem, so they would only
    pollute the element picker. The bonus is computed, not stored."""
    dropped = {}
    for code in [c for c in elements if c.endswith("b")]:
        stem = code[:-1]
        if stem in elements and elements[stem]["base_value"] != elements[code]["base_value"]:
            raise SystemExit(
                f"{code} is not value-neutral against {stem} "
                f"({elements[code]['base_value']} vs {elements[stem]['base_value']}). "
                "The bonus rows now carry value — they can no longer be dropped."
            )
        dropped[code] = elements.pop(code)
    return dropped


def main() -> None:
    if not SOURCE_PDF.exists():
        raise SystemExit(f"Missing source PDF: {SOURCE_PDF}")

    elements = parse(extract_text(SOURCE_PDF))
    dropped = drop_bonus_duplicates(elements)

    for required in ("Eu", "ChSp1", "ChPSp1", "ChPLi1", "3A", "5Lz"):
        if required not in elements:
            raise SystemExit(f"Expected element {required!r} missing from parse output.")

    OUTPUT.write_text(
        json.dumps({"season": SEASON, "elements": elements}, indent=2, ensure_ascii=False) + "\n"
    )
    print(f"Wrote {len(elements)} elements to {OUTPUT} ({len(dropped)} b-rows dropped)", file=sys.stderr)


if __name__ == "__main__":
    main()
