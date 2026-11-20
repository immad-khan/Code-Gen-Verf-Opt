import { afterEach, expect, it, vi } from 'vitest';
import { runBackendOptimization, runCompareOptimization } from './optimizationService';

const request = { files: [], originalPrompt: 'Example', lockedTestHash: 'locked',
  apiSettings: { provider: 'openai' as const, model: 'test-model', apiKey: '' } };
afterEach(() => vi.unstubAllGlobals());

it.each([runBackendOptimization, runCompareOptimization])('rejects a rejected test hash without a fallback call', async run => {
  const fetch = vi.fn().mockResolvedValue(new Response('Unknown suite', { status: 400 }));
  vi.stubGlobal('fetch', fetch);
  await expect(run(request)).rejects.toThrow('Unknown suite');
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('sends the selected mode, locked hash and two-round budget', async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ iterations: [] }));
  vi.stubGlobal('fetch', fetch);
  await expect(runBackendOptimization({ ...request, mode: 'improved' })).resolves.toEqual({ iterations: [] });
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({ repairMode: 'improved', lockedTestHash: 'locked', maxIterations: 2 });
});
