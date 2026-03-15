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
    .default(['.fleet/docs/shortcuts', '.fleet/docs/guidelines', '.fleet/docs/templates']),
});

const ManifestSettingsSchema = z.object({
  doc_auto_sync_hours: z.number().default(24),
});

const FleetManifestSchema = z.object({
  docs_cache: DocsCacheSchema.default({}),
  settings: ManifestSettingsSchema.default({}),
});

/** Primary manifest shape stored in `.fleet/manifest.yml` — tracks doc sources, sync settings, and the docs cache. */
export type FleetManifest = z.infer<typeof FleetManifestSchema>;

const LocalStateSchema = z.object({
  last_doc_sync_at: z.string().optional(),
});

/** Gitignored local runtime state stored in `.fleet/run/state.yml` — not committed to the repo. */
export type LocalState = z.infer<typeof LocalStateSchema>;

/**
 * Reads and validates the fleet manifest YAML from `<repoRoot>/.fleet/manifest.yml`.
 * Schema defaults are applied by Zod, so the return value is always fully populated
 * even when the file is absent or partially specified.
 */
export function readManifest(repoRoot: string): FleetManifest {
  const manifestPath = resolve(repoRoot, '.fleet', 'manifest.yml');
  if (!existsSync(manifestPath)) {
    return FleetManifestSchema.parse({});
  }
  const raw = readFileSync(manifestPath, 'utf-8');
  return FleetManifestSchema.parse((parseYaml(raw) as unknown) ?? {});
}

const MANIFEST_HEADER = `\
# Doc manifest — tracks doc sources and sync settings.
# files: Maps destination paths (relative to .fleet/docs/) to source locations.
#   Sources can be:
#   - internal: prefix for bundled docs (e.g., "internal:shortcuts/build-task.md")
#   - Full URL for external docs (e.g., "https://raw.githubusercontent.com/org/repo/main/file.md")
# lookup_path: Search paths for doc lookup (like shell $PATH). Earlier paths take precedence.
#
# To sync docs: fleet init
#
# Auto-sync: Docs are automatically synced when stale (default: every 24 hours).
# Configure with settings.doc_auto_sync_hours (0 = disabled).
`;

/**
 * Serializes the manifest to YAML and writes it atomically to `<repoRoot>/.fleet/manifest.yml`.
 * A multi-line header comment explaining the file format is prepended before the `docs_cache:` key.
 */
export function writeManifest(repoRoot: string, manifest: FleetManifest): void {
  const manifestPath = resolve(repoRoot, '.fleet', 'manifest.yml');
  const body = stringifyYaml(manifest, YAML_OPTIONS);
  const output = body.replace(/^docs_cache:/m, MANIFEST_HEADER + 'docs_cache:');
  writeFileSync(manifestPath, output, 'utf-8');
}

/**
 * Reads the gitignored local state file from `<repoRoot>/.fleet/run/state.yml`.
 * Returns schema defaults if the file does not exist — callers never need to handle absence.
 */
export function readLocalState(repoRoot: string): LocalState {
  const statePath = resolve(repoRoot, '.fleet', 'run', 'state.yml');
  if (!existsSync(statePath)) {
    return LocalStateSchema.parse({});
  }
  const raw = readFileSync(statePath, 'utf-8');
  return LocalStateSchema.parse((parseYaml(raw) as unknown) ?? {});
}

/** Writes local state to `<repoRoot>/.fleet/run/state.yml`, creating the directory if needed. */
export function writeLocalState(repoRoot: string, state: LocalState): void {
  const dir = resolve(repoRoot, '.fleet', 'run');
  mkdirSync(dir, { recursive: true });
  const statePath = resolve(dir, 'state.yml');
  writeFileSync(statePath, stringifyYaml(state, YAML_OPTIONS), 'utf-8');
}
