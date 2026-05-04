import { AnsiLogger } from 'node-ansi-logger';

/**
 * This is the main entry point.
 */
export function main() {
  AnsiLogger.create({ logName: 'Tool package' }).info('Hello world!');
}
