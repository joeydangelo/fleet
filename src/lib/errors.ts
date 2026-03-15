/** Base class for all fleet CLI errors. Carries an exit code for process.exit(). */
export class CLIError extends Error {
  exitCode = 1;
  constructor(message: string, options?: { cause?: Error }) {
    super(message, options);
    this.name = 'CLIError';
  }
}

/** Validation failures — exits with code 2. */
export class ValidationError extends CLIError {
  override exitCode = 2;
  constructor(message: string, options?: { cause?: Error }) {
    super(message, options);
    this.name = 'ValidationError';
  }
}

/** A required resource (file, task, config) was not found. */
export class NotFoundError extends CLIError {
  constructor(message: string, options?: { cause?: Error }) {
    super(message, options);
    this.name = 'NotFoundError';
  }
}

/** An external command (git, shell) failed. */
export class ExternalCommandError extends CLIError {
  constructor(message: string, options?: { cause?: Error }) {
    super(message, options);
    this.name = 'ExternalCommandError';
  }
}
