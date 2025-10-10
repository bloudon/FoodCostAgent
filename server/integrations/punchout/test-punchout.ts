#!/usr/bin/env tsx
/**
 * Manual test script for PunchOut cXML implementation
 * Run with: tsx server/integrations/punchout/test-punchout.ts
 */

import { CxmlClient } from './CxmlClient';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log('🧪 Testing PunchOut cXML Implementation\n');

// Create test client
const client = new CxmlClient('USFOODS', {
  punchoutUrl: 'https://punchout.usfoods.com/setup',
  sharedSecret: 'test-secret-key',
  buyerDomain: 'RestaurantInventory',
  buyerIdentity: 'BUYER001',
});

// Test 1: Process Cart Return
async function testProcessCartReturn() {
  console.log('📦 Test 1: Process Cart Return');
  
  try {
    const orderMessageXml = readFileSync(
      join(__dirname, 'fixtures/order-message.xml'),
      'utf-8'
    );

    const result = await client.processCartReturn(orderMessageXml);

    console.log('✅ Session ID:', result.sessionId);
    console.log('✅ Items found:', result.items.length);
    console.log('✅ Total amount: $' + result.totalAmount.toFixed(2));
    
    console.log('\nItems:');
    result.items.forEach((item, i) => {
      console.log(`  ${i + 1}. ${item.description}`);
      console.log(`     SKU: ${item.vendorSku}, Qty: ${item.quantity}, Price: $${item.unitPrice}`);
    });
    
    console.log('\n✅ Test 1 PASSED\n');
  } catch (error) {
    console.error('❌ Test 1 FAILED:', error);
    process.exit(1);
  }
}

// Test 2: Validate Signature
function testValidateSignature() {
  console.log('🔐 Test 2: Validate Signature');
  
  try {
    const payload = 'test-payload-data';
    const hmac = crypto.createHmac('sha256', 'test-secret-key');
    hmac.update(payload);
    const signature = hmac.digest('hex');

    const isValid = client.validateSignature(payload, signature);
    
    if (isValid) {
      console.log('✅ Valid signature accepted');
    } else {
      throw new Error('Valid signature rejected');
    }

    // Test invalid signature
    const invalidSignature = 'invalid-signature-0000000000000000000000000000000000000000000000000000000000000000';
    const isInvalid = client.validateSignature(payload, invalidSignature);
    
    if (!isInvalid) {
      console.log('✅ Invalid signature rejected');
    } else {
      throw new Error('Invalid signature accepted');
    }
    
    console.log('✅ Test 2 PASSED\n');
  } catch (error) {
    console.error('❌ Test 2 FAILED:', error);
    process.exit(1);
  }
}

// Test 3: Build Setup Request
function testBuildSetupRequest() {
  console.log('📝 Test 3: Build Setup Request');
  
  try {
    const request = {
      buyerCookie: 'TEST-COOKIE-123',
      buyerUserId: 'user@restaurant.com',
      buyerEmail: 'user@restaurant.com',
      returnUrl: 'https://restaurant.example.com/punchout/return',
    };

    const xml = (client as any).buildSetupRequest(request);

    // Verify key elements
    const checks = [
      ['XML declaration', xml.includes('<?xml version="1.0" encoding="UTF-8"?>')],
      ['cXML version', xml.includes('<cXML version="1.2.014"')],
      ['PunchOutSetupRequest', xml.includes('<PunchOutSetupRequest operation="create">')],
      ['BuyerCookie', xml.includes('<BuyerCookie>TEST-COOKIE-123</BuyerCookie>')],
      ['UserEmail', xml.includes('<Extrinsic name="UserEmail">user@restaurant.com</Extrinsic>')],
      ['UserId', xml.includes('<Extrinsic name="UserId">user@restaurant.com</Extrinsic>')],
      ['Return URL', xml.includes('<URL>https://restaurant.example.com/punchout/return</URL>')],
      ['SharedSecret', xml.includes('<SharedSecret>test-secret-key</SharedSecret>')],
      ['Buyer Identity', xml.includes('<Identity>BUYER001</Identity>')],
    ];

    checks.forEach(([name, passed]) => {
      if (passed) {
        console.log(`  ✅ ${name}`);
      } else {
        throw new Error(`Missing or incorrect: ${name}`);
      }
    });
    
    console.log('✅ Test 3 PASSED\n');
  } catch (error) {
    console.error('❌ Test 3 FAILED:', error);
    process.exit(1);
  }
}

// Run all tests
async function runTests() {
  await testProcessCartReturn();
  testValidateSignature();
  testBuildSetupRequest();
  
  console.log('✨ All tests PASSED!');
}

runTests().catch(error => {
  console.error('❌ Test suite failed:', error);
  process.exit(1);
});
