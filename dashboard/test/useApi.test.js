// The useApi hook (lib/useApi.js) that most dashboard pages load their data through: loading, data, error, retry,
// refetch when its inputs change. Rendered for real with react-dom inside jsdom. (AIN-606 part)
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { useApi } from '../lib/useApi.js';

let container, root, seen;

beforeEach(() => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>');
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.getElementById('root');
  root = createRoot(container);
  seen = null;
});

function Probe({ fetcher, deps, initial }) {
  seen = useApi(fetcher, deps, initial);
  return React.createElement('div', null, seen.loading ? 'loading' : seen.error ? `error:${seen.error}` : `data:${JSON.stringify(seen.data)}`);
}

const mount = async (props) => { await act(async () => { root.render(React.createElement(Probe, props)); }); };
const text = () => container.textContent;
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

test('shows loading, then the data, and holds the initial value until the first answer', async () => {
  let resolve;
  await mount({ fetcher: () => new Promise((r) => { resolve = r; }), deps: [], initial: [] });
  assert.equal(text(), 'loading');
  assert.deepEqual(seen.data, []);
  await act(async () => { resolve(['a', 'b']); });
  assert.equal(text(), 'data:["a","b"]');
  assert.equal(seen.error, null);
});

test('a failure shows the message, and reload() clears it when the retry works', async () => {
  let ok = false;
  await mount({ fetcher: async () => { if (!ok) throw new Error('server down'); return { fine: true }; }, deps: [], initial: null });
  assert.equal(text(), 'error:server down');
  ok = true;
  await act(async () => { await seen.reload(); });
  assert.equal(text(), 'data:{"fine":true}');
  assert.equal(seen.error, null);
});

test('it fetches again when one of its deps changes, and not otherwise', async () => {
  const calls = [];
  const fetcher = (q) => async () => { calls.push(q); return q; };
  await mount({ fetcher: fetcher('one'), deps: ['one'] });
  await mount({ fetcher: fetcher('one'), deps: ['one'] });     // same deps: no new request
  assert.deepEqual(calls, ['one']);
  await mount({ fetcher: fetcher('two'), deps: ['two'] });
  assert.deepEqual(calls, ['one', 'two']);
  assert.equal(text(), 'data:"two"');
});

test('reload keeps the data on screen while it refetches, and setData lets a page update it in place', async () => {
  let n = 0;
  await mount({ fetcher: async () => ++n, deps: [], initial: 0 });
  assert.equal(seen.data, 1);
  await act(async () => { seen.reload(); });
  assert.equal(seen.data, 2);
  await act(async () => { seen.setData(99); });
  assert.equal(seen.data, 99);
});
