import { findStudentModule, resolveLocationBinding } from './frontend-contract.mjs';

const ORIGIN = 'https://jzsz.uestc.edu.cn';
const contractError = () => new Error('frontend_location_contract_changed');
function entryAddress(value) {
  let url;
  try { url = new URL(value); } catch { throw contractError(); }
  if (url.origin !== ORIGIN || url.username || url.password || url.search || url.hash ||
      !/^\/daily-checkin-h5\/assets\/index-[\w-]+\.js$/.test(url.pathname)) throw contractError();
  return url.href;
}
async function readSource(page, url, limit) {
  const response = await page.context().request.get(url, { timeout: 15000, maxRedirects: 0 });
  try {
    if (response.status() !== 200 || response.url() !== url) throw contractError();
    const content = await response.text();
    if (Buffer.byteLength(content, 'utf8') > limit) throw contractError();
    return content;
  } finally { await response.dispose(); }
}

// Serialized into the existing school page; no coordinates are supplied by this client.
export async function invokeLocation({ binding, timeoutMs }) {
  if (globalThis.location?.origin !== 'https://jzsz.uestc.edu.cn' ||
      globalThis.location?.pathname !== '/daily-checkin-h5/index.html') throw new Error('frontend_location_contract_changed');
  let locate;
  if (!binding) locate = globalThis.uni?.getLocation?.bind(globalThis.uni);
  else locate = (await import(binding.entryUrl))[binding.exportName];
  if (typeof locate !== 'function') throw new Error('frontend_location_contract_changed');
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('location_timeout')), timeoutMs);
    const fail = () => { clearTimeout(timer); reject(new Error('location_failed')); };
    try {
      locate({ type: 'gcj02', isHighAccuracy: true, accuracy: 'best', highAccuracyExpireTime: 60000,
        success: value => {
          try {
            const { latitude, longitude, accuracy } = value || {};
            if (![latitude, longitude, accuracy].every(Number.isFinite) ||
                Math.abs(latitude) > 90 || Math.abs(longitude) > 180 || accuracy < 0) return fail();
            clearTimeout(timer);resolve({ latitude, longitude, accuracy });
          } catch { fail(); }
        }, fail });
    } catch { fail(); }
  });
}

export async function locate(page, { fetchSource = (url, limit) => readSource(page, url, limit), timeoutMs = 75000 } = {}) {
  let landing;
  try { landing = new URL(page.url()); } catch { throw contractError(); }
  if (landing.origin !== ORIGIN || landing.username || landing.password ||
      landing.pathname !== '/daily-checkin-h5/index.html') throw contractError();
  let binding = null;
  if (!await page.evaluate(() => typeof globalThis.uni?.getLocation === 'function')) {
    const entryUrl = entryAddress(await page.evaluate(() => {
      const entries = [...document.querySelectorAll('script[type="module"][src]')]
        .map(x => x.src).filter(x => /\/assets\/index-/.test(x));
      return entries.length === 1 ? entries[0] : null;
    }));
    const entrySource = await fetchSource(entryUrl, 2 * 1024 * 1024);
    const studentUrl = findStudentModule({ entryUrl, entrySource, origin: ORIGIN });
    const studentSource = await fetchSource(studentUrl, 256 * 1024);
    binding = resolveLocationBinding({ entryUrl, entrySource, studentUrl, studentSource, origin: ORIGIN });
  }
  return page.evaluate(invokeLocation, { binding, timeoutMs });
}
