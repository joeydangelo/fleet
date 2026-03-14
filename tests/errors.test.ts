import { describe, it, expect } from 'vitest';
import {
  CLIError,
  ValidationError,
  NotFoundError,
  ExternalCommandError,
} from '../src/lib/errors.js';

describe('CLIError', () => {
  it('has name "CLIError"', () => {
    expect(new CLIError('test').name).toBe('CLIError');
  });

  it('has exitCode 1', () => {
    expect(new CLIError('test').exitCode).toBe(1);
  });

  it('preserves cause', () => {
    const cause = new Error('root');
    const err = new CLIError('wrapper', { cause });
    expect(err.cause).toBe(cause);
  });

  it('is an instance of Error', () => {
    expect(new CLIError('test')).toBeInstanceOf(Error);
  });
});

describe('ValidationError', () => {
  it('has name "ValidationError"', () => {
    expect(new ValidationError('bad').name).toBe('ValidationError');
  });

  it('has exitCode 2', () => {
    expect(new ValidationError('bad').exitCode).toBe(2);
  });

  it('is instanceof CLIError', () => {
    expect(new ValidationError('bad')).toBeInstanceOf(CLIError);
  });

  it('preserves cause', () => {
    const cause = new Error('root');
    const err = new ValidationError('invalid', { cause });
    expect(err.cause).toBe(cause);
  });
});

describe('NotFoundError', () => {
  it('has name "NotFoundError"', () => {
    expect(new NotFoundError('missing').name).toBe('NotFoundError');
  });

  it('has exitCode 1', () => {
    expect(new NotFoundError('missing').exitCode).toBe(1);
  });

  it('is instanceof CLIError', () => {
    expect(new NotFoundError('missing')).toBeInstanceOf(CLIError);
  });

  it('preserves cause', () => {
    const cause = new Error('root');
    const err = new NotFoundError('not found', { cause });
    expect(err.cause).toBe(cause);
  });
});

describe('ExternalCommandError', () => {
  it('has name "ExternalCommandError"', () => {
    expect(new ExternalCommandError('cmd failed').name).toBe('ExternalCommandError');
  });

  it('has exitCode 1', () => {
    expect(new ExternalCommandError('cmd failed').exitCode).toBe(1);
  });

  it('is instanceof CLIError', () => {
    expect(new ExternalCommandError('cmd failed')).toBeInstanceOf(CLIError);
  });

  it('preserves cause', () => {
    const cause = new Error('exit 1');
    const err = new ExternalCommandError('git failed', { cause });
    expect(err.cause).toBe(cause);
  });
});
