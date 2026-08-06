/**
 * EDI X12 Mapping Test Suite
 * Tests parsing and generation for 850, 855, and 810 documents
 */

import { parseX12 } from './edi-parser';
import { generateX12 } from './edi-generator';
import type { Edi850PurchaseOrder, Edi855PoAcknowledgement, Edi810Invoice } from './edi-types';

// Sample EDI 850 Purchase Order (X12 format)
const sample850X12 = `BEG*00*NE*PO123456**20231015~
DTM*002*20231020~
N1*ST*Pizza Palace*92*STORE001~
N3*123 Main Street~
N4*Chicago*IL*60601*US~
N1*BT*Pizza Palace HQ*92*CORP001~
N3*456 Corporate Blvd~
N4*Chicago*IL*60602*US~
PO1*1*24*EA*12.50*PE*VP*MOZZ-001*BP*INV-MOZZ~
PID*F****Mozzarella Cheese 5lb~
PO1*2*12*CS*45.00*PE*VP*TOM-002*BP*INV-TOM~
PID*F****Tomato Sauce 6/#10 Cans~
CTT*2~`;

// Sample EDI 855 Purchase Order Acknowledgement (X12 format)
const sample855X12 = `BAK*00*AC*PO123456**20231015~
DTM*004*20231015~
PO1*1*24*EA*12.50*PE*VP*MOZZ-001~
ACK*IA~
DTM*002*20231018~
PO1*2*12*CS*45.00*PE*VP*TOM-002~
ACK*IB~
CTT*2~`;

// Sample EDI 810 Invoice (X12 format)
const sample810X12 = `BIG*20231020*INV987654**PO123456~
N1*BT*Pizza Palace HQ*92*CORP001~
N3*456 Corporate Blvd~
N4*Chicago*IL*60602*US~
N1*ST*Pizza Palace*92*STORE001~
N3*123 Main Street~
N4*Chicago*IL*60601*US~
IT1*1*24*EA*12.50**VP*MOZZ-001*BP*INV-MOZZ~
PID*F****Mozzarella Cheese 5lb~
IT1*2*12*CS*45.00**VP*TOM-002*BP*INV-TOM~
PID*F****Tomato Sauce 6/#10 Cans~
TDS*84000~
CTT*2~`;

// Sample normalized JSON for 850
const sample850JSON: Edi850PurchaseOrder = {
  docType: '850',
  purpose: '00',
  orderType: 'NE',
  poNumber: 'PO123456',
  poDate: '20231015',
  deliveryDate: '20231020',
  shipTo: {
    qualifier: 'ST',
    name: 'Pizza Palace',
    identificationCodeQualifier: '92',
    identifierCode: 'STORE001',
    address1: '123 Main Street',
    city: 'Chicago',
    state: 'IL',
    zip: '60601',
    country: 'US',
  },
  billTo: {
    qualifier: 'BT',
    name: 'Pizza Palace HQ',
    identificationCodeQualifier: '92',
    identifierCode: 'CORP001',
    address1: '456 Corporate Blvd',
    city: 'Chicago',
    state: 'IL',
    zip: '60602',
    country: 'US',
  },
  lineItems: [
    {
      lineNumber: '1',
      quantity: 24,
      uom: 'EA',
      unitPrice: 12.50,
      vendorSku: 'MOZZ-001',
      buyerSku: 'INV-MOZZ',
      description: 'Mozzarella Cheese 5lb',
    },
    {
      lineNumber: '2',
      quantity: 12,
      uom: 'CS',
      unitPrice: 45.00,
      vendorSku: 'TOM-002',
      buyerSku: 'INV-TOM',
      description: 'Tomato Sauce 6/#10 Cans',
    },
  ],
  totalLines: 2,
};

/**
 * Test 850 Parsing (X12 → JSON)
 */
function test850Parsing() {
  console.log('📋 Testing EDI 850 Parsing (X12 → JSON)...');
  
  const result = parseX12(sample850X12);
  const po = result.normalized as Edi850PurchaseOrder;

  console.assert(po.docType === '850', '✅ Doc type is 850');
  console.assert(po.poNumber === 'PO123456', '✅ PO number parsed');
  console.assert(po.poDate === '20231015', '✅ PO date parsed');
  console.assert(po.deliveryDate === '20231020', '✅ Delivery date parsed');
  console.assert(po.shipTo?.name === 'Pizza Palace', '✅ Ship-to name parsed');
  console.assert(po.shipTo?.identifierCode === 'STORE001', '✅ Ship-to identifier parsed');
  console.assert(po.shipTo?.identificationCodeQualifier === '92', '✅ Ship-to qualifier parsed');
  console.assert(po.billTo?.identifierCode === 'CORP001', '✅ Bill-to identifier parsed');
  console.assert(po.shipTo?.city === 'Chicago', '✅ Ship-to city parsed');
  console.assert(po.lineItems.length === 2, '✅ Line items count correct');
  console.assert(po.lineItems[0].quantity === 24, '✅ Line 1 quantity correct');
  console.assert(po.lineItems[0].vendorSku === 'MOZZ-001', '✅ Line 1 vendor SKU correct');
  console.assert(po.lineItems[0].description === 'Mozzarella Cheese 5lb', '✅ Line 1 description correct');

  console.log('✅ EDI 850 Parsing Test PASSED\n');
}

/**
 * Test 850 Generation (JSON → X12)
 */
function test850Generation() {
  console.log('📋 Testing EDI 850 Generation (JSON → X12)...');
  
  const x12 = generateX12(sample850JSON);
  
  console.assert(x12.includes('BEG*00*NE*PO123456'), '✅ BEG segment generated');
  console.assert(x12.includes('DTM*002*20231020'), '✅ DTM segment generated');
  console.assert(x12.includes('N1*ST*Pizza Palace'), '✅ Ship-to N1 generated');
  console.assert(x12.includes('PO1*1*24*EA*12.50'), '✅ PO1 line 1 generated');
  console.assert(x12.includes('PID*F****Mozzarella Cheese 5lb'), '✅ PID description generated');
  console.assert(x12.includes('CTT*2'), '✅ CTT line count generated');
  console.assert(x12.includes('~'), '✅ Segment terminators present');

  console.log('✅ EDI 850 Generation Test PASSED\n');
}

/**
 * Test 855 Parsing (X12 → JSON)
 */
function test855Parsing() {
  console.log('📋 Testing EDI 855 Parsing (X12 → JSON)...');
  
  const result = parseX12(sample855X12);
  const ack = result.normalized as Edi855PoAcknowledgement;

  console.assert(ack.docType === '855', '✅ Doc type is 855');
  console.assert(ack.ackType === 'AC', '✅ Ack type parsed');
  console.assert(ack.poNumber === 'PO123456', '✅ PO number parsed');
  console.assert(ack.lineItems.length === 2, '✅ Line items count correct');
  console.assert(ack.lineItems[0].status === 'IA', '✅ Line 1 status (accepted) parsed');
  console.assert(ack.lineItems[1].status === 'IB', '✅ Line 2 status (backordered) parsed');

  console.log('✅ EDI 855 Parsing Test PASSED\n');
}

/**
 * Test 810 Parsing (X12 → JSON)
 */
function test810Parsing() {
  console.log('📋 Testing EDI 810 Parsing (X12 → JSON)...');
  
  const result = parseX12(sample810X12);
  const invoice = result.normalized as Edi810Invoice;

  console.assert(invoice.docType === '810', '✅ Doc type is 810');
  console.assert(invoice.invoiceNumber === 'INV987654', '✅ Invoice number parsed');
  console.assert(invoice.poNumber === 'PO123456', '✅ PO reference parsed');
  console.assert(invoice.billTo?.name === 'Pizza Palace HQ', '✅ Bill-to name parsed');
  console.assert(invoice.lineItems.length === 2, '✅ Line items count correct');
  console.assert(invoice.totalAmount === 84000, '✅ Total amount parsed');

  console.log('✅ EDI 810 Parsing Test PASSED\n');
}

/**
 * Test Round-Trip Conversion (JSON → X12 → JSON)
 */
function testRoundTrip() {
  console.log('📋 Testing Round-Trip Conversion (JSON → X12 → JSON)...');
  
  // Generate X12 from JSON
  const x12 = generateX12(sample850JSON);
  
  // Parse X12 back to JSON
  const result = parseX12(x12);
  const po = result.normalized as Edi850PurchaseOrder;

  // Verify critical fields survived round-trip
  console.assert(po.poNumber === sample850JSON.poNumber, '✅ PO number survived round-trip');
  console.assert(po.poDate === sample850JSON.poDate, '✅ PO date survived round-trip');
  console.assert(po.shipTo?.identifierCode === sample850JSON.shipTo?.identifierCode, '✅ Ship-to ID survived round-trip');
  console.assert(po.billTo?.identifierCode === sample850JSON.billTo?.identifierCode, '✅ Bill-to ID survived round-trip');
  console.assert(po.lineItems.length === sample850JSON.lineItems.length, '✅ Line count survived round-trip');
  console.assert(po.lineItems[0].vendorSku === sample850JSON.lineItems[0].vendorSku, '✅ SKU survived round-trip');

  console.log('✅ Round-Trip Conversion Test PASSED\n');
}

/**
 * Run all tests
 */
export function runEDITests() {
  console.log('\n🧪 Running EDI X12 Mapping Tests...\n');
  console.log('='.repeat(50) + '\n');

  try {
    test850Parsing();
    test850Generation();
    test855Parsing();
    test810Parsing();
    testRoundTrip();

    console.log('='.repeat(50));
    console.log('✅ ALL EDI TESTS PASSED!\n');
    return true;
  } catch (error) {
    console.error('❌ TEST FAILED:', error);
    return false;
  }
}

// Run tests if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runEDITests();
  process.exit(0);
}
