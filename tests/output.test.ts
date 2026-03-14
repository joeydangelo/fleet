import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  formatFocusAreas,
  formatTaskStatus,
  error,
  warn,
  unknown,
  success,
  pending,
  handleError,
} from '../src/lib/output.js';

describe('stderr/stdout routing', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('error() writes to stderr', () => {
    error('my-task', 'something failed');
    expect(consoleErrorSpy).toHaveBeenCalledOnce();
    expect(consoleLogSpy).not.toHaveBeenCalled();
  });

  it('warn() writes to stderr', () => {
    warn('my-task', 'heads up');
    expect(consoleErrorSpy).toHaveBeenCalledOnce();
    expect(consoleLogSpy).not.toHaveBeenCalled();
  });

  it('unknown() writes to stderr', () => {
    unknown('my-task', 'state unclear');
    expect(consoleErrorSpy).toHaveBeenCalledOnce();
    expect(consoleLogSpy).not.toHaveBeenCalled();
  });

  it('success() writes to stdout', () => {
    success('my-task', 'all good');
    expect(consoleLogSpy).toHaveBeenCalledOnce();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it('pending() writes to stdout', () => {
    pending('my-task', 'working...');
    expect(consoleLogSpy).toHaveBeenCalledOnce();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it('handleError() writes to stderr and exits with code 1', () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code) => {
      throw new Error('process.exit called');
    });
    expect(() => handleError(new Error('boom'))).toThrow('process.exit called');
    expect(consoleErrorSpy).toHaveBeenCalledOnce();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

describe('formatFocusAreas', () => {
  it('returns empty string for undefined', () => {
    expect(formatFocusAreas(undefined)).toBe('');
  });

  it('returns empty string for empty array', () => {
    expect(formatFocusAreas([])).toBe('');
  });

  it('shows single item', () => {
    expect(formatFocusAreas(['src/auth/'])).toBe('(src/auth/)');
  });

  it('shows two items', () => {
    expect(formatFocusAreas(['src/auth/', 'src/api/'])).toBe('(src/auth/, src/api/)');
  });

  it('shows three items without truncation', () => {
    expect(formatFocusAreas(['src/auth/', 'src/api/', 'src/middleware/'])).toBe(
      '(src/auth/, src/api/, src/middleware/)',
    );
  });

  it('truncates four items to first 2 + count', () => {
    expect(formatFocusAreas(['src/auth/', 'src/api/', 'src/middleware/', 'src/utils/'])).toBe(
      '(src/auth/, src/api/, +2 more)',
    );
  });

  it('truncates five items to first 2 + count', () => {
    expect(
      formatFocusAreas(['src/auth/', 'src/api/', 'src/middleware/', 'src/utils/', 'tests/']),
    ).toBe('(src/auth/, src/api/, +3 more)');
  });
});

describe('formatTaskStatus', () => {
  it('maps in_review to "in review"', () => {
    expect(formatTaskStatus('in_review')).toBe('in review');
  });

  it('passes through other statuses unchanged', () => {
    expect(formatTaskStatus('done')).toBe('done');
    expect(formatTaskStatus('pending')).toBe('pending');
    expect(formatTaskStatus('in_progress')).toBe('in_progress');
  });
});
