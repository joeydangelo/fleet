import { Command } from 'commander';
import pc from 'picocolors';
import { readDoc, listDocs } from '../lib/docs.js';
import { handleError } from '../lib/output.js';

/**
 * Factory for list/display commands that serve a single doc category.
 * Used by guidelines, shortcut, and template commands.
 */
export function createDocCommand(name: string, category: string, description: string): Command {
  return new Command(name)
    .description(description)
    .argument('[name]', `${name} name`)
    .option('-l, --list', `List available ${category}`)
    .action((docName: string | undefined, opts: { list?: boolean }) => {
      try {
        if (opts.list || !docName) {
          const docs = listDocs(category);
          if (docs.length === 0) {
            console.log(pc.yellow(`No ${category} found.`));
            return;
          }
          console.log(pc.bold(`Available ${category}:\n`));
          const maxName = Math.max(...docs.map((d) => d.name.length));
          for (const doc of docs) {
            console.log(`  ${pc.cyan(doc.name.padEnd(maxName))}  ${pc.dim(doc.description)}`);
          }
          return;
        }

        const doc = readDoc(category, docName);
        if (!doc) {
          const label = name.charAt(0).toUpperCase() + name.slice(1);
          console.error(pc.red(`${label} not found: ${docName}`));
          console.error(pc.dim(`Run \`paw ${name} --list\` to see available ${category}.`));
          process.exit(1);
        }
        console.log(doc.content);
      } catch (err) {
        handleError(err);
      }
    });
}
