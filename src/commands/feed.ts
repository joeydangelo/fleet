import { Command } from 'commander';
import { existsSync, readFileSync, watch, openSync, readSync, closeSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import pc from 'picocolors';
import type { Formatter } from 'picocolors/types.js';
import { getRepoRoot } from '../lib/git.js';
import { handleError } from '../lib/output.js';
import { FEED_DIR, FEED_FILENAME } from '../lib/feed.js';

const COLOR_PALETTE: Formatter[] = [pc.blue, pc.green, pc.yellow, pc.magenta, pc.cyan, pc.red];
const TASK_COL_WIDTH = 12;

/** Safely convert an unknown value to string. */
function str(val: unknown, fallback = ''): string {
  if (val == null) return fallback;
  if (typeof val === 'string') return val;
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  return JSON.stringify(val);
}

/** Assign a stable color to a task name based on insertion order. */
function getTaskColor(taskName: string, taskColors: Map<string, Formatter>): Formatter {
  let color = taskColors.get(taskName);
  if (!color) {
    color = COLOR_PALETTE[taskColors.size % COLOR_PALETTE.length]!;
    taskColors.set(taskName, color);
  }
  return color;
}

/** Truncate task name for display — reviewer sessions show as `task:rev`. */
function formatTaskName(task: string): string {
  if (task.endsWith(':reviewer')) {
    const base = task.slice(0, -':reviewer'.length);
    const short = base + ':rev';
    return short.length > TASK_COL_WIDTH
      ? short.slice(0, TASK_COL_WIDTH)
      : short.padEnd(TASK_COL_WIDTH);
  }
  return task.length > TASK_COL_WIDTH ? task.slice(0, TASK_COL_WIDTH) : task.padEnd(TASK_COL_WIDTH);
}

/** Extract a human-readable detail string from an event's extra fields. */
function formatDetail(parsed: Record<string, unknown>): string {
  const event = str(parsed.event);

  // Tool events
  if (event === 'tool.Read' || event === 'tool.Write' || event === 'tool.Edit') {
    const file = str(parsed.file);
    const lines = parsed.lines != null ? ' (+' + str(parsed.lines) + ' lines)' : '';
    return file + lines;
  }
  if (event === 'tool.Glob' || event === 'tool.Grep') {
    return str(parsed.pattern) + ' (' + str(parsed.hits, '0') + ' hits)';
  }
  if (event === 'tool.Bash') return str(parsed.cmd);
  if (event === 'tool.Agent') {
    const desc = str(parsed.description);
    const model = parsed.model ? ' (' + str(parsed.model) + ')' : '';
    return desc + model;
  }
  if (event === 'tool.Skill') return str(parsed.skill);

  // Git events
  if (event === 'git.commit') return str(parsed.msg);

  // Fleet events
  if (event === 'fleet.broadcast') return str(parsed.msg);
  if (event === 'fleet.send' || event === 'fleet.reply' || event === 'fleet.nudge') {
    return str(parsed.to) + ': ' + str(parsed.msg);
  }
  if (event === 'fleet.review') return 'cycle ' + str(parsed.cycle, '?');
  if (event === 'fleet.summary') return parsed.append ? 'appended' : 'written';
  if (event === 'fleet.shortcut' || event === 'fleet.guideline' || event === 'fleet.template') {
    return str(parsed.name);
  }
  if (event === 'fleet.up' || event === 'session.start') {
    return 'target: ' + str(parsed.target, '?') + ', tasks: ' + str(parsed.tasks, '?');
  }
  if (event === 'fleet.launch') {
    const tasks = parsed.tasks;
    return Array.isArray(tasks) ? (tasks as string[]).join(', ') : '';
  }
  if (event === 'fleet.merge') {
    const conflicts = parsed.conflicts ? ' (conflicts)' : ' (clean)';
    return str(parsed.source, '?') + ' → ' + str(parsed.target, '?') + conflicts;
  }
  if (event === 'fleet.down') return 'archived: ' + str(parsed.archived, '?');
  if (event === 'fleet.triage') {
    return str(parsed.to || parsed.task) + ': ' + str(parsed.verdict, '?');
  }

  // Review events
  if (event === 'review.start') return 'cycle ' + str(parsed.cycle, '?');
  if (event === 'review.verdict') {
    const verdict = str(parsed.verdict);
    const findings = Number(parsed.findings ?? 0);
    return verdict + ' (' + String(findings) + ' finding' + (findings === 1 ? '' : 's') + ')';
  }
  if (event === 'review.timeout') return 'elapsed ' + str(parsed.elapsed, '?') + 's';

  // Session end
  if (event === 'session.end') {
    return (
      'completed: ' +
      str(parsed.tasks_completed, '?') +
      ', failed: ' +
      str(parsed.tasks_failed, '?') +
      ', duration: ' +
      str(parsed.duration_s, '?') +
      's'
    );
  }

  return '';
}

/** Color the verdict text in review events. */
function colorVerdict(detail: string, event: string): string {
  if (event !== 'review.verdict') return detail;
  if (detail.startsWith('PASS')) return pc.green(detail);
  if (detail.startsWith('FAIL')) return pc.red(detail);
  return detail;
}

/** Format and print one parsed event line. */
function printEvent(parsed: Record<string, unknown>, taskColors: Map<string, Formatter>): void {
  const ts = str(parsed.ts, '??:??:??');
  const task = str(parsed.task, '?');
  const event = str(parsed.event, '?');
  const detail = formatDetail(parsed);
  const coloredDetail = colorVerdict(detail, event);

  const colorFn = getTaskColor(task, taskColors);
  const taskDisplay = formatTaskName(task);

  const parts = [pc.dim(ts), '  ', colorFn(taskDisplay), '  ', pc.dim(event)];
  if (coloredDetail) parts.push('  ', coloredDetail);

  console.log(parts.join(''));
}

/** Process a chunk of NDJSON text — print each line, applying filters. */
function processChunk(
  text: string,
  opts: { taskFilter?: string; eventFilter?: string; json?: boolean },
  taskColors: Map<string, Formatter>,
): void {
  const lines = text.split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;

    if (opts.json) {
      // Raw passthrough — still apply filters
      try {
        const parsed = JSON.parse(line) as Record<string, unknown>;
        if (opts.taskFilter && parsed.task !== opts.taskFilter) continue;
        if (opts.eventFilter && !str(parsed.event).startsWith(opts.eventFilter)) continue;
      } catch {
        // Not valid JSON — output anyway in json mode
      }
      console.log(line);
      continue;
    }

    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      if (opts.taskFilter && parsed.task !== opts.taskFilter) continue;
      if (opts.eventFilter && !str(parsed.event).startsWith(opts.eventFilter)) continue;
      printEvent(parsed, taskColors);
    } catch {
      console.log(pc.dim('  [malformed line skipped]'));
    }
  }
}

/** Tail a feed file from a given byte offset, printing new content. Returns new offset. */
function tailFrom(
  filePath: string,
  offset: number,
  opts: { taskFilter?: string; eventFilter?: string; json?: boolean },
  taskColors: Map<string, Formatter>,
): number {
  let size: number;
  try {
    size = statSync(filePath).size;
  } catch {
    return offset;
  }

  if (size <= offset) return offset;

  const fd = openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(size - offset);
    readSync(fd, buf, 0, buf.length, offset);
    processChunk(buf.toString('utf-8'), opts, taskColors);
    return size;
  } finally {
    closeSync(fd);
  }
}

/** Build the `fleet feed` CLI command. */
export function feedCommand(): Command {
  return new Command('feed')
    .description('Live-tail the NDJSON event feed')
    .option('--task <name>', 'Filter events by task name')
    .option('--event <pattern>', 'Filter events by event prefix')
    .option('--json', 'Output raw NDJSON (for piping to jq)')
    .option('--replay <session>', 'Read from archived session instead of live feed')
    .action(async (opts: { task?: string; event?: string; json?: boolean; replay?: string }) => {
      try {
        const repoRoot = getRepoRoot();
        const taskColors = new Map<string, Formatter>();

        if (opts.replay) {
          // Replay archived session
          const feedPath = resolve(repoRoot, '.fleet', 'sessions', opts.replay, FEED_FILENAME);
          if (!existsSync(feedPath)) {
            console.error(pc.red('No feed found for session "' + opts.replay + '"'));
            console.error(pc.dim('Expected: ' + feedPath));
            process.exit(1);
          }
          const content = readFileSync(feedPath, 'utf-8');
          processChunk(
            content,
            { taskFilter: opts.task, eventFilter: opts.event, json: opts.json },
            taskColors,
          );
          return;
        }

        // Live tail
        const feedPath = resolve(repoRoot, FEED_DIR, FEED_FILENAME);
        const sessionReady = resolve(repoRoot, FEED_DIR, '.session-ready');

        if (!existsSync(sessionReady) && !existsSync(feedPath)) {
          console.error(
            pc.red('No active session. Use --replay <session> to read archived feeds.'),
          );
          process.exit(1);
        }

        const filterOpts = { taskFilter: opts.task, eventFilter: opts.event, json: opts.json };

        // Print existing content first
        let offset = 0;
        if (existsSync(feedPath)) {
          offset = tailFrom(feedPath, 0, filterOpts, taskColors);
        }

        // Watch for changes
        const watchDir = resolve(repoRoot, FEED_DIR);
        const watcher = watch(watchDir, (_eventType, filename) => {
          if (filename === FEED_FILENAME) {
            offset = tailFrom(feedPath, offset, filterOpts, taskColors);
          }
        });

        // Clean exit on signals
        const cleanup = () => {
          watcher.close();
          process.exit(0);
        };
        process.on('SIGINT', cleanup);
        process.on('SIGTERM', cleanup);

        // Keep alive
        await new Promise(() => {});
      } catch (err) {
        handleError(err);
      }
    });
}
