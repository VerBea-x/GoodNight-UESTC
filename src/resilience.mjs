import { spawn } from 'node:child_process';
import { shanghaiDate } from './policy.mjs';

const FAILURE_RESULTS = new Set(['unknown','need_login','location_fail','report_rejected','checkin_rejected','window_missed']);
const NEUTRAL_RESULTS = new Set(['window_not_open','already_running']);
const VALID_PHASES = new Set(['preflight','session','daily','report','checkin','recovery']);
const FAILURE_PRIORITY = ['daily','report','checkin','recovery','preflight','session'];
const slug = (value) => typeof value === 'string' && /^[a-z0-9_]{1,80}$/.test(value) ? value : 'execution_failed';
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);

function timeOnDate(date, hhmm) {
  if (!validDate(date) || typeof hhmm !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(hhmm)) return NaN;
  return Date.parse(`${date}T${hhmm}:00+08:00`);
}
function minutes(value, fallback) { return Number.isFinite(value) && value >= 0 && value <= 1440 ? value : fallback; }

/** True once daily during the configured preflight interval. */
export function preflightDue(config = {}, state = {}, now = new Date()) {
  const date = shanghaiDate(now), report = timeOnDate(date, config.reportTime);
  if (!Number.isFinite(report) || state.lastPreflightDate === date) return false;
  const lead = minutes(config.preflightLeadMinutes, 20), t = now.getTime();
  return t >= report - lead * 60000 && t < report;
}

/** True for bounded same-day recovery attempts, with cross-midnight stamps ignored. */
export function recoveryDue(config = {}, state = {}, now = new Date()) {
  const date = shanghaiDate(now), report = timeOnDate(date, config.reportTime);
  const cutoff = timeOnDate(date, config.recoveryCutoff ?? '23:55');
  const t = now.getTime();
  if (!Number.isFinite(report) || !Number.isFinite(cutoff) || t < report || t >= cutoff || state.completionDate === date) return false;
  const interval = minutes(config.recoveryIntervalMinutes, 10) * 60000;
  const stamps = [state.lastAttemptAt, state.lastRecoveryAt]
    .map(value => typeof value === 'string' ? Date.parse(value) : NaN)
    .filter(value => Number.isFinite(value) && shanghaiDate(new Date(value)) === date);
  if (stamps.some(value => value > t)) return false;
  return stamps.length === 0 || t - Math.max(...stamps) >= interval;
}

function safeRecord(out, phase, now) {
  const result = slug(out?.result);
  const reason = slug(out?.reason);
  return { result, reason, date: shanghaiDate(now), phase: VALID_PHASES.has(phase) ? phase : 'recovery', timestamp: now.toISOString() };
}
function read(store, name) { try { return store.read(name, null); } catch { return undefined; } }
function safeLog(store, event, detail) { try { store.log(event, detail); } catch {} }

/** Persist only allowlisted status fields, resolve today's matching failures, and alert once per phase/day. */
export async function recordOutcome(options) {
  const { store, out, phase, now = new Date() } = options || {};
  try { return await recordOutcomeInner(options); }
  catch {
    const safePhase = VALID_PHASES.has(phase) ? phase : 'recovery';
    const safeResult = slug(out?.result);
    safeLog(store, 'failure_state_write_failed', { phase: safePhase, result: safeResult });
    try { return safeRecord(out, phase, now); }
    catch { return { result: safeResult, reason: slug(out?.reason), date: '', phase: safePhase, timestamp: '' }; }
  }
}

async function recordOutcomeInner({ store, out, phase, now = new Date(), notify = notifyFailure, notifications = true }) {
  if (!store?.write) return;
  const record = safeRecord(out, phase, now);
  const failure = FAILURE_RESULTS.has(record.result);
  const neutral = NEUTRAL_RESULTS.has(record.result);
  if (failure) {
    store.write(phaseFailureName(record.date, record.phase), record);
    refreshFailureSummary(store, record.date, record.timestamp);
  } else if (['done','success','already_done'].includes(record.result)) {
    resolveFailure(store, record.date, null, record.timestamp);
  } else if (record.result === 'session_valid') {
    resolveFailure(store, record.date, 'session', record.timestamp);
  } else if (record.result === 'preflight_ready') {
    resolveFailure(store, record.date, 'preflight', record.timestamp);
  }
  if (!failure || neutral || !notifications || typeof notify !== 'function') return record;
  const state = read(store, 'notification-state.json');
  if (state === undefined) { safeLog(store, 'notification_state_unreadable', { phase: record.phase }); return record; }
  const dedupe = state && typeof state === 'object' && !Array.isArray(state) ? state : {};
  if (dedupe[record.phase] === record.date) return record;
  const next = { ...dedupe, [record.phase]: record.date };
  try { store.write('notification-state.json', next); }
  catch (error) { safeLog(store, 'notification_state_write_failed', { phase: record.phase }); return record; }
  try { await notify({ phase: record.phase, result: record.result }); }
  catch { safeLog(store, 'notification_failed', { phase: record.phase, result: record.result }); }
  return record;
}

function resolveFailure(store, date, phase, timestamp) {
  for (const name of [...FAILURE_PRIORITY.map(item => phaseFailureName(date, item)), `failure-${date}.json`]) {
    const prior = read(store, name);
    if (prior === undefined || !prior || prior.date !== date || !FAILURE_RESULTS.has(prior.result) || (phase && prior.phase !== phase)) continue;
    store.write(name === `failure-${date}.json` ? phaseFailureName(date, prior.phase) : name,
      { result: 'resolved', reason: 'completed', date, phase: prior.phase, timestamp });
  }
  refreshFailureSummary(store, date, timestamp);
}

function phaseFailureName(date, phase) { return `failure-${date}-${phase}.json`; }
function refreshFailureSummary(store, date, timestamp) {
  const unresolved = [];
  let phaseRecordExists = false;
  let unreadable = false;
  for (const phase of FAILURE_PRIORITY) {
    const item = read(store, phaseFailureName(date, phase));
    if (item === undefined) { unreadable = true; continue; }
    if (item && item.date === date) phaseRecordExists = true;
    if (item && item.date === date && FAILURE_RESULTS.has(item.result)) unresolved.push(item);
  }
  // Migrate a prior flat record when there are no phase records yet.
  let prior = null;
  if (!phaseRecordExists) {
    prior = read(store, `failure-${date}.json`);
    if (prior === undefined) unreadable = true;
    if (prior && prior.date === date && FAILURE_RESULTS.has(prior.result)) unresolved.push(prior);
  }
  if (unreadable) {
    safeLog(store, 'failure_state_unreadable', { date });
    return;
  }
  // A quiet day must not replace a previous date's unresolved last-failure record.
  if (!phaseRecordExists && !prior) return;
  const chosen = unresolved[0] || { result: 'resolved', reason: 'completed', date, phase: 'daily', timestamp };
  store.write(`failure-${date}.json`, chosen);
  const index = read(store, 'failure-index.json');
  if (index === undefined || (index !== null && (!Array.isArray(index) || index.some(item => !validDate(item))))) {
    safeLog(store, 'failure_index_unreadable', { date });
    return;
  }
  const previousLatest = read(store, 'last-failure.json');
  if (previousLatest === undefined) {
    safeLog(store, 'failure_state_unreadable', { date });
    return;
  }
  const legacyDates = previousLatest?.date !== date && validDate(previousLatest?.date) && FAILURE_RESULTS.has(previousLatest?.result)
    ? [previousLatest.date] : [];
  const dates = [...new Set([...(index || []), ...legacyDates, date])].sort();
  store.write('failure-index.json', dates);
  let latestUnresolved = null;
  for (const knownDate of [...dates].sort().reverse()) {
    const summary = knownDate === date ? chosen : read(store, `failure-${knownDate}.json`);
    if (summary === undefined) {
      safeLog(store, 'failure_state_unreadable', { date: knownDate });
      return;
    }
    if (summary?.date === knownDate && FAILURE_RESULTS.has(summary.result)) { latestUnresolved = summary; break; }
  }
  store.write('last-failure.json', latestUnresolved || chosen);
}

function notificationMessage(payload) {
  const phase = VALID_PHASES.has(payload?.phase) ? payload.phase : 'recovery';
  const result = FAILURE_RESULTS.has(payload?.result) ? payload.result : 'execution_failed';
  return `GoodNight ${phase}: ${result}. Check GoodNight status.`;
}

function defaultRunner(file, args) {
  return new Promise((resolve, reject) => {
    let child;
    try { child = spawn(file, args, { shell: false, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore'] }); }
    catch { reject(new Error('notification_runner_failed')); return; }
    let settled = false;
    const timer = setTimeout(() => { try { child.kill(); } catch {} finish(new Error('notification_timeout')); }, 8000);
    function finish(error) { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(); }
    child.once('error', () => finish(new Error('notification_runner_failed')));
    child.once('exit', code => code === 0 ? finish() : finish(new Error('notification_runner_failed')));
  });
}

/** Best-effort local desktop alert. All user-controlled text is passed as argv data. */
export async function notifyFailure(payload, { platform = process.platform, runner = defaultRunner } = {}) {
  if (typeof runner !== 'function') throw new Error('notification_runner_failed');
  const message = notificationMessage(payload);
  if (platform === 'darwin') {
    await runner('/usr/bin/osascript', ['-e', 'on run argv\n display notification (item 1 of argv) with title "GoodNight"\nend run', '--', message]);
    return;
  }
  if (platform === 'linux') {
    await runner('/usr/bin/notify-send', ['GoodNight', message]);
    return;
  }
  if (platform === 'win32') {
    const script = `$shell = New-Object -ComObject WScript.Shell; $null = $shell.Popup('${message.replaceAll("'", "''")}', 5, 'GoodNight', 0)`;
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    await runner('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded]);
    return;
  }
  throw new Error('notification_platform_unsupported');
}
