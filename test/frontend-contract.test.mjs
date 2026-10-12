import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveLocationBinding, findStudentModule } from '../src/frontend-contract.mjs';

const entryUrl = 'https://jzsz.uestc.edu.cn/daily-checkin-h5/assets/index-CqZyvL8l.js';
const studentUrl = 'https://jzsz.uestc.edu.cn/daily-checkin-h5/assets/pages-student-report-today-home-index.Ab12.js';
const call = alias => `${alias}({type:'gcj02',isHighAccuracy:true,success(x){return x},fail:()=>{}})`;
const fixture = (exportName = 'bl', alias = 'W') => ({
  entryUrl, studentUrl,
  entrySource: 'function a(){} function b(){} export {a as bl,b as bk};',
  studentSource: `import {${exportName} as ${alias}} from './index-CqZyvL8l.js'; ${call(alias)};`
});
const rejects = input => assert.throws(() => resolveLocationBinding(input), error => error.message === 'frontend_location_contract_changed');

test('old and new minifier aliases resolve the actual call, even when the old export remains', () => {
  assert.equal(resolveLocationBinding(fixture()).exportName, 'bl');
  assert.equal(resolveLocationBinding(fixture('bk', 'L')).exportName, 'bk');
  assert.deepEqual(resolveLocationBinding(fixture()), { entryUrl, studentUrl, exportName: 'bl' });
});

test('comments, whitespace, quoted keys, and function callbacks are supported', () => {
  const input = fixture();
  input.studentSource = `import /* alias */ { bl as W } from './index-CqZyvL8l.js'; W( { 'type': /* location */ 'gcj02', success: function(){}, fail(){} } );`;
  assert.equal(resolveLocationBinding(input).exportName, 'bl');
});

test('repeated calls of the same imported binding are allowed', () => {
  const input = fixture();
  input.studentSource += `;${call('W')};`;
  assert.equal(resolveLocationBinding(input).exportName, 'bl');
});

test('missing and ambiguous bindings fail closed', () => {
  rejects({ ...fixture(), studentSource: 'const W=()=>{};' });
  rejects({ ...fixture(), studentSource: call('W') });
  rejects({ ...fixture(), studentSource: fixture().studentSource + `import {bk as L} from './index-CqZyvL8l.js';${call('L')}` });
  rejects({ ...fixture(), studentSource: `import {bl as W} from './other.js';${call('W')}` });
  rejects({ ...fixture(), studentSource: `import W from './index-CqZyvL8l.js';${call('W')}` });
  rejects({ ...fixture(), studentSource: fixture().studentSource + `function f(W){${call('W')}}` });
});

test('entry must explicitly export the discovered name locally', () => {
  rejects({ ...fixture(), entrySource: 'function bl(){}; export {bl as bk};' });
  rejects({ ...fixture(), entrySource: "export {bl} from './remote.js';" });
  assert.equal(resolveLocationBinding({ ...fixture(), entrySource: 'export function bl(){}' }).exportName, 'bl');
  assert.equal(resolveLocationBinding({ ...fixture(), entrySource: 'export const bl=()=>{};' }).exportName, 'bl');
});

test('callback omissions, noncallbacks, and malformed code fail closed', () => {
  rejects({ ...fixture(), studentSource: "import {bl as W} from './index-CqZyvL8l.js';W({type:'gcj02',success(){}})" });
  rejects({ ...fixture(), studentSource: "import {bl as W} from './index-CqZyvL8l.js';W({type:'gcj02',success(){},fail:handler})" });
  rejects({ ...fixture(), studentSource: 'broken ! {' });
  rejects({ ...fixture(), entrySource: 'broken ! {' });
});

test('asset URLs reject foreign origins, credentials, queries, hashes, and traversal', () => {
  for (const value of [entryUrl.replace('jzsz.uestc.edu.cn','evil.example'), entryUrl.replace('https:','http:'), entryUrl+'?x=1', entryUrl+'#x', entryUrl.replace('https://','https://user@'), entryUrl.replace('/assets/', '/assets/../assets/'), entryUrl.replace('/assets/', '/assets/%2e%2e/assets/'), entryUrl.replace('/assets/','/other/')]) rejects({ ...fixture(), entryUrl: value });
  rejects({ ...fixture(), studentUrl: studentUrl+'?x=1' });
  rejects({ ...fixture(), studentSource: `import {bl as W} from '../assets/index-CqZyvL8l.js';${call('W')}` });
});

test('source size limits count bytes and sanitize errors', () => {
  rejects({ ...fixture(), entrySource: ' '.repeat(2*1024*1024+1) });
  rejects({ ...fixture(), studentSource: ' '.repeat(256*1024+1) });
  rejects({ ...fixture(), studentSource: '中'.repeat(100000) });
});

test('student chunk discovery uses AST literals and requires one valid unique URL', () => {
  const source = `const chunks=['./pages-student-report-today-home-index.Ab12.js'];`;
  assert.equal(findStudentModule({ entryUrl, entrySource: source }), studentUrl);
  assert.equal(findStudentModule({ entryUrl, entrySource: source+source.replace('const chunks','const again') }), studentUrl);
  for (const entrySource of ['// "./pages-student-report-today-home-index.Ab12.js"', source+`const other='./pages-student-report-today-home-index.Cd34.js';`, `const other='https://evil.example/daily-checkin-h5/assets/pages-student-report-today-home-index.Ab12.js';`, `const other='./pages-student-report-today-home-index.Ab12.js?x=1';`, 'not { valid']) {
    assert.throws(() => findStudentModule({ entryUrl, entrySource }), error => error.message === 'frontend_location_contract_changed');
  }
});

test('only declarations enclosing the call can shadow the imported binding', () => {
  const input = fixture();
  input.studentSource += 'function sibling(W){return W} function other(){let W;return W} {const W=1;}';
  assert.equal(resolveLocationBinding(input).exportName, 'bl');
  for (const body of [
    `function enclosing(W){${call('W')}}`,
    `function enclosing(){${call('W')};var W;}`,
    `function enclosing(){if(false){var W;} ${call('W')}}`,
    `function enclosing(){${call('W')};let W;}`,
    `function enclosing(){class W{};${call('W')}}`,
    `const fn=function W(){${call('W')}}`,
    `try{}catch(W){${call('W')}}`,
    `for(let W of []){${call('W')}}`
  ]) rejects({ ...fixture(), studentSource: `import {bl as W} from './index-CqZyvL8l.js';${body}` });
  assert.equal(resolveLocationBinding({ ...fixture(), studentSource: `import {bl as W} from './index-CqZyvL8l.js';function outer(){function sibling(W){};${call('W')}}` }).exportName, 'bl');
});

test('duplicate options, spreads, computed keys, and accessors fail closed', () => {
  for (const options of [
    "type:'gcj02',type:'wgs84',success(){},fail(){}",
    "type:'wgs84',type:'gcj02',success(){},fail(){}",
    "type:'gcj02',type:'gcj02',success(){},fail(){}",
    "type:'gcj02',success(){},success:other,fail(){}",
    "type:'gcj02',success(){},fail(){},fail:other",
    "type:'gcj02',success(){},fail(){},...dynamicOptions",
    "...dynamicOptions,type:'gcj02',success(){},fail(){}",
    "type:'gcj02',success(){},fail(){},[unknown]:other",
    "type:'gcj02',get success(){return ()=>{}},fail(){}"
  ]) rejects({ ...fixture(), studentSource: `import {bl as W} from './index-CqZyvL8l.js'; W({${options}});` });
  rejects({ ...fixture(), studentSource: fixture().studentSource + `W({type:'gcj02',type:'wgs84',success(){},fail(){}});` });
});
