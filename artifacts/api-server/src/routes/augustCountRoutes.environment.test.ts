import express from 'express';
import type { Express } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const testState = vi.hoisted(() => ({
  queryIndex: 0,
  queryResults: [] as unknown[][],
  canAccessStore: vi.fn(),
  getEffectiveLocations: vi.fn(),
}));

vi.mock('@workspace/db', async () => import('../../../../lib/db/src/schema'));

vi.mock('../auth', () => ({
  requireAuth: vi.fn((req: any, res: any, next: any) => {
    if (req.get('x-test-auth') !== 'authenticated') {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    const companyId = req.get('x-company-id') ?? 'active-company';
    req.user = { id: 'regression-user', companyId, role: 'company_admin' };
    req.companyId = req.get('x-no-company') === 'true' ? undefined : companyId;
    return next();
  }),
}));

vi.mock('../permissions', () => ({
  canAccessStore: testState.canAccessStore,
}));

vi.mock('../db', () => ({
  db: {
    select: vi.fn(() => {
      const result = testState.queryResults[testState.queryIndex++] ?? [];
      const query: any = {
        from: vi.fn(function (this: any) { return this; }),
        innerJoin: vi.fn(function (this: any) { return this; }),
        leftJoin: vi.fn(function (this: any) { return this; }),
        where: vi.fn(function (this: any) { return this; }),
        limit: vi.fn(async () => result),
        then: (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject),
      };
      return query;
    }),
  },
}));

vi.mock('../services/inventory/effectiveItemLocations', () => ({
  getEffectiveInventoryItemLocationsBatch: testState.getEffectiveLocations,
}));

import { db } from '../db';
import { canAccessStore } from '../permissions';
import { getEffectiveInventoryItemLocationsBatch } from '../services/inventory/effectiveItemLocations';
import { registerAugustCountRoutes } from './augustCountRoutes';

const ACTIVE_COMPANY = 'active-company';
const NON_REFERENCE_STORE = 'active-store';
const AUGUST_REFERENCE_COMPANY = '61971215-e3ed-49f3-8afc-6dbe1eef1fcc';
const AUGUST_REFERENCE_STORE = '7126a705-64a6-4362-8b62-f08349640442';

function makeApp(): Express {
  const app = express();
  registerAugustCountRoutes(app);
  return app;
}

function authenticatedRequest(path: string, companyId = ACTIVE_COMPANY) {
  return request(makeApp())
    .get(path)
    .set('x-test-auth', 'authenticated')
    .set('x-company-id', companyId);
}

function manualAugustCount(overrides: Record<string, unknown> = {}) {
  return {
    id: 'august-session',
    companyId: ACTIVE_COMPANY,
    storeId: NON_REFERENCE_STORE,
    countDate: new Date('2026-08-31T00:00:00.000Z'),
    isHistoricalImport: 0,
    isPowerSession: 0,
    sourceSystem: null,
    sourceBatchId: null,
    ...overrides,
  };
}

function setNodeEnvironment(value: string | undefined) {
  if (value === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = value;
}

let previousNodeEnvironment: string | undefined;

beforeEach(() => {
  previousNodeEnvironment = process.env.NODE_ENV;
  testState.queryIndex = 0;
  testState.queryResults = [];
  vi.clearAllMocks();
  vi.mocked(canAccessStore).mockResolvedValue(true);
  vi.mocked(getEffectiveInventoryItemLocationsBatch).mockResolvedValue(new Map());
});

afterEach(() => {
  setNodeEnvironment(previousNodeEnvironment);
});

describe('August count reference environment boundary', () => {
  it.each([
    { label: 'production', value: 'production' },
    { label: 'undefined', value: undefined },
    { label: 'staging', value: 'staging' },
    { label: 'test', value: 'test' },
  ])('rejects authenticated reference requests when NODE_ENV is $label before any access checks', async ({ value }) => {
    setNodeEnvironment(value);

    const response = await authenticatedRequest('/api/inventory-counts/august-session/august-reference');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: 'Not found' });
    expect(db.select).not.toHaveBeenCalled();
    expect(canAccessStore).not.toHaveBeenCalled();
    expect(getEffectiveInventoryItemLocationsBatch).not.toHaveBeenCalled();
  });

  it('keeps requireAuth ahead of the production-only handler response', async () => {
    setNodeEnvironment('production');

    const response = await request(makeApp())
      .get('/api/inventory-counts/august-session/august-reference');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'Not authenticated' });
    expect(db.select).not.toHaveBeenCalled();
    expect(canAccessStore).not.toHaveBeenCalled();
  });

  it('allows a development request through the scoped count/store/session guards and returns an empty out-of-reference comparison', async () => {
    setNodeEnvironment('development');
    testState.queryResults = [
      [manualAugustCount()],
      [{ id: NON_REFERENCE_STORE }],
    ];

    const response = await authenticatedRequest('/api/inventory-counts/august-session/august-reference');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      batch: null,
      rows: [],
      unresolved: [{
        status: 'reference_scope_unavailable',
        reason: 'The packaged August workbook reference is authorized only for the designated Bay Hill company and store.',
      }],
    });
    expect(db.select).toHaveBeenCalledTimes(2);
    expect(canAccessStore).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'regression-user' }),
      NON_REFERENCE_STORE,
    );
    expect(getEffectiveInventoryItemLocationsBatch).not.toHaveBeenCalled();
  });

  it('runs the packaged workbook comparison for the designated company and store in development', async () => {
    setNodeEnvironment('development');
    testState.queryResults = [
      [manualAugustCount({
        companyId: AUGUST_REFERENCE_COMPANY,
        storeId: AUGUST_REFERENCE_STORE,
      })],
      [{ id: AUGUST_REFERENCE_STORE }],
      [],
      [],
      [],
      [],
    ];

    const response = await authenticatedRequest(
      '/api/inventory-counts/august-session/august-reference',
      AUGUST_REFERENCE_COMPANY,
    );

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.batch).toMatchObject({
      sourceType: 'packaged_workbook',
      sourcePropertyId: '24472',
      date: '2026-08-31',
      filename: expect.any(String),
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      sourceRowCount: expect.any(Number),
    });
    expect(response.body.batch.sourceRowCount).toBeGreaterThan(0);
    expect(response.body.rows).toEqual([]);
    expect(response.body.unresolved.length).toBeGreaterThan(0);
    expect(response.body.unresolved[0]).toMatchObject({
      rowIndex: expect.any(Number),
      status: expect.any(String),
      sourceEvidence: expect.any(Object),
    });
    expect(db.select).toHaveBeenCalledTimes(6);
    expect(canAccessStore).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'regression-user' }),
      AUGUST_REFERENCE_STORE,
    );
    expect(getEffectiveInventoryItemLocationsBatch).toHaveBeenCalledWith(
      AUGUST_REFERENCE_COMPANY,
      [],
      expect.any(Map),
      [],
    );
  });

  it('returns not found when a session from another company is hidden by the active-company lookup', async () => {
    setNodeEnvironment('development');
    // A company-scoped DB lookup does not return the otherwise-existing foreign count.
    testState.queryResults = [[]];

    const response = await authenticatedRequest(
      '/api/inventory-counts/foreign-company-session/august-reference',
    );

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: 'Count session not found' });
    expect(db.select).toHaveBeenCalledTimes(1);
    expect(canAccessStore).not.toHaveBeenCalled();
  });

  it('returns not found for a missing count session', async () => {
    setNodeEnvironment('development');
    testState.queryResults = [[]];

    const response = await authenticatedRequest('/api/inventory-counts/missing-session/august-reference');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: 'Count session not found' });
    expect(db.select).toHaveBeenCalledTimes(1);
    expect(canAccessStore).not.toHaveBeenCalled();
  });

  it('rejects development requests without an active company before reading the count', async () => {
    setNodeEnvironment('development');

    const response = await request(makeApp())
      .get('/api/inventory-counts/august-session/august-reference')
      .set('x-test-auth', 'authenticated')
      .set('x-no-company', 'true');

    expect(response.status).toBe(401);
    expect(db.select).not.toHaveBeenCalled();
    expect(canAccessStore).not.toHaveBeenCalled();
  });

  it('rejects a development request when the authenticated user cannot access the count store', async () => {
    setNodeEnvironment('development');
    testState.queryResults = [[manualAugustCount()]];
    vi.mocked(canAccessStore).mockResolvedValue(false);

    const response = await authenticatedRequest('/api/inventory-counts/august-session/august-reference');

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: 'Store access denied' });
    expect(db.select).toHaveBeenCalledTimes(1);
    expect(canAccessStore).toHaveBeenCalledOnce();
    expect(getEffectiveInventoryItemLocationsBatch).not.toHaveBeenCalled();
  });

  it('rejects a count whose store does not belong to the active company', async () => {
    setNodeEnvironment('development');
    testState.queryResults = [
      [manualAugustCount()],
      [],
    ];

    const response = await authenticatedRequest('/api/inventory-counts/august-session/august-reference');

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: 'Count store does not belong to the active company' });
    expect(db.select).toHaveBeenCalledTimes(2);
    expect(getEffectiveInventoryItemLocationsBatch).not.toHaveBeenCalled();
  });

  it('rejects non-August or non-ordinary sessions before loading comparison data', async () => {
    setNodeEnvironment('development');
    testState.queryResults = [
      [manualAugustCount({ countDate: new Date('2026-08-30T00:00:00.000Z') })],
      [{ id: NON_REFERENCE_STORE }],
    ];

    const response = await authenticatedRequest('/api/inventory-counts/august-session/august-reference');

    expect(response.status).toBe(409);
    expect(response.body.error).toMatch(/ordinary manual count dated 2026-08-31/);
    expect(db.select).toHaveBeenCalledTimes(2);
    expect(getEffectiveInventoryItemLocationsBatch).not.toHaveBeenCalled();
  });
});

describe('August count readiness remains available in production', () => {
  it('serves a synthetic empty store-scoped readiness result without loading reference data', async () => {
    setNodeEnvironment('production');
    testState.queryResults = [
      [{ id: NON_REFERENCE_STORE }],
      [],
      [],
    ];

    const response = await authenticatedRequest(
      `/api/inventory-counts/readiness?storeId=${NON_REFERENCE_STORE}`,
    );

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body).toEqual({
      storeId: NON_REFERENCE_STORE,
      activeItems: [],
      totalLines: 0,
      unassigned: [],
      blocked: [],
      locations: [],
    });
    expect(db.select).toHaveBeenCalledTimes(3);
    expect(canAccessStore).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'regression-user' }),
      NON_REFERENCE_STORE,
    );
    expect(getEffectiveInventoryItemLocationsBatch).toHaveBeenCalledWith(
      ACTIVE_COMPANY,
      [],
      expect.any(Map),
      [],
    );
  });

  it('reports blockers for a synthetic active item without an effective location', async () => {
    setNodeEnvironment('production');
    const item = {
      id: 'synthetic-unassigned-weight-item',
      name: 'Synthetic flour',
      unitId: 'synthetic-pound-unit',
      categoryId: null,
      caseSize: null,
      containerSize: null,
      casePkgCount: null,
      containerUnitId: null,
      containerLabel: null,
    };
    testState.queryResults = [
      [{ id: NON_REFERENCE_STORE }],
      [{ item, storeAssignment: {}, unitAbbreviation: 'lb', unitKind: 'weight' }],
      [],
      [],
    ];

    const response = await authenticatedRequest(
      `/api/inventory-counts/readiness?storeId=${NON_REFERENCE_STORE}`,
    );

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.activeItems).toHaveLength(1);
    expect(response.body.activeItems[0]).toMatchObject({
      inventoryItemId: item.id,
      countInputMode: 'direct',
      locations: [],
      status: 'blocked',
      blockers: [
        'No effective storage location assignment.',
        'Direct counting in a measurement unit requires an explicit catch-weight setup or verified physical package geometry.',
      ],
    });
    expect(response.body.totalLines).toBe(0);
    expect(response.body.unassigned).toEqual([{
      id: item.id,
      name: item.name,
      reason: 'No effective storage location is assigned.',
    }]);
    expect(response.body.blocked).toHaveLength(1);
    expect(db.select).toHaveBeenCalledTimes(4);
    expect(getEffectiveInventoryItemLocationsBatch).toHaveBeenCalledWith(
      ACTIVE_COMPANY,
      [item.id],
      expect.any(Map),
      [],
    );
  });
});