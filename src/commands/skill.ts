import { Command } from 'commander';
import { readDoc, stripFrontmatter } from '../lib/docs.js';
import { handleError, colors } from '../lib/output.js';

export function skillCommand(): Command {
  return new Command('skill')
    .description('Output paw skill content to stdout')
    .option('--brief', 'Output condensed skill content (~400 tokens)')
    .action((opts: { brief?: boolean }) => {
      try {
        const templateName = opts.brief ? 'skill-brief' : 'skill';
        const doc = readDoc('templates', templateName);
        if (!doc) {
          console.error(colors.error(`Skill template '${templateName}' not found.`));
          process.exit(1);
        }
        console.log(stripFrontmatter(doc.content));
      } catch (err) {
        handleError(err);
      }
    });
}
