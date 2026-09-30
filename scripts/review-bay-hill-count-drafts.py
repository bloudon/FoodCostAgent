#!/usr/bin/env python3
"""Classify the operator's read-only psql section C without copying raw output into git.

Usage: python scripts/review-bay-hill-count-drafts.py INPUT.txt > /tmp/bay-hill-draft-findings.csv
The output omits names, locations, prices, and quantities; source/line IDs remain
so the operator can inspect the retained private source evidence for each verdict.
"""
import csv
import re
import sys
from collections import Counter

EVIDENCE = re.compile(
    r"^(.*?) \[([^/]+)/([^/]+)/([^]]+)\] parts=([^/]+)/([^/]+)/([^ ]+) total=([^ ]+) raw=(.*)$"
)
PACK = re.compile(r"^([0-9.]+)/([0-9.]+)\s+([0-9.]*)([A-Za-z]+)$")
SESSIONS = {
    "a454cf0a-dba2-46b5-b191-06ae67fb55e6": ("May", 2512, "cdcfeead-8fa4-4b84-a3b8-9e8b0fa62c55"),
    "af1bea97-b199-4864-9968-dacd03d3d1a8": ("June", 2339, "1be3bb58-c7c7-4091-b749-6bc64724fe4b"),
}


def number(text):
    if text in ("", "NULL"):
        return None
    return float(text)


def near(a, b):
    return a is not None and b is not None and abs(a - b) <= 0.0001 * max(1, abs(a), abs(b))


def unit(text):
    value = text.strip().lower()
    return {"each": "ea", "pound": "lb", "pounds": "lb",
            "ounce": "oz", "ounces": "oz"}.get(value, value)


def read_psql(path):
    with open(path, encoding="utf-8") as handle:
        lines = handle.readlines()
    if not lines or not lines[0].startswith("C. ") or not any(line.strip() == "ROLLBACK" for line in lines):
        raise ValueError("Expected completed psql section C, ending in ROLLBACK")
    header = lines[1]
    columns = [column.strip() for column in header.split("|")]
    if columns != [
        "session_id", "period", "source_batch_id", "line_id", "inventory_item_id",
        "item_name", "location_name", "unit_id", "saved_unit", "qty", "case_qty",
        "container_qty", "loose_units", "candidate_rows", "candidate_batches",
        "source_row_refs", "source_evidence", "link_status",
    ]:
        raise ValueError("Unexpected section C columns; do not guess field offsets")
    breaks = [index for index, char in enumerate(header) if char == "|"]
    rows = []
    for line in lines[3:]:
        if not line.strip() or line.strip() == "ROLLBACK" or line.startswith("("):
            continue
        cells = [line[start + 1:end].strip() for start, end in
                 zip([-1] + breaks, breaks + [len(line)])]
        row = dict(zip(columns, cells))
        if row["session_id"] not in SESSIONS:
            raise ValueError("Unexpected session in operator result")
        period, _, batch_id = SESSIONS[row["session_id"]]
        if row["period"] != period or row["source_batch_id"] != batch_id:
            raise ValueError("Session date or source batch did not match operator summary")
        if row["candidate_batches"] != "1" or int(row["candidate_rows"]) < 1:
            raise ValueError("Unexpected unmatched or cross-batch source candidate")
        rows.append(row)
    actual = Counter(row["session_id"] for row in rows)
    if any(actual[session] != expected for session, (_, expected, _) in SESSIONS.items()):
        raise ValueError(f"Section C incomplete; actual line counts: {dict(actual)}")
    if len({row["line_id"] for row in rows}) != len(rows):
        raise ValueError("Duplicate saved line ID in section C")
    return rows


def classify(row):
    parsed = []
    for text in row["source_evidence"].split("; "):
        match = EVIDENCE.fullmatch(text)
        if not match:
            raise ValueError("Unparseable source evidence for line " + row["line_id"])
        pack, tier1, tier2, tier3, *numbers = match.groups()
        parsed.append((pack, tier1, tier2, tier3, *map(number, numbers)))
    if len(parsed) != int(row["candidate_rows"]):
        raise ValueError("Source evidence count differs from source row count")

    source_parts = []
    for index in (4, 5, 6, 7):
        values = [source[index] for source in parsed]
        source_parts.append(sum(value for value in values if value is not None)
                            if any(value is not None for value in values) else None)
    saved_parts = [number(row[name]) for name in ("case_qty", "container_qty", "loose_units", "qty")]
    part_flags = ["match" if near(source, saved) else
                  "both_null" if source is None and saved is None else "different"
                  for source, saved in zip(source_parts, saved_parts)]

    source_units = []
    reasons = set()
    for pack, tier1, tier2, tier3, case, container, loose, total, raw_total in parsed:
        geometry = PACK.fullmatch(pack.strip())
        if not geometry:
            reasons.add("opaque_or_unparseable_pack")
            continue
        case_size, inner_size, base_size, base_unit = geometry.groups()
        case_size, inner_size = float(case_size), float(inner_size)
        base_size = float(base_size) if base_size else 1.0
        src_unit = unit(tier3)
        if (case_size <= 0 or inner_size <= 0 or base_size <= 0 or
            src_unit in ("", "case", "pack") or src_unit != unit(base_unit) or
            (case is not None and case > 0 and unit(tier1) != "case") or
            (container is not None and container > 0 and unit(tier2) != "pack")):
            reasons.add("unverified_tier_or_unit")
            continue
        if total is None or raw_total is None or not near(total, raw_total):
            reasons.add("raw_total_not_verified")
            continue
        implied = ((case or 0) * case_size * inner_size * base_size +
                   (container or 0) * inner_size * base_size + (loose or 0) * base_size)
        if not near(implied, total):
            reasons.add("pack_arithmetic_differs_from_source_total")
            continue
        source_units.append(src_unit)
    if len(source_units) != len(parsed) or len(set(source_units)) != 1 or not row["saved_unit"]:
        verdict = "unit_unverified"
    elif source_units[0] == unit(row["saved_unit"]):
        verdict = "declared_unit_agrees"
    else:
        verdict = "declared_unit_differs"
    if not all(flag != "different" for flag in part_flags):
        reasons.add("saved_parts_or_quantity_differ")
    return {
        "period": row["period"],
        "session_id": row["session_id"],
        "line_id": row["line_id"],
        "inventory_item_id": row["inventory_item_id"],
        "source_row_refs": row["source_row_refs"],
        "source_rows": row["candidate_rows"],
        "source_tier_units": ";".join(sorted({source[3] for source in parsed})),
        "saved_unit": row["saved_unit"],
        "case_parts": part_flags[0],
        "container_parts": part_flags[1],
        "loose_parts": part_flags[2],
        "total_quantity": part_flags[3],
        "unit_finding": verdict,
        "review_reason": ";".join(sorted(reasons)),
    }


def main():
    if len(sys.argv) != 2:
        raise SystemExit("Usage: review-bay-hill-count-drafts.py SECTION-C.txt")
    findings = [classify(row) for row in read_psql(sys.argv[1])]
    writer = csv.DictWriter(sys.stdout, fieldnames=list(findings[0]))
    writer.writeheader()
    writer.writerows(findings)
    for period in ("May", "June"):
        scoped = [row for row in findings if row["period"] == period]
        print(period, dict(Counter(row["unit_finding"] for row in scoped)),
              "part/quantity differences:", sum(
                  "different" in (row["case_parts"], row["container_parts"],
                                  row["loose_parts"], row["total_quantity"])
                  for row in scoped),
              "multi-source lines:", sum(int(row["source_rows"]) > 1 for row in scoped),
              file=sys.stderr)


if __name__ == "__main__":
    main()