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

const PawManifestSchema = z.object({
  docs_cache: DocsCacheSchema.default({}),
  settings: SettingsSchema.default({}),
});

export type PawManifest = z.infer<typeof PawManifestSchema>;

const LocalStateSchema = z.object({
  last_doc_sync_at: z.string().optional(),
});

export type LocalState = z.infer<typeof LocalStateSchema>;

export function readManifest(repoRoot: string): PawManifest {
  const manifestPath = resolve(repoRoot, '.paw', 'manifest.yml');
  if (!existsSync(manifestPath)) {
    return PawManifestSchema.parse({});
  }
  const raw = readFileSync(manifestPath, 'utf-8');
  return PawManifestSchema.parse((parseYaml(raw) as unknown) ?? {});
}

const MANIFEST_HEADER = `\
# Doc manifest — tracks doc sources and sync settings.
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

export function writeManifest(repoRoot: string, manifest: PawManifest): void {
  const manifestPath = resolve(repoRoot, '.paw', 'manifest.yml');
  const body = stringifyYaml(manifest, YAML_OPTIONS);
  const output = body.replace(/^docs_cache:/m, MANIFEST_HEADER + 'docs_cache:');
  writeFileSync(manifestPath, output, 'utf-8');
}

export function readLocalState(repoRoot: string): LocalState {
  const statePath = resolve(repoRoot, '.paw', 'run', 'state.yml');
  if (!existsSync(statePath)) {
    return LocalStateSchema.parse({});
  }
  const raw = readFileSync(statePath, 'utf-8');
  return LocalStateSchema.parse((parseYaml(raw) as unknown) ?? {});
}

export function writeLocalState(repoRoot: string, state: LocalState): void {
  const dir = resolve(repoRoot, '.paw', 'run');
  mkdirSync(dir, { recursive: true });
  const statePath = resolve(dir, 'state.yml');
  writeFileSync(statePath, stringifyYaml(state, YAML_OPTIONS), 'utf-8');
}
