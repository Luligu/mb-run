import { functionFromOne } from '@monorepo/one';
import { functionFromTwo } from '@monorepo/two';

/**
 * This is the main entry point.
 */
export function main() {
  // eslint-disable-next-line no-console
  console.log('Hello world from monorepo root!');
  // eslint-disable-next-line no-console
  console.log(functionFromOne());
  // eslint-disable-next-line no-console
  console.log(functionFromTwo());
}
