/**
 * @description This file contains ANSI styling utilities.
 * @file ansi.ts
 * @author Luca Liguori
 * @created 2026-04-30
 * @version 1.0.0
 * @license Apache-2.0
 *
 * Copyright 2026, 2027, 2028 Luca Liguori.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Returns whether ANSI output should be used.
 *
 * @returns {boolean} True when ANSI output is enabled.
 */
export function shouldUseAnsi(): boolean {
  if (process.env.NO_COLOR) return false;
  if (process.env.TERM === 'dumb') return false;
  if (process.env.FORCE_COLOR) return true;
  return Boolean(process.stdout?.isTTY);
}

/**
 * Wraps text with an ANSI style when enabled.
 *
 * @param {string} open Opening ANSI code.
 * @param {string} close Closing ANSI code.
 * @param {string} text Text to style.
 * @returns {string} Styled or plain text.
 */
function wrapAnsi(open: string, close: string, text: string): string {
  return shouldUseAnsi() ? `${open}${text}${close}` : text;
}

/**
 * Applies reverse-video ANSI styling.
 *
 * @param {string} text Text to style.
 * @returns {string} Styled text.
 */
export function reverse(text: string): string {
  return wrapAnsi('\u001B[7m', '\u001B[27m', text);
}

/**
 * Applies black ANSI styling.
 *
 * @param {string} text Text to style.
 * @returns {string} Styled text.
 */
export function black(text: string): string {
  return wrapAnsi('\u001B[30m', '\u001B[39m', text);
}

/**
 * Applies red ANSI styling.
 *
 * @param {string} text Text to style.
 * @returns {string} Styled text.
 */
export function red(text: string): string {
  return wrapAnsi('\u001B[31m', '\u001B[39m', text);
}

/**
 * Applies green ANSI styling.
 *
 * @param {string} text Text to style.
 * @returns {string} Styled text.
 */
export function green(text: string): string {
  return wrapAnsi('\u001B[32m', '\u001B[39m', text);
}

/**
 * Applies yellow ANSI styling.
 *
 * @param {string} text Text to style.
 * @returns {string} Styled text.
 */
export function yellow(text: string): string {
  return wrapAnsi('\u001B[33m', '\u001B[39m', text);
}

/**
 * Applies blue ANSI styling.
 *
 * @param {string} text Text to style.
 * @returns {string} Styled text.
 */
export function blue(text: string): string {
  return wrapAnsi('\u001B[34m', '\u001B[39m', text);
}

/**
 * Applies magenta ANSI styling.
 *
 * @param {string} text Text to style.
 * @returns {string} Styled text.
 */
export function magenta(text: string): string {
  return wrapAnsi('\u001B[35m', '\u001B[39m', text);
}

/**
 * Applies cyan ANSI styling.
 *
 * @param {string} text Text to style.
 * @returns {string} Styled text.
 */
export function cyan(text: string): string {
  return wrapAnsi('\u001B[36m', '\u001B[39m', text);
}

/**
 * Applies white ANSI styling.
 *
 * @param {string} text Text to style.
 * @returns {string} Styled text.
 */
export function white(text: string): string {
  return wrapAnsi('\u001B[37m', '\u001B[39m', text);
}

/**
 * Applies bright black ANSI styling.
 *
 * @param {string} text Text to style.
 * @returns {string} Styled text.
 */
export function brightBlack(text: string): string {
  return wrapAnsi('\u001B[90m', '\u001B[39m', text);
}

/**
 * Applies bright red ANSI styling.
 *
 * @param {string} text Text to style.
 * @returns {string} Styled text.
 */
export function brightRed(text: string): string {
  return wrapAnsi('\u001B[91m', '\u001B[39m', text);
}

/**
 * Applies bright green ANSI styling.
 *
 * @param {string} text Text to style.
 * @returns {string} Styled text.
 */
export function brightGreen(text: string): string {
  return wrapAnsi('\u001B[92m', '\u001B[39m', text);
}

/**
 * Applies bright yellow ANSI styling.
 *
 * @param {string} text Text to style.
 * @returns {string} Styled text.
 */
export function brightYellow(text: string): string {
  return wrapAnsi('\u001B[93m', '\u001B[39m', text);
}

/**
 * Applies bright blue ANSI styling.
 *
 * @param {string} text Text to style.
 * @returns {string} Styled text.
 */
export function brightBlue(text: string): string {
  return wrapAnsi('\u001B[94m', '\u001B[39m', text);
}

/**
 * Applies bright magenta ANSI styling.
 *
 * @param {string} text Text to style.
 * @returns {string} Styled text.
 */
export function brightMagenta(text: string): string {
  return wrapAnsi('\u001B[95m', '\u001B[39m', text);
}

/**
 * Applies bright cyan ANSI styling.
 *
 * @param {string} text Text to style.
 * @returns {string} Styled text.
 */
export function brightCyan(text: string): string {
  return wrapAnsi('\u001B[96m', '\u001B[39m', text);
}

/**
 * Applies bright white ANSI styling.
 *
 * @param {string} text Text to style.
 * @returns {string} Styled text.
 */
export function brightWhite(text: string): string {
  return wrapAnsi('\u001B[97m', '\u001B[39m', text);
}

let startTime = 0;

/**
 * Saves the current cursor position and records the start time for {@link getElapsed}.
 *
 * @returns {string} ANSI cursor save sequence.
 */
export function savePos(): string {
  startTime = Date.now();
  return shouldUseAnsi() ? '\u001B[s' : '';
}

/**
 * Restores the saved cursor position and clears everything after it.
 *
 * @returns {string} ANSI cursor restore and clear sequence.
 */
export function restorePos(): string {
  return shouldUseAnsi() ? '\u001B[u\u001B[J' : '';
}

/**
 * Synchronizes the cursor position.
 *
 * @returns {string} ANSI cursor sync sequence.
 */
export function syncPos(): string {
  return shouldUseAnsi() ? ' \u001B[D' : '';
}

/**
 * Returns the elapsed time since the last {@link savePos} call, formatted as `123 ms` or `1.2 s`.
 *
 * @returns {string} Formatted elapsed time.
 */
export function getElapsed(): string {
  const ms = Date.now() - startTime;
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/**
 * Clears from the current cursor position to the end of the screen.
 *
 * @returns {string} ANSI clear-to-end sequence.
 */
export function clearEnd(): string {
  return shouldUseAnsi() ? '\u001B[J' : '';
}

/**
 * Clears from the current cursor position to the end of the line.
 *
 * @returns {string} ANSI clear-to-end sequence.
 */
export function clearEol(): string {
  return shouldUseAnsi() ? '\u001B[K' : '';
}

/**
 * Resets all ANSI styles.
 *
 * @returns {string} ANSI reset sequence.
 */
export function reset(): string {
  return shouldUseAnsi() ? '\u001B[0m' : '';
}

/**
 * Moves the cursor up by the given number of rows.
 *
 * @param {number} n Number of rows to move up. Defaults to 1.
 * @returns {string} ANSI cursor-up sequence, or empty string when ANSI is disabled.
 */
export function moveUp(n: number = 1): string {
  return shouldUseAnsi() ? `\u001B[${n}A` : '';
}

/**
 * Moves the cursor down by the given number of rows.
 *
 * @param {number} n Number of rows to move down. Defaults to 1.
 * @returns {string} ANSI cursor-down sequence, or empty string when ANSI is disabled.
 */
export function moveDown(n: number = 1): string {
  return shouldUseAnsi() ? `\u001B[${n}B` : '';
}

/**
 * Moves the cursor right by the given number of columns.
 *
 * @param {number} n Number of columns to move right. Defaults to 1.
 * @returns {string} ANSI cursor-right sequence, or empty string when ANSI is disabled.
 */
export function moveRight(n: number = 1): string {
  return shouldUseAnsi() ? `\u001B[${n}C` : '';
}

/**
 * Moves the cursor left by the given number of columns.
 *
 * @param {number} n Number of columns to move left. Defaults to 1.
 * @returns {string} ANSI cursor-left sequence, or empty string when ANSI is disabled.
 */
export function moveLeft(n: number = 1): string {
  return shouldUseAnsi() ? `\u001B[${n}D` : '';
}

/**
 * Logs a message to stdout.
 *
 * @param {string} message Message to log.
 * @returns {void}
 */
export function log(message: string): void {
  // eslint-disable-next-line no-console
  console.log(message);
}
