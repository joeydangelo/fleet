import { mkdirSync } from 'node:fs';
import { writeFileSync } from 'atomically';
import { resolve, dirname } from 'node:path';

import { fetchWithGhFallback } from './github-fetch.js';
import { readProjectConfig, writeProjectConfig } from './paw-config.js';

export type DocType = 'shortcut' | 'guideline' | 'template';

export interface AddDocResult {
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

/** Map doc type to its subdirectory name. */
export function getDocTypeSubdir(docType: DocType): string {
  switch (docType) {
    case 'guideline':
      return 'guidelines';
    case 'shortcut':
      return 'shortcuts';
    case 'template':
      return 'templates';
  }
}

/** Fetch a doc from a URL and save it to .paw/docs/{category}/. */
export async function addDoc(
  repoRoot: string,
  options: { url: string; name: string; docType: DocType },
): Promise<AddDocResult> {
  const { url, name, docType } = options;

  const cleanName = name.endsWith('.md') ? name.slice(0, -3) : name;
  const filename = `${cleanName}.md`;
  const subdir = getDocTypeSubdir(docType);
  const destPath = `${subdir}/${filename}`;

  const { content, usedGhCli } = await fetchWithGhFallback(url);

  validateDocContent(content, cleanName);

  const fullPath = resolve(repoRoot, '.paw', 'docs', destPath);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content, 'utf-8');

  // Update config.yml
  const config = readProjectConfig(repoRoot);
  config.docs_cache.files[destPath] = url;
  writeProjectConfig(repoRoot, config);

  return { destPath, rawUrl: url, usedGhCli };
}
