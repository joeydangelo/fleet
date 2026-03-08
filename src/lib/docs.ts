import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { getRepoRoot } from './git.js';
import { readManifest } from './manifest.js';

/** Return the repo root or null when called outside a git repo. */
function getRepoRootSafe(): string | null {
  try {
    return process.env.PAW_REPO_ROOT || getRepoRoot();
  } catch {
    return null;
  }
}

/** Metadata extracted from a doc file's YAML frontmatter. */
export interface DocInfo {
  name: string;
  title: string;
  description: string;
  roles?: string[];
}

/**
 * Get lookup paths for a category, filtered from config.docs_cache.lookup_path.
 * Paths ending with `/{category}` match. Falls back to `.paw/docs/{category}/`.
 */
function getLookupPaths(repoRoot: string, category: string): string[] {
  let lookupPath: string[];
  try {
    const manifest = readManifest(repoRoot);
    lookupPath = manifest.docs_cache.lookup_path;
  } catch {
    lookupPath = [];
  }

  if (lookupPath.length === 0) {
    return [join(repoRoot, '.paw', 'docs', category)];
  }

  const matching = lookupPath
    .filter((p) => basename(p) === category)
    .map((p) => {
      if (!p.startsWith('/') && !p.match(/^[a-zA-Z]:/)) {
        return join(repoRoot, p);
      }
      return p;
    });

  if (matching.length === 0) {
    return [join(repoRoot, '.paw', 'docs', category)];
  }

  return matching;
}

/**
 * Read a doc file by category and name.
 * Searches lookup paths in order; first match wins.
 */
export function readDoc(category: string, name: string): { content: string; path: string } | null {
  const filename = name.endsWith('.md') ? name : `${name}.md`;
  const repoRoot = getRepoRootSafe();
  if (!repoRoot) return null;

  for (const dir of getLookupPaths(repoRoot, category)) {
    const filepath = join(dir, filename);
    if (existsSync(filepath)) {
      return { content: readFileSync(filepath, 'utf-8'), path: filepath };
    }
  }
  return null;
}

/** Read .md files from a directory into DocInfo entries. */
function readDocsFromDir(dir: string): DocInfo[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const content = readFileSync(join(dir, f), 'utf-8');
      const name = f.replace(/\.md$/, '');
      const { title, description, roles } = parseFrontmatter(content);
      return { name, title: title || name, description: description || '', roles };
    });
}

/**
 * List all docs in a category across lookup paths.
 * Deduplicates by name — first occurrence wins (shadowing).
 */
export function listDocs(category: string): DocInfo[] {
  const repoRoot = getRepoRootSafe();
  if (!repoRoot) return [];

  const seen = new Set<string>();
  const results: DocInfo[] = [];

  for (const dir of getLookupPaths(repoRoot, category)) {
    for (const doc of readDocsFromDir(dir)) {
      if (!seen.has(doc.name)) {
        seen.add(doc.name);
        results.push(doc);
      }
    }
  }

  return results.sort((a, b) => a.name.localeCompare(b.name));
}

/** Strip YAML frontmatter (--- block ---) from markdown content. */
export function stripFrontmatter(content: string): string {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
}

/** Extract title, description, and roles from a YAML frontmatter block (--- delimited). */
export function parseFrontmatter(content: string): {
  title?: string;
  description?: string;
  roles?: string[];
} {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  try {
    const data = parseYaml(match[1]!) as Record<string, unknown>;
    const roles = Array.isArray(data.roles)
      ? data.roles.filter((r): r is string => typeof r === 'string')
      : undefined;
    return {
      title: typeof data.name === 'string' ? data.name : undefined,
      description: typeof data.description === 'string' ? data.description : undefined,
      roles: roles && roles.length > 0 ? roles : undefined,
    };
  } catch {
    return {};
  }
}
