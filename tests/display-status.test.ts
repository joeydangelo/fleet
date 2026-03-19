import { describe, it, expect } from 'vitest';
import { resolveAgentStatus } from '../src/lib/display-status.js';
import type { HealthState } from '../src/lib/health.js';

describe('resolveAgentStatus', () => {
  const healthStates: (HealthState | undefined)[] = [
    'booting',
    'working',
    'stalled',
    'zombie',
    'completed',
    undefined,
  ];

  describe('pending + any → pending', () => {
    it.each(healthStates)('pending + %s → pending', (health) => {
      expect(resolveAgentStatus('pending', health)).toBe('pending');
    });
  });

  describe('in_progress + health → display status', () => {
    it('in_progress + booting → booting', () => {
      expect(resolveAgentStatus('in_progress', 'booting')).toBe('booting');
    });

    it('in_progress + working → working', () => {
      expect(resolveAgentStatus('in_progress', 'working')).toBe('working');
    });

    it('in_progress + stalled → stalled', () => {
      expect(resolveAgentStatus('in_progress', 'stalled')).toBe('stalled');
    });

    it('in_progress + zombie → zombie', () => {
      expect(resolveAgentStatus('in_progress', 'zombie')).toBe('zombie');
    });

    it('in_progress + completed → working (fallback)', () => {
      expect(resolveAgentStatus('in_progress', 'completed')).toBe('working');
    });

    it('in_progress + undefined → working (fallback)', () => {
      expect(resolveAgentStatus('in_progress', undefined)).toBe('working');
    });
  });

  describe('in_review + any → in review', () => {
    it.each(healthStates)('in_review + %s → in review', (health) => {
      expect(resolveAgentStatus('in_review', health)).toBe('in review');
    });
  });

  describe('done + any → done', () => {
    it.each(healthStates)('done + %s → done', (health) => {
      expect(resolveAgentStatus('done', health)).toBe('done');
    });
  });
});
