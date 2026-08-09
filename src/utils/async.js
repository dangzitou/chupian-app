export async function mapWithConcurrency(items, worker, concurrency = 2) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return [];

  const results = new Array(list.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(Number(concurrency) || 1, list.length));

  const runWorker = async () => {
    while (nextIndex < list.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(list[index], index);
    }
  };

  const workerResults = await Promise.allSettled(
    Array.from({ length: workerCount }, runWorker),
  );
  const failedWorker = workerResults.find((result) => result.status === 'rejected');
  if (failedWorker) throw failedWorker.reason;
  return results;
}
