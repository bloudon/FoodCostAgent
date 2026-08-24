import * as XLSX from 'xlsx';

/**
 * A deliberately small, realistic Orderly workbook used only by acceptance
 * tests. It contains one complete, stable-code new-pack-size candidate and one
 * similarly named row whose missing source pack evidence must stay out of the
 * bulk action.
 */
export const BULK_PACK_SIZE_FIXTURE_FILENAME = 'Orderly_Bulk_Pack_Size_July_2026.xlsx';

const ORDERLY_HEADERS = [
  'Location', 'Item Code', 'Item Description', 'Pack Size', 'Package Price',
  'Counting Unit 1', 'Count', 'Counting Unit 2', 'Count', 'Counting Unit 3',
  'Count', 'Total Units', 'Par Order Target', 'Total Cost',
  'Previous Case', 'Previous Pack', 'Previous UOM', 'Previous Cost',
  'Supplier', 'Purchase Date', 'Category', 'GL Code',
];

const FIXTURE_ROWS = [
  [
    'Liquor Cage', 'TEQ-5050', 'House Tequila', '5/1 50ML', 42.50,
    'Case', 1, 'Pack', 0, 'Each', 0, 2, 0, 42.50,
    0, 0, 0, 0, 'Acme Liquor', 'July 15, 2026', 'Spirits', '5100',
  ],
  [
    'Main Bar', 'TEQ-5051', 'House Tequila', '', 42.50,
    'Case', 1, 'Pack', 0, 'Each', 0, 1, 0, 42.50,
    0, 0, 0, 0, 'Acme Liquor', 'July 15, 2026', 'Spirits', '5100',
  ],
];

export function buildBulkPackSizeFixtureWorkbook(): Buffer {
  const sheet = XLSX.utils.aoa_to_sheet([ORDERLY_HEADERS, ...FIXTURE_ROWS]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Inventory Detail');
  return Buffer.from(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }));
}