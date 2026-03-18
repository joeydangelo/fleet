import { existsSync, readFileSync } from 'node:fs';
import { writeFileSync } from 'atomically';
import { resolve } from 'node:path';

const FLEET_GITIGNORE_CONTENT = `# Transient runtime state (dies with session)
run/
# Installed documentation (regenerated on sync)
docs/
# Session runtime data
fleet.yaml
tasks/
sync/
sessions/
specs/
*.tmp
`;

/**
 * Create or update .fleet/.gitignore so that docs/ and runtime
 * data are ignored while manifest.yml and hooks/ stay tracked.
 */
export function ensureFleetGitignore(repoRoot: string): boolean {
  const gitignorePath = resolve(repoRoot, '.fleet', '.gitignore');
  if (existsSync(gitignorePath)) {
    const current = readFileSync(gitignorePath, 'utf-8');
    if (current === FLEET_GITIGNORE_CONTENT) return false;
  }
  writeFileSync(gitignorePath, FLEET_GITIGNORE_CONTENT, 'utf-8');
  return true;
}

/**
 * Remove the `.fleet/` entry (and its comment) from the root .gitignore.
 * This is the migration path from the old "ignore everything" model.
 * Returns true if the file was modified.
 */
export function removeFleetFromRootGitignore(repoRoot: string): boolean {
  const gitignorePath = resolve(repoRoot, '.gitignore');
  if (!existsSync(gitignorePath)) return false;

  const content = readFileSync(gitignorePath, 'utf-8');
  if (!content.includes('.fleet/')) return false;

  const lines = content.split('\n');
  const filtered: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() === '.fleet/' || line.trim() === '.fleet') continue;
    if (
      line.trim() === '# fleet working state' &&
      i + 1 < lines.length &&
      (lines[i + 1]!.trim() === '.fleet/' || lines[i + 1]!.trim() === '.fleet')
    ) {
      continue;
    }
    filtered.push(line);
  }

  const cleaned = filtered
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\n+$/, '\n');

  if (cleaned === content) return false;
  writeFileSync(gitignorePath, cleaned, 'utf-8');
  return true;
}
