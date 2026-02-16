import { Command } from 'commander';
import { execSync } from 'node:child_process';
import pc from 'picocolors';
import { getRepoRoot } from '../lib/git.js';
import { loadConfig, resolveConfigPath } from '../lib/config.js';
import { detectTaskName } from '../lib/session.js';
import { readSyncState, completeTask, writeSyncStateAndFiles } from '../lib/sync.js';
import { handleError } from '../lib/output.js';
import { validateSummary, generateErrorTemplate } from '../lib/summary.js';

export function doneCommand(): Command {
  return new Command('done')
    .description('Mark current task as done')
    .option('--summary <text>', 'Completion summary (what you did, interface changes, warnings)')
    .option('--force', 'Bypass summary validation')
    .action((opts: { summary?: string; force?: boolean }) => {
      try {
        const repoRoot = getRepoRoot();
        const taskName = detectTaskName(repoRoot);

        if (!taskName) {
          console.error(pc.red('Could not detect task name. Are you in a paw worktree?'));
          console.error(
            pc.dim('Expected a single .md file in .paw/tasks/. Run `paw up` to create worktrees.'),
          );
          process.exit(1);
        }

        const state = readSyncState(repoRoot);
        if (!state) {
          console.error(pc.red('No sync state found. Run `paw up` first.'));
          process.exit(1);
        }

        if (!state.tasks[taskName]) {
          console.error(pc.red(`Task '${taskName}' not found in sync state.`));
          process.exit(1);
        }

        if (!opts.summary) {
          console.error(pc.red('Missing --summary flag. A structured summary is required.'));
          console.error('');
          console.error(pc.bold('Expected format:'));
          console.error(pc.dim(generateErrorTemplate()));
          console.error('');
          console.error(pc.dim('Run `paw template task-summary` for full details.'));
          process.exit(1);
        }

        const validation = validateSummary(opts.summary);
        if (!validation.valid && !opts.force) {
          console.error(
            pc.yellow(`Summary is missing required sections: ${validation.missing.join(', ')}`),
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

        // Run pre-done hook if configured
        if (!opts.force) {
          try {
            const configPath = resolveConfigPath(repoRoot);
            const config = loadConfig(configPath);
            const preDoneHook = config.hooks?.['pre-done'];
            if (preDoneHook) {
              console.log(pc.dim(`Running pre-done hook: ${preDoneHook}`));
              try {
                execSync(preDoneHook, { cwd: repoRoot, stdio: 'inherit' });
              } catch {
                console.error(pc.red('Pre-done hook failed. Fix the issue and try again.'));
                console.error(pc.dim('Use --force to bypass the pre-done hook.'));
                process.exit(1);
              }
            }
          } catch {
            // No config found -- skip hook (worktree may not have paw.yaml)
          }
        }

        const updated = completeTask(state, taskName);
        const summaryPath = `summaries/${taskName}.md`;
        writeSyncStateAndFiles(updated, [{ path: summaryPath, content: opts.summary }], repoRoot);
        console.log(pc.green(`+ ${taskName} -- marked as done`));
        console.log(pc.dim(`  Summary written to ${summaryPath} on sync branch`));
      } catch (err) {
        handleError(err);
      }
    });
}
