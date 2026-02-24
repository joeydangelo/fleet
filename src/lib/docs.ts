import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { getRepoRoot } from './git.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Resolve the docs base directory. Checks bundled (dist/docs/) first,
 * falls back to dev (src/docs/) for local development.
 */
export function getDocsBasePath(): string {
  const candidates = [
    join(__dirname, 'docs'), // Bundled: dist/docs/
    join(__dirname, '..', 'src', 'docs'), // Dev from dist: ../src/docs/
    join(__dirname, '..', 'docs'), // Dev from src/lib: ../docs/ = src/docs/
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  throw new Error('paw docs not found');
}

/** Resolve .paw/custom/ path for user-added docs. Returns null if unavailable. */
function getCustomDocsPath(): string | null {
  try {
    const root = process.env.PAW_REPO_ROOT || getRepoRoot();
    const customPath = join(root, '.paw', 'custom');
    return existsSync(customPath) ? customPath : null;
  } catch {
    return null;
  }
}

interface DocInfo {
  name: string;
  title: string;
  description: string;
}

/**
 * Read a doc file by category and name. Checks custom docs first, then bundled.
 */
export function readDoc(category: string, name: string): { content: string; path: string } | null {
  const filename = name.endsWith('.md') ? name : `${name}.md`;

  // Custom docs shadow bundled docs
  const customPath = getCustomDocsPath();
  if (customPath) {
    const filepath = join(customPath, category, filename);
    if (existsSync(filepath)) {
      return { content: readFileSync(filepath, 'utf-8'), path: filepath };
    }
  }

  const base = getDocsBasePath();
  const filepath = join(base, category, filename);
  if (!existsSync(filepath)) return null;
  return { content: readFileSync(filepath, 'utf-8'), path: filepath };
}

/** Read .md files from a directory into DocInfo entries. */
function readDocsFromDir(dir: string): DocInfo[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const content = readFileSync(join(dir, f), 'utf-8');
      const name = f.replace(/\.md$/, '');
      const { title, description } = parseFrontmatter(content);
      return { name, title: title || name, description: description || '' };
    });
}

/**
 * List all docs in a category. Custom docs appear first and shadow bundled docs of the same name.
 */
export function listDocs(category: string): DocInfo[] {
  const seen = new Set<string>();
  const results: DocInfo[] = [];

  // Custom docs first (shadow bundled)
  const customPath = getCustomDocsPath();
  if (customPath) {
    for (const doc of readDocsFromDir(join(customPath, category))) {
      seen.add(doc.name);
      results.push(doc);
    }
  }

  // Bundled docs (skip if shadowed)
  const base = getDocsBasePath();
  for (const doc of readDocsFromDir(join(base, category))) {
    if (!seen.has(doc.name)) {
      results.push(doc);
    }
  }

  return results.sort((a, b) => a.name.localeCompare(b.name));
}

/** Strip YAML frontmatter (--- block ---) from markdown content. */
export function stripFrontmatter(content: string): string {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
}

/** Extract title and description from a YAML frontmatter block (--- delimited). */
export function parseFrontmatter(content: string): {
  title?: string;
  description?: string;
} {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  try {
    const data = parseYaml(match[1]!) as Record<string, unknown>;
    return {
      title: typeof data.title === 'string' ? data.title : undefined,
      description: typeof data.description === 'string' ? data.description : undefined,
    };
  } catch {
    return {};
  }
}
