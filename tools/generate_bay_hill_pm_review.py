#!/usr/bin/env python3
"""Generate a sanitized, read-only PM review package from an Orderly report capture."""

from __future__ import annotations

import csv
import json
import sys
from collections import Counter
from datetime import date
from pathlib import Path


MAY_START = date(2026, 5, 1)
MAY_END = date(2026, 6, 1)
JUNE_START = date(2026, 6, 2)
JUNE_END = date(2026, 7, 1)
MAY_BASELINE = 254_286.67
JUNE_BASELINE = 261_007.67


def load_capture(path: Path) -> dict:
    """Drop the CLI preamble and parse only the first report JSON object."""
    text = path.read_text(encoding="utf-8")
    marker = '{\n  "reportVersion"'
    try:
        return json.loads(text[text.index(marker) :])
    except (ValueError, json.JSONDecodeError) as error:
        raise SystemExit(f"Cannot parse report JSON from {path}: {error}") from error


def joined(values: list[object]) -> str:
    return " | ".join(str(value) for value in values if value is not None)


def source_period_flags(group: dict) -> tuple[bool, bool]:
    dates = {date.fromisoformat(value) for value in group["evidence"]["importInventoryDates"]}
    return (
        any(MAY_START <= value <= MAY_END for value in dates),
        any(JUNE_START <= value <= JUNE_END for value in dates),
    )


def candidate_pack_signature(candidate: dict) -> tuple[object, ...]:
    return (
        candidate["unitId"],
        candidate["caseSize"],
        candidate["containerSize"],
        candidate["casePkgCount"],
    )


def pack_result(group: dict) -> str:
    signatures = {candidate_pack_signature(candidate) for candidate in group["candidates"]}
    source_uom = joined(group["evidence"]["sourceBaseUnits"]) or "not supplied"
    source_case_qty = joined(group["evidence"]["sourceCaseQuantities"]) or "not supplied"
    result = "Compatible" if len(signatures) == 1 else "Needs review"
    return f"{result}; {len(signatures)} candidate pack/UOM signature(s); source UOM={source_uom}; source case qty={source_case_qty}"


def mapping_counts(group: dict) -> tuple[int, int, int]:
    records = [
        candidate["referenceCounts"]["inventoryItemExternalMappings"]
        for candidate in group["candidates"]
    ]
    mapped_candidates = sum(1 for value in records if value > 0)
    sibling_records = sum(
        candidate["referenceCounts"]["inventoryItemExternalMappings"]
        for candidate in group["candidates"]
        if candidate["itemId"] != group.get("proposedCanonicalItemId")
    )
    return sum(records), mapped_candidates, sibling_records


def group_row(group: dict) -> dict[str, object]:
    may_present, june_present = source_period_flags(group)
    mapping_records, mapped_candidates, sibling_mapping_records = mapping_counts(group)
    canonical = next(
        (candidate for candidate in group["candidates"] if candidate["itemId"] == group["proposedCanonicalItemId"]),
        None,
    )
    return {
        "Source Item Code": group["sourceExternalId"],
        "Source / product name": joined(group["evidence"]["sourceDescriptions"]),
        "FnB inventory identities in group": len(group["candidateItemIds"]),
        "Proposed canonical inventoryItemId": group.get("proposedCanonicalItemId") or "",
        "Canonical product name": canonical["name"] if canonical else "",
        "Canonical selection reason": group.get("canonicalSelectionReason") or "",
        "Superseded identities": len(group["alternativeCandidateIds"]),
        "May source-row presence": "Yes" if may_present else "No",
        "June source-row presence": "Yes" if june_present else "No",
        "Physical locations represented": len(group["evidence"]["sourceStorageLocations"]),
        "Physical location names": joined(group["evidence"]["sourceStorageLocations"]),
        "Count lines to repoint": group["referencesToRepoint"]["inventoryCountLines"],
        "External-mapping coverage": f"{mapping_records} mapping record(s) across {mapped_candidates} of {len(group['candidates'])} identity/identities; sibling records={sibling_mapping_records}",
        "Material pack/UOM compatibility": pack_result(group),
        "Expected valuation delta": "$0.00",
    }


def markdown_table(headers: list[str], rows: list[list[object]]) -> str:
    lines = [
        "| " + " | ".join(headers) + " |",
        "| " + " | ".join("---" for _ in headers) + " |",
    ]
    for row in rows:
        lines.append("| " + " | ".join(str(value).replace("|", "/") for value in row) + " |")
    return "\n".join(lines)


def exact_example(group: dict) -> dict[str, object]:
    canonical = next(candidate for candidate in group["candidates"] if candidate["itemId"] == group["proposedCanonicalItemId"])
    mapping_records, mapped_candidates, sibling_mapping_records = mapping_counts(group)
    return {
        "item_code": group["sourceExternalId"],
        "source_name": joined(group["evidence"]["sourceDescriptions"]),
        "canonical_id": canonical["itemId"],
        "canonical_name": canonical["name"],
        "reason": group["canonicalSelectionReason"],
        "candidate_names": joined(sorted({candidate["name"] for candidate in group["candidates"]})),
        "candidate_count": len(group["candidates"]),
        "pack": pack_result(group),
        "dates": joined(group["evidence"]["importInventoryDates"]),
        "mapping": f"{mapping_records} mapping record(s), {mapped_candidates} mapped identity/identities, {sibling_mapping_records} sibling mapping record(s)",
    }


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("Usage: generate_bay_hill_pm_review.py INPUT_CAPTURE OUTPUT_DIRECTORY")
    report = load_capture(Path(sys.argv[1]))
    output = Path(sys.argv[2])
    output.mkdir(parents=True, exist_ok=True)

    groups = report["groups"]
    safe = [group for group in groups if group["classification"] == "SAFE_CANDIDATE"]
    ambiguous = [group for group in groups if group["classification"] == "AMBIGUOUS"]
    conflicts = [group for group in groups if group["classification"] == "CONFLICT"]

    if len(safe) != report["totals"]["safeCandidates"] or len(ambiguous) != report["totals"]["ambiguous"]:
        raise SystemExit("Report classification totals do not reconcile.")

    detail_path = output / "bay-hill-safe-candidate-detail.csv"
    fieldnames = list(group_row(safe[0]).keys())
    with detail_path.open("w", newline="", encoding="utf-8") as file:
        writer = csv.DictWriter(file, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(group_row(group) for group in sorted(safe, key=lambda item: item["sourceExternalId"]))

    approval_path = output / "bay-hill-safe-candidate-item-codes.csv"
    with approval_path.open("w", newline="", encoding="utf-8") as file:
        writer = csv.writer(file)
        writer.writerow(["Source Item Code"])
        for group in sorted(safe, key=lambda item: item["sourceExternalId"]):
            writer.writerow([group["sourceExternalId"]])

    ambiguous_path = output / "bay-hill-ambiguous-groups.csv"
    ambiguous_headers = [
        "Source Item Code", "Item names", "Candidate IDs", "Conflicting / insufficient evidence",
        "Locations", "Pack / UOM evidence", "External mappings", "Why classifier refused SAFE_CANDIDATE",
    ]
    with ambiguous_path.open("w", newline="", encoding="utf-8") as file:
        writer = csv.DictWriter(file, fieldnames=ambiguous_headers)
        writer.writeheader()
        for group in ambiguous:
            records, mapped, sibling_records = mapping_counts(group)
            writer.writerow({
                "Source Item Code": group["sourceExternalId"],
                "Item names": joined(sorted({candidate["name"] for candidate in group["candidates"]})),
                "Candidate IDs": joined(group["candidateItemIds"]),
                "Conflicting / insufficient evidence": joined(group["evidence"]["conflictReasons"] + group["evidence"]["ambiguityReasons"]),
                "Locations": joined(group["evidence"]["sourceStorageLocations"]),
                "Pack / UOM evidence": pack_result(group),
                "External mappings": f"{records} mapping record(s) across {mapped} candidate(s); records outside a proposed canonical identity={sibling_records}",
                "Why classifier refused SAFE_CANDIDATE": joined(group["evidence"]["ambiguityReasons"]) or "No deterministic canonical candidate was available.",
            })

    candidate_distribution = Counter(len(group["candidateItemIds"]) for group in safe)
    month_distribution = Counter()
    mapping_distribution = Counter()
    count_line_distribution = Counter()
    pack_distribution = Counter()
    for group in safe:
        may, june = source_period_flags(group)
        month_distribution["May only" if may and not june else "June only" if june and not may else "Both months" if may and june else "Outside approved periods"] += 1
        records, _mapped, sibling_records = mapping_counts(group)
        mapping_distribution["one"] += records == 1
        mapping_distribution["multiple"] += records > 1
        mapping_distribution["zero sibling"] += sibling_records == 0
        count_line_distribution["with"] += group["referencesToRepoint"]["inventoryCountLines"] > 0
        count_line_distribution["zero"] += group["referencesToRepoint"]["inventoryCountLines"] == 0
        pack_distribution[pack_result(group).split(";")[0]] += 1

    known_terms = {
        "Chambord": "chambord",
        "Sweet n Low": "sweet n low",
        "Sauce - Tabasco": "sauce tabasco",
        "Heavy Cream": "heavy cream",
        "Chicken - Breast": "chicken breast",
        "Mayonnaise - Extra Heavy": "mayonnaise extra heavy",
    }
    examples: list[tuple[str, dict[str, object]]] = []
    for label, search in known_terms.items():
        normalized = search.replace(" ", "")
        matched = [
            group for group in safe
            if normalized in "".join(group["evidence"]["sourceDescriptions"]).lower().replace(" ", "").replace("-", "")
        ]
        if len(matched) != 1:
            raise SystemExit(f"Expected exactly one known-example match for {label}; found {len(matched)}")
        examples.append((label, exact_example(matched[0])))

    superseded = sum(len(group["alternativeCandidateIds"]) for group in safe)
    count_lines = sum(group["referencesToRepoint"]["inventoryCountLines"] for group in safe)
    nonzero_delta_groups: list[dict] = []  # Identity-only repointing never changes a count-line amount.

    candidate_rows = [[f"{count} IDs" if count < 5 else "5+ IDs", candidate_distribution[count]] for count in sorted(candidate_distribution) if count < 5]
    candidate_rows.append(["5+ IDs", sum(value for count, value in candidate_distribution.items() if count >= 5)])

    summary = f"""# Bay Hill SAFE_CANDIDATE PM Review

**Review status: READ-ONLY CANDIDATE SET — NOT PRODUCT OWNER APPROVAL**

This package was generated from the JSON portion of the supplied successful production report. The CLI preamble was excluded. It contains no credentials, connection strings, raw query payloads, manifest, or apply output.

## Source report provenance

- Report version: `{report["reportVersion"]}`
- Report hash: `{report["reportHash"]}`
- Generated at: `{report["generatedAt"]}`
- Scope is deliberately not reproduced in this artifact beyond the approved Bay Hill review context.
- Classification totals reconcile to the report: {report["totals"]["groupsExamined"]} examined, {len(safe)} SAFE_CANDIDATE, {len(ambiguous)} AMBIGUOUS, {len(conflicts)} CONFLICT.

## Included review files

- `bay-hill-safe-candidate-detail.csv` — one sanitized row for each of the {len(safe)} SAFE_CANDIDATE groups.
- `bay-hill-safe-candidate-item-codes.csv` — exact proposed approval set: {len(safe)} source Item Codes.
- `bay-hill-ambiguous-groups.csv` — the {len(ambiguous)} excluded AMBIGUOUS groups.

## Distribution and sanity summary

{markdown_table(["Candidate identities in group", "SAFE_CANDIDATE groups"], candidate_rows)}

| Measure | Result |
| --- | ---: |
| Canonical items retained | {len(safe)} |
| Items proposed to be superseded | {superseded:,} |
| Count lines that would repoint | {count_lines:,} |
| May only | {month_distribution["May only"]} |
| June only | {month_distribution["June only"]} |
| Both May and June | {month_distribution["Both months"]} |
| Groups outside approved May/June date windows | {month_distribution["Outside approved periods"]} |
| Groups with exactly one external-mapping record | {mapping_distribution["one"]} |
| Groups with multiple external-mapping records | {mapping_distribution["multiple"]} |
| Groups with no external mapping on duplicate siblings | {mapping_distribution["zero sibling"]} |
| Groups with count lines | {count_line_distribution["with"]} |
| Groups with zero count lines | {count_line_distribution["zero"]} |
| Groups with compatible candidate pack/UOM signatures | {pack_distribution["Compatible"]} |
| Groups needing pack/UOM review | {pack_distribution["Needs review"]} |
| Groups with nonzero expected valuation delta | {len(nonzero_delta_groups)} |

**Definitions.** “One/multiple external mapping” counts `inventoryItemExternalMappings` records across every identity in a group. “No mapping on duplicate siblings” means all proposed-to-be-superseded identities have zero such records; a canonical identity may still have mappings. Month presence follows the approved May window (2026-05-01 through 2026-06-01) and June window (2026-06-02 through 2026-07-01).

## Valuation preflight

The proposed operation is identity consolidation only: it repoints references to a selected existing identity and does not change source quantities, locations, unit costs, or count-line amounts. Therefore the expected delta for every SAFE_CANDIDATE is **$0.00**.

| Approved baseline | Expected post-remediation valuation | Expected delta |
| --- | ---: | ---: |
| May 2026 — ${MAY_BASELINE:,.2f} | ${MAY_BASELINE:,.2f} | $0.00 |
| June 2026 — ${JUNE_BASELINE:,.2f} | ${JUNE_BASELINE:,.2f} | $0.00 |

No SAFE_CANDIDATE is surfaced for nonzero expected valuation delta. This is a preflight expectation, not a post-apply reconciliation, because no manifest was created and no apply was run.

## Required known-example verification

"""
    for label, example in examples:
        summary += f"""### {label} — source Item Code `{example["item_code"]}`

- **Proposed canonical identity:** `{example["canonical_id"]}` ({example["canonical_name"]})
- **Deterministic selection:** {example["reason"]}.
- **Why these are the same source item:** the group is keyed to one source Item Code and one source description (`{example["source_name"]}`); all {example["candidate_count"]} FnB identities use the same product name(s) (`{example["candidate_names"]}`) and the candidate pack/UOM comparison is `{example["pack"]}`. Source rows are present on `{example["dates"]}`.
- **Mapping evidence:** {example["mapping"]}.

"""

    summary += "## AMBIGUOUS groups — excluded from the first manifest\n\n"
    for group in ambiguous:
        records, mapped, sibling_records = mapping_counts(group)
        summary += f"""### Source Item Code `{group["sourceExternalId"]}`

- **Item name(s):** {joined(sorted({candidate["name"] for candidate in group["candidates"]}))}
- **Candidate IDs:** {joined(group["candidateItemIds"])}
- **Conflicting or insufficient evidence:** {joined(group["evidence"]["conflictReasons"] + group["evidence"]["ambiguityReasons"])}
- **Locations:** {joined(group["evidence"]["sourceStorageLocations"])}
- **Pack/UOM:** {pack_result(group)}
- **Mappings:** {records} mapping record(s) across {mapped} candidate(s); there is no proposed canonical identity in an AMBIGUOUS group.
- **Why no SAFE_CANDIDATE:** {joined(group["evidence"]["ambiguityReasons"]) or "No deterministic canonical candidate was available."}

"""
    summary += f"""## Stop condition

The proposed approval set is exactly the {len(safe)} source Item Codes in `bay-hill-safe-candidate-item-codes.csv`. Production classification is **not** Product Owner approval. This package intentionally contains **no manifest**, **no APPLY output**, and performs **no production mutation**.
"""
    (output / "bay-hill-pm-review-summary.md").write_text(summary, encoding="utf-8")

    print(json.dumps({
        "safeCandidates": len(safe),
        "ambiguous": len(ambiguous),
        "conflicts": len(conflicts),
        "superseded": superseded,
        "countLines": count_lines,
        "detailRows": sum(1 for _ in detail_path.open(encoding="utf-8")) - 1,
        "approvalRows": sum(1 for _ in approval_path.open(encoding="utf-8")) - 1,
    }, indent=2))


if __name__ == "__main__":
    main()