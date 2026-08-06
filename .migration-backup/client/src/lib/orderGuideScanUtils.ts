export interface ScannedLine {
  id: string;
  vendorSku: string;
  productName: string;
  packSize: string | null;
  uom: string | null;
  price: number | null;
  matchStatus: 'matched' | 'ambiguous' | 'new';
  matchConfidence: number | null;
}

export interface MatchCounts {
  matched: number;
  ambiguous: number;
  newItems: number;
  total: number;
}

export function computeMatchCounts(lines: ScannedLine[]): MatchCounts {
  return {
    matched: lines.filter(l => l.matchStatus === 'matched').length,
    ambiguous: lines.filter(l => l.matchStatus === 'ambiguous').length,
    newItems: lines.filter(l => l.matchStatus === 'new').length,
    total: lines.length,
  };
}

export function getPageBreakInsertionIndex(existingLines: ScannedLine[]): number {
  return existingLines.length;
}

export function getPageBreakLabel(pageBreaks: number[], lineIndex: number): string | null {
  const position = pageBreaks.indexOf(lineIndex);
  if (position === -1) return null;
  return `— Page ${position + 2} —`;
}

export function buildReviewUrl(orderGuideId: string): string {
  return `/order-guides/${orderGuideId}/review`;
}

export function parseOrderGuideScanParams(search: string): {
  vendorId: string;
  storeId: string;
  orderGuideId: string;
} {
  const params = new URLSearchParams(search);
  return {
    vendorId: params.get('vendorId') || '',
    storeId: params.get('storeId') || '',
    orderGuideId: params.get('ogId') || '',
  };
}

export function buildOrderGuideScanUrl(params: {
  vendorId?: string;
  storeId?: string;
  ogId?: string;
}): string {
  const qs = new URLSearchParams();
  if (params.vendorId) qs.set('vendorId', params.vendorId);
  if (params.storeId) qs.set('storeId', params.storeId);
  if (params.ogId) qs.set('ogId', params.ogId);
  const queryString = qs.toString();
  return queryString ? `/order-guide-scan?${queryString}` : '/order-guide-scan';
}

export function buildAppendedLines(
  existingLines: ScannedLine[],
  newLines: ScannedLine[]
): { lines: ScannedLine[]; pageBreaks: number[] } {
  const insertionIndex = existingLines.length;
  const combined = [...existingLines, ...newLines];
  const pageBreakIndices = newLines.length > 0 ? [insertionIndex] : [];
  return { lines: combined, pageBreaks: pageBreakIndices };
}

export function mergeAppendedLines(
  existingLines: ScannedLine[],
  existingPageBreaks: number[],
  newLines: ScannedLine[]
): { lines: ScannedLine[]; pageBreaks: number[] } {
  if (newLines.length === 0) {
    return { lines: existingLines, pageBreaks: existingPageBreaks };
  }
  const insertionIndex = existingLines.length;
  return {
    lines: [...existingLines, ...newLines],
    pageBreaks: [...existingPageBreaks, insertionIndex],
  };
}
