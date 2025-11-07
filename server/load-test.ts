import autocannon from 'autocannon';
import { storage } from './storage';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5000';
const DURATION_SECONDS = parseInt(process.env.DURATION || '30', 10);
const CONNECTIONS = parseInt(process.env.CONNECTIONS || '50', 10);

interface LoadTestResult {
  endpoint: string;
  connections: number;
  duration: number;
  requests: number;
  throughput: number;
  latencyAvg: number;
  latencyP99: number;
  errors: number;
  errorRate: number;
}

const results: LoadTestResult[] = [];

async function setupTestData() {
  console.log('📊 Setting up test data...');
  
  // Get a test user
  const testUser = await storage.getUserByEmail('admin@brianspizza.com');
  
  if (!testUser) {
    throw new Error('Test user not found. Please ensure database is seeded.');
  }
  
  // Get test company
  const testCompany = testUser.companyId 
    ? await storage.getCompany(testUser.companyId)
    : undefined;
  
  if (!testCompany) {
    throw new Error('Test company not found.');
  }
  
  // Create a test session
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
  const session = await storage.createAuthSession({
    userId: testUser.id,
    tokenHash: `load-test-${Date.now()}`,
    expiresAt,
    selectedCompanyId: testCompany.id
  });
  
  console.log(`✅ Test session created for ${testUser.email}`);
  console.log(`✅ Using company: ${testCompany.name}`);
  
  return {
    sessionId: session.id,
    userId: testUser.id,
    companyId: testCompany.id,
    email: testUser.email
  };
}

async function runLoadTest(
  name: string,
  config: autocannon.Options
): Promise<LoadTestResult> {
  console.log(`\n🚀 Running load test: ${name}`);
  console.log(`   Connections: ${config.connections}`);
  console.log(`   Duration: ${config.duration}s`);
  
  return new Promise((resolve, reject) => {
    const instance = autocannon(config, (err, result) => {
      if (err) {
        reject(err);
        return;
      }
      
      const latencyAvg = result.latency.mean || 0;
      const latencyP99 = result.latency.p99 || 0;
      const requests = result.requests.total || 0;
      const errors = result.errors || 0;
      const errorRate = requests > 0 ? (errors / requests) * 100 : 0;
      const throughput = result.throughput.mean || 0;
      
      const testResult: LoadTestResult = {
        endpoint: name,
        connections: typeof config.connections === 'number' ? config.connections : 10,
        duration: typeof config.duration === 'number' ? config.duration : 10,
        requests,
        throughput,
        latencyAvg,
        latencyP99,
        errors,
        errorRate
      };
      
      results.push(testResult);
      
      console.log(`✅ Completed: ${name}`);
      console.log(`   Requests: ${requests.toLocaleString()}`);
      console.log(`   Throughput: ${throughput.toFixed(2)} bytes/sec`);
      console.log(`   Latency (avg): ${latencyAvg.toFixed(2)}ms`);
      console.log(`   Latency (p99): ${latencyP99.toFixed(2)}ms`);
      console.log(`   Errors: ${errors} (${errorRate.toFixed(2)}%)`);
      
      resolve(testResult);
    });
    
    autocannon.track(instance);
  });
}

async function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('🏪 Restaurant Inventory Management - Load Test Suite');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Duration: ${DURATION_SECONDS}s per test`);
  console.log(`Connections: ${CONNECTIONS} concurrent users`);
  console.log('═══════════════════════════════════════════════════════\n');
  
  const testData = await setupTestData();
  
  const authHeaders = {
    'Cookie': `session=${testData.sessionId}`,
    'Content-Type': 'application/json'
  };
  
  // Test 1: Authentication Check (most frequent operation)
  await runLoadTest('GET /api/auth/me', {
    url: `${BASE_URL}/api/auth/me`,
    connections: CONNECTIONS,
    duration: DURATION_SECONDS,
    headers: authHeaders
  });
  
  // Test 2: Inventory Items List (critical for all operations)
  await runLoadTest('GET /api/inventory-items', {
    url: `${BASE_URL}/api/inventory-items`,
    connections: CONNECTIONS,
    duration: DURATION_SECONDS,
    headers: authHeaders
  });
  
  // Test 3: Store Inventory Items (store-level queries)
  await runLoadTest('GET /api/store-inventory-items', {
    url: `${BASE_URL}/api/store-inventory-items`,
    connections: CONNECTIONS,
    duration: DURATION_SECONDS,
    headers: authHeaders
  });
  
  // Test 4: Recipes List (recipe costing queries)
  await runLoadTest('GET /api/recipes', {
    url: `${BASE_URL}/api/recipes`,
    connections: CONNECTIONS,
    duration: DURATION_SECONDS,
    headers: authHeaders
  });
  
  // Test 5: Menu Items (POS integration lookups)
  await runLoadTest('GET /api/menu-items', {
    url: `${BASE_URL}/api/menu-items`,
    connections: CONNECTIONS,
    duration: DURATION_SECONDS,
    headers: authHeaders
  });
  
  // Test 6: Purchase Orders List
  await runLoadTest('GET /api/purchase-orders', {
    url: `${BASE_URL}/api/purchase-orders`,
    connections: CONNECTIONS,
    duration: DURATION_SECONDS,
    headers: authHeaders
  });
  
  // Test 7: Receipts List (receiving operations)
  await runLoadTest('GET /api/receipts', {
    url: `${BASE_URL}/api/receipts`,
    connections: CONNECTIONS,
    duration: DURATION_SECONDS,
    headers: authHeaders
  });
  
  // Test 8: Transfer Orders List
  await runLoadTest('GET /api/transfer-orders', {
    url: `${BASE_URL}/api/transfer-orders`,
    connections: CONNECTIONS,
    duration: DURATION_SECONDS,
    headers: authHeaders
  });
  
  // Test 9: Waste Logs (waste tracking queries)
  await runLoadTest('GET /api/waste-logs', {
    url: `${BASE_URL}/api/waste-logs`,
    connections: CONNECTIONS,
    duration: DURATION_SECONDS,
    headers: authHeaders
  });
  
  // Test 10: Company Data (multi-tenant isolation test)
  await runLoadTest('GET /api/companies/:id', {
    url: `${BASE_URL}/api/companies/${testData.companyId}`,
    connections: CONNECTIONS,
    duration: DURATION_SECONDS,
    headers: authHeaders
  });
  
  // Print summary report
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('📊 LOAD TEST SUMMARY REPORT');
  console.log('═══════════════════════════════════════════════════════\n');
  
  console.log('Performance Metrics:');
  console.log('─────────────────────────────────────────────────────────');
  console.log(
    'Endpoint'.padEnd(35),
    'Req/s'.padStart(10),
    'Avg(ms)'.padStart(10),
    'P99(ms)'.padStart(10),
    'Errors'.padStart(10)
  );
  console.log('─────────────────────────────────────────────────────────');
  
  results.forEach(r => {
    const reqPerSec = (r.requests / r.duration).toFixed(0);
    console.log(
      r.endpoint.padEnd(35),
      reqPerSec.padStart(10),
      r.latencyAvg.toFixed(2).padStart(10),
      r.latencyP99.toFixed(2).padStart(10),
      `${r.errors}`.padStart(10)
    );
  });
  
  console.log('─────────────────────────────────────────────────────────');
  
  // Calculate overall statistics
  const totalRequests = results.reduce((sum, r) => sum + r.requests, 0);
  const totalErrors = results.reduce((sum, r) => sum + r.errors, 0);
  const avgLatency = results.reduce((sum, r) => sum + r.latencyAvg, 0) / results.length;
  const maxP99 = Math.max(...results.map(r => r.latencyP99));
  const overallErrorRate = totalRequests > 0 ? (totalErrors / totalRequests) * 100 : 0;
  
  console.log('\nOverall Statistics:');
  console.log(`  Total Requests: ${totalRequests.toLocaleString()}`);
  console.log(`  Total Errors: ${totalErrors} (${overallErrorRate.toFixed(2)}%)`);
  console.log(`  Average Latency: ${avgLatency.toFixed(2)}ms`);
  console.log(`  Worst P99 Latency: ${maxP99.toFixed(2)}ms`);
  
  // Performance assessment
  console.log('\n🎯 Performance Assessment:');
  if (avgLatency < 100) {
    console.log('  ✅ EXCELLENT - Average latency under 100ms');
  } else if (avgLatency < 200) {
    console.log('  ✅ GOOD - Average latency under 200ms');
  } else if (avgLatency < 500) {
    console.log('  ⚠️  ACCEPTABLE - Average latency under 500ms');
  } else {
    console.log('  ❌ POOR - Average latency over 500ms (optimization needed)');
  }
  
  if (overallErrorRate < 0.1) {
    console.log('  ✅ EXCELLENT - Error rate under 0.1%');
  } else if (overallErrorRate < 1) {
    console.log('  ⚠️  ACCEPTABLE - Error rate under 1%');
  } else {
    console.log('  ❌ POOR - Error rate over 1% (stability issues)');
  }
  
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('✅ Load testing complete!');
  console.log('═══════════════════════════════════════════════════════\n');
  
  process.exit(0);
}

main().catch(err => {
  console.error('❌ Load test failed:', err);
  process.exit(1);
});
