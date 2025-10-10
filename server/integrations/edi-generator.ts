/**
 * EDI X12 Generator - Convert Normalized JSON to X12
 */

import type {
  EdiDocument,
  Edi850PurchaseOrder,
  Edi855PoAcknowledgement,
  Edi810Invoice,
  EdiParty,
  X12GenerateOptions,
} from './edi-types';

const DEFAULT_OPTIONS: Required<X12GenerateOptions> = {
  segmentTerminator: '~',
  elementSeparator: '*',
  compositeElementSeparator: ':',
};

/**
 * Generate N1 loop segments for a party
 */
function generateN1Loop(
  party: EdiParty,
  options: Required<X12GenerateOptions>
): string[] {
  const { elementSeparator: sep, segmentTerminator: term } = options;
  const segments: string[] = [];

  // N1 segment
  const n1Parts = ['N1', party.qualifier, party.name];
  if (party.identifierCode) {
    n1Parts.push('92', party.identifierCode);
  }
  segments.push(n1Parts.join(sep) + term);

  // N3 segment (address)
  if (party.address1) {
    const n3Parts = ['N3', party.address1];
    if (party.address2) n3Parts.push(party.address2);
    segments.push(n3Parts.join(sep) + term);
  }

  // N4 segment (city/state/zip)
  if (party.city || party.state || party.zip) {
    const n4Parts = [
      'N4',
      party.city || '',
      party.state || '',
      party.zip || '',
      party.country || '',
    ];
    segments.push(n4Parts.join(sep) + term);
  }

  return segments;
}

/**
 * Generate 850 Purchase Order X12
 */
function generate850(
  po: Edi850PurchaseOrder,
  options: Required<X12GenerateOptions>
): string {
  const { elementSeparator: sep, segmentTerminator: term } = options;
  const segments: string[] = [];

  // BEG segment
  segments.push(
    ['BEG', po.purpose, po.orderType, po.poNumber, '', po.poDate].join(sep) + term
  );

  // DTM segment (delivery date)
  if (po.deliveryDate) {
    segments.push(['DTM', '002', po.deliveryDate].join(sep) + term);
  }

  // N1 loops
  if (po.shipTo) segments.push(...generateN1Loop(po.shipTo, options));
  if (po.billTo) segments.push(...generateN1Loop(po.billTo, options));
  if (po.vendor) segments.push(...generateN1Loop(po.vendor, options));

  // PO1 line items
  for (const item of po.lineItems) {
    const po1Parts = [
      'PO1',
      item.lineNumber,
      item.quantity.toString(),
      item.uom,
      item.unitPrice.toFixed(2),
      'PE', // Price basis: per each
    ];

    // Add vendor SKU
    if (item.vendorSku) {
      po1Parts.push('VP', item.vendorSku);
    }

    // Add buyer SKU
    if (item.buyerSku) {
      po1Parts.push('BP', item.buyerSku);
    }

    segments.push(po1Parts.join(sep) + term);

    // PID segment (description)
    if (item.description) {
      segments.push(['PID', 'F', '', '', '', item.description].join(sep) + term);
    }
  }

  // CTT segment (line count)
  const lineCount = po.totalLines ?? po.lineItems.length;
  segments.push(['CTT', lineCount.toString()].join(sep) + term);

  return segments.join('');
}

/**
 * Generate 855 Purchase Order Acknowledgement X12
 */
function generate855(
  ack: Edi855PoAcknowledgement,
  options: Required<X12GenerateOptions>
): string {
  const { elementSeparator: sep, segmentTerminator: term } = options;
  const segments: string[] = [];

  // BAK segment
  segments.push(
    ['BAK', '00', ack.ackType, ack.poNumber, '', ack.poDate].join(sep) + term
  );

  // DTM segment (ack date)
  if (ack.ackDate) {
    segments.push(['DTM', '004', ack.ackDate].join(sep) + term);
  }

  // PO1 line items
  for (const item of ack.lineItems) {
    const po1Parts = [
      'PO1',
      item.lineNumber,
      item.quantity.toString(),
      item.uom,
    ];

    if (item.unitPrice !== undefined) {
      po1Parts.push(item.unitPrice.toFixed(2), 'PE');
    }

    if (item.vendorSku) {
      po1Parts.push('VP', item.vendorSku);
    }

    segments.push(po1Parts.join(sep) + term);

    // ACK segment (status)
    if (item.status) {
      segments.push(['ACK', item.status].join(sep) + term);
    }

    // DTM segment (confirmed date)
    if (item.confirmedDate) {
      segments.push(['DTM', '002', item.confirmedDate].join(sep) + term);
    }
  }

  // CTT segment
  segments.push(['CTT', ack.lineItems.length.toString()].join(sep) + term);

  return segments.join('');
}

/**
 * Generate 810 Invoice X12
 */
function generate810(
  invoice: Edi810Invoice,
  options: Required<X12GenerateOptions>
): string {
  const { elementSeparator: sep, segmentTerminator: term } = options;
  const segments: string[] = [];

  // BIG segment
  const bigParts = [
    'BIG',
    invoice.invoiceDate,
    invoice.invoiceNumber,
    '',
    invoice.poNumber || '',
  ];
  segments.push(bigParts.join(sep) + term);

  // N1 loops
  if (invoice.billTo) segments.push(...generateN1Loop(invoice.billTo, options));
  if (invoice.shipTo) segments.push(...generateN1Loop(invoice.shipTo, options));
  if (invoice.vendor) segments.push(...generateN1Loop(invoice.vendor, options));

  // IT1 line items
  for (const item of invoice.lineItems) {
    const it1Parts = [
      'IT1',
      item.lineNumber,
      item.quantity.toString(),
      item.uom,
      item.unitPrice.toFixed(2),
      '',
    ];

    if (item.vendorSku) {
      it1Parts.push('VP', item.vendorSku);
    }

    if (item.buyerSku) {
      it1Parts.push('BP', item.buyerSku);
    }

    segments.push(it1Parts.join(sep) + term);

    // PID segment (description)
    if (item.description) {
      segments.push(['PID', 'F', '', '', '', item.description].join(sep) + term);
    }
  }

  // TDS segment (totals)
  if (invoice.totalAmount !== undefined) {
    segments.push(
      ['TDS', Math.round(invoice.totalAmount * 100).toString()].join(sep) + term
    );
  }

  // CTT segment
  const lineCount = invoice.totalLines ?? invoice.lineItems.length;
  segments.push(['CTT', lineCount.toString()].join(sep) + term);

  return segments.join('');
}

/**
 * Generate X12 from normalized JSON
 */
export function generateX12(
  doc: EdiDocument,
  options: Partial<X12GenerateOptions> = {}
): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  switch (doc.docType) {
    case '850':
      return generate850(doc, opts);
    case '855':
      return generate855(doc, opts);
    case '810':
      return generate810(doc, opts);
    default:
      throw new Error(`Unsupported document type: ${(doc as any).docType}`);
  }
}
