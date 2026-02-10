import { Command } from "commander";
import pc from "picocolors";
import { readDoc, listDocs } from "../lib/docs.js";
import { handleError } from "../lib/output.js";

export function shortcutCommand(): Command {
  return new Command("shortcut")
    .description("Display a shortcut workflow")
    .argument("[name]", "Shortcut name")
    .option("-l, --list", "List available shortcuts")
    .action((name: string | undefined, opts: { list?: boolean }) => {
      try {
        if (opts.list || !name) {
          const docs = listDocs("shortcuts");
          if (docs.length === 0) {
            console.log(pc.yellow("No shortcuts found."));
            return;
          }
          console.log(pc.bold("Available shortcuts:\n"));
          const maxName = Math.max(...docs.map((d) => d.name.length));
          for (const doc of docs) {
            console.log(
              `  ${pc.cyan(doc.name.padEnd(maxName))}  ${pc.dim(doc.description)}`,
            );
          }
          return;
        }

        const doc = readDoc("shortcuts", name);
        if (!doc) {
          console.error(pc.red(`Shortcut not found: ${name}`));
          console.error(
            pc.dim("Run `paw shortcut --list` to see available shortcuts."),
          );
          process.exit(1);
        }
        console.log(doc.content);
      } catch (err) {
        handleError(err);
      }
    });
}
