import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
export class Store {
  constructor(dataDir) {
    this.dir = path.resolve(dataDir);
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    if (process.platform !== 'win32') fs.chmodSync(this.dir, 0o700);
  }
  file(name) {
    if (!/^[\w.-]+$/.test(name)) throw new Error('invalid_state_filename');
    return path.join(this.dir, name);
  }
  read(name, fallback = null) {
    try { return JSON.parse(fs.readFileSync(this.file(name), 'utf8')); }
    catch (e) { if (e.code === 'ENOENT') return fallback; throw new Error('state_unreadable'); }
  }
  write(name, value) {
    const target = this.file(name), temp = target + '.' + crypto.randomUUID() + '.tmp';
    try { fs.writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' }); fs.renameSync(temp, target); }
    finally { try { fs.unlinkSync(temp); } catch {} }
  }
  acquire() {
    const target = this.file('run.lock');
    const token = crypto.randomUUID();
    for (let attempt = 0; attempt < 2; attempt++) {
      try { fs.writeFileSync(target, JSON.stringify({ pid: process.pid, token }), { flag: 'wx', mode: 0o600 });
        return () => { try { if (JSON.parse(fs.readFileSync(target, 'utf8')).token === token) fs.unlinkSync(target); } catch {} }; }
      catch (e) {
        if (e.code !== 'EEXIST') throw e;
        let owner; try { owner = JSON.parse(fs.readFileSync(target, 'utf8')); } catch { return null; }
        if (!Number.isInteger(owner.pid) || owner.pid <= 0) return null;
        try { process.kill(owner.pid, 0); return null; }
        catch (e) { if (e.code !== 'ESRCH') return null; try { fs.unlinkSync(target); } catch {} }
      }
    }
    return null;
  }
  claimSubmission(date, fingerprint, kind = 'report') {
    if (!['report', 'checkin'].includes(kind)) throw new Error('invalid_submission_kind');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('invalid_business_date');
    try { fs.writeFileSync(this.file(`submission-${kind}-${date}.json`), JSON.stringify({ businessDate: date, fingerprint, kind, state: 'attempted', at: new Date().toISOString() }), { flag: 'wx', mode: 0o600 }); return true; }
    catch (e) { if (e.code === 'EEXIST') return false; throw e; }
  }
  log(event, detail = {}) {
    // Only call with sanitized status metadata, never API bodies/credentials/coordinates.
    const line = JSON.stringify({ at: new Date().toISOString(), event, ...detail });
    const folder = path.join(this.dir, 'logs'); fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
    const date = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
    const file = path.join(folder, `${date}.jsonl`);
    fs.appendFileSync(file, line + '\n', { mode: 0o600 });
    if (process.platform !== 'win32') fs.chmodSync(file, 0o600);
  }
}
