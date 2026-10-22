import { apiSucceeded } from '../policy.mjs';
import { locate } from '../location.mjs';
import { validateConfig } from '../config.mjs';
export const ORIGIN = 'https://jzsz.uestc.edu.cn';
export const CLIENT_SESSION_RETENTION_SECONDS = 7 * 24 * 3600;
export const PORTAL = `${ORIGIN}/#/hall/home`;
export const PAGE = `${ORIGIN}/daily-checkin-h5/index.html?appId=294#/pages/student/report-today/home/index`;
export class BusinessError extends Error { constructor(code) { super(code); this.code = code; } }
export function createUestcAdapter(ctx, config) {
  async function request(p, body) {
    let response;
    try { response = await ctx.request.fetch(ORIGIN + '/daily-checkin/api' + p, { method: body ? 'POST' : 'GET', data: body, headers: { platform: 'h5' }, timeout: 15000, maxRedirects: 0 }); }
    catch { throw new BusinessError('transport_error'); }
    if (response.status() !== 200) throw new BusinessError('http_error');
    let r; try { r = await response.json(); } catch { throw new BusinessError('invalid_api_response'); }
    if (!r || typeof r !== 'object' || Array.isArray(r) || !Number.isInteger(r.code) || (r.ok !== undefined && typeof r.ok !== 'boolean')) throw new BusinessError('invalid_api_response');
    if (r.code === 5000) throw new BusinessError('need_login');
    return r;
  }
  return {
    async authenticate() {
      const r = await request('/auth/user-info');
      if (!apiSucceeded(r) || !r.data) throw new BusinessError('auth_check_failed');
      const session = (await ctx.cookies(ORIGIN)).find(c => c.name === 'SESSION' && c.domain === new URL(ORIGIN).hostname);
      // Preserve validated credentials through a prolonged connection outage.
      // Client retention is NOT server-side reauthentication or guaranteed renewal.
      if (session) await ctx.addCookies([{ ...session, expires: Math.max(session.expires || 0, Math.floor(Date.now() / 1000) + CLIENT_SESSION_RETENTION_SECONDS) }]);
    },
    getToday: () => request('/student-checkin-record/today'),
    getSchedule: () => request('/checkin-schedule/effective'),
    getCheckinLocations: () => request('/checkin-location/available-locations'),
    submitCheckin: body => request('/student-checkin-record/checkin', body),
    async getUserAgent() { const page = ctx.pages()[0] || await ctx.newPage(); return page.evaluate(() => navigator.userAgent); },
    getFences: () => request('/campus-fence/current-student'),
    getKeywords: () => request('/case-keyword/active?locationTypeCode=' + config.locationType),
    submit: body => request('/student-checkin-record/report', body),
    async getLocation() {
      if (config.locationMode === 'virtual') return { ...validateConfig(config).virtualLocation };
      await ctx.grantPermissions(['geolocation'], { origin: ORIGIN });
      const page = await ctx.newPage();
      try {
        await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 45000 });
        return await locate(page);
      } catch { throw new BusinessError('location_unavailable_or_frontend_changed'); }
      finally { await page.close().catch(() => {}); }
    },
    async getAddress(geo) {
      try { const r = await request(`/map/reverse?lat=${geo.latitude}&lng=${geo.longitude}`); return apiSucceeded(r) && typeof r.data === 'string' ? r.data : ''; }
      catch (e) { if (e.code === 'need_login') throw e; return ''; }
    },
  };
}
