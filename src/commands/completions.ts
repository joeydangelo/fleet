import { Command } from 'commander';
import {
  generateBashCompletion,
  generateZshCompletion,
  generateFishCompletion,
} from '../lib/completions.js';
import { handleError } from '../lib/output.js';

export function completionsCommand(): Command {
  return new Command('completions')
    .description('Generate shell completion scripts')
    .argument('<shell>', 'Shell type: bash, zsh, or fish')
    .action((shell: string) => {
      try {
        switch (shell) {
          case 'bash':
            console.log(generateBashCompletion());
            break;
          case 'zsh':
            console.log(generateZshCompletion());
            break;
          case 'fish':
            console.log(generateFishCompletion());
            break;
          default:
            console.error(`Unknown shell: ${shell}. Supported: bash, zsh, fish`);
            process.exit(1);
        }
      } catch (err) {
        handleError(err);
      }
    });
}
