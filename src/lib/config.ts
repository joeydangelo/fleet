import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { getRepoRoot } from './git.js';

const TaskSchema = z.object({
  focus: z.union([z.string(), z.array(z.string())]),
  prompt: z.string().optional(),
  issue: z.string().optional(),
  depends_on: z.union([z.string(), z.array(z.string())]).optional(),
});

const PawConfigSchema = z.object({
  base: z.string().default('main'),
  target: z.string(),
  agent: z.string().optional(),
  spec: z.string().optional(),
  include: z.array(z.string()).optional(),
  tasks: z.record(z.string(), TaskSchema),
});

/** Parsed paw.yaml configuration: target branch, task definitions, and file-copy patterns. */
export type PawConfig = z.infer<typeof PawConfigSchema>;

/** Parse and validate a paw.yaml file, including dependency-graph checks. */
export function loadConfig(configPath: string): PawConfig {
  if (!existsSync(configPath)) {
    throw new Error(`Config file not found: ${configPath}`);
  }

  const raw = readFileSync(configPath, 'utf-8');

  if (/^<<<<<<< /m.test(raw) || /^=======/m.test(raw) || /^>>>>>>> /m.test(raw)) {
    throw new Error(
      `${configPath} contains unresolved git merge conflict markers. Resolve conflicts before running paw.`,
    );
  }

  const parsed = parseYaml(raw) as unknown;

  const result = PawConfigSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid .paw/paw.yaml:\n${issues}`);
  }

  validateDependsOn(result.data);

  return result.data;
}

/** Coerce a scalar-or-array `depends_on` value into a uniform array. */
export function normalizeDeps(deps: string | string[] | undefined): string[] {
  if (!deps) return [];
  return Array.isArray(deps) ? deps : [deps];
}

function validateDependsOn(config: PawConfig): void {
  const taskNames = new Set(Object.keys(config.tasks));

  for (const [name, task] of Object.entries(config.tasks)) {
    const deps = normalizeDeps(task.depends_on);
    for (const dep of deps) {
      if (dep === name) {
        throw new Error(
          `Invalid .paw/paw.yaml:\n  tasks.${name}.depends_on references "${dep}" (itself)`,
        );
      }
      if (!taskNames.has(dep)) {
        throw new Error(
          `Invalid .paw/paw.yaml:\n  tasks.${name}.depends_on references "${dep}" which does not exist in tasks`,
        );
      }
    }
  }

  const visited = new Set<string>();
  const inStack = new Set<string>();

  function visit(name: string): void {
    if (inStack.has(name)) {
      throw new Error(
        `Invalid .paw/paw.yaml:\n  Cycle detected in depends_on: ${[...inStack, name].join(' → ')}`,
      );
    }
    if (visited.has(name)) return;

    inStack.add(name);
    const deps = normalizeDeps(config.tasks[name]?.depends_on);
    for (const dep of deps) {
      visit(dep);
    }
    inStack.delete(name);
    visited.add(name);
  }

  for (const name of taskNames) {
    visit(name);
  }
}

/**
 * Topological sort of tasks using Kahn's algorithm.
 * Tasks with no dependencies come first. Tasks at the same depth
 * preserve their YAML definition order (stable sort).
 */
export function topologicalSort(
  tasks: Record<string, { depends_on?: string | string[]; [key: string]: unknown }>,
): string[] {
  const names = Object.keys(tasks);
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();

  for (const name of names) {
    inDegree.set(name, 0);
    dependents.set(name, []);
  }

  for (const name of names) {
    const deps = normalizeDeps(tasks[name]?.depends_on);
    inDegree.set(name, deps.length);
    for (const dep of deps) {
      dependents.get(dep)!.push(name);
    }
  }

  const queue: string[] = names.filter((n) => inDegree.get(n) === 0);
  const result: string[] = [];

  while (queue.length > 0) {
    const current = queue.shift()!;
    result.push(current);

    const unblocked: string[] = [];
    for (const dep of dependents.get(current)!) {
      const newDegree = inDegree.get(dep)! - 1;
      inDegree.set(dep, newDegree);
      if (newDegree === 0) {
        unblocked.push(dep);
      }
    }
    for (const u of unblocked) {
      const uIndex = names.indexOf(u);
      let inserted = false;
      for (let i = 0; i < queue.length; i++) {
        if (names.indexOf(queue[i]!) > uIndex) {
          queue.splice(i, 0, u);
          inserted = true;
          break;
        }
      }
      if (!inserted) queue.push(u);
    }
  }

  return result;
}

/** Convenience wrapper: resolve repo root, find config, parse and return all three. */
export function loadRepoConfig(configOpt?: string): {
  repoRoot: string;
  configPath: string;
  config: PawConfig;
} {
  const repoRoot = getRepoRoot();
  const configPath = configOpt ?? resolveConfigPath(repoRoot);
  const config = loadConfig(configPath);
  return { repoRoot, configPath, config };
}

/** Find the first existing paw config file (.yaml or .yml) under `cwd`. */
export function resolveConfigPath(cwd: string): string {
  const candidates = ['.paw/paw.yaml', '.paw/paw.yml'];
  for (const name of candidates) {
    const p = resolve(cwd, name);
    if (existsSync(p)) return p;
  }
  throw new Error('No .paw/paw.yaml found. Create one or specify --config <path>');
}
