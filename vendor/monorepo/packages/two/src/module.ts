import { AnsiLogger } from 'node-ansi-logger';

/**
 * This is the main entry point.
 */
export function main() {
  AnsiLogger.create({ logName: 'Monorepo two' }).info('Hello world!');
}

/**
 * Returns a greeting string from package two.
 *
 * @returns {string} Greeting from two.
 */
export function functionFromTwo(): string {
  return 'Hello from two!';
}
