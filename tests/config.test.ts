import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig, resolveConfigPath } from '../src/lib/config.js';

function makeTempDir(): string {
  const dir = resolve(tmpdir(), `paw-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('loadConfig', () => {
  it('parses a valid paw.yaml', () => {
    const dir = makeTempDir();
    const configPath = resolve(dir, 'paw.yaml');
    writeFileSync(
      configPath,
      `
base: main
target: feature/dashboard
tasks:
  auth:
    focus: src/auth/
    prompt: Implement auth
  api:
    focus:
      - src/api/
      - src/routes/
`,
    );

    const config = loadConfig(configPath);
    expect(config.base).toBe('main');
    expect(config.target).toBe('feature/dashboard');
    expect(Object.keys(config.tasks)).toEqual(['auth', 'api']);
    expect(config.tasks['auth']?.focus).toBe('src/auth/');
    expect(config.tasks['api']?.focus).toEqual(['src/api/', 'src/routes/']);
    expect(config.tasks['auth']?.prompt).toBe('Implement auth');

    rmSync(dir, { recursive: true });
  });

  it('defaults base to main', () => {
    const dir = makeTempDir();
    const configPath = resolve(dir, 'paw.yaml');
    writeFileSync(
      configPath,
      `
target: cleanup/tests
tasks:
  lint:
    focus: src/
`,
    );

    const config = loadConfig(configPath);
    expect(config.base).toBe('main');

    rmSync(dir, { recursive: true });
  });

  it('throws on missing config file', () => {
    expect(() => loadConfig('/nonexistent/paw.yaml')).toThrow('Config file not found');
  });

  it('throws on invalid config (missing target)', () => {
    const dir = makeTempDir();
    const configPath = resolve(dir, 'paw.yaml');
    writeFileSync(
      configPath,
      `
tasks:
  foo:
    focus: bar/
`,
    );

    expect(() => loadConfig(configPath)).toThrow();
    rmSync(dir, { recursive: true });
  });

  it('throws a readable message on invalid config', () => {
    const dir = makeTempDir();
    const configPath = resolve(dir, 'paw.yaml');
    writeFileSync(
      configPath,
      `
target: feature/x
tasks:
  foo:
    not_a_field: true
`,
    );

    expect(() => loadConfig(configPath)).toThrow(/Invalid paw\.yaml/);
    rmSync(dir, { recursive: true });
  });
});

describe('agent config', () => {
  it('parses the agent field', () => {
    const dir = makeTempDir();
    const configPath = resolve(dir, 'paw.yaml');
    writeFileSync(
      configPath,
      `
target: feature/x
agent: claude
tasks:
  a:
    focus: src/
`,
    );

    const config = loadConfig(configPath);
    expect(config.agent).toBe('claude');

    rmSync(dir, { recursive: true });
  });

  it('accepts config without agent', () => {
    const dir = makeTempDir();
    const configPath = resolve(dir, 'paw.yaml');
    writeFileSync(
      configPath,
      `
target: feature/x
tasks:
  a:
    focus: src/
`,
    );

    const config = loadConfig(configPath);
    expect(config.agent).toBeUndefined();

    rmSync(dir, { recursive: true });
  });
});

describe('hooks config', () => {
  it('parses pre-done and post-merge hooks', () => {
    const dir = makeTempDir();
    const configPath = resolve(dir, 'paw.yaml');
    writeFileSync(
      configPath,
      `
target: feature/x
hooks:
  pre-done: npm test
  post-merge: npm test
tasks:
  a:
    focus: src/
`,
    );

    const config = loadConfig(configPath);
    expect(config.hooks?.['pre-done']).toBe('npm test');
    expect(config.hooks?.['post-merge']).toBe('npm test');

    rmSync(dir, { recursive: true });
  });

  it('accepts config with no hooks', () => {
    const dir = makeTempDir();
    const configPath = resolve(dir, 'paw.yaml');
    writeFileSync(
      configPath,
      `
target: feature/x
tasks:
  a:
    focus: src/
`,
    );

    const config = loadConfig(configPath);
    expect(config.hooks).toBeUndefined();

    rmSync(dir, { recursive: true });
  });

  it('accepts config with only pre-done hook', () => {
    const dir = makeTempDir();
    const configPath = resolve(dir, 'paw.yaml');
    writeFileSync(
      configPath,
      `
target: feature/x
hooks:
  pre-done: uv run pytest
tasks:
  a:
    focus: src/
`,
    );

    const config = loadConfig(configPath);
    expect(config.hooks?.['pre-done']).toBe('uv run pytest');
    expect(config.hooks?.['post-merge']).toBeUndefined();

    rmSync(dir, { recursive: true });
  });
});

describe('include config', () => {
  it('parses include as array of strings', () => {
    const dir = makeTempDir();
    const configPath = resolve(dir, 'paw.yaml');
    writeFileSync(
      configPath,
      `
target: feature/x
include:
  - .env
  - .env.local
  - "config/local.json"
tasks:
  a:
    focus: src/
`,
    );

    const config = loadConfig(configPath);
    expect(config.include).toEqual(['.env', '.env.local', 'config/local.json']);

    rmSync(dir, { recursive: true });
  });

  it('accepts config without include', () => {
    const dir = makeTempDir();
    const configPath = resolve(dir, 'paw.yaml');
    writeFileSync(
      configPath,
      `
target: feature/x
tasks:
  a:
    focus: src/
`,
    );

    const config = loadConfig(configPath);
    expect(config.include).toBeUndefined();

    rmSync(dir, { recursive: true });
  });
});

describe('resolveConfigPath', () => {
  it('finds paw.yaml', () => {
    const dir = makeTempDir();
    writeFileSync(resolve(dir, 'paw.yaml'), 'target: x\ntasks:\n  a:\n    focus: b\n');

    const result = resolveConfigPath(dir);
    expect(result).toBe(resolve(dir, 'paw.yaml'));

    rmSync(dir, { recursive: true });
  });

  it('finds paw.yml', () => {
    const dir = makeTempDir();
    writeFileSync(resolve(dir, 'paw.yml'), 'target: x\ntasks:\n  a:\n    focus: b\n');

    const result = resolveConfigPath(dir);
    expect(result).toBe(resolve(dir, 'paw.yml'));

    rmSync(dir, { recursive: true });
  });

  it('throws when no config found', () => {
    const dir = makeTempDir();
    expect(() => resolveConfigPath(dir)).toThrow('No paw.yaml found');
    rmSync(dir, { recursive: true });
  });
});
