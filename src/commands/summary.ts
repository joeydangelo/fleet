import { Command } from 'commander';
import { getRepoRoot, getCurrentBranch } from '../lib/git.js';
import { detectTaskName } from '../lib/session.js';
import { readSyncState, readSyncFile, writeSyncFile } from '../lib/sync.js';
import { requireSyncState, handleError, colors } from '../lib/output.js';
import pc from 'picocolors';

interface SummaryRunOpts {
  show?: boolean;
  append?: boolean;
  content?: string;
}

/** Core logic for the summary command — testable without Commander. */
export function runSummary(opts: SummaryRunOpts): number {
  const repoRoot = getRepoRoot();
  const taskName = detectTaskName(repoRoot);

  if (!taskName) {
    console.error(colors.error('Could not detect task name. Are you in a paw worktree?'));
    return 1;
  }

  const state = readSyncState(repoRoot);
  requireSyncState(state);

  const taskBranch = getCurrentBranch(repoRoot);
  const safeBranch = taskBranch.replace(/[^a-zA-Z0-9-]/g, '-');
  const reviewFilePath = `review/${safeBranch}.md`;

  if (opts.show) {
    const content = readSyncFile(reviewFilePath, repoRoot);
    if (content) {
      console.log(content);
    } else {
      console.log(pc.dim(`No summary found for ${taskName} yet.`));
    }
    return 0;
  }

  const content = opts.content ?? '';
  if (!content.trim()) {
    console.error(colors.error('No content provided. Pipe content via stdin or heredoc.'));
    return 1;
  }

  if (opts.append) {
    const existing = readSyncFile(reviewFilePath, repoRoot) ?? '';
    writeSyncFile(reviewFilePath, existing + content, repoRoot);
    console.log(colors.success(`  ${taskName} -- summary updated on sync branch`));
  } else {
    writeSyncFile(reviewFilePath, content, repoRoot);
    console.log(colors.success(`  ${taskName} -- summary written to sync branch`));
  }

  return 0;
}

/** Read all of stdin as a string (returns empty string if stdin is a TTY with no pipe). */
async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return '';
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

/** CLI command: write, read, or append task summary on the sync branch. */
export function summaryCommand(): Command {
  return new Command('summary')
    .description('Write, read, or append task summary on the sync branch')
    .option('--show', 'Read and print the current summary from the sync branch')
    .option('--append', 'Append stdin content to the existing summary')
    .action(async (opts: { show?: boolean; append?: boolean }) => {
      try {
        const content = opts.show ? undefined : await readStdin();
        const exitCode = runSummary({ ...opts, content });
        if (exitCode !== 0) process.exit(exitCode);
      } catch (err) {
        handleError(err);
      }
    });
}
