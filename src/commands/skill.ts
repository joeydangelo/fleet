import { Command } from 'commander';
import { readDoc, stripFrontmatter } from '../lib/docs.js';
import { handleError, colors } from '../lib/output.js';

/** CLI command: output paw skill content to stdout for agent consumption. */
export function skillCommand(): Command {
  return new Command('skill').description('Output paw skill content to stdout').action(() => {
    try {
      const doc = readDoc('templates', 'skill');
      if (!doc) {
        console.error(colors.error("Skill template 'skill' not found."));
        process.exit(1);
      }
      console.log(stripFrontmatter(doc.content));
    } catch (err) {
      handleError(err);
    }
  });
}
