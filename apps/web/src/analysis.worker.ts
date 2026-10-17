/// <reference lib="webworker" />
import { readInventory, DEFAULT_LIMITS, compare, applyBudget, serializeReport } from '../../../packages/core/src/index';

type Request = { before: File; after: File; budget?: number };
self.onmessage = async (event: MessageEvent<Request>) => {
  let side = 'before';
  try {
    const { before, after, budget } = event.data;
    self.postMessage({ type: 'progress', message: 'Reading before archive…' });
    const left = await readInventory(before.stream(), before.size, DEFAULT_LIMITS);
    side = 'after';
    self.postMessage({ type: 'progress', message: 'Reading after archive…' });
    const right = await readInventory(after.stream(), after.size, DEFAULT_LIMITS);
    self.postMessage({ type: 'progress', message: 'Comparing files and manifest…' });
    let report = compare(left, right);
    if (budget !== undefined) report = applyBudget(report, budget);
    self.postMessage({ type: 'complete', report, json: serializeReport(report) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The archive could not be read.';
    self.postMessage({ type: 'error', message: `Could not analyze the ${side} archive. ${message}` });
  }
};
