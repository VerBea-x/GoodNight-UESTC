import os from 'node:os';
import path from 'node:path';
import { Store } from './store.mjs';
export const DEFAULT_REASON = '在校外旅游会注意自己安全，导员放心';
export const DEFAULTS = Object.freeze({ version: 1, remark: DEFAULT_REASON, keyword: '旅游', locationType: 'OUTSIDE', reportTime: '22:30', sessionIntervalMinutes: 10, catchUpMinutes: 30, browserChannel: 'chrome', headless: true, frontendLocationExport: 'auto', maxAccuracyMeters: 200, preflightLeadMinutes: 20, recoveryIntervalMinutes: 10, recoveryCutoff: '23:55', notifications: true, locationMode: 'real', virtualLocation: null });
export function defaultDataDir({ platform = process.platform, home = os.homedir(), env = process.env } = {}) {
  const paths=platform==='win32'?path.win32:path.posix;
  if (env.GOODNIGHT_HOME) return paths.resolve(env.GOODNIGHT_HOME);
  if (platform === 'darwin') return paths.join(home, 'Library', 'Application Support', 'GoodNight');
  if (platform === 'win32') return path.win32.join(env.LOCALAPPDATA || path.win32.join(home, 'AppData', 'Local'), 'GoodNight');
  return paths.join(env.XDG_STATE_HOME || paths.join(home, '.local', 'state'), 'goodnight');
}
export function validateConfig(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('配置必须是 JSON 对象');
  if (Object.keys(input).some(k => !Object.hasOwn(DEFAULTS, k))) throw new Error('配置包含未知字段，请参考 config.example.json');
  const c = { ...DEFAULTS, ...input };
  if (typeof c.remark === 'string' && !c.remark.trim()) c.remark = DEFAULT_REASON;
  if (c.version !== 1) throw new Error('不支持的配置版本');
  if (typeof c.remark !== 'string' || c.remark.trim().length < 10 || c.remark.length > 200 || c.remark.includes('\0')) throw new Error('请填写本人真实说明：10–200字');
  if (typeof c.keyword !== 'string' || !c.keyword.trim() || c.keyword.length > 200 || /[\0\r\n]/.test(c.keyword)) throw new Error('情况类别无效');
  if (!['OUTSIDE', 'CAMPUS'].includes(c.locationType)) throw new Error('locationType 必须是 OUTSIDE 或 CAMPUS');
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(c.reportTime)) throw new Error('时间必须是 HH:mm（上海时间）');
  if (!Number.isInteger(c.sessionIntervalMinutes) || c.sessionIntervalMinutes < 1 || c.sessionIntervalMinutes > 30) throw new Error('会话检查间隔必须为1–30分钟');
  if (!Number.isInteger(c.catchUpMinutes) || c.catchUpMinutes < 1 || c.catchUpMinutes > 120) throw new Error('补执行窗口必须为1–120分钟');
  if (!Number.isInteger(c.preflightLeadMinutes) || c.preflightLeadMinutes < 1 || c.preflightLeadMinutes > 120) throw new Error('预检提前量必须为1–120分钟');
  if (!Number.isInteger(c.recoveryIntervalMinutes) || c.recoveryIntervalMinutes < 1 || c.recoveryIntervalMinutes > 30) throw new Error('补执行检查间隔必须为1–30分钟');
  if (typeof c.recoveryCutoff !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(c.recoveryCutoff) || c.recoveryCutoff > '23:55' || c.recoveryCutoff <= c.reportTime) throw new Error('补执行截止须晚于每日时间且不晚于23:55');
  if (typeof c.notifications !== 'boolean') throw new Error('notifications 必须是布尔值');
  if (!['chrome', 'msedge', 'chromium'].includes(c.browserChannel)) throw new Error('浏览器必须为 chrome、msedge 或 chromium');
  if (typeof c.headless !== 'boolean') throw new Error('headless 必须是布尔值');
  if (typeof c.frontendLocationExport !== 'string' || !/^[\w$]{1,80}$/.test(c.frontendLocationExport)) throw new Error('定位导出名无效');
  if (!Number.isFinite(c.maxAccuracyMeters) || c.maxAccuracyMeters < 1 || c.maxAccuracyMeters > 5000) throw new Error('最大定位误差必须为1–5000米');
  if (!['real', 'virtual'].includes(c.locationMode)) throw new Error('locationMode 必须是 real 或 virtual');
  if (c.virtualLocation !== null) {
    const p = c.virtualLocation;
    if (!p || typeof p !== 'object' || Array.isArray(p) || Object.keys(p).some(k => !['latitude', 'longitude', 'accuracy'].includes(k)) ||
        ![p.latitude, p.longitude, p.accuracy].every(Number.isFinite) || Math.abs(p.latitude) > 90 || Math.abs(p.longitude) > 180 || p.accuracy < 0 || p.accuracy > c.maxAccuracyMeters) {
      throw new Error('虚拟位置须包含有效 GCJ-02 经纬度及不超过 maxAccuracyMeters 的非负精度');
    }
    c.virtualLocation = { latitude: p.latitude, longitude: p.longitude, accuracy: p.accuracy };
  }
  if (c.locationMode === 'virtual' && !c.virtualLocation) throw new Error('虚拟定位模式需要设置 virtualLocation');
  return c;
}
export function loadConfig(dataDir) {
  let input;
  try { input = new Store(dataDir).read('config.json'); }
  catch (e) { if (e.code === 'ENOENT') throw new Error('尚未配置，请先运行 init'); throw new Error('无法读取 config.json，请检查 JSON 格式和权限'); }
  return validateConfig(input);
}
