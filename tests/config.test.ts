import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadConfig, resolveConfigPath, topologicalSort } from '../src/lib/config.js';
import { makeTempDir } from './helpers/temp.js';

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

    expect(() => loadConfig(configPath)).toThrow(/Invalid \.paw\/paw\.yaml/);
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

    expect(() => loadConfig(configPath)).toThrow(/Invalid \.paw\/paw\.yaml/);
    rmSync(dir, { recursive: true });
  });

  it('throws a clear error when file contains merge conflict markers', () => {
    const dir = makeTempDir();
    const configPath = resolve(dir, 'paw.yaml');
    writeFileSync(
      configPath,
      `
target: feature/x
tasks:
<<<<<<< HEAD
  auth:
    focus: src/auth/
=======
  api:
    focus: src/api/
>>>>>>> feature/other
`,
    );

    expect(() => loadConfig(configPath)).toThrow(/merge conflict/i);
    rmSync(dir, { recursive: true });
  });
});

describe('agent config', () => {
  it('ignores unknown agent field in yaml', () => {
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
    expect(config).toBeDefined();

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
});

describe('task issue field', () => {
  it('parses tasks with issue field', () => {
    const dir = makeTempDir();
    const configPath = resolve(dir, 'paw.yaml');
    writeFileSync(
      configPath,
      `
target: feature/x
tasks:
  auth:
    focus: src/auth/
    issue: paw-za72
    prompt: Add OAuth2 login
`,
    );

    const config = loadConfig(configPath);
    expect(config.tasks['auth']?.issue).toBe('paw-za72');

    rmSync(dir, { recursive: true });
  });
});

describe('top-level spec field', () => {
  it('parses config with top-level spec', () => {
    const dir = makeTempDir();
    const configPath = resolve(dir, 'paw.yaml');
    writeFileSync(
      configPath,
      `
target: feature/x
spec: .paw/specs/spec-2026-03-04-auth.md
tasks:
  auth:
    focus: src/auth/
    prompt: Add OAuth2 login
`,
    );

    const config = loadConfig(configPath);
    expect(config.spec).toBe('.paw/specs/spec-2026-03-04-auth.md');

    rmSync(dir, { recursive: true });
  });
});

describe('depends_on config', () => {
  it('accepts depends_on as a string', () => {
    const dir = makeTempDir();
    const configPath = resolve(dir, 'paw.yaml');
    writeFileSync(
      configPath,
      `
target: feature/x
tasks:
  auth:
    focus: src/auth/
  api:
    focus: src/api/
    depends_on: auth
`,
    );

    const config = loadConfig(configPath);
    expect(config.tasks['api']?.depends_on).toBe('auth');

    rmSync(dir, { recursive: true });
  });

  it('accepts depends_on as an array', () => {
    const dir = makeTempDir();
    const configPath = resolve(dir, 'paw.yaml');
    writeFileSync(
      configPath,
      `
target: feature/x
tasks:
  auth:
    focus: src/auth/
  api:
    focus: src/api/
  tests:
    focus: tests/
    depends_on:
      - auth
      - api
`,
    );

    const config = loadConfig(configPath);
    expect(config.tasks['tests']?.depends_on).toEqual(['auth', 'api']);

    rmSync(dir, { recursive: true });
  });

  it('throws when depends_on references a nonexistent task', () => {
    const dir = makeTempDir();
    const configPath = resolve(dir, 'paw.yaml');
    writeFileSync(
      configPath,
      `
target: feature/x
tasks:
  api:
    focus: src/api/
    depends_on: auth
`,
    );

    expect(() => loadConfig(configPath)).toThrow(/depends_on.*"auth".*does not exist/);

    rmSync(dir, { recursive: true });
  });

  it('throws when depends_on array references a nonexistent task', () => {
    const dir = makeTempDir();
    const configPath = resolve(dir, 'paw.yaml');
    writeFileSync(
      configPath,
      `
target: feature/x
tasks:
  auth:
    focus: src/auth/
  tests:
    focus: tests/
    depends_on:
      - auth
      - api
`,
    );

    expect(() => loadConfig(configPath)).toThrow(/depends_on.*"api".*does not exist/);

    rmSync(dir, { recursive: true });
  });

  it('throws on a two-node cycle (A→B→A)', () => {
    const dir = makeTempDir();
    const configPath = resolve(dir, 'paw.yaml');
    writeFileSync(
      configPath,
      `
target: feature/x
tasks:
  auth:
    focus: src/auth/
    depends_on: api
  api:
    focus: src/api/
    depends_on: auth
`,
    );

    expect(() => loadConfig(configPath)).toThrow(/cycle.*depends_on/i);

    rmSync(dir, { recursive: true });
  });

  it('throws on a three-node cycle (A→B→C→A)', () => {
    const dir = makeTempDir();
    const configPath = resolve(dir, 'paw.yaml');
    writeFileSync(
      configPath,
      `
target: feature/x
tasks:
  auth:
    focus: src/auth/
    depends_on: tests
  api:
    focus: src/api/
    depends_on: auth
  tests:
    focus: tests/
    depends_on: api
`,
    );

    expect(() => loadConfig(configPath)).toThrow(/cycle.*depends_on/i);

    rmSync(dir, { recursive: true });
  });

  it('accepts a valid diamond dependency (no cycle)', () => {
    const dir = makeTempDir();
    const configPath = resolve(dir, 'paw.yaml');
    writeFileSync(
      configPath,
      `
target: feature/x
tasks:
  core:
    focus: src/core/
  auth:
    focus: src/auth/
    depends_on: core
  api:
    focus: src/api/
    depends_on: core
  tests:
    focus: tests/
    depends_on:
      - auth
      - api
`,
    );

    const config = loadConfig(configPath);
    expect(config.tasks['tests']?.depends_on).toEqual(['auth', 'api']);

    rmSync(dir, { recursive: true });
  });

  it('throws when a task depends on itself', () => {
    const dir = makeTempDir();
    const configPath = resolve(dir, 'paw.yaml');
    writeFileSync(
      configPath,
      `
target: feature/x
tasks:
  auth:
    focus: src/auth/
    depends_on: auth
`,
    );

    expect(() => loadConfig(configPath)).toThrow(/depends_on.*"auth".*itself/);

    rmSync(dir, { recursive: true });
  });
});

describe('topologicalSort', () => {
  it('returns YAML order when no dependencies exist', () => {
    const tasks = {
      auth: { focus: 'src/auth/' },
      api: { focus: 'src/api/' },
      tests: { focus: 'tests/' },
    };

    expect(topologicalSort(tasks)).toEqual(['auth', 'api', 'tests']);
  });

  it('sorts a linear chain (A←B←C)', () => {
    const tasks = {
      tests: { focus: 'tests/', depends_on: 'api' },
      api: { focus: 'src/api/', depends_on: 'auth' },
      auth: { focus: 'src/auth/' },
    };

    const result = topologicalSort(tasks);
    expect(result.indexOf('auth')).toBeLessThan(result.indexOf('api'));
    expect(result.indexOf('api')).toBeLessThan(result.indexOf('tests'));
  });

  it('sorts a diamond (core←auth,api←tests)', () => {
    const tasks = {
      tests: { focus: 'tests/', depends_on: ['auth', 'api'] },
      api: { focus: 'src/api/', depends_on: 'core' },
      auth: { focus: 'src/auth/', depends_on: 'core' },
      core: { focus: 'src/core/' },
    };

    const result = topologicalSort(tasks);
    expect(result.indexOf('core')).toBeLessThan(result.indexOf('auth'));
    expect(result.indexOf('core')).toBeLessThan(result.indexOf('api'));
    expect(result.indexOf('auth')).toBeLessThan(result.indexOf('tests'));
    expect(result.indexOf('api')).toBeLessThan(result.indexOf('tests'));
  });

  it('preserves YAML order for tasks at the same depth', () => {
    const tasks = {
      auth: { focus: 'src/auth/' },
      api: { focus: 'src/api/' },
      tests: { focus: 'tests/', depends_on: ['auth', 'api'] },
    };

    const result = topologicalSort(tasks);
    // auth and api are both at depth 0, should keep YAML order
    expect(result).toEqual(['auth', 'api', 'tests']);
  });

  it('handles single task', () => {
    const tasks = { auth: { focus: 'src/auth/' } };

    expect(topologicalSort(tasks)).toEqual(['auth']);
  });
});

describe('setup config', () => {
  it('parses config with setup field', () => {
    const dir = makeTempDir();
    const configPath = resolve(dir, 'paw.yaml');
    writeFileSync(
      configPath,
      `
target: feature/x
setup: pnpm install
tasks:
  a:
    focus: src/
`,
    );

    const config = loadConfig(configPath);
    expect(config.setup).toBe('pnpm install');

    rmSync(dir, { recursive: true });
  });

  it('accepts config without setup', () => {
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
    expect(config.setup).toBeUndefined();

    rmSync(dir, { recursive: true });
  });
});

describe('resolveConfigPath', () => {
  it('finds .paw/paw.yaml', () => {
    const dir = makeTempDir();
    mkdirSync(resolve(dir, '.paw'), { recursive: true });
    writeFileSync(resolve(dir, '.paw/paw.yaml'), 'target: x\ntasks:\n  a:\n    focus: b\n');

    const result = resolveConfigPath(dir);
    expect(result).toBe(resolve(dir, '.paw/paw.yaml'));

    rmSync(dir, { recursive: true });
  });

  it('finds .paw/paw.yml', () => {
    const dir = makeTempDir();
    mkdirSync(resolve(dir, '.paw'), { recursive: true });
    writeFileSync(resolve(dir, '.paw/paw.yml'), 'target: x\ntasks:\n  a:\n    focus: b\n');

    const result = resolveConfigPath(dir);
    expect(result).toBe(resolve(dir, '.paw/paw.yml'));

    rmSync(dir, { recursive: true });
  });

  it('throws when no config found', () => {
    const dir = makeTempDir();
    expect(() => resolveConfigPath(dir)).toThrow('No .paw/paw.yaml found');
    rmSync(dir, { recursive: true });
  });
});
