import test from 'node:test';
import assert from 'node:assert/strict';
import { locate, invokeLocation } from '../src/location.mjs';

const entryUrl = 'https://jzsz.uestc.edu.cn/daily-checkin-h5/assets/index-test.js';
const studentUrl = 'https://jzsz.uestc.edu.cn/daily-checkin-h5/assets/pages-student-report-today-home-index.test.js';
const entrySource = 'const old=()=>{},gps=()=>{}; const route="./pages-student-report-today-home-index.test.js"; export {old as bk,gps as bl};';
const studentSource = 'import {bl as W} from "./index-test.js";W({type:"gcj02",success(x){},fail(e){}});';
function fixture({ global = false, src = entryUrl } = {}) {
  const calls = [];
  return { calls, page: { url: () => 'https://jzsz.uestc.edu.cn/daily-checkin-h5/index.html?appId=294', evaluate: async (fn, arg) => {
    calls.push({ fn, arg });
    if (arg) return { latitude: 10, longitude: 10, accuracy: 20 };
    return calls.length === 1 ? global : src;
  } } };
}
test('locator uses the actual imported call, ignoring a misleading old export', async () => {
  const { page, calls } = fixture(), fetched = [];
  const result = await locate(page, { fetchSource: async url => { fetched.push(url); return url === entryUrl ? entrySource : studentSource; } });
  assert.deepEqual(fetched, [entryUrl, studentUrl]);
  assert.equal(calls.at(-1).arg.binding.exportName, 'bl');
  assert.equal(result.accuracy, 20);
});
test('public uni location takes priority and avoids fetching modules', async () => {
  const { page, calls } = fixture({ global: true });
  await locate(page, { fetchSource: async () => { throw new Error('must not fetch'); } });
  assert.equal(calls.at(-1).arg.binding, null);
});
test('redirected pages cannot supply a public uni location or initiate source discovery', async () => {
  const {page,calls}=fixture({global:true});page.url=()=>'https://foreign.invalid/daily-checkin-h5/index.html';
  await assert.rejects(locate(page),/frontend_location_contract_changed/);assert.equal(calls.length,0);
});
test('missing/foreign entry and changed source stop before invoking any guessed export', async () => {
  for (const src of [null, 'https://evil.invalid/daily-checkin-h5/assets/index-test.js', entryUrl + '?x=1']) {
    const { page, calls } = fixture({ src });
    await assert.rejects(locate(page, { fetchSource: async () => { throw new Error('must not fetch'); } }), /frontend_location_contract_changed/);
    assert.ok(calls.every(c => c.arg === undefined));
  }
  const { page, calls } = fixture();
  await assert.rejects(locate(page, { fetchSource: async () => 'const changed = true;' }), /frontend_location_contract_changed/);
  assert.ok(calls.every(c => c.arg === undefined));
});
test('default module reader rejects redirects and disposes responses', async () => {
  const { page, calls } = fixture();let disposed = 0;
  page.context = () => ({ request: { get: async (_url, options) => {
    assert.equal(options.maxRedirects, 0);
    return { status: () => 302, url: () => entryUrl, dispose: async () => { disposed++; } };
  } } });
  await assert.rejects(locate(page), /frontend_location_contract_changed/);assert.equal(disposed, 1);
  assert.ok(calls.every(c => c.arg === undefined));
});
test('real callbacks, bad coordinates, throws and timeouts settle without fake location', async t => {
  const previous = globalThis.uni;t.after(() => { if (previous === undefined) delete globalThis.uni;else globalThis.uni = previous; });
  const previousLocation=globalThis.location;t.after(()=>{if(previousLocation===undefined)delete globalThis.location;else globalThis.location=previousLocation;});
  globalThis.location={origin:'https://jzsz.uestc.edu.cn',pathname:'/daily-checkin-h5/index.html'};
  globalThis.uni = { getLocation(options) { assert.equal(this, globalThis.uni);assert.equal(options.type, 'gcj02');options.success({ latitude: 10, longitude: 10, accuracy: 20, private: 'omitted' }); } };
  assert.deepEqual(await invokeLocation({ binding: null, timeoutMs: 20 }), { latitude: 10, longitude: 10, accuracy: 20 });
  for (const fn of [o => o.success({ latitude: 100, longitude: 10, accuracy: 20 }), () => { throw new Error('private details'); }, o => o.fail()]) {
    globalThis.uni = { getLocation: fn };await assert.rejects(invokeLocation({ binding: null, timeoutMs: 20 }), /location_failed/);
  }
  globalThis.uni = { getLocation() {} };await assert.rejects(invokeLocation({ binding: null, timeoutMs: 5 }), /location_timeout/);
  globalThis.uni = { getLocation(options) { setTimeout(() => options.success({ get latitude() { throw new Error('private provider details'); } }), 0); } };
  await assert.rejects(invokeLocation({ binding: null, timeoutMs: 20 }), e => e.message === 'location_failed');
  globalThis.location={origin:'https://foreign.invalid',pathname:'/daily-checkin-h5/index.html'};
  await assert.rejects(invokeLocation({binding:null,timeoutMs:20}),/frontend_location_contract_changed/);
});
