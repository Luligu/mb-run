/**
 * @file vitest/error.test.ts
 * @description This file contains the tests for the shared error-handling utilities.
 * @author Luca Liguori
 */

import { describe, expect, it } from 'vitest';

import { getErrorCode, getErrorMessage } from '../src/error.js';
import { ExitError } from '../src/spawn.js';

describe('error', () => {
  describe('getErrorCode', () => {
    it('returns the exit code from an ExitError', () => {
      expect(getErrorCode(new ExitError(42, 'boom'))).toBe(42);
    });

    it('returns 1 for a plain Error', () => {
      expect(getErrorCode(new Error('boom'))).toBe(1);
    });

    it('returns 1 for a non-Error value', () => {
      expect(getErrorCode('boom')).toBe(1);
    });
  });

  describe('getErrorMessage', () => {
    it('returns the message from an Error', () => {
      expect(getErrorMessage(new Error('boom'))).toBe('boom');
    });

    it('returns the message from an ExitError', () => {
      expect(getErrorMessage(new ExitError(1, 'boom'))).toBe('boom');
    });

    it('stringifies a non-Error value', () => {
      expect(getErrorMessage('boom')).toBe('boom');
      expect(getErrorMessage(42)).toBe('42');
      expect(getErrorMessage(null)).toBe('null');
    });
  });
});
