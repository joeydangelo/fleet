import { Command } from 'commander';
import { existsSync, readFileSync, watch, openSync, readSync, closeSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import pc from 'picocolors';
import type { Formatter } from 'picocolors/types.js';
import { getRepoRoot } from '../lib/git.js';
import { handleError, COLOR_PALETTE } from '../lib/output.js';
import { CLIError } from '../lib/errors.js';
import { FEED_DIR, FEED_FILENAME } from '../lib/feed.js';
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

/** Truncate or pad a string to exactly TASK_COL_WIDTH characters. */
function fitColumn(text: string): string {
  return text.length > TASK_COL_WIDTH ? text.slice(0, TASK_COL_WIDTH) : text.padEnd(TASK_COL_WIDTH);
}

/** Truncate task name for display — reviewer sessions show as `task:rev`. */
function formatTaskName(task: string): string {
  if (task.endsWith(':reviewer')) {
    return fitColumn(task.slice(0, -':reviewer'.length) + ':rev');
  }
  return fitColumn(task);
}

/**
 * Dispatch table mapping event names to detail formatters.
 * Each formatter receives the parsed event record and returns a display string.
 */
type DetailFormatter = (p: Record<string, unknown>) => string;

function fileDetail(p: Record<string, unknown>): string {
  const file = str(p.file);
  const lines = p.lines != null ? ' (+' + str(p.lines) + ' lines)' : '';
  return file + lines;
}

function patternHitsDetail(p: Record<string, unknown>): string {
  return str(p.pattern) + ' (' + str(p.hits, '0') + ' hits)';
}

function targetedMsgDetail(p: Record<string, unknown>): string {
  return str(p.to) + ': ' + str(p.msg);
}

function sessionStartDetail(p: Record<string, unknown>): string {
  return 'target: ' + str(p.target, '?') + ', tasks: ' + str(p.tasks, '?');
}

const DETAIL_FORMATTERS: Record<string, DetailFormatter> = {
  // Tool events
  'tool.Read': fileDetail,
  'tool.Write': fileDetail,
  'tool.Edit': fileDetail,
  'tool.Glob': patternHitsDetail,
  'tool.Grep': patternHitsDetail,
  'tool.Bash': (p) => str(p.cmd),
  'tool.Agent': (p) => {
    const model = p.model ? ' (' + str(p.model) + ')' : '';
    return str(p.description) + model;
  },
  'tool.Skill': (p) => str(p.skill),

  // Git events
  'git.commit': (p) => str(p.msg),

  // Fleet events
  'fleet.broadcast': (p) => str(p.msg),
  'fleet.send': targetedMsgDetail,
  'fleet.reply': targetedMsgDetail,
  'fleet.nudge': targetedMsgDetail,
  'fleet.review': (p) => 'cycle ' + str(p.cycle, '?'),
  'fleet.summary': (p) => (p.append ? 'appended' : 'written'),
  'fleet.shortcut': (p) => str(p.name),
  'fleet.guideline': (p) => str(p.name),
  'fleet.template': (p) => str(p.name),
  'fleet.up': sessionStartDetail,
  'fleet.launch': (p) => (Array.isArray(p.tasks) ? (p.tasks as string[]).join(', ') : ''),
  'fleet.merge': (p) => {
    const conflicts = p.conflicts ? ' (conflicts)' : ' (clean)';
    return str(p.source, '?') + ' \u2192 ' + str(p.target, '?') + conflicts;
  },
  'fleet.down': (p) => 'archived: ' + str(p.archived, '?'),
  'fleet.triage': (p) => str(p.to || p.task) + ': ' + str(p.verdict, '?'),

  // Review events
  'review.start': (p) => 'cycle ' + str(p.cycle, '?'),
  'review.verdict': (p) => {
    const findings = Number(p.findings ?? 0);
    return (
      str(p.verdict) + ' (' + String(findings) + ' finding' + (findings === 1 ? '' : 's') + ')'
    );
  },
  'review.timeout': (p) => 'elapsed ' + str(p.elapsed, '?') + 's',

  // Session events
  'session.start': sessionStartDetail,
  'session.end': (p) =>
    'completed: ' +
    str(p.tasksCompleted ?? p.tasks_completed, '?') +
    ', failed: ' +
    str(p.tasksFailed ?? p.tasks_failed, '?') +
    ', duration: ' +
    str(p.durationS ?? p.duration_s, '?') +
    's',
};

/** Extract a human-readable detail string from an event's extra fields. */
function formatDetail(parsed: Record<string, unknown>): string {
  const formatter = DETAIL_FORMATTERS[str(parsed.event)];
  return formatter ? formatter(parsed) : '';
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
            throw new CLIError(`No feed found for session "${opts.replay}"\nExpected: ${feedPath}`);
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
          throw new CLIError('No active session. Use --replay <session> to read archived feeds.');
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
