import { parseTemplateFast } from "./parser.ts";

// Benchmark test cases covering various RFC 6570 patterns
const testCases = {
  simple: "/users/{id}",
  multipleVars: "/users/{id}/posts/{postId}",
  reservedOperator: "/path{+reserved}/file",
  queryOperator: "/search{?q,limit,offset}",
  fragmentOperator: "/docs{#section}",
  pathOperator: "{/var,x,y}",
  queryContOperator: "/search?fixed=yes{&x,y}",
  explodeModifier: "/values/{list*}",
  prefixModifier: "/text/{str:3}",
  complexModifiers: "{?x,y:3,z*}",
  manyVariables: "{a,b,c,d,e,f,g,h,i,j,k,l,m,n,o,p,q,r,s,t,u,v,w,x,y,z}",
  deeplyNested: "/level1/{a}/level2/{b}/level3/{c}/level4/{d}/level5/{e}",
  allOperators: "/base{/path}{+reserved}{#fragment}{?query}{&more}",
  unicodeLiterals: "🚀/users/{id}/📁/{file}/✨",
  longVariableNames: `/{${"very_long_variable_name_".repeat(10)}}`,
};

// Helper to format benchmark results
function formatResult(name: string, opsPerSec: number, timePerOp: number): string {
  return `${name.padEnd(20)} ${opsPerSec.toFixed(0).padStart(10)} ops/sec   ${timePerOp.toFixed(3).padStart(8)} μs/op`;
}

// Run benchmark for a single test case
function benchmark(
  _name: string,
  fn: () => void,
  warmupRuns: number = 1000,
  testRuns: number = 100000
): { opsPerSec: number; timePerOp: number } {
  // Warmup
  for (let i = 0; i < warmupRuns; i++) {
    fn();
  }
  
  // Actual benchmark
  const start = performance.now();
  for (let i = 0; i < testRuns; i++) {
    fn();
  }
  const end = performance.now();
  
  const totalTime = end - start;
  const timePerOp = (totalTime * 1000) / testRuns; // Convert to microseconds
  const opsPerSec = (testRuns / totalTime) * 1000;
  
  return { opsPerSec, timePerOp };
}

// Compare with url-template package if available
async function compareWithUrlTemplate() {
  try {
    // Try to import url-template package from CDN
    const { parseTemplate } = await import("https://esm.sh/url-template@3.1.1");
    
    console.log("\n📊 Benchmark Comparison: parseTemplateFast vs url-template.parseTemplate");
    console.log("=" + "=".repeat(75));
    console.log("Test Case".padEnd(20) + " parseTemplateFast".padEnd(25) + " url-template");
    console.log("-" + "-".repeat(75));
    
    for (const [testName, template] of Object.entries(testCases)) {
      // Benchmark our parser
      const ourResult = benchmark(
        testName,
        () => parseTemplateFast(template),
        1000,
        50000
      );
      
      // Benchmark url-template parser
      const urlTemplateResult = benchmark(
        testName,
        () => parseTemplate(template),
        1000,
        50000
      );
      
      // Calculate speedup
      const speedup = ourResult.opsPerSec / urlTemplateResult.opsPerSec;
      const speedupStr = speedup >= 1 
        ? `🟢 ${speedup.toFixed(2)}x faster`
        : `🔴 ${(1/speedup).toFixed(2)}x slower`;
      
      console.log(
        testName.padEnd(20) +
        `${ourResult.opsPerSec.toFixed(0).padStart(10)} ops/s` +
        `${urlTemplateResult.opsPerSec.toFixed(0).padStart(15)} ops/s` +
        `  ${speedupStr}`
      );
    }
    
  } catch (_error) {
    console.log("\n⚠️  url-template package not available for comparison");
    console.log("To run comparison, install: npm install url-template@3.1.1");
  }
}

// Run standalone benchmark
function runStandaloneBenchmark() {
  console.log("\n📊 Benchmark Results for parseTemplateFast");
  console.log("=" + "=".repeat(49));
  console.log("Test Case".padEnd(20) + " Performance");
  console.log("-" + "-".repeat(49));
  
  const results: Array<{ name: string; opsPerSec: number; timePerOp: number }> = [];
  
  for (const [testName, template] of Object.entries(testCases)) {
    const result = benchmark(
      testName,
      () => parseTemplateFast(template)
    );
    results.push({ name: testName, ...result });
    console.log(formatResult(testName, result.opsPerSec, result.timePerOp));
  }
  
  // Calculate statistics
  const opsPerSecValues = results.map(r => r.opsPerSec);
  const timePerOpValues = results.map(r => r.timePerOp);
  
  const avgOpsPerSec = opsPerSecValues.reduce((a, b) => a + b, 0) / opsPerSecValues.length;
  const minOpsPerSec = Math.min(...opsPerSecValues);
  const maxOpsPerSec = Math.max(...opsPerSecValues);
  
  const avgTimePerOp = timePerOpValues.reduce((a, b) => a + b, 0) / timePerOpValues.length;
  const minTimePerOp = Math.min(...timePerOpValues);
  const maxTimePerOp = Math.max(...timePerOpValues);
  
  console.log("-" + "-".repeat(49));
  console.log("\n📈 Statistics:");
  console.log(`  Average: ${avgOpsPerSec.toFixed(0)} ops/sec (${avgTimePerOp.toFixed(3)} μs/op)`);
  console.log(`  Min:     ${minOpsPerSec.toFixed(0)} ops/sec (${maxTimePerOp.toFixed(3)} μs/op)`);
  console.log(`  Max:     ${maxOpsPerSec.toFixed(0)} ops/sec (${minTimePerOp.toFixed(3)} μs/op)`);
}

// Main benchmark runner
async function main() {
  console.log("🚀 RFC 6570 URI Template Parser Benchmark\n");
  
  // Run standalone benchmark first
  runStandaloneBenchmark();
  
  // Try to run comparison if url-template is available
  await compareWithUrlTemplate();
  
  console.log("\n✅ Benchmark complete!");
}

// Run if this is the main module
if (import.meta.main) {
  main();
}