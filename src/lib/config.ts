import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

const TaskSchema = z.object({
  focus: z.union([z.string(), z.array(z.string())]),
  prompt: z.string().optional(),
  issue: z.string().optional(),
  spec: z.string().optional(),
});

const HooksSchema = z.object({
  'pre-done': z.string().optional(),
  'post-merge': z.string().optional(),
  'post-up': z.string().optional(),
});

const PawConfigSchema = z.object({
  base: z.string().default('main'),
  target: z.string(),
  agent: z.string().optional(),
  include: z.array(z.string()).optional(),
  hooks: HooksSchema.optional(),
  tasks: z.record(z.string(), TaskSchema),
});

export type PawConfig = z.infer<typeof PawConfigSchema>;

export function loadConfig(configPath: string): PawConfig {
  if (!existsSync(configPath)) {
    throw new Error(`Config file not found: ${configPath}`);
  }

  const raw = readFileSync(configPath, 'utf-8');
  const parsed = parseYaml(raw) as unknown;

  const result = PawConfigSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid .paw/paw.yaml:\n${issues}`);
  }
  return result.data;
}

export function resolveConfigPath(cwd: string): string {
  const candidates = ['.paw/paw.yaml', '.paw/paw.yml'];
  for (const name of candidates) {
    const p = resolve(cwd, name);
    if (existsSync(p)) return p;
  }
  throw new Error('No .paw/paw.yaml found. Create one or specify --config <path>');
}
