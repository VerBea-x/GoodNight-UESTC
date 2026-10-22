import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { defaultDataDir } from '../src/config.mjs';
import { installService, renderService, uninstallService, SERVICE_ID } from '../src/service.mjs';

const base = {
  home: '/Users/Zoë O\'Brien',
  dataDir: '/Users/Zoë O\'Brien/Library/Application Support/GoodNight & Data',
  entrypoint: '/Applications/GoodNight/bin/goodnight.mjs',
  node: '/Applications/Node JS/bin/node',
  env: { UID: '502', USERNAME: 'Zoë & O\'Brien', USERDOMAIN: 'EXAMPLE', LOCALAPPDATA: 'C:\\Users\\Zoë O\'Brien\\AppData\\Local' },
};

test('renders a persistent launch agent for macOS', () => {
  const result = renderService({ ...base, platform: 'darwin' });
  assert.equal(result.files[0].path, `/Users/Zoë O'Brien/Library/LaunchAgents/${SERVICE_ID}.plist`);
  assert.match(result.files[0].content, /<key>KeepAlive<\/key>\s*<true\/>/);
  assert.match(result.files[0].content, /<key>RunAtLoad<\/key>\s*<true\/>/);
  assert.match(result.files[0].content, /GoodNight &amp; Data/);
  assert.deepEqual(result.commands[1], { file: 'launchctl', args: ['bootstrap', 'gui/502', result.files[0].path] });
  assert.equal(result.commands[0].optional, true);
  assert.deepEqual(result.commands[0].ignoreExitCodes, [3]);
  assert.deepEqual(result.uninstallCommands[0], { file: 'launchctl', args: ['bootout', `gui/502/${SERVICE_ID}`], optional: true, ignoreExitCodes: [3] });
});

test('renders a per-user Windows logon task with current-user interactive launch', () => {
  const result = renderService({ ...base, platform: 'win32' });
  const xml = result.files[0].content;
  assert.equal(result.files[0].encoding, 'utf16le');
  assert.match(xml, /encoding="UTF-16"/);
  assert.match(xml, /<Task xmlns="http:\/\/schemas\.microsoft\.com\/windows\/2004\/02\/mit\/task" version="1\.3">/);
  assert.match(xml, /<LogonTrigger><UserId>EXAMPLE\\Zoë &amp; O&apos;Brien<\/UserId><Enabled>true<\/Enabled><\/LogonTrigger>/);
  assert.match(xml, /<LogonType>InteractiveToken<\/LogonType>/);
  assert.match(xml, /<MultipleInstancesPolicy>IgnoreNew<\/MultipleInstancesPolicy>/);
  assert.match(xml, /<ExecutionTimeLimit>PT0S<\/ExecutionTimeLimit>/);
  assert.match(xml, /<RestartOnFailure><Interval>PT1M<\/Interval><Count>3<\/Count><\/RestartOnFailure>/);
  assert.match(xml, /EXAMPLE\\Zoë &amp; O&apos;Brien/);
  assert.match(result.files[1].content, /GoodNight & Data/);
  assert.match(xml, /wscript\.exe/);
  assert.match(result.files[1].content, /shell\.Run\(.*?, 0, True\)/);
  assert.match(result.files[1].content, /node/);
  assert.equal(result.files[1].encoding,'utf16le');
  assert.deepEqual(result.commands[0].args, ['/End', '/TN', SERVICE_ID]);
  assert.deepEqual(result.commands[1].args.slice(0, 3), ['/Create', '/TN', SERVICE_ID]);
  assert.equal(result.commands[1].file, 'schtasks.exe');
  assert.deepEqual(result.commands[2].args, ['/Run', '/TN', SERVICE_ID]);
  assert.deepEqual(result.uninstallCommands.map(command => command.optional === true), [true, false]);
});

test('uses config.mjs default data paths and environment overrides on each platform', () => {
  const cases = [
    { platform: 'darwin', home: '/Users/alice', env: { HOME: '/Users/alice', UID:'501', GOODNIGHT_HOME: '/Volumes/Data/goodnight' } },
    { platform: 'win32', home: 'C:\\Users\\Alice', env: { USERNAME: 'Alice', LOCALAPPDATA: 'C:\\Users\\Alice\\AppData\\Local', GOODNIGHT_HOME: 'D:\\GoodNight' } },
    { platform: 'linux', home: '/home/alice', env: { HOME: '/home/alice', XDG_STATE_HOME: '/run/user/1000/state' } },
  ];
  for (const entry of cases) {
    const result = renderService({ ...entry, node: entry.platform === 'win32' ? 'C:\\Program Files\\nodejs\\node.exe' : '/usr/bin/node', entrypoint: entry.platform === 'win32' ? 'C:\\GoodNight\\bin\\goodnight.mjs' : '/opt/goodnight/bin/goodnight.mjs' });
    const expected = defaultDataDir({ platform: entry.platform, home: entry.home, env: { ...process.env, ...entry.env } });
    const rendered=result.files.map(file=>file.content).join('\n');
    assert.ok(rendered.includes(expected), `${entry.platform} should use config.mjs data path ${expected}`);
    assert.ok(rendered.includes('--data-dir'), `${entry.platform} should pass an explicit data directory`);
  }
});

test('Windows task rendering requires the current USERNAME identity', () => {
  assert.throws(() => renderService({ ...base, platform: 'win32', env: { USERNAME: '', USERDOMAIN: '' } }), /Windows username.*USERNAME/);
});

test('web service starts the dashboard with an explicit port on all platforms',()=>{
  for(const platform of ['win32','darwin','linux']){
    const result=renderService({...base,platform,mode:'web',port:3211});
    const rendered=result.files.map(file=>file.content).join('\n');
    assert.match(rendered,/web/);assert.match(rendered,/--port/);assert.match(rendered,/3211/);
  }
  assert.throws(()=>renderService({...base,platform:'win32',mode:'web',port:0}),/port/);
  assert.throws(()=>renderService({...base,platform:'win32',mode:'other'}),/mode/);
});

test('Windows task file uses UTF-16LE with BOM for schtasks import', async t => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'goodnight-service-encoding-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const result = await installService({ ...base, platform:'win32', entrypoint:path.join(temp,'bin','goodnight.mjs'),env:{...base.env,LOCALAPPDATA:temp}, apply:false });
  const bytes = await readFile(result.files[0].path);
  assert.deepEqual([...bytes.subarray(0,2)],[0xff,0xfe]);
  assert.equal(bytes.subarray(2).toString('utf16le'),result.files[0].content);
});

test('renders a systemd user daemon attached to the graphical session target', () => {
  const result = renderService({ ...base, platform: 'linux' });
  const unit = result.files[0].content;
  assert.match(unit, /^\[Unit\]/);
  assert.match(unit, /^ExecStart=.*daemon.*--data-dir.*$/m);
  assert.match(unit, /Restart=on-failure/);
  assert.match(unit, /WantedBy=graphical-session\.target/);
  assert.equal(result.commands.length, 3);
  assert.deepEqual(result.commands[1].args, ['--user', 'enable', `${SERVICE_ID}.service`]);
  assert.deepEqual(result.commands[2].args, ['--user', 'restart', `${SERVICE_ID}.service`]);
  assert.match(result.uninstallCommands[0].args.join(' '), /disable --now/);
});

test('systemd ExecStart escapes literal specifiers, quotes, and Unicode exactly', () => {
  const result = renderService({
    platform: 'linux', home: '/home/Zoë', dataDir: '/home/Zoë/$100%/"quoted"',
    node: '/opt/Nødé $100%/node "x"', entrypoint: '/opt/GoodNight/启动.mjs', env: {},
  });
  assert.ok(result.files[0].content.includes('ExecStart="/opt/Nødé $$100%%/node \\"x\\"" "\/opt\/GoodNight/启动.mjs" "daemon" "--data-dir" "/home/Zoë/$$100%%/\\"quoted\\""'));
});

test('Windows default home uses USERPROFILE and does not borrow the host HOME', () => {
  const result = renderService({
    platform: 'win32', env: { USERPROFILE: 'C:\\Users\\Alice', LOCALAPPDATA: 'C:\\Users\\Alice\\AppData\\Local', USERNAME: 'Alice' },
    node: 'C:\\Program Files\\nodejs\\node.exe', entrypoint: 'C:\\GoodNight\\bin\\goodnight.mjs',
  });
  assert.match(result.files[0].content, /<WorkingDirectory>C:\\Users\\Alice<\/WorkingDirectory>/);
});

test('rejects newline and NUL injection in configured paths', () => {
  assert.throws(() => renderService({ ...base, platform: 'linux', dataDir: '/tmp/good\nnight' }), /without NUL or newline/);
  assert.throws(() => renderService({ ...base, platform: 'darwin', node: `/tmp/nul\0node` }), /without NUL or newline/);
});

test('apply:false writes the generated unit and never invokes a service manager', { skip: process.platform !== 'linux' }, async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'goodnight-service-'));
  const calls = [];
  try {
    const options = { platform: 'linux', home: temp, dataDir: path.join(temp, 'data'), entrypoint: path.join(temp, 'bin', 'goodnight.mjs'), node: '/usr/bin/node', commandRunner: (...args) => calls.push(args) };
    const result = await installService({ ...options, apply: false });
    assert.deepEqual(calls, []);
    assert.equal(await readFile(result.files[0].path, 'utf8'), result.files[0].content);
    await uninstallService({ ...options, apply: false });
    await assert.rejects(stat(result.files[0].path), { code: 'ENOENT' });
    assert.deepEqual(calls, []);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test('installer passes argv without a shell and distinguishes missing tooling and permission errors', { skip: process.platform !== 'linux' }, async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'goodnight-service-'));
  const options = { platform: 'linux', home: temp, dataDir: path.join(temp, 'data'), entrypoint: path.join(temp, 'bin', 'goodnight.mjs'), node: '/usr/bin/node' };
  try {
    const seen = [];
    await installService({ ...options, commandRunner: async (file, args) => { seen.push([file, args]); return { code: 0 }; } });
    assert.deepEqual(seen.map(([file]) => file), ['systemctl', 'systemctl', 'systemctl']);
    assert.ok(seen.every(([, args]) => Array.isArray(args)));
    await assert.rejects(installService({ ...options, commandRunner: async () => { throw Object.assign(new Error('not found'), { code: 'ENOENT' }); } }), /missing tooling/);
    await assert.rejects(installService({ ...options, commandRunner: async () => { throw Object.assign(new Error('denied'), { code: 'EACCES' }); } }), /permission denied/);
    await assert.rejects(uninstallService({ ...options, commandRunner: async () => ({ code: 5 }) }), /permission denied/);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test('Windows registration and start failures propagate; only task stop exit code 1 is optional', { skip: process.platform !== 'win32' }, async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'goodnight-service-'));
  const options = { platform: 'win32', home: 'C:\\Users\\Alice', dataDir: 'C:\\Users\\Alice\\state', entrypoint: path.win32.join(temp,'bin','goodnight.mjs'), node: 'C:\\Node\\node.exe', env: { USERNAME: 'Alice', LOCALAPPDATA: `${temp}\\Local` } };
  try {
    const calls = [];
    await installService({ ...options, commandRunner: async (file, args) => { calls.push(args); return { code: 0 }; } });
    assert.deepEqual(calls[0], ['/End', '/TN', SERVICE_ID]);
    assert.deepEqual(calls[1].slice(0, 4), ['/Create', '/TN', SERVICE_ID, '/XML']);
    assert.ok(calls[1][4].endsWith(`Local\\GoodNight\\${SERVICE_ID}.xml`));
    assert.deepEqual(calls[2], ['/Run', '/TN', SERVICE_ID]);
    await assert.rejects(installService({ ...options, commandRunner: async (_file,args) => ({ code: args[0]==='/End'?0:1 }) }), /failed with exit code 1/);
    await assert.rejects(uninstallService({ ...options, commandRunner: async (_file, args) => args[0] === '/End' ? { code: 5 } : { code: 0 } }), /permission denied/);
    await uninstallService({ ...options, commandRunner: async (_file, args) => args[0] === '/End' ? { code: 1 } : { code: 0 } });
    await assert.rejects(uninstallService({ ...options, commandRunner: async (_file, args) => args[0] === '/End' ? { code: 1 } : { code: 5 } }), /permission denied/);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test('macOS missing launch-agent is idempotent while bootstrap and permission failures remain visible', { skip: process.platform !== 'darwin' }, async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'goodnight-launchagent-'));
  const options = { platform: 'darwin', home: temp, dataDir: path.join(temp, 'data'), entrypoint: path.join(temp, 'bin', 'goodnight.mjs'), node: '/usr/bin/node', env: { UID: '502' } };
  try {
    const calls = [];
    await installService({ ...options, commandRunner: async (file, args) => {
      calls.push([file, args]);
      return { code: calls.length === 1 ? 3 : 0 };
    } });
    assert.deepEqual(calls.map(([, args]) => args[0]), ['bootout', 'bootstrap']);
    await assert.rejects(installService({ ...options, commandRunner: async (_file, args) => ({ code: args[0] === 'bootout' ? 5 : 0 }) }), /permission denied/);

    const stopAndDelete = [];
    const rendered = await installService({ ...options, apply: false });
    await uninstallService({ ...options, commandRunner: async (_file, args) => { stopAndDelete.push(args[0]); return { code: 3 }; } });
    assert.deepEqual(stopAndDelete, ['bootout']);
    await assert.rejects(stat(rendered.files[0].path), { code: 'ENOENT' });
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
