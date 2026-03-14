#!/usr/bin/env node
import { createCli } from './cli.js';
import { handleError } from './lib/output.js';

process.stdout.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EPIPE') process.exit(0);
  throw err;
});
process.stderr.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EPIPE') process.exit(0);
  throw err;
});

const program = createCli();
program.parseAsync().catch(handleError);
