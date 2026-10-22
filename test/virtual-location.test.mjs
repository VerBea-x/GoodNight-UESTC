import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateConfig, loadConfig } from '../src/config.mjs';
import { createUestcAdapter } from '../src/adapters/uestc.mjs';

test('virtual mode validates missing coordinates, ranges, precision and unknown fields',async()=>{
  assert.equal(validateConfig({}).locationMode,'real');
  assert.throws(()=>validateConfig({locationMode:'other'}));
  assert.throws(()=>validateConfig({locationMode:'virtual'}));
  for(const virtualLocation of [[],{latitude:91,longitude:104,accuracy:20},{latitude:30,longitude:181,accuracy:20},{latitude:30,longitude:104,accuracy:-1},{latitude:30,longitude:104,accuracy:201},{latitude:'30',longitude:104,accuracy:20},{latitude:30,longitude:104,accuracy:20,typo:1}]) {
    await assert.rejects(createUestcAdapter({},{locationMode:'virtual',virtualLocation}).getLocation());
  }
  const config=validateConfig({locationMode:'virtual',virtualLocation:{latitude:0,longitude:0,accuracy:0}});
  const point=await createUestcAdapter({},config).getLocation();
  point.latitude=1;assert.equal(config.virtualLocation.latitude,0);
});
test('CLI persists selected coordinates and time, rejects bad input, and switches back to real',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'goodnight-virtual-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const cli=fileURLToPath(new URL('../bin/goodnight.mjs',import.meta.url));
  const run=(...args)=>spawnSync(process.execPath,[cli,...args,'--data-dir',dir],{encoding:'utf8'});
  assert.equal(run('init').status,0);
  const result=run('location','--mode','virtual','--latitude','30','--longitude','104','--time','22:15');
  assert.equal(result.status,0,result.stderr);
  const config=loadConfig(dir);assert.equal(config.locationMode,'virtual');assert.equal(config.reportTime,'22:15');
  assert.deepEqual(config.virtualLocation,{latitude:30,longitude:104,accuracy:20});
  for(const args of [['--latitude','30'],['--latitude','91','--longitude','104'],['--latitude','','--longitude','104']]) {
    assert.notEqual(run('location','--mode','virtual',...args).status,0);
    assert.deepEqual(loadConfig(dir),config);
  }
  assert.equal(run('location','--mode','real').status,0);
  assert.equal(loadConfig(dir).locationMode,'real');
});
