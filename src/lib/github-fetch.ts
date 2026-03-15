import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const GITHUB_BLOB_RE = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/;
const RAW_GITHUB_RE = /^https?:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/;
const DEFAULT_FETCH_TIMEOUT = 30000;

/** Convert a GitHub blob URL to a raw.githubusercontent.com URL. Non-blob URLs pass through. */
export function githubBlobToRawUrl(url: string): string {
  const match = GITHUB_BLOB_RE.exec(url);
  if (!match) return url;
  const [, owner, repo, ref, path] = match;
  return `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${path}`;
}

/** Fetch content from a URL via direct HTTP. */
export async function directFetch(url: string, timeout = DEFAULT_FETCH_TIMEOUT): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'get-fleet/1.0',
        Accept: 'text/plain, text/markdown, */*',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch content from a GitHub raw URL using gh api. */
async function ghCliFetch(rawUrl: string): Promise<string> {
  const match = RAW_GITHUB_RE.exec(rawUrl);
  if (match) {
    const [, owner, repo, ref, path] = match;
    const { stdout } = await execFileAsync('gh', [
      'api',
      `/repos/${owner}/${repo}/contents/${path}?ref=${ref}`,
      '--jq',
      '.content',
      '-H',
      'Accept: application/vnd.github.v3+json',
    ]);
    return Buffer.from(stdout.trim(), 'base64').toString('utf-8');
  }

  const { stdout } = await execFileAsync('gh', ['api', rawUrl]);
  return stdout;
}

/** Fetch content from a URL, falling back to gh CLI on 403. Auto-converts blob URLs to raw. */
export async function fetchWithGhFallback(
  url: string,
): Promise<{ content: string; usedGhCli: boolean }> {
  const rawUrl = githubBlobToRawUrl(url);

  try {
    const content = await directFetch(rawUrl);
    return { content, usedGhCli: false };
  } catch (error) {
    if (!(error instanceof Error && error.message.includes('HTTP 403'))) {
      throw error;
    }
  }

  const content = await ghCliFetch(rawUrl);
  return { content, usedGhCli: true };
}
