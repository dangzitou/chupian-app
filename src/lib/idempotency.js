export function buildSessionIdempotencyKey(scope, seed) {
  const safeSeed = String(seed || Date.now())
    .replace(/[^a-zA-Z0-9._-]/g, '')
    .slice(0, 120);
  const random = Math.random().toString(36).slice(2, 10);
  return `${scope}-${safeSeed}-${random}`;
}
