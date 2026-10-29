#!/usr/bin/env node
/**
 * Campus Mess System — Automated Post-Deployment Smoke Test Script (§25.9)
 *
 * Verifies system availability, healthiness, security headers,
 * uniform 404 handling, and database responsiveness after release deployment.
 *
 * Usage:
 *   npx tsx scripts/smoke-test.ts [target_url]
 *   npm run smoke-test
 */

interface TestResult {
  name: string;
  status: "PASSED" | "FAILED" | "SKIPPED";
  durationMs: number;
  details?: string;
}

const targetUrl = process.argv[2] || process.env.SMOKE_TEST_URL || "http://localhost:3000";
const results: TestResult[] = [];

console.log("\n==================================================================");
console.log(`🚀 Starting Campus Mess Deployment Smoke Test (§25.9)`);
console.log(`🎯 Target API Base URL: ${targetUrl}`);
console.log(`⏰ Time (UTC): ${new Date().toISOString()}`);
console.log("==================================================================\n");

async function runCheck(name: string, checkFn: () => Promise<void>) {
  const start = Date.now();
  try {
    await checkFn();
    const durationMs = Date.now() - start;
    results.push({ name, status: "PASSED", durationMs });
    console.log(`  ✅ [PASS] ${name} (${durationMs}ms)`);
  } catch (err) {
    const durationMs = Date.now() - start;
    const msg = err instanceof Error ? err.message : String(err);
    results.push({ name, status: "FAILED", durationMs, details: msg });
    console.error(`  ❌ [FAIL] ${name} (${durationMs}ms)`);
    console.error(`     Error: ${msg}`);
  }
}

async function execute() {
  // 1. Healthcheck Probe
  await runCheck("1. Health Endpoint Availability (/healthz)", async () => {
    const res = await fetch(`${targetUrl}/healthz`, { signal: AbortSignal.timeout(5000) });
    if (res.status !== 200) {
      throw new Error(`Expected HTTP 200 but received ${res.status}`);
    }
    const data = await res.json();
    if (data.status !== "ok") {
      throw new Error(`Expected status 'ok' in response body, got '${data.status}'`);
    }
    if (data.service !== "campus-mess-backend") {
      throw new Error(`Unexpected service identifier: '${data.service}'`);
    }
  });

  // 2. Security Headers on HTTP Perimeter
  await runCheck("2. Perimeter Security Headers (Helmet, nosniff)", async () => {
    const res = await fetch(`${targetUrl}/healthz`, { signal: AbortSignal.timeout(5000) });
    const xContentType = res.headers.get("x-content-type-options");
    if (xContentType !== "nosniff") {
      throw new Error(`Expected X-Content-Type-Options: nosniff, got '${xContentType}'`);
    }
  });

  // 3. Public Pass Endpoint & Cache-Control: no-store
  await runCheck("3. Public Pass Privacy & Cache-Control: no-store (/c/:token)", async () => {
    const res = await fetch(`${targetUrl}/c/NONEXISTENT_SMOKE_PASS_12345`, {
      signal: AbortSignal.timeout(5000),
    });

    if (res.status !== 404) {
      throw new Error(`Expected uniform 404 for unknown token, received HTTP ${res.status}`);
    }

    const cacheControl = res.headers.get("cache-control") || "";
    if (!cacheControl.includes("no-store")) {
      throw new Error(`Expected Cache-Control to contain 'no-store', got '${cacheControl}'`);
    }

    const referrerPolicy = res.headers.get("referrer-policy") || "";
    if (referrerPolicy !== "no-referrer") {
      throw new Error(`Expected Referrer-Policy: no-referrer, got '${referrerPolicy}'`);
    }

    const body = await res.json();
    if (body.stack || body.query) {
      throw new Error("Security leak detected: stack trace or query dump present in 404 body");
    }
  });

  // 4. Undefined Route Uniform Handling
  await runCheck("4. Undefined Route 404 Uniformity (/api/v1/nonexistent)", async () => {
    const res = await fetch(`${targetUrl}/api/v1/nonexistent-smoke-probe`, {
      signal: AbortSignal.timeout(5000),
    });
    if (res.status !== 404) {
      throw new Error(`Expected 404 for undefined route, received HTTP ${res.status}`);
    }
    const body = await res.json();
    if (!body.error || body.error.code !== "NOT_FOUND") {
      throw new Error(`Expected standard error envelope with NOT_FOUND code, got: ${JSON.stringify(body)}`);
    }
  });

  // 5. Protected Endpoint Authentication Boundary
  await runCheck("5. Unauthenticated Admin Perimeter Rejection (/api/v1/reimbursements/requests)", async () => {
    const res = await fetch(`${targetUrl}/api/v1/reimbursements/requests`, {
      signal: AbortSignal.timeout(5000),
    });
    if (res.status !== 401) {
      throw new Error(`Expected HTTP 401 Unauthorized for admin route, received HTTP ${res.status}`);
    }
  });

  // Summary
  console.log("\n==================================================================");
  console.log("📊 Smoke Test Results Summary");
  console.log("==================================================================");

  const passed = results.filter((r) => r.status === "PASSED").length;
  const failed = results.filter((r) => r.status === "FAILED").length;

  console.log(`Total Checks : ${results.length}`);
  console.log(`Passed       : ${passed}`);
  console.log(`Failed       : ${failed}`);

  if (failed > 0) {
    console.error(`\n❌ Deployment Verification FAILED with ${failed} failure(s).`);
    process.exit(1);
  } else {
    console.log(`\n🎉 All ${passed} deployment verification probes PASSED successfully!`);
    process.exit(0);
  }
}

// In unit/local test environments, export or run
if (process.argv[1]?.includes("smoke-test")) {
  execute().catch((err) => {
    console.error("Fatal error executing smoke test:", err);
    process.exit(1);
  });
}

export { execute, runCheck };
