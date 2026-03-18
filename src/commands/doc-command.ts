import { Command } from 'commander';
import pc from 'picocolors';
import { readDoc, listDocs } from '../lib/docs.js';
import { ensureDocsFresh } from '../lib/doc-sync.js';
import { handleError, colors, success, toErrorMessage } from '../lib/output.js';
import { addDoc } from '../lib/doc-add.js';
import type { DocType } from '../lib/doc-add.js';
import { getRepoRoot } from '../lib/git.js';
import { emitEvent } from '../lib/feed.js';

/** Derive a doc name from a URL's last path segment. */
function deriveNameFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const basename = pathname.split('/').pop() || 'unnamed';
    return basename.replace(/\.md$/, '');
  } catch {
    return 'unnamed';
  }
}

/** Map category directory name to DocType. */
function categoryToDocType(category: string): DocType {
  return category.replace(/s$/, '') as DocType;
}

/** Builds a Commander CLI subcommand that fetches and displays a tbd doc file by name within a given category. */
export function createDocCommand(
  name: string,
  category: string,
  description: string,
  eventName?: string,
): Command {
  return new Command(name)
    .description(description)
    .argument('[name]', `${name} name`)
    .option('-l, --list', `List available ${category}`)
    .option('--add <url>', 'Add a custom doc from a URL')
    .option('--name <name>', 'Name for the added doc (default: derived from URL)')
    .option('--roles <roles>', 'Comma-separated roles for the added doc (e.g. builder,reviewer)')
    .action(
      async (
        docName: string | undefined,
        opts: { list?: boolean; add?: string; name?: string; roles?: string },
      ) => {
        try {
          try {
            await ensureDocsFresh(getRepoRoot());
          } catch (err: unknown) {
            // Expected: not in a git repo, or docs not configured yet.
            // Unexpected errors (network, permissions) are logged so operators
            // can diagnose sync failures.
            const code = (err as NodeJS.ErrnoException)?.code;
            const isExpected =
              code === 'ENOENT' ||
              code === 'ERR_INVALID_ARG_TYPE' ||
              (err instanceof Error && err.message.includes('not a git repository'));
            if (!isExpected) {
              console.warn(`Doc sync skipped: ${toErrorMessage(err)}`);
            }
          }

          if (opts.add) {
            const docNameForAdd = opts.name || deriveNameFromUrl(opts.add);
            const repoRoot = getRepoRoot();

            console.log(`Adding ${name}: ${docNameForAdd}`);
            console.log(`  URL: ${opts.add}`);

            const roles = opts.roles
              ? opts.roles
                  .split(',')
                  .map((r) => r.trim())
                  .filter(Boolean)
              : undefined;

            const result = await addDoc(repoRoot, {
              url: opts.add,
              name: docNameForAdd,
              docType: categoryToDocType(category),
              roles,
            });

            if (result.usedGhCli) {
              console.log(pc.dim('  (fetched via gh CLI due to direct access restriction)'));
            }

            success(name, `.fleet/docs/${result.destPath}`);
            console.log(pc.dim(`Run \`fleet ${name} --list\` to verify.`));
            return;
          }

          if (opts.list || !docName) {
            const docs = listDocs(category);
            if (docs.length === 0) {
              console.log(colors.warn(`No ${category} found.`));
              return;
            }
            console.log(pc.bold(`Available ${category}:\n`));
            const maxName = Math.max(...docs.map((d) => d.name.length));
            for (const doc of docs) {
              console.log(`  ${colors.info(doc.name.padEnd(maxName))}  ${pc.dim(doc.description)}`);
            }
            return;
          }

          const doc = readDoc(category, docName);
          if (!doc) {
            const label = name.charAt(0).toUpperCase() + name.slice(1);
            console.error(colors.error(`${label} not found: ${docName}`));
            console.error(pc.dim(`Run \`fleet ${name} --list\` to see available ${category}.`));
            process.exit(1);
          }
          if (eventName) emitEvent({ event: eventName, name: docName });
          console.log(doc.content);
        } catch (err) {
          handleError(err);
        }
      },
    );
}
