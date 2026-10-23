/**
 * @file scripts/buntest/junit.test.ts
 * @description This file creates the folder of the JUnit report set in bunfig.toml: Bun does not create it.
 * @author Luca Liguori
 */

import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

describe('JUnit report', () => {
  test('should create the .cache/bun folder for the JUnit report', () => {
    const dir = path.join(process.cwd(), '.cache', 'bun');
    mkdirSync(dir, { recursive: true });
    expect(existsSync(dir)).toBe(true);
  });
});
