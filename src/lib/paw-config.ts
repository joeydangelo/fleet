import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { writeFileSync } from 'atomically';
import { resolve } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { z } from 'zod';

const YAML_OPTIONS = {
  lineWidth: 88,
  defaultStringType: 'PLAIN' as const,
  defaultKeyType: 'PLAIN' as const,
  sortMapEntries: true,
};

const DocsCacheSchema = z.object({
  files: z.record(z.string(), z.string()).default({}),
  lookup_path: z
    .array(z.string())
    .default(['.paw/docs/shortcuts', '.paw/docs/guidelines', '.paw/docs/templates']),
});

const SettingsSchema = z.object({
  doc_auto_sync_hours: z.number().default(24),
});

const PawProjectConfigSchema = z.object({
  docs_cache: DocsCacheSchema.default({}),
  settings: SettingsSchema.default({}),
});

/** Tracked project configuration stored in `.paw/config.yml`. */
export type PawProjectConfig = z.infer<typeof PawProjectConfigSchema>;

const LocalStateSchema = z.object({
  last_doc_sync_at: z.string().optional(),
});

/** Transient per-machine state stored in `.paw/run/state.yml` (gitignored). */
export type LocalState = z.infer<typeof LocalStateSchema>;

/** Parse `.paw/config.yml`, applying schema defaults for missing fields. */
export function readProjectConfig(repoRoot: string): PawProjectConfig {
  const configPath = resolve(repoRoot, '.paw', 'config.yml');
  if (!existsSync(configPath)) {
    return PawProjectConfigSchema.parse({});
  }
  const raw = readFileSync(configPath, 'utf-8');
  const parsed = parseYaml(raw) as unknown;
  return PawProjectConfigSchema.parse(parsed ?? {});
}

const CONFIG_HEADER = `\
# Documentation cache configuration.
# files: Maps destination paths (relative to .paw/docs/) to source locations.
#   Sources can be:
#   - internal: prefix for bundled docs (e.g., "internal:shortcuts/build-task.md")
#   - Full URL for external docs (e.g., "https://raw.githubusercontent.com/org/repo/main/file.md")
# lookup_path: Search paths for doc lookup (like shell $PATH). Earlier paths take precedence.
#
# To sync docs: paw init
#
# Auto-sync: Docs are automatically synced when stale (default: every 24 hours).
# Configure with settings.doc_auto_sync_hours (0 = disabled).
`;

/** Serialize config to `.paw/config.yml` with a human-readable comment header. */
export function writeProjectConfig(repoRoot: string, config: PawProjectConfig): void {
  const configPath = resolve(repoRoot, '.paw', 'config.yml');
  const body = stringifyYaml(config, YAML_OPTIONS);
  const output = body.replace(/^docs_cache:/m, CONFIG_HEADER + 'docs_cache:');
  writeFileSync(configPath, output, 'utf-8');
}

/** Parse transient local state from `.paw/run/state.yml`, defaulting if absent. */
export function readLocalState(repoRoot: string): LocalState {
  const statePath = resolve(repoRoot, '.paw', 'run', 'state.yml');
  if (!existsSync(statePath)) {
    return LocalStateSchema.parse({});
  }
  const raw = readFileSync(statePath, 'utf-8');
  const parsed = parseYaml(raw) as unknown;
  return LocalStateSchema.parse(parsed ?? {});
}

/** Persist transient local state to `.paw/run/state.yml`, creating the directory if needed. */
export function writeLocalState(repoRoot: string, state: LocalState): void {
  const dir = resolve(repoRoot, '.paw', 'run');
  mkdirSync(dir, { recursive: true });
  const statePath = resolve(dir, 'state.yml');
  writeFileSync(statePath, stringifyYaml(state, YAML_OPTIONS), 'utf-8');
}
