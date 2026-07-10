export interface ExportLineInput {
  itemName: string;
  vendorSku: string | null;
  orderedQty: number;
  caseQuantity: number | null;
  unitName: string;
  priceEach: number;
  caseSize: number;
}

export interface ExportInput {
  purchaseOrderId: string;
  vendorName: string;
  accountNumber: string | null;
  expectedDate: string | null;
  notes: string | null;
  exportedAt: Date;
  lines: ExportLineInput[];
}

export interface ExportValidationResult {
  canExport: boolean;
  errors: string[];
  warnings: string[];
}

export interface ExportResult {
  buffer: Buffer;
  filename: string;
  mimeType: string;
  lineCount: number;
  warnings: string[];
}

export interface PoExportRenderer {
  connectorId: string;
  displayName: string;
  format: 'csv' | 'excel';
  validate(input: ExportInput): ExportValidationResult;
  render(input: ExportInput): ExportResult;
}
