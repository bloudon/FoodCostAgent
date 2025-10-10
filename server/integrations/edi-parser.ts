/**
 * EDI X12 Parser - Convert X12 to Normalized JSON
 */

import type {
  EdiDocument,
  Edi850PurchaseOrder,
  Edi855PoAcknowledgement,
  Edi810Invoice,
  EdiParty,
  X12ParseResult,
} from './edi-types';

/**
 * Parse X12 string into segments
 */
function parseSegments(x12: string): string[] {
  // Common segment terminators: ~, \n
  const segmentTerminator = x12.includes('~') ? '~' : '\n';
  return x12
    .split(segmentTerminator)
    .map(seg => seg.trim())
    .filter(seg => seg.length > 0);
}

/**
 * Parse segment into elements
 */
function parseElements(segment: string): string[] {
  // Element separator is typically *
  return segment.split('*').map(el => el.trim());
}

/**
 * Parse N1 loop into party information
 */
function parseN1Party(elements: string[]): EdiParty {
  return {
    qualifier: elements[1] || '',
    name: elements[2] || '',
    identifierCode: elements[3],
  };
}

/**
 * Parse 850 Purchase Order
 */
function parse850(segments: string[]): Edi850PurchaseOrder {
  const po: Edi850PurchaseOrder = {
    docType: '850',
    purpose: '00',
    orderType: 'NE',
    poNumber: '',
    poDate: '',
    lineItems: [],
  };

  let currentPartyQualifier: string | null = null;

  for (const segment of segments) {
    const elements = parseElements(segment);
    const segmentId = elements[0];

    switch (segmentId) {
      case 'BEG':
        // BEG*00*NE*PO123456**20231015
        po.purpose = elements[1] || '00';
        po.orderType = elements[2] || 'NE';
        po.poNumber = elements[3] || '';
        po.poDate = elements[5] || '';
        break;

      case 'DTM':
        // DTM*002*20231020 (delivery date)
        if (elements[1] === '002' || elements[1] === '010') {
          po.deliveryDate = elements[2];
        }
        break;

      case 'N1':
        // N1*ST*Restaurant Name*92*12345
        currentPartyQualifier = elements[1];
        const party = parseN1Party(elements);
        
        if (currentPartyQualifier === 'ST') po.shipTo = party;
        else if (currentPartyQualifier === 'BT') po.billTo = party;
        else if (currentPartyQualifier === 'VN') po.vendor = party;
        break;

      case 'N3':
        // N3*123 Main St*Apt 4
        if (currentPartyQualifier) {
          const party = currentPartyQualifier === 'ST' ? po.shipTo :
                       currentPartyQualifier === 'BT' ? po.billTo :
                       currentPartyQualifier === 'VN' ? po.vendor : null;
          if (party) {
            party.address1 = elements[1];
            party.address2 = elements[2];
          }
        }
        break;

      case 'N4':
        // N4*Chicago*IL*60601*US
        if (currentPartyQualifier) {
          const party = currentPartyQualifier === 'ST' ? po.shipTo :
                       currentPartyQualifier === 'BT' ? po.billTo :
                       currentPartyQualifier === 'VN' ? po.vendor : null;
          if (party) {
            party.city = elements[1];
            party.state = elements[2];
            party.zip = elements[3];
            party.country = elements[4];
          }
        }
        break;

      case 'PO1':
        // PO1*1*24*EA*12.50*PE*VP*SKU123*BP*OURSKU456
        po.lineItems.push({
          lineNumber: elements[1] || '',
          quantity: parseFloat(elements[2] || '0'),
          uom: elements[3] || 'EA',
          unitPrice: parseFloat(elements[4] || '0'),
          vendorSku: elements[7],
          buyerSku: elements[9],
        });
        break;

      case 'PID':
        // PID*F****Product Description
        const lastItem = po.lineItems[po.lineItems.length - 1];
        if (lastItem) {
          lastItem.description = elements[5] || elements[4] || '';
        }
        break;

      case 'CTT':
        // CTT*5
        po.totalLines = parseInt(elements[1] || '0');
        break;
    }
  }

  return po;
}

/**
 * Parse 855 Purchase Order Acknowledgement
 */
function parse855(segments: string[]): Edi855PoAcknowledgement {
  const ack: Edi855PoAcknowledgement = {
    docType: '855',
    ackType: 'AC',
    poNumber: '',
    poDate: '',
    lineItems: [],
  };

  for (const segment of segments) {
    const elements = parseElements(segment);
    const segmentId = elements[0];

    switch (segmentId) {
      case 'BAK':
        // BAK*00*AC*PO123456**20231015
        ack.ackType = elements[2] || 'AC';
        ack.poNumber = elements[3] || '';
        ack.poDate = elements[5] || '';
        break;

      case 'DTM':
        // DTM*004*20231015 (ack date)
        if (elements[1] === '004') {
          ack.ackDate = elements[2];
        }
        break;

      case 'PO1':
        // PO1*1*24*EA*12.50*PE*VP*SKU123
        const lineItem = {
          lineNumber: elements[1] || '',
          quantity: parseFloat(elements[2] || '0'),
          uom: elements[3] || 'EA',
          unitPrice: parseFloat(elements[4] || '0'),
          vendorSku: elements[7],
        };
        ack.lineItems.push(lineItem);
        break;

      case 'ACK':
        // ACK*IA (Item Accepted)
        const lastItem = ack.lineItems[ack.lineItems.length - 1];
        if (lastItem) {
          lastItem.status = elements[1];
        }
        break;
    }
  }

  return ack;
}

/**
 * Parse 810 Invoice
 */
function parse810(segments: string[]): Edi810Invoice {
  const invoice: Edi810Invoice = {
    docType: '810',
    invoiceNumber: '',
    invoiceDate: '',
    lineItems: [],
  };

  let currentPartyQualifier: string | null = null;

  for (const segment of segments) {
    const elements = parseElements(segment);
    const segmentId = elements[0];

    switch (segmentId) {
      case 'BIG':
        // BIG*20231015*INV123456*20231010*PO123456
        invoice.invoiceDate = elements[1] || '';
        invoice.invoiceNumber = elements[2] || '';
        invoice.poNumber = elements[4];
        break;

      case 'N1':
        currentPartyQualifier = elements[1];
        const party = parseN1Party(elements);
        
        if (currentPartyQualifier === 'BT') invoice.billTo = party;
        else if (currentPartyQualifier === 'ST') invoice.shipTo = party;
        else if (currentPartyQualifier === 'VN') invoice.vendor = party;
        break;

      case 'N3':
        if (currentPartyQualifier) {
          const party = currentPartyQualifier === 'BT' ? invoice.billTo :
                       currentPartyQualifier === 'ST' ? invoice.shipTo :
                       currentPartyQualifier === 'VN' ? invoice.vendor : null;
          if (party) {
            party.address1 = elements[1];
            party.address2 = elements[2];
          }
        }
        break;

      case 'N4':
        if (currentPartyQualifier) {
          const party = currentPartyQualifier === 'BT' ? invoice.billTo :
                       currentPartyQualifier === 'ST' ? invoice.shipTo :
                       currentPartyQualifier === 'VN' ? invoice.vendor : null;
          if (party) {
            party.city = elements[1];
            party.state = elements[2];
            party.zip = elements[3];
            party.country = elements[4];
          }
        }
        break;

      case 'IT1':
        // IT1*1*24*EA*12.50**VP*SKU123*BP*OURSKU456
        invoice.lineItems.push({
          lineNumber: elements[1] || '',
          quantity: parseFloat(elements[2] || '0'),
          uom: elements[3] || 'EA',
          unitPrice: parseFloat(elements[4] || '0'),
          vendorSku: elements[7],
          buyerSku: elements[9],
        });
        break;

      case 'PID':
        const lastItem = invoice.lineItems[invoice.lineItems.length - 1];
        if (lastItem) {
          lastItem.description = elements[5] || elements[4] || '';
        }
        break;

      case 'TDS':
        // TDS*30000 (total in cents, or dollar amount depends on format)
        invoice.totalAmount = parseFloat(elements[1] || '0');
        break;

      case 'CTT':
        invoice.totalLines = parseInt(elements[1] || '0');
        break;
    }
  }

  return invoice;
}

/**
 * Parse X12 document to normalized JSON
 */
export function parseX12(x12: string): X12ParseResult {
  const segments = parseSegments(x12);
  
  // Determine document type from first segment
  let docType: '850' | '855' | '810' | null = null;
  
  for (const segment of segments) {
    const elements = parseElements(segment);
    const segmentId = elements[0];
    
    // Document type indicators
    if (segmentId === 'BEG') docType = '850';
    else if (segmentId === 'BAK') docType = '855';
    else if (segmentId === 'BIG') docType = '810';
    
    if (docType) break;
  }

  if (!docType) {
    throw new Error('Unable to determine EDI document type');
  }

  let normalized: EdiDocument;
  
  switch (docType) {
    case '850':
      normalized = parse850(segments);
      break;
    case '855':
      normalized = parse855(segments);
      break;
    case '810':
      normalized = parse810(segments);
      break;
  }

  return {
    normalized,
    raw: x12,
    segments,
  };
}
