/**
 * @file src/error.ts
 * @description This file contains shared error-handling utilities for the mb-run command.
 * @author Luca Liguori
 * @created 2026-07-23
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

import { ExitError } from './spawn.js';

/**
 * Resolves the process exit code for a caught error.
 *
 * @param {unknown} error The caught error.
 * @returns {number} The error's exit code when it is an {@link ExitError}, otherwise 1.
 */
export function getErrorCode(error: unknown): number {
  return error instanceof ExitError ? error.code : 1;
}

/**
 * Resolves a printable message for a caught error.
 *
 * @param {unknown} error The caught error.
 * @returns {string} The error's message when it is an {@link Error}, otherwise its string form.
 */
export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
