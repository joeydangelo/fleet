import { Command } from 'commander';
import { readDoc } from '../lib/docs.js';
import { handleError, colors } from '../lib/output.js';

export function skillCommand(): Command {
  return new Command('skill').description('Output paw skill content to stdout').action(() => {
    try {
      const doc = readDoc('templates', 'skill');
      if (!doc) {
        console.error(colors.error('Skill template not found.'));
        process.exit(1);
      }
      // Strip YAML frontmatter — output raw markdown body only
      const body = doc.content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
      console.log(body);
    } catch (err) {
      handleError(err);
    }
  });
}
