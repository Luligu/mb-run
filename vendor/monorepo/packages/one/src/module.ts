import { AnsiLogger } from 'node-ansi-logger';

/**
 * This is the main entry point.
 */
export function main() {
  AnsiLogger.create({ logName: 'Monorepo one' }).info('Hello world!');
}

/**
 * Returns a greeting string from package one.
 *
 * @returns {string} Greeting from one.
 */
export function functionFromOne(): string {
  return 'Hello from one!';
}
