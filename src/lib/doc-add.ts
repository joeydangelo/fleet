import { mkdirSync } from 'node:fs';
import { writeFileSync } from 'atomically';
import { resolve, dirname } from 'node:path';

import { fetchWithGhFallback } from './github-fetch.js';
import { readManifest, writeManifest } from './manifest.js';

/** The category of a fleet doc file — controls which subdirectory and manifest section it uses. */
export type DocType = 'shortcut' | 'guideline' | 'template';

interface AddDocResult {
  destPath: string;
  rawUrl: string;
  usedGhCli: boolean;
}

/** Validate that fetched content looks like a markdown document. */
export function validateDocContent(content: string, name: string): void {
  if (!content || content.trim().length === 0) {
    throw new Error(`Fetched content for "${name}" is empty`);
  }
  if (content.length < 10) {
    throw new Error(`Fetched content for "${name}" is too short (${content.length} chars)`);
  }
  if (content.trimStart().startsWith('<!DOCTYPE') || content.trimStart().startsWith('<html')) {
    throw new Error(
      `Fetched content for "${name}" appears to be an HTML page, not a markdown document`,
    );
  }
}

function getDocTypeSubdir(docType: DocType): string {
  switch (docType) {
    case 'guideline':
      return 'guidelines';
    case 'shortcut':
      return 'shortcuts';
    case 'template':
      return 'templates';
    default: {
      const _exhaustive: never = docType;
      throw new Error(`Unhandled DocType: ${_exhaustive as string}`);
    }
  }
}

/** Inject or update a `roles` field in markdown frontmatter. */
export function injectRolesFrontmatter(content: string, roles: string[]): string {
  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (fmMatch) {
    const rolesLine = `roles: [${roles.join(', ')}]`;
    const body = fmMatch[1]!;
    // Replace existing roles line or append before closing ---
    if (/^roles:/m.test(body)) {
      const updated = body.replace(/^roles:.*$/m, rolesLine);
      return content.replace(fmMatch[0], `---\n${updated}\n---`);
    }
    return content.replace(fmMatch[0], `---\n${body}\n${rolesLine}\n---`);
  }
  // No frontmatter — wrap content with one
  return `---\nroles: [${roles.join(', ')}]\n---\n${content}`;
}

/** Fetch a doc from a URL and save it to .fleet/docs/{category}/. */
export async function addDoc(
  repoRoot: string,
  options: { url: string; name: string; docType: DocType; roles?: string[] },
): Promise<AddDocResult> {
  const { url, name, docType, roles } = options;

  const cleanName = name.endsWith('.md') ? name.slice(0, -3) : name;
  const filename = `${cleanName}.md`;
  const subdir = getDocTypeSubdir(docType);
  const destPath = `${subdir}/${filename}`;

  let result: { content: string; usedGhCli: boolean };
  try {
    result = await fetchWithGhFallback(url);
  } catch (err) {
    throw new Error(
      `Failed to fetch doc from ${url}: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }
  let content = result.content;
  const { usedGhCli } = result;

  validateDocContent(content, cleanName);

  if (roles && roles.length > 0) {
    content = injectRolesFrontmatter(content, roles);
  }

  const fullPath = resolve(repoRoot, '.fleet', 'docs', destPath);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content, 'utf-8');

  // Update manifest.yml
  const manifest = readManifest(repoRoot);
  manifest.docs_cache.files[destPath] = url;
  writeManifest(repoRoot, manifest);

  return { destPath, rawUrl: url, usedGhCli };
}
