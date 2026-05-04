import { AnsiLogger } from 'matterbridge/logger';

/**
 * This is the main entry point.
 */
export function main() {
  AnsiLogger.create({ logName: 'Plugin' }).info('Hello world!');
}
