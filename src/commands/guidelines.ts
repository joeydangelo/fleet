import { Command } from 'commander';
import pc from 'picocolors';
import { readDoc, listDocs } from '../lib/docs.js';
import { handleError } from '../lib/output.js';

export function guidelinesCommand(): Command {
  return new Command('guidelines')
    .description('Display a coding guideline')
    .argument('[name]', 'Guideline name')
    .option('-l, --list', 'List available guidelines')
    .action((name: string | undefined, opts: { list?: boolean }) => {
      try {
        if (opts.list || !name) {
          const docs = listDocs('guidelines');
          if (docs.length === 0) {
            console.log(pc.yellow('No guidelines found.'));
            return;
          }
          console.log(pc.bold('Available guidelines:\n'));
          const maxName = Math.max(...docs.map((d) => d.name.length));
          for (const doc of docs) {
            console.log(`  ${pc.cyan(doc.name.padEnd(maxName))}  ${pc.dim(doc.description)}`);
          }
          return;
        }

        const doc = readDoc('guidelines', name);
        if (!doc) {
          console.error(pc.red(`Guideline not found: ${name}`));
          console.error(pc.dim('Run `paw guidelines --list` to see available guidelines.'));
          process.exit(1);
        }
        console.log(doc.content);
      } catch (err) {
        handleError(err);
      }
    });
}
