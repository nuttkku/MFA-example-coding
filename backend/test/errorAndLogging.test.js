import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { errorHandler } from '../src/middleware/error.middleware.js';
import { NotFoundError } from '../src/utils/errors.js';
import { logger } from '../src/utils/logger.js';

function capture(err) {
  const out = {};
  const res = {
    status(code) {
      out.status = code;
      return this;
    },
    json(body) {
      out.body = body;
      return this;
    },
  };
  const originalError = console.error;
  console.error = () => {};
  try {
    errorHandler(err, {}, res, () => {});
  } finally {
    console.error = originalError;
  }
  return out;
}

test('CSRF rejections are tagged so the frontend can tell them from other 403s', () => {
  const { status, body } = capture(Object.assign(new Error('x'), { code: 'EBADCSRFTOKEN' }));
  assert.equal(status, 403);
  assert.equal(body.code, 'csrf');
});

test('validation errors are a 400 with details', () => {
  const result = z.object({ a: z.string() }).safeParse({});
  const { status, body } = capture(result.error);
  assert.equal(status, 400);
  assert.ok(Array.isArray(body.details));
});

test('app errors keep their status', () => {
  assert.equal(capture(new NotFoundError()).status, 404);
});

test('client errors from body-parser are a 4xx, not a logged 500', () => {
  const { status, body } = capture(Object.assign(new Error('bad json'), { status: 400, expose: true }));
  assert.equal(status, 400);
  assert.equal(body.error, 'Invalid request');
});

test('unexpected errors are a generic 500 without internals', () => {
  const { status, body } = capture(new Error('db password is hunter2'));
  assert.equal(status, 500);
  assert.equal(body.error, 'Internal server error');
});

test('logger flattens CR/LF so a value cannot forge log lines', () => {
  const lines = [];
  const original = console.log;
  console.log = (...args) => lines.push(args.join(' '));
  try {
    logger.info('user said', 'hello\r\n[2026-01-01] ERROR forged');
  } finally {
    console.log = original;
  }
  assert.equal(lines.length, 1);
  assert.ok(!/[\r\n]/.test(lines[0]));
});
