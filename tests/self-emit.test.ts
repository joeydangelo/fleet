import { describe, it, expect, vi, beforeEach } from 'vitest';

// Track emitEvent calls
const emitCalls: Array<Record<string, unknown>> = [];

vi.mock('../src/lib/feed.js', () => ({
  emitEvent: (event: Record<string, unknown>) => {
    emitCalls.push(event);
  },
}));

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn().mockReturnValue('EXTEND'),
}));

describe('self-emit: triage emits fleet.triage event', () => {
  beforeEach(() => {
    emitCalls.length = 0;
  });

  it('triageAgent emits fleet.triage with extend verdict', async () => {
    const { execFileSync } = await import('node:child_process');
    vi.mocked(execFileSync).mockReturnValue('EXTEND');

    const { triageAgent } = await import('../src/lib/health.js');

    const mockTmux = {
      capturePaneContent: () => 'some terminal output',
    } as unknown as Parameters<typeof triageAgent>[0];

    const result = triageAgent(mockTmux, 'fleet-review-alpha', 'alpha');

    expect(result.verdict).toBe('extend');

    const triageEvent = emitCalls.find((c) => c.event === 'fleet.triage');
    expect(triageEvent).toBeDefined();
    expect(triageEvent!.task).toBe('alpha');
    expect(triageEvent!.verdict).toBe('extend');
  });

  it('triageAgent emits fleet.triage with terminate verdict', async () => {
    const { execFileSync } = await import('node:child_process');
    vi.mocked(execFileSync).mockReturnValue('TERMINATE');

    const { triageAgent } = await import('../src/lib/health.js');

    const mockTmux = {
      capturePaneContent: () => 'bash prompt $',
    } as unknown as Parameters<typeof triageAgent>[0];

    const result = triageAgent(mockTmux, 'fleet-review-beta', 'beta');

    expect(result.verdict).toBe('terminate');

    const triageEvent = emitCalls.find((c) => c.event === 'fleet.triage' && c.task === 'beta');
    expect(triageEvent).toBeDefined();
    expect(triageEvent!.verdict).toBe('terminate');
  });

  it('triageAgent emits fleet.triage with retry verdict', async () => {
    const { execFileSync } = await import('node:child_process');
    vi.mocked(execFileSync).mockReturnValue('RETRY');

    const { triageAgent } = await import('../src/lib/health.js');

    const mockTmux = {
      capturePaneContent: () => 'error loop output',
    } as unknown as Parameters<typeof triageAgent>[0];

    const result = triageAgent(mockTmux, 'fleet-review-gamma', 'gamma');

    expect(result.verdict).toBe('retry');

    const triageEvent = emitCalls.find((c) => c.event === 'fleet.triage' && c.task === 'gamma');
    expect(triageEvent).toBeDefined();
    expect(triageEvent!.verdict).toBe('retry');
  });
});
