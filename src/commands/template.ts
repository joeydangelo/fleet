import { Command } from "commander";
import pc from "picocolors";
import { readDoc, listDocs } from "../lib/docs.js";
import { handleError } from "../lib/output.js";

export function templateCommand(): Command {
  return new Command("template")
    .description("Display a document template")
    .argument("[name]", "Template name")
    .option("-l, --list", "List available templates")
    .action((name: string | undefined, opts: { list?: boolean }) => {
      try {
        if (opts.list || !name) {
          const docs = listDocs("templates");
          if (docs.length === 0) {
            console.log(pc.yellow("No templates found."));
            return;
          }
          console.log(pc.bold("Available templates:\n"));
          const maxName = Math.max(...docs.map((d) => d.name.length));
          for (const doc of docs) {
            console.log(
              `  ${pc.cyan(doc.name.padEnd(maxName))}  ${pc.dim(doc.description)}`,
            );
          }
          return;
        }

        const doc = readDoc("templates", name);
        if (!doc) {
          console.error(pc.red(`Template not found: ${name}`));
          console.error(
            pc.dim("Run `paw template --list` to see available templates."),
          );
          process.exit(1);
        }
        console.log(doc.content);
      } catch (err) {
        handleError(err);
      }
    });
}
