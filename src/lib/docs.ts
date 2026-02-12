import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

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

export interface DocInfo {
  name: string;
  title: string;
  description: string;
}

/**
 * Read a doc file by category and name. Returns the file content or null.
 */
export function readDoc(category: string, name: string): { content: string; path: string } | null {
  const base = getDocsBasePath();
  const filename = name.endsWith('.md') ? name : `${name}.md`;
  const filepath = join(base, category, filename);
  if (!existsSync(filepath)) return null;
  return { content: readFileSync(filepath, 'utf-8'), path: filepath };
}

/**
 * List all docs in a category, parsing title and description from frontmatter.
 */
export function listDocs(category: string): DocInfo[] {
  const base = getDocsBasePath();
  const dir = join(base, category);
  if (!existsSync(dir)) return [];

  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const content = readFileSync(join(dir, f), 'utf-8');
      const name = f.replace(/\.md$/, '');
      const { title, description } = parseFrontmatter(content);
      return { name, title: title || name, description: description || '' };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function parseFrontmatter(content: string): {
  title?: string;
  description?: string;
} {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const block = match[1]!;
  const title = block.match(/^title:\s*(.+)$/m)?.[1]?.trim();
  const description = block.match(/^description:\s*(.+)$/m)?.[1]?.trim();
  return { title, description };
}
