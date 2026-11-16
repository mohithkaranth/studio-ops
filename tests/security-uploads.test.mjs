import assert from 'node:assert/strict';
import test from 'node:test';
import {loadTs} from './ts-loader.mjs';

let parserCalls = 0;
const {POST} = loadTs('app/api/bank-statements/upload/route.ts', {
  '@/lib/studio-auth-request': {authorizeApiRequest: async () => null},
  '@/lib/db': {sql: {}},
  'next/server': {NextResponse: {json: (body, options) => Response.json(body, options)}},
  'xlsx': {read: () => { parserCalls++; throw new Error('Internal parser detail'); }},
});

const endpoint = 'https://studio.test/api/bank-statements/upload';

test('rejects declared oversized request before parsing', async () => {
  const request = new Request(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'multipart/form-data; boundary=testing',
      'content-length': String(11 * 1024 * 1024),
    },
    body: 'ignored',
  });
  const response = await POST(request);
  assert.equal(response.status, 413);
  assert.equal(parserCalls, 0);
});

test('rejects unsupported content types', async () => {
  const request = new Request(endpoint, {
    method: 'POST',
    headers: {'content-type': 'text/plain'},
    body: 'not a multipart upload',
  });
  const response = await POST(request);
  assert.equal(response.status, 400);
  assert.equal(parserCalls, 0);
});

test('rejects disguised non-spreadsheet files', async () => {
  const form = new FormData();
  form.append('file', new Blob(['not a spreadsheet']), 'statement.xls');
  const response = await POST(new Request(endpoint, {method: 'POST', body: form}));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, 'Unrecognised spreadsheet format.');
  assert.equal(parserCalls, 0);
});

test('does not leak third-party parser error details', async () => {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array([0x50, 0x4b, 0x03, 0x04])]), 'statement.xlsx');
  const response = await POST(new Request(endpoint, {method: 'POST', body: form}));
  assert.equal(response.status, 400);
  assert.doesNotMatch((await response.json()).error, /Internal parser detail/);
  assert.equal(parserCalls, 1);
});
