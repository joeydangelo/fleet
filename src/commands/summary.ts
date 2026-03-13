import { Command } from 'commander';
import { getRepoRoot, getCurrentBranch } from '../lib/git.js';
import {
  readRequiredSyncState,
  readSyncFile,
  writeSyncFile,
  reviewFilePath,
  requireWorktreeTask,
} from '../lib/sync.js';
import { handleError, colors } from '../lib/output.js';
import pc from 'picocolors';

interface SummaryRunOpts {
  show?: boolean;
  append?: boolean;
  content?: string;
}

/** Core logic for the summary command — testable without Commander. */
export function runSummary(opts: SummaryRunOpts): number {
  const repoRoot = getRepoRoot();

  if (opts.show && opts.append) {
    console.error(colors.error('Cannot use --show and --append together.'));
    return 1;
  }

  const taskName = requireWorktreeTask(repoRoot);

  readRequiredSyncState(repoRoot);

  const taskBranch = getCurrentBranch(repoRoot);
  const reviewPath = reviewFilePath(taskBranch);

  if (opts.show) {
    const content = readSyncFile(reviewPath, repoRoot);
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
    const existing = readSyncFile(reviewPath, repoRoot) ?? '';
    writeSyncFile(reviewPath, existing + content, repoRoot);
    console.log(colors.success(`  ${taskName} -- summary updated`));
  } else {
    writeSyncFile(reviewPath, content, repoRoot);
    console.log(colors.success(`  ${taskName} -- summary written`));
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

/** CLI command: write, read, or append task summary. */
export function summaryCommand(): Command {
  return new Command('summary')
    .description('Write, read, or append task summary')
    .option('--show', 'Read and print the current summary')
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
