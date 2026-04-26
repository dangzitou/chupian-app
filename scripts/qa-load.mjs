#!/usr/bin/env node
import process from "node:process";

const target = String(process.env.LOAD_TARGET_URL || process.env.BACKEND_URL || "http://127.0.0.1").replace(/\/+$/, "");
const total = Math.max(1, Number.parseInt(process.env.LOAD_REQUESTS || "40", 10) || 40);
const concurrency = Math.max(1, Math.min(total, Number.parseInt(process.env.LOAD_CONCURRENCY || "8", 10) || 8));
const paths = [
  "/api/v1/health",
  "/api/v1/community/feed?limit=5&sort=latest",
];

const samples = [];
const failures = [];
let nextIndex = 0;

async function hit(index) {
  const path = paths[index % paths.length];
  const started = performance.now();
  try {
    const response = await fetch(`${target}${path}`);
    const elapsed = performance.now() - started;
    samples.push(elapsed);
    if (!response.ok) failures.push(`${path} -> ${response.status}`);
  } catch (error) {
    samples.push(performance.now() - started);
    failures.push(`${path} -> ${error?.message || error}`);
  }
}

async function worker() {
  while (true) {
    const index = nextIndex;
    nextIndex += 1;
    if (index >= total) return;
    await hit(index);
  }
}

const started = Date.now();
await Promise.all(Array.from({ length: concurrency }, () => worker()));
samples.sort((a, b) => a - b);
const percentile = (ratio) => samples[Math.min(samples.length - 1, Math.floor(samples.length * ratio))] || 0;
const average = samples.reduce((sum, value) => sum + value, 0) / Math.max(samples.length, 1);

console.log(`Load target: ${target}`);
console.log(`Requests: ${total}, concurrency: ${concurrency}, elapsed: ${Date.now() - started}ms`);
console.log(`Latency ms: avg=${average.toFixed(1)}, p50=${percentile(0.5).toFixed(1)}, p95=${percentile(0.95).toFixed(1)}, max=${Math.max(...samples).toFixed(1)}`);
if (failures.length) {
  console.error(`Failures: ${failures.length}/${total}`);
  for (const failure of failures.slice(0, 10)) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(`PASS ${total}/${total}`);
