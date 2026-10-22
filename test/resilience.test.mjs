import test from 'node:test';
import assert from 'node:assert/strict';
import { preflightDue, recoveryDue, recordOutcome, notifyFailure, notifyReview } from '../src/resilience.mjs';

const at = value => new Date(value);
const config = { reportTime: '20:30', preflightLeadMinutes: 20, recoveryIntervalMinutes: 10, recoveryCutoff: '23:55' };

test('preflight is bounded to one Shanghai-day interval and checks the daily marker', () => {
  assert.equal(preflightDue(config, {}, at('2026-10-12T12:09:00Z')), false); // 20:09 Shanghai
  assert.equal(preflightDue(config, {}, at('2026-10-12T12:15:00Z')), true);
  assert.equal(preflightDue(config, {}, at('2026-10-12T12:30:00Z')), false);
  assert.equal(preflightDue(config, { lastPreflightDate: '2026-10-12' }, at('2026-10-12T12:15:00Z')), false);
});

test('recovery honors same-day cadence, cutoff, completion, and ignores cross-day or future stamps', () => {
  const now = at('2026-10-12T13:00:00Z'); // 21:00 Shanghai
  assert.equal(recoveryDue(config, {}, now), true);
  assert.equal(recoveryDue(config, { lastAttemptAt: '2026-10-12T12:55:00Z' }, now), false);
  assert.equal(recoveryDue(config, { lastAttemptAt: '2026-10-12T12:50:00Z' }, now), true);
  assert.equal(recoveryDue(config, { lastRecoveryAt: '2026-10-11T14:00:00Z' }, now), true);
  assert.equal(recoveryDue(config, { lastAttemptAt: '2026-10-12T13:01:00Z' }, now), false);
  assert.equal(recoveryDue(config, { completionDate: '2026-10-12' }, now), false);
  assert.equal(recoveryDue(config, {}, at('2026-10-12T15:55:00Z')), false); // 23:55 exclusive
  assert.equal(recoveryDue(config, {}, at('2026-10-12T11:00:00Z')), false);
});

function fakeStore() {
  const files = new Map(), logs = [];
  return { files, logs, read: (name, fallback) => files.has(name) ? structuredClone(files.get(name)) : fallback,
    write: (name, value) => files.set(name, structuredClone(value)), log: (event, detail) => logs.push({ event, detail }) };
}

test('failure writes are allowlisted, alerts dedupe daily by phase, and success resolves only its date', async () => {
  const store = fakeStore(), alerts = [];
  const now = at('2026-10-12T12:00:00Z');
  const notify = async value => alerts.push(value);
  await recordOutcome({ store, phase: 'report', now, notify, out: { result: 'report_rejected', reason: 'bad_window', secret: 'never-write-me' } });
  await recordOutcome({ store, phase: 'report', now, notify, out: { result: 'report_rejected', reason: 'changed' } });
  assert.equal(alerts.length, 1);
  assert.deepEqual(Object.keys(store.files.get('failure-2026-10-12.json')).sort(), ['date','phase','reason','result','timestamp']);
  assert.equal(JSON.stringify([...store.files.values()]).includes('never-write-me'), false);
  await recordOutcome({ store, phase: 'report', now: at('2026-10-12T12:05:00Z'), notify, out: { result: 'already_done' } });
  assert.equal(store.files.get('failure-2026-10-12.json').result, 'resolved');
  assert.equal(store.files.get('last-failure.json').result, 'resolved');
  assert.equal(store.files.get('failure-2026-10-12.json').date, '2026-10-12');
  await recordOutcome({ store, phase: 'report', now: at('2026-10-13T12:00:00Z'), notify, out: { result: 'report_rejected' } });
  await recordOutcome({ store, phase: 'report', now: at('2026-10-14T12:00:00Z'), notify, out: { result: 'already_done' } });
  assert.equal(store.files.get('failure-2026-10-13.json').result, 'report_rejected');
});

test('phase-specific success does not resolve unrelated failures and neutral outcomes do not alert', async () => {
  const store = fakeStore(), alerts = [];
  const now = at('2026-10-12T12:00:00Z'), notify = async x => alerts.push(x);
  await recordOutcome({ store, phase: 'report', now, notify, out: { result: 'report_rejected' } });
  await recordOutcome({ store, phase: 'session', now, notify, out: { result: 'session_valid' } });
  assert.equal(store.files.get('failure-2026-10-12.json').result, 'report_rejected');
  await recordOutcome({ store, phase: 'checkin', now, notify, out: { result: 'window_not_open' } });
  assert.equal(alerts.length, 1);
});

test('session recovery preserves an outstanding daily failure and summary priority', async () => {
  const store = fakeStore(), now = at('2026-10-12T12:00:00Z'), notify = async () => {};
  await recordOutcome({ store, phase: 'daily', now, notify, out: { result: 'report_rejected' } });
  await recordOutcome({ store, phase: 'session', now, notify, out: { result: 'need_login' } });
  await recordOutcome({ store, phase: 'session', now, notify, out: { result: 'session_valid' } });
  assert.equal(store.files.get('failure-2026-10-12-session.json').result, 'resolved');
  assert.equal(store.files.get('failure-2026-10-12-daily.json').result, 'report_rejected');
  assert.equal(store.files.get('failure-2026-10-12.json').phase, 'daily');
  assert.equal(store.files.get('last-failure.json').phase, 'daily');
});

test('quiet next-day success preserves yesterday failure summary and archive', async () => {
  const store = fakeStore(), notify = async () => {};
  const day12 = at('2026-10-12T12:00:00Z');
  await recordOutcome({ store, phase: 'daily', now: day12, notify, out: { result: 'report_rejected' } });
  const archive = structuredClone(store.files.get('failure-2026-10-12.json'));
  const latest = structuredClone(store.files.get('last-failure.json'));
  await recordOutcome({ store, phase: 'session', now: at('2026-10-13T04:00:00Z'), notify, out: { result: 'session_valid' } });
  await recordOutcome({ store, phase: 'daily', now: at('2026-10-13T12:00:00Z'), notify, out: { result: 'already_done' } });
  assert.deepEqual(store.files.get('failure-2026-10-12.json'), archive);
  assert.deepEqual(store.files.get('last-failure.json'), latest);
  assert.equal(store.files.has('failure-2026-10-13.json'), false);
});

test('date index restores older unresolved failures after newer phase and daily resolutions', async () => {
  const store = fakeStore(), notify = async () => {};
  await recordOutcome({ store, phase: 'daily', now: at('2026-10-12T12:00:00Z'), notify, out: { result: 'report_rejected' } });
  await recordOutcome({ store, phase: 'session', now: at('2026-10-13T04:00:00Z'), notify, out: { result: 'need_login' } });
  await recordOutcome({ store, phase: 'session', now: at('2026-10-13T04:01:00Z'), notify, out: { result: 'session_valid' } });
  assert.equal(store.files.get('last-failure.json').date, '2026-10-12');
  assert.equal(store.files.get('last-failure.json').phase, 'daily');
  await recordOutcome({ store, phase: 'daily', now: at('2026-10-13T12:00:00Z'), notify, out: { result: 'window_missed' } });
  await recordOutcome({ store, phase: 'daily', now: at('2026-10-13T12:01:00Z'), notify, out: { result: 'already_done' } });
  assert.equal(store.files.get('failure-2026-10-13.json').result, 'resolved');
  assert.equal(store.files.get('last-failure.json').date, '2026-10-12');
  assert.deepEqual(store.files.get('failure-index.json'), ['2026-10-12','2026-10-13']);
  assert.equal(JSON.stringify(store.files.get('failure-index.json')).includes('report_rejected'), false);
});

test('notification failures are swallowed and unreadable dedupe state fails closed', async () => {
  const store = fakeStore(), now = at('2026-10-12T12:00:00Z');
  let notifications = 0;
  await recordOutcome({ store, phase: 'daily', now, notify: async () => { notifications++; throw Error('raw secret'); }, out: { result: 'unknown' } });
  assert.equal(notifications, 1);
  assert.equal(store.logs.at(-1).event, 'notification_failed');
  const unreadable = { ...fakeStore(), read: () => { throw Error('bad json'); } };
  await recordOutcome({ store: unreadable, phase: 'daily', now, notify: async () => { notifications++; }, out: { result: 'unknown' } });
  assert.equal(notifications, 1);
  assert.equal(unreadable.logs.at(-1).event, 'notification_state_unreadable');
});

test('bookkeeping write failures are swallowed before alert and later outcomes still resolve records', async () => {
  const store = fakeStore(), originalWrite = store.write;
  let failDaily = true, notifications = 0;
  store.write = (name, value) => {
    if (failDaily && name === 'failure-2026-10-12-daily.json') { failDaily = false; throw Error('sensitive filesystem detail'); }
    originalWrite(name, value);
  };
  const notify = async () => { notifications++; };
  const failed = await recordOutcome({ store, phase: 'daily', now: at('2026-10-12T12:00:00Z'), notify, out: { result: 'unknown', reason: 'secret_reason' } });
  assert.equal(failed.result, 'unknown');
  assert.equal(notifications, 0);
  assert.deepEqual(store.logs.at(-1), { event: 'failure_state_write_failed', detail: { phase: 'daily', result: 'unknown' } });
  await recordOutcome({ store, phase: 'recovery', now: at('2026-10-12T12:01:00Z'), notify, out: { result: 'report_rejected' } });
  await recordOutcome({ store, phase: 'daily', now: at('2026-10-12T12:02:00Z'), notify, out: { result: 'already_done' } });
  assert.equal(store.files.get('failure-2026-10-12-recovery.json').result, 'resolved');
  assert.equal(notifications, 1);
  assert.equal(JSON.stringify(store.logs).includes('sensitive filesystem detail'), false);
  assert.equal(JSON.stringify(store.logs).includes('secret_reason'), false);
});

test('notification platform commands keep message data in argv and reject unknown platforms', async () => {
  for (const platform of ['darwin','linux','win32']) {
    let captured;
    await notifyFailure({ phase: 'report', result: 'report_rejected', reason: 'ignored; touch /tmp/no' }, {
      platform, runner: async (file, args) => { captured = { file, args }; }
    });
    if (platform === 'win32') {
      const decoded = Buffer.from(captured.args[captured.args.indexOf('-EncodedCommand') + 1], 'base64').toString('utf16le');
      assert.ok(decoded.includes('report_rejected'));
      assert.equal(decoded.includes('touch /tmp/no'), false);
    } else {
      assert.ok(captured.args.some(arg => arg.includes('report_rejected')));
      assert.equal(captured.args.some(arg => arg.includes('touch /tmp/no')), false);
    }
    assert.equal(captured.file.includes('touch'), false);
    if (platform === 'darwin') assert.ok(captured.args.includes('--'));
    if (platform === 'win32') {
      const script = Buffer.from(captured.args[captured.args.indexOf('-EncodedCommand') + 1], 'base64').toString('utf16le');
      assert.ok(script.includes("Popup('晚安成电运行需要检查（report: report_rejected）。请打开本机工作台核对学校记录。', 5"));
      assert.equal(script.includes('touch /tmp/no'), false);
    }
  }
  await assert.rejects(notifyFailure({}, { platform: 'plan9', runner: async () => {} }), /notification_platform_unsupported/);
});

test('successful daily result can prompt a local record review', async () => {
  let encoded;
  await notifyReview({platform:'win32',runner:async (_file,args)=>{encoded=args[args.indexOf('-EncodedCommand')+1];}});
  const script=Buffer.from(encoded,'base64').toString('utf16le');
  assert.match(script,/请打开本机工作台，核对学校保存的记录/);
});
