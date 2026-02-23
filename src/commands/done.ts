import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import pc from 'picocolors';
import { getRepoRoot } from '../lib/git.js';
import { detectTaskName } from '../lib/session.js';
import { readSyncState, completeTask, writeSyncStateAndFiles } from '../lib/sync.js';
import { requireSyncState, handleError, colors } from '../lib/output.js';
import { validateSummary, generateErrorTemplate } from '../lib/summary.js';

export function doneCommand(): Command {
  return new Command('done')
    .description('Mark current task as done')
    .option('--summary <text>', 'Completion summary (what you did, interface changes, warnings)')
    .option('--force', 'Bypass summary section validation')
    .action((opts: { summary?: string; force?: boolean }) => {
      try {
        const repoRoot = getRepoRoot();
        const taskName = detectTaskName(repoRoot);

        if (!taskName) {
          console.error(colors.error('Could not detect task name. Are you in a paw worktree?'));
          console.error(
            pc.dim('Expected a single .md file in .paw/tasks/. Run `paw up` to create worktrees.'),
          );
          process.exit(1);
        }

        const state = readSyncState(repoRoot);
        requireSyncState(state);

        if (!state.tasks[taskName]) {
          console.error(colors.error(`Task '${taskName}' not found in sync state.`));
          process.exit(1);
        }

        let summary: string;
        if (opts.summary) {
          summary = opts.summary;
        } else if (!process.stdin.isTTY) {
          summary = readFileSync(0, 'utf-8').trim();
        } else {
          console.error(colors.error('No summary provided. Pass via --summary or heredoc:'));
          console.error('');
          console.error("  paw done << 'EOF'");
          console.error('  ## What I did');
          console.error('  - What you built');
          console.error('');
          console.error('  ## Interface changes');
          console.error('  - Types, exports, API changes');
          console.error('');
          console.error('  ## Watch out');
          console.error('  - Non-obvious things');
          console.error('  EOF');
          console.error('');
          console.error(pc.dim('Run `paw template task-summary` for full details.'));
          process.exit(1);
        }

        const validation = validateSummary(summary);
        if (!validation.valid && !opts.force) {
          console.error(
            colors.warn(`Summary is missing required sections: ${validation.missing.join(', ')}`),
          );
          console.error('');
          console.error(pc.bold('Expected format:'));
          console.error(pc.dim(generateErrorTemplate()));
          console.error('');
          console.error(
            pc.dim('Run `paw template task-summary` for full details, or use --force to bypass.'),
          );
          process.exit(1);
        }

        const updated = completeTask(state, taskName);
        const summaryPath = `summaries/${taskName}.md`;
        writeSyncStateAndFiles(updated, [{ path: summaryPath, content: summary }], repoRoot);
        console.log(colors.success(`+ ${taskName} -- marked as done`));
        console.log(pc.dim(`  Summary written to ${summaryPath} on sync branch`));
      } catch (err) {
        handleError(err);
      }
    });
}
