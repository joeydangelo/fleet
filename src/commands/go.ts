import { Command } from 'commander';
import { execFileSync } from 'node:child_process';
import pc from 'picocolors';
import { getRepoRoot, getCurrentBranch, git } from '../lib/git.js';
import { loadConfig, resolveConfigPath } from '../lib/config.js';
import { DEFAULT_POLL_INTERVAL } from '../lib/constants.js';
import { isVerbose } from '../lib/context.js';
import { handleError, colors } from '../lib/output.js';
import { ensureTmuxInstalled } from '../lib/tmux.js';
import { runWatchLoop } from './watch.js';

function formatElapsed(ms: number): string {
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds.toFixed(0)}s`;
}

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
  detached?: boolean;
}

export async function runGo(opts: GoOpts): Promise<void> {
  ensureTmuxInstalled();
  const repoRoot = getRepoRoot();
  const configPath = opts.config ?? resolveConfigPath(repoRoot);
  const pollInterval = parseInt(opts.pollInterval, 10);

  if (isNaN(pollInterval) || pollInterval < 1) {
    console.error(colors.error('Poll interval must be a positive integer (seconds).'));
    process.exit(1);
  }

  const config = loadConfig(configPath);
  const verbose = isVerbose();
  const totalStart = Date.now();

  console.log(pc.bold('paw go'));
  console.log(`  target: ${config.target}`);
  console.log(`  tasks:  ${Object.keys(config.tasks).length}\n`);

  // Create worktrees
  console.log(pc.bold('Step 1/4: paw up\n'));
  const configArgs = opts.config ? ['-c', opts.config] : [];
  let phaseStart = Date.now();
  const upResult = runPawCommand(['up', ...configArgs]);
  if (upResult.exitCode !== 0) {
    console.error(colors.error('\npaw up failed. Aborting.'));
    process.exit(upResult.exitCode);
  }
  if (verbose) console.log(colors.info(`⏰ up: ${formatElapsed(Date.now() - phaseStart)}`));

  // Launch agents and wait
  console.log(pc.bold('\nStep 2/4: paw launch\n'));
  phaseStart = Date.now();
  const detachedArgs = opts.detached ? ['--detached'] : [];
  const launchResult = runPawCommand(['launch', ...configArgs, ...detachedArgs]);
  if (launchResult.exitCode !== 0) {
    console.error(colors.error('\npaw launch failed. Aborting.'));
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
  if (verbose)
    console.log(colors.info(`⏰ launch + watch: ${formatElapsed(Date.now() - phaseStart)}`));

  // Merge results
  console.log(pc.bold('Step 3/4: paw merge\n'));
  phaseStart = Date.now();

  // Checkout the target branch -- paw merge requires it
  const currentBranch = getCurrentBranch(repoRoot);
  if (currentBranch !== config.target) {
    console.log(pc.dim(`Switching to target branch: ${config.target}`));
    git(['checkout', config.target], { cwd: repoRoot });
  }

  const mergeResult = runPawCommand(['merge', ...configArgs]);
  if (mergeResult.exitCode !== 0) {
    console.log(colors.warn('\nMerge failed. Resolve the issue, then run: paw merge --continue'));
    console.log(colors.warn('Worktrees left intact (skipping paw down).'));
    return;
  }
  if (verbose) console.log(colors.info(`⏰ merge: ${formatElapsed(Date.now() - phaseStart)}`));

  // Tear down
  console.log(pc.bold('\nStep 4/4: paw down\n'));
  phaseStart = Date.now();
  const downResult = runPawCommand(['down', ...configArgs]);
  if (downResult.exitCode !== 0) {
    console.error(colors.error('\npaw down failed.'));
    process.exit(downResult.exitCode);
  }
  if (verbose) console.log(colors.info(`⏰ down: ${formatElapsed(Date.now() - phaseStart)}`));

  if (verbose) console.log(colors.info(`⏰ total: ${formatElapsed(Date.now() - totalStart)}`));
  console.log(colors.success(`\nDone. Work merged to ${config.target}.`));
}

export function goCommand(): Command {
  return new Command('go')
    .description('Run the full workflow: up → launch → watch → merge → down')
    .option('-c, --config <path>', 'Path to .paw/paw.yaml')
    .option(
      '--poll-interval <seconds>',
      'Poll interval in seconds for watching agents',
      DEFAULT_POLL_INTERVAL,
    )
    .option('--detached', 'Force detached mode (background tmux sessions)')
    .action(async (opts: GoOpts) => {
      try {
        await runGo(opts);
      } catch (err) {
        handleError(err);
      }
    });
}
