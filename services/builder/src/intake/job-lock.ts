// Serialize dispatch and cancellation for one job within the API process.
const tails = new Map<string, Promise<void>>();

export async function withJobDispatchLock<T>(jobId: string, work: () => Promise<T>): Promise<T> {
  const previous = tails.get(jobId) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => current);
  tails.set(jobId, tail);
  await previous;
  try {
    return await work();
  } finally {
    release();
    if (tails.get(jobId) === tail) tails.delete(jobId);
  }
}
