/**
 * Bay Hill's operator-confirmed rule: the complete stock unit is one case and
 * one canonical EA. This does NOT assert anything about the case's contents.
 * Never pass this through the general source-pack parser: 1/1 Case stays opaque.
 */
export const WHOLE_CASE_LABEL = "whole case";

export type WholeCaseEvidence = {
  unitId: string;
  unit: string;
  caseSize: number;
  containerSize: number | null;
  casePkgCount: number | null;
  containerLabel: string | null;
  containerUnitId: string | null;
  isVariableWeight: number | null;
  isCatchWeightCategory: number | null;
  mappings: Array<{
    sourceSystem: string; sourcePropertyId: string | null; packSizeRaw: string | null;
    caseQuantity: number | null; innerPackQuantity: number | null;
    baseUnitQuantity: number | null; baseUnit: string | null;
  }>;
  products: Array<{
    canonicalQtyPerPurchaseUnit: number | null;
    packGeometryStatus: string | null;
    packUom: string | null;
    caseSize: number;
    innerPackSize: number | null;
    isVariableWeight: number | null;
  }>;
  savedParts: Array<{
    unitId: string;
    qty: number;
    caseQty: number | null;
    containerQty: number | null;
    looseUnits: number | null;
  }>;
};

export function wholeCaseExclusionReasons(row: WholeCaseEvidence): string[] {
  const reasons: string[] = [];
  if (row.unit.toUpperCase() !== "EA" || row.caseSize !== 1) reasons.push("unit or case quantity changed");
  if (row.isVariableWeight === 1 || row.isCatchWeightCategory === 1) reasons.push("catch or variable weight");
  if (!row.mappings.length || row.mappings.some(m =>
    m.sourceSystem !== "ORDERLY" || m.sourcePropertyId !== "24472" ||
    m.packSizeRaw?.trim().toUpperCase() !== "1/1 CASE" ||
    m.caseQuantity !== 1 || m.innerPackQuantity !== 1 ||
    m.baseUnit?.toUpperCase() !== "CASE" || m.baseUnitQuantity != null,
  )) reasons.push("missing or conflicting source pack");
  const unconfigured = row.containerSize == null && row.casePkgCount == null &&
    row.containerUnitId == null && (row.containerLabel == null || row.containerLabel === "package");
  const alreadyWholeCase = row.containerSize === 1 && row.casePkgCount === 1 &&
    row.containerUnitId === row.unitId && row.containerLabel === WHOLE_CASE_LABEL;
  if (!unconfigured && !alreadyWholeCase) reasons.push("existing operational geometry needs review");
  if (row.products.some(p =>
    p.isVariableWeight === 1 ||
    p.caseSize !== 1 || (p.innerPackSize != null && p.innerPackSize !== 1) ||
    (p.canonicalQtyPerPurchaseUnit != null && p.canonicalQtyPerPurchaseUnit !== 1) ||
    (p.packGeometryStatus === "verified" &&
      (p.canonicalQtyPerPurchaseUnit == null ||
       (p.packUom != null && !["EA", "CS", "CASE"].includes(p.packUom.trim().toUpperCase())))),
  )) reasons.push("contradictory supplier geometry");
  if (row.savedParts.some(line =>
    line.unitId !== row.unitId ||
    Number(line.looseUnits ?? 0) > 0 ||
    Number(line.containerQty ?? 0) > 0 ||
    !Number.isFinite(line.qty) ||
    Math.abs(line.qty - Number(line.caseQty ?? 0)) >
      Math.max(0.01, Math.abs(line.qty) * 0.000001),
  )) reasons.push("saved package parts need historical review");
  return reasons;
}