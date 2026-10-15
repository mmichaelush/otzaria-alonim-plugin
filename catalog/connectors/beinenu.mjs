// beinenu.com/alonim: Cloudflare answers automated requests with 403.
// This is a link-only source and the 403 is final: no challenge solving, no
// header tricks, no headless browser. The probe makes one polite request (plus
// robots.txt through the shared client) and records the outcome.
import { HostBlockedError, HttpError } from '../lib/http.mjs';

export const id = 'beinenu';
export const name = 'בינינו';
export const url = 'https://beinenu.com/alonim/';
export const mode = 'link';

const BLOCKED_NOTE = 'האתר מגביל גישה אוטומטית; הקישור פותח את האתר';

export async function probe({ http }) {
  try {
    await http.getText(url, { accept: 'text/html' });
    // Reachable now, but there is no parser: stay a link and keep it simple.
    return { status: 'ok', note: 'הקישור פותח את האתר' };
  } catch (e) {
    if (e instanceof HostBlockedError || (e instanceof HttpError && [403, 429, 503].includes(e.status))) {
      return { status: 'blocked', note: BLOCKED_NOTE };
    }
    return { status: 'down', note: 'האתר אינו זמין כרגע; הקישור פותח את האתר' };
  }
}

// Link-only: never yields records.
export async function* crawl() {}
