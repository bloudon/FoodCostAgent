import { describe, expect, it, vi } from 'vitest';
import { historicalInvoicePayloadSchema } from './historicalInvoiceImport';
import {
  BayHillOrderlyAdapterError,
  fetchBayHillOrderlyHistoricalInvoicePayload,
  fetchBayHillOrderlyInvoiceRangePayload,
  normalizeBayHillOrderlyHistoricalInvoices,
} from './bayHillOrderlyAdapter';

const cutoverDate = '2026-08-13';
const specsFixture = [{
  id: 77,
  packSizes: [{
    id: 501,
    supplierId: 88,
    supplierName: 'Bay Hill Foods',
    itemCode: 'CREAM-32',
    packSizeDesc: '12 / 32 OZ',
    itemDesc: 'Heavy Cream',
    size: '32',
    uom: 'OZ',
    pack: '12',
    active: true,
    price: 25,
  }],
}];
const invoicesFixture = [{
  id: 901,
  restaurantId: 24472,
  supplierId: 88,
  supplierName: 'Bay Hill Foods',
  invoiceNumber: 'INV-901',
  deliveryDate: '2026-03-04T12:00:00.000Z',
  total: 60,
  tax: 5,
  kegCharges: 2,
  deliveryCharges: 3,
  otherCharges: 0,
  items: [{
    id: 902,
    invoiceId: 901,
    restaurantId: 24472,
    itemDesc: 'Heavy Cream',
    quantity: 2,
    price: 25,
    total: 50,
    pack: '12',
    size: '32',
    uom: 'OZ',
    category: { id: 3, name: 'Dairy' },
    packSize: { id: 501 },
  }],
}];

describe('Bay Hill Orderly thin acquisition adapter', () => {
  it('normalizes the confirmed root-array contract and enriches lines by packSize.id', () => {
    const payload = normalizeBayHillOrderlyHistoricalInvoices({
      cutoverDate,
      specs: specsFixture,
      invoices: invoicesFixture,
    });

    expect(historicalInvoicePayloadSchema.parse(payload)).toEqual(payload);
    expect(payload).toMatchObject({
      sourceSystem: 'ORDERLY',
      sourcePropertyId: '24472',
      cutoverDate,
      invoices: [{
        sourceInvoiceId: '901',
        invoiceDate: '2026-03-04',
        vendorExternalId: '88',
        subtotal: 50,
        chargeAmount: 5,
        lines: [{
          sourceLineId: '902',
          packSizeId: '501',
          productName: 'Heavy Cream',
          pack: { packSizeDesc: '12 / 32 OZ' },
          source: { matchedSpecPackSize: { id: 501 } },
        }],
      }],
    });
  });

  it('uses only the bound Bay Hill endpoints and passes runtime session headers without retaining them', async () => {
    const fetchImplementation = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(specsFixture), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(invoicesFixture), { status: 200 }));

    await fetchBayHillOrderlyHistoricalInvoicePayload({
      cutoverDate,
      session: { headers: { cookie: '<runtime-only>' } },
      fetchImplementation,
    });

    expect(fetchImplementation).toHaveBeenCalledTimes(2);
    expect(String(fetchImplementation.mock.calls[0][0])).toBe(
      'https://app.bepbackoffice.com/data/restaurantv2/spec/allSpecsForRestaurant/24472',
    );
    expect(String(fetchImplementation.mock.calls[1][0])).toBe(
      'https://app.bepbackoffice.com/data/restaurantv2/invoice/forRest/24472?startDate=2025-08-01&endDate=2026-07-31',
    );
    expect(fetchImplementation.mock.calls[1][1]).toMatchObject({
      method: 'GET',
      headers: { cookie: '<runtime-only>' },
    });
  });

  it('supports a bounded read-only probe range without changing the source identity contract', async () => {
    const fetchImplementation = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(specsFixture), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(invoicesFixture), { status: 200 }));

    const payload = await fetchBayHillOrderlyInvoiceRangePayload({
      cutoverDate: '2026-08-01',
      startDate: '2026-03-01',
      endDate: '2026-03-31',
      session: { headers: { cookie: '<runtime-only>' } },
      fetchImplementation,
    });

    expect(payload.invoices).toHaveLength(1);
    expect(String(fetchImplementation.mock.calls[1][0])).toContain(
      'startDate=2026-03-01&endDate=2026-03-31',
    );
  });

  it('fails closed for unverified response envelopes, non-Bay-Hill invoices, and missing line identities', () => {
    expect(() => normalizeBayHillOrderlyHistoricalInvoices({
      cutoverDate, specs: { data: specsFixture }, invoices: invoicesFixture,
    })).toThrow(/root array/i);
    expect(() => normalizeBayHillOrderlyHistoricalInvoices({
      cutoverDate, specs: specsFixture, invoices: [{ ...invoicesFixture[0], restaurantId: 27417 }],
    })).toThrow(/24472/);
    expect(() => normalizeBayHillOrderlyHistoricalInvoices({
      cutoverDate,
      specs: specsFixture,
      invoices: [{ ...invoicesFixture[0], items: [{ ...invoicesFixture[0].items[0], id: null }] }],
    })).toThrow(BayHillOrderlyAdapterError);
    expect(() => normalizeBayHillOrderlyHistoricalInvoices({
      cutoverDate,
      specs: specsFixture,
      invoices: [{ ...invoicesFixture[0], deliveryDate: '2026-08-01' }],
    })).toThrow(/outside the requested/i);
  });

  it.each([401, 403])('fails closed when the runtime session receives HTTP %i', async (status) => {
    const fetchImplementation = vi.fn().mockResolvedValue(new Response(null, { status }));
    await expect(fetchBayHillOrderlyHistoricalInvoicePayload({
      cutoverDate,
      session: { headers: { cookie: '<runtime-only>' } },
      fetchImplementation,
    })).rejects.toMatchObject({ code: 'AUTHENTICATION_FAILED' });
  });
});