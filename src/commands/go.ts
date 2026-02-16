import { Command } from 'commander';
import { execFileSync } from 'node:child_process';
import pc from 'picocolors';
import { getRepoRoot, getCurrentBranch, git } from '../lib/git.js';
import { loadConfig, resolveConfigPath } from '../lib/config.js';
import { handleError } from '../lib/output.js';
import { runWatchLoop } from './watch.js';

/** Shell out to a paw subcommand. Returns the exit code. */
export function runPawCommand(args: string[]): { exitCode: number } {
  try {
    execFileSync(process.execPath, [process.argv[1]!, ...args], {
      stdio: 'inherit',
    });
    return { exitCode: 0 };
  } catch (err: unknown) {
    const code =
      err && typeof err === 'object' && 'status' in err ? (err.status as number | null) : null;
    return { exitCode: code ?? 1 };
  }
}

export interface GoOpts {
  config?: string;
  pollInterval: string;
}

export async function runGo(opts: GoOpts): Promise<void> {
  const repoRoot = getRepoRoot();
  const configPath = opts.config ?? resolveConfigPath(repoRoot);
  const pollInterval = parseInt(opts.pollInterval, 10);

  if (isNaN(pollInterval) || pollInterval < 1) {
    console.error(pc.red('Poll interval must be a positive integer (seconds).'));
    process.exit(1);
  }

  const config = loadConfig(configPath);
  console.log(pc.bold('paw go'));
  console.log(`  target: ${config.target}`);
  console.log(`  tasks:  ${Object.keys(config.tasks).length}\n`);

  // Step 1: paw up
  console.log(pc.bold('Step 1/4: paw up\n'));
  const configArgs = opts.config ? ['-c', opts.config] : [];
  const upResult = runPawCommand(['up', ...configArgs]);
  if (upResult.exitCode !== 0) {
    console.error(pc.red('\npaw up failed. Aborting.'));
    process.exit(upResult.exitCode);
  }

  // Step 2: paw launch (+ watch)
  console.log(pc.bold('\nStep 2/4: paw launch\n'));
  const launchResult = runPawCommand(['launch', ...configArgs]);
  if (launchResult.exitCode !== 0) {
    console.error(pc.red('\npaw launch failed. Aborting.'));
    process.exit(launchResult.exitCode);
  }

  // Wait for agents using the shared watch loop
  console.log();
  await runWatchLoop({
    repoRoot,
    configPath,
    interval: pollInterval,
    noExit: false,
    header: pc.dim(
      `Watching ${Object.keys(config.tasks).length} task(s), polling every ${pollInterval}s...`,
    ),
    onAbort: () => {
      console.log(pc.dim('\nAborted.'));
      process.exit(130);
    },
  });

  // Step 3: paw merge
  console.log(pc.bold('Step 3/4: paw merge\n'));

  // Checkout the target branch -- paw merge requires it
  const currentBranch = getCurrentBranch(repoRoot);
  if (currentBranch !== config.target) {
    console.log(pc.dim(`Switching to target branch: ${config.target}`));
    git(['checkout', config.target], { cwd: repoRoot });
  }

  const mergeResult = runPawCommand(['merge', ...configArgs]);
  if (mergeResult.exitCode !== 0) {
    console.log(
      pc.yellow('\nMerge conflict detected. Resolve manually, then run: paw merge --continue'),
    );
    console.log(pc.yellow('Worktrees left intact (skipping paw down).'));
    return;
  }

  // Step 4: paw down
  console.log(pc.bold('\nStep 4/4: paw down\n'));
  const downResult = runPawCommand(['down', ...configArgs]);
  if (downResult.exitCode !== 0) {
    console.error(pc.red('\npaw down failed.'));
    process.exit(downResult.exitCode);
  }

  console.log(pc.green(`\nDone. Work merged to ${config.target}.`));
}

export function goCommand(): Command {
  return new Command('go')
    .description('Run the full workflow: up → launch → watch → merge → down')
    .option('-c, --config <path>', 'Path to .paw/paw.yaml')
    .option('--poll-interval <seconds>', 'Poll interval in seconds for watching agents', '5')
    .action(async (opts: GoOpts) => {
      try {
        await runGo(opts);
      } catch (err) {
        handleError(err);
      }
    });
}
