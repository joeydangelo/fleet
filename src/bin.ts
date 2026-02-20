#!/usr/bin/env node
import { createCli } from './cli.js';
import { handleError } from './lib/output.js';

const program = createCli();
program.parseAsync().catch(handleError);
