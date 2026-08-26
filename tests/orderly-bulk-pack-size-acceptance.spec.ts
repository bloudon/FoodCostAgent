import { test, expect, type Page } from './test-helpers';

const BASE_URL = 'http://localhost:5000';
const BATCH_ID = 'bulk-pack-size-fixture-batch';

const authUser = {
  id: 'bulk-pack-test-user',
  email: 'bulk-pack-test@example.test',
  companyId: 'bulk-pack-test-company',
  companyName: 'Bulk Pack Test Company',
  role: 'company_admin',
  firstName: 'Bulk',
  lastName: 'Tester',
  active: 1,
  subscriptionPlan: 'platform',
};

const preview = {
  batchId: BATCH_ID,
  inventoryDate: '2026-07-31',
  totalRows: 2,
  summary: {
    totalRows: 2, itemsMatchedHigh: 0, itemsMatchedMedium: 0, itemsAmbiguous: 0,
    itemsNew: 0, itemsFuzzy: 0, vendorsMatched: 2, vendorsNew: 0,
    locationsMatched: 2, locationsNew: 0, rowsRequiringReview: 1,
    itemsResolvedByLocationHistory: 0, itemsWillCreate: 0, itemsHeldForReview: 0,
    itemsRecode: 2, itemsMatchedUnique: 0, rowsMatchedSafe: 0,
  },
  recodeSummary: {
    compatibleAlternates: 0,
    newPackSizes: 1,
    sourceDataConflicts: 0,
    unreliableCodes: 0,
    packEvidenceMissing: 1,
  },
  newLocations: [],
  newVendors: [],
  identitySummary: {
    uniqueIdentityGroups: 2,
    identityGroupsResolvedToExisting: 0,
    identityGroupsNewCandidates: 0,
    identityGroupsRequiringReview: 1,
    blankCodeGroupsWithCodedSibling: 0,
    blankCodeGroupsAutoResolved: 0,
    alternateIdentityMatches: 0,
    blankCodeClassification: {
      confirmed: { rows: 0, valueTotal: 0 },
      reviewable: { rows: 0, valueTotal: 0 },
      conflicted: { rows: 0, valueTotal: 0 },
      held: { rows: 0, valueTotal: 0 },
    },
  },
  rows: [
    {
      rowIndex: 1,
      storageLocation: 'Liquor Cage',
      sourceItemCode: 'TEQ-5050',
      itemCodeStatus: 'valid',
      sourceCodeReliability: 'stable',
      packSizeRaw: '5/1 50ML',
      cleanedDescription: 'House Tequila',
      supplierRaw: 'Acme Liquor',
      sourceCategory: 'Spirits',
      caseQuantity: 5,
      innerPackQuantity: 1,
      baseUnitQuantity: 50,
      baseUnit: 'ML',
      packParseStatus: 'ok',
      packagePrice: 42.5,
      totalCost: 42.5,
      heldForReview: false,
      itemMatch: {
        strategy: 'name_pack',
        confidence: 'high',
        matchedId: null,
        candidateIds: [],
        candidates: [],
        requiresReview: false,
        possibleRecode: true,
        possibleRecodeMatchedId: 'existing-house-tequila',
        possibleRecodeItem: { id: 'existing-house-tequila', name: 'House Tequila', caseSize: 1 },
        packCompatibility: 'incompatible',
        packCompatibilityReason: 'normalized pack totals differ',
        candidatePackEvidence: { caseQuantity: 1, innerPackQuantity: 1, baseUnitQuantity: 750, baseUnit: 'ML' },
        recodeEvidenceClass: 'new_pack_size',
      },
      vendorMatch: { vendorId: 'acme-liquor', isNew: false, confidence: 'high', requiresReview: false },
      locationMatch: { locationId: 'liquor-cage', isNew: false, normalizedName: 'liquor cage' },
    },
    {
      rowIndex: 2,
      storageLocation: 'Main Bar',
      sourceItemCode: 'TEQ-5051',
      itemCodeStatus: 'valid',
      sourceCodeReliability: 'stable',
      packSizeRaw: '',
      cleanedDescription: 'House Tequila',
      supplierRaw: 'Acme Liquor',
      sourceCategory: 'Spirits',
      caseQuantity: null,
      innerPackQuantity: null,
      baseUnitQuantity: null,
      baseUnit: null,
      packParseStatus: 'unparseable',
      packagePrice: 42.5,
      totalCost: 42.5,
      heldForReview: false,
      itemMatch: {
        strategy: 'name_pack',
        confidence: 'high',
        matchedId: null,
        candidateIds: [],
        candidates: [],
        requiresReview: false,
        possibleRecode: true,
        possibleRecodeMatchedId: 'existing-house-tequila',
        possibleRecodeItem: { id: 'existing-house-tequila', name: 'House Tequila', caseSize: 1 },
        packCompatibility: 'unknown',
        packCompatibilityReason: 'complete parsed pack geometry and base unit are required',
        recodeEvidenceClass: 'pack_evidence_missing',
      },
      vendorMatch: { vendorId: 'acme-liquor', isNew: false, confidence: 'high', requiresReview: false },
      locationMatch: { locationId: 'main-bar', isNew: false, normalizedName: 'main bar' },
    },
  ],
};

async function mockOrderlyBulkPackFixture(page: Page): Promise<() => number> {
  let approvalCalls = 0;

  // Catch unrelated shell queries without allowing the browser test to reach
  // the API server. More-specific fixture routes are registered afterwards.
  await page.route('**/api/**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: '[]',
  }));
  await page.route('**/api/auth/me', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(authUser),
  }));
  await page.route('**/api/inventory-import/orderly/batches', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify([{
      id: BATCH_ID,
      status: 'pending_review',
      inventoryDate: '2026-07-31',
      uploadedAt: '2026-08-01T12:00:00.000Z',
      originalFilename: 'Orderly_Bulk_Pack_Size_July_2026.xlsx',
      sourceRowCount: 2,
      approvedAt: null,
    }]),
  }));
  await page.route(`**/api/inventory-import/orderly/batches/${BATCH_ID}/resolution-preview`, route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(preview),
  }));
  await page.route(`**/api/inventory-import/orderly/batches/${BATCH_ID}/approve`, route => {
    approvalCalls += 1;
    return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"Approval must not run in this fixture"}' });
  });

  return () => approvalCalls;
}

test('queues only the verified stable new-pack-size variant from a realistic import fixture', async ({ page }) => {
  const approvalCalls = await mockOrderlyBulkPackFixture(page);
  await page.goto(`${BASE_URL}/orderly-import`);

  await page.getByRole('button', { name: /review/i }).click();
  await page.getByRole('button', { name: /confirm date & preview matches/i }).click();
  await expect(page.getByTestId('orderly-pack-size-walkthrough')).toContainText('1 decision requires a separate item variant');
  await expect(page.getByText('TEQ-5051')).toBeVisible();

  const bulkAction = page.getByTestId('bulk-new-pack-size-variants');
  await expect(bulkAction).toHaveText(/Create 1 new variant in bulk/);
  await bulkAction.click();

  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('Acme Liquor');
  await expect(dialog).toContainText('5/1 50ML');
  await expect(dialog).toContainText('TEQ-5050');
  await expect(dialog).toContainText('House Tequila');
  await expect(dialog).not.toContainText('TEQ-5051');

  await page.getByTestId('confirm-bulk-new-pack-size-variants').click();
  await expect(page.getByTestId('bulk-new-pack-size-queued')).toContainText('1 pack-size variant is queued');
  expect(approvalCalls()).toBe(0);
});