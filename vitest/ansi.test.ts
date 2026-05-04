import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  black,
  blue,
  brightBlack,
  brightBlue,
  brightCyan,
  brightGreen,
  brightMagenta,
  brightRed,
  brightWhite,
  brightYellow,
  clearEnd,
  clearEol,
  cyan,
  getElapsed,
  green,
  log,
  magenta,
  moveDown,
  moveLeft,
  moveRight,
  moveUp,
  red,
  reset,
  restorePos,
  reverse,
  savePos,
  syncPos,
  white,
  yellow,
} from '../src/ansi.js';

const ESC = '';

describe('ansi', () => {
  describe('ANSI disabled (no TTY)', () => {
    it('all style functions return plain text', () => {
      expect(reverse('x')).toBe('x');
      expect(black('x')).toBe('x');
      expect(red('x')).toBe('x');
      expect(green('x')).toBe('x');
      expect(yellow('x')).toBe('x');
      expect(blue('x')).toBe('x');
      expect(magenta('x')).toBe('x');
      expect(cyan('x')).toBe('x');
      expect(white('x')).toBe('x');
      expect(brightBlack('x')).toBe('x');
      expect(brightRed('x')).toBe('x');
      expect(brightGreen('x')).toBe('x');
      expect(brightYellow('x')).toBe('x');
      expect(brightBlue('x')).toBe('x');
      expect(brightMagenta('x')).toBe('x');
      expect(brightCyan('x')).toBe('x');
      expect(brightWhite('x')).toBe('x');
    });

    it('savePos returns empty string', () => {
      expect(savePos()).toBe('');
    });

    it('restorePos returns empty string', () => {
      expect(restorePos()).toBe('');
    });

    it('syncPos returns empty string', () => {
      expect(syncPos()).toBe('');
    });

    it('clearEnd returns empty string', () => {
      expect(clearEnd()).toBe('');
    });

    it('clearEol returns empty string', () => {
      expect(clearEol()).toBe('');
    });

    it('reset returns empty string', () => {
      expect(reset()).toBe('');
    });

    it('moveUp returns empty string', () => {
      expect(moveUp()).toBe('');
    });

    it('moveDown returns empty string', () => {
      expect(moveDown()).toBe('');
    });

    it('moveRight returns empty string', () => {
      expect(moveRight()).toBe('');
    });

    it('moveLeft returns empty string', () => {
      expect(moveLeft()).toBe('');
    });
  });

  describe('ANSI disabled via NO_COLOR', () => {
    beforeEach(() => {
      vi.stubEnv('NO_COLOR', '1');
      Object.defineProperty(process.stdout, 'isTTY', { value: true, writable: true, configurable: true });
    });

    afterEach(() => {
      vi.unstubAllEnvs();
      Object.defineProperty(process.stdout, 'isTTY', { value: undefined, writable: true, configurable: true });
    });

    it('green returns plain text', () => {
      expect(green('hello')).toBe('hello');
    });

    it('savePos returns empty string', () => {
      expect(savePos()).toBe('');
    });

    it('restorePos returns empty string', () => {
      expect(restorePos()).toBe('');
    });
  });

  describe('ANSI disabled via TERM=dumb', () => {
    beforeEach(() => {
      vi.stubEnv('TERM', 'dumb');
      Object.defineProperty(process.stdout, 'isTTY', { value: true, writable: true, configurable: true });
    });

    afterEach(() => {
      vi.unstubAllEnvs();
      Object.defineProperty(process.stdout, 'isTTY', { value: undefined, writable: true, configurable: true });
    });

    it('green returns plain text', () => {
      expect(green('hello')).toBe('hello');
    });

    it('savePos returns empty string', () => {
      expect(savePos()).toBe('');
    });

    it('restorePos returns empty string', () => {
      expect(restorePos()).toBe('');
    });
  });

  describe('ANSI enabled via FORCE_COLOR', () => {
    beforeEach(() => {
      vi.stubEnv('FORCE_COLOR', '1');
      Object.defineProperty(process.stdout, 'isTTY', { value: false, writable: true, configurable: true });
    });

    afterEach(() => {
      vi.unstubAllEnvs();
      Object.defineProperty(process.stdout, 'isTTY', { value: undefined, writable: true, configurable: true });
    });

    it('green wraps with green codes even without a TTY', () => {
      expect(green('x')).toBe(`${ESC}[32mx${ESC}[39m`);
    });

    it('FORCE_COLOR is overridden by NO_COLOR', () => {
      vi.stubEnv('NO_COLOR', '1');
      expect(green('x')).toBe('x');
    });
  });

  describe('ANSI enabled', () => {
    beforeEach(() => {
      vi.stubEnv('NO_COLOR', undefined as unknown as string);
      vi.stubEnv('TERM', 'xterm-256color');
      Object.defineProperty(process.stdout, 'isTTY', { value: true, writable: true, configurable: true });
    });

    afterEach(() => {
      vi.unstubAllEnvs();
      Object.defineProperty(process.stdout, 'isTTY', { value: undefined, writable: true, configurable: true });
    });

    it('reverse wraps with reverse-video codes', () => {
      expect(reverse('x')).toBe(`${ESC}[7mx${ESC}[27m`);
    });

    it('black wraps with black codes', () => {
      expect(black('x')).toBe(`${ESC}[30mx${ESC}[39m`);
    });

    it('red wraps with red codes', () => {
      expect(red('x')).toBe(`${ESC}[31mx${ESC}[39m`);
    });

    it('green wraps with green codes', () => {
      expect(green('x')).toBe(`${ESC}[32mx${ESC}[39m`);
    });

    it('yellow wraps with yellow codes', () => {
      expect(yellow('x')).toBe(`${ESC}[33mx${ESC}[39m`);
    });

    it('blue wraps with blue codes', () => {
      expect(blue('x')).toBe(`${ESC}[34mx${ESC}[39m`);
    });

    it('magenta wraps with magenta codes', () => {
      expect(magenta('x')).toBe(`${ESC}[35mx${ESC}[39m`);
    });

    it('cyan wraps with cyan codes', () => {
      expect(cyan('x')).toBe(`${ESC}[36mx${ESC}[39m`);
    });

    it('white wraps with white codes', () => {
      expect(white('x')).toBe(`${ESC}[37mx${ESC}[39m`);
    });

    it('brightBlack wraps with bright-black codes', () => {
      expect(brightBlack('x')).toBe(`${ESC}[90mx${ESC}[39m`);
    });

    it('brightRed wraps with bright-red codes', () => {
      expect(brightRed('x')).toBe(`${ESC}[91mx${ESC}[39m`);
    });

    it('brightGreen wraps with bright-green codes', () => {
      expect(brightGreen('x')).toBe(`${ESC}[92mx${ESC}[39m`);
    });

    it('brightYellow wraps with bright-yellow codes', () => {
      expect(brightYellow('x')).toBe(`${ESC}[93mx${ESC}[39m`);
    });

    it('brightBlue wraps with bright-blue codes', () => {
      expect(brightBlue('x')).toBe(`${ESC}[94mx${ESC}[39m`);
    });

    it('brightMagenta wraps with bright-magenta codes', () => {
      expect(brightMagenta('x')).toBe(`${ESC}[95mx${ESC}[39m`);
    });

    it('brightCyan wraps with bright-cyan codes', () => {
      expect(brightCyan('x')).toBe(`${ESC}[96mx${ESC}[39m`);
    });

    it('brightWhite wraps with bright-white codes', () => {
      expect(brightWhite('x')).toBe(`${ESC}[97mx${ESC}[39m`);
    });

    it('savePos returns cursor-save sequence', () => {
      expect(savePos()).toBe(`${ESC}[s`);
    });

    it('restorePos returns cursor-restore-and-clear sequence', () => {
      expect(restorePos()).toBe(`${ESC}[u${ESC}[J`);
    });

    it('syncPos returns cursor-sync sequence', () => {
      expect(syncPos()).toBe(` ${ESC}[D`);
    });

    it('clearEnd returns clear-to-end-of-screen sequence', () => {
      expect(clearEnd()).toBe(`${ESC}[J`);
    });

    it('clearEol returns clear-to-end-of-line sequence', () => {
      expect(clearEol()).toBe(`${ESC}[K`);
    });

    it('reset returns ANSI reset sequence', () => {
      expect(reset()).toBe(`${ESC}[0m`);
    });

    it('moveUp moves cursor up 1 row by default', () => {
      expect(moveUp()).toBe(`${ESC}[1A`);
    });

    it('moveUp moves cursor up n rows', () => {
      expect(moveUp(3)).toBe(`${ESC}[3A`);
    });

    it('moveDown moves cursor down 1 row by default', () => {
      expect(moveDown()).toBe(`${ESC}[1B`);
    });

    it('moveDown moves cursor down n rows', () => {
      expect(moveDown(5)).toBe(`${ESC}[5B`);
    });

    it('moveRight moves cursor right 1 column by default', () => {
      expect(moveRight()).toBe(`${ESC}[1C`);
    });

    it('moveRight moves cursor right n columns', () => {
      expect(moveRight(4)).toBe(`${ESC}[4C`);
    });

    it('moveLeft moves cursor left 1 column by default', () => {
      expect(moveLeft()).toBe(`${ESC}[1D`);
    });

    it('moveLeft moves cursor left n columns', () => {
      expect(moveLeft(2)).toBe(`${ESC}[2D`);
    });

    it('getElapsed returns ms format for short durations', () => {
      savePos();
      const result = getElapsed();
      expect(result).toMatch(/^\d+ ms$/);
    });

    it('getElapsed returns seconds format for durations >= 1000 ms', () => {
      // Force _startTime to 1100 ms in the past by calling savePos then manipulating Date.now.
      savePos();
      const origNow = Date.now;
      vi.spyOn(Date, 'now').mockReturnValue(origNow() + 1100);
      const result = getElapsed();
      vi.mocked(Date.now).mockRestore();
      expect(result).toMatch(/^\d+\.\d+ s$/);
    });
  });

  describe('log', () => {
    it('calls console.log with the message', () => {
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      log('hello world');
      expect(spy).toHaveBeenCalledExactlyOnceWith('hello world');
    });
  });
});
