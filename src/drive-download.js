import { driveDownloadId } from './drive.js';
import { boundedText } from './network.js';

const fail = message => Object.assign(new Error(message), { code: 'DRIVE_DOWNLOAD' });
export const DRIVE_SCAN_NOTICE = 'Google Drive cannot scan this large file for viruses. Download only if you trust its source.';

// A large original may take many minutes. Bound stalled headers/body reads,
// rather than aborting a healthy transfer after a fixed total duration.
async function fetchWithIdleTimeout(url, options, fetcher, timeoutMs) {
  const timeout = new AbortController();
  const signal = AbortSignal.any([timeout.signal, ...(options?.signal ? [options.signal] : [])]);
  let timer;
  const arm = () => { timer = setTimeout(() => timeout.abort(new DOMException('Google Drive download timed out.', 'TimeoutError')), timeoutMs); };
  arm();
  let response;
  try { response = await fetcher(url, { ...options, signal }); }
  finally { clearTimeout(timer); }
  if (!response.body) return response;
  const reader = response.body.getReader();
  const body = new ReadableStream({
    async pull(controller) {
      arm();
      try {
        const { done, value } = await reader.read();
        if (done) controller.close(); else controller.enqueue(value);
      } catch (error) { controller.error(error); }
      finally { clearTimeout(timer); }
    },
    cancel(reason) { clearTimeout(timer); timeout.abort(reason); return reader.cancel(reason); },
  });
  const wrapped = new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
  Object.defineProperties(wrapped, { url: { value: response.url }, redirected: { value: response.redirected } });
  return wrapped;
}

export function driveConfirmation(text, responseUrl, originalUrl, Parser = globalThis.DOMParser) {
  const id = driveDownloadId(originalUrl);
  if (!id || driveDownloadId(responseUrl) !== id) throw fail('Open this file in Google Drive and sign in to the account that can download it, then rescan.');
  const doc = new Parser().parseFromString(text, 'text/html');
  const form = doc.getElementById('download-form');
  const words = doc.documentElement?.textContent || '';
  if (/infected with a virus|identified as (?:malware|abuse)|violat(?:es|ion).*terms|abusive content/i.test(words)) throw fail('Google Drive flagged this file. Review its warning in Drive before downloading.');
  if (!form || form.tagName.toLowerCase() !== 'form' || (form.getAttribute('method') || 'get').toLowerCase() !== 'get' || !/too large[\s\S]{0,200}scan|can(?:not|'t|’t) scan this file for viruses/i.test(words)) throw fail('Google Drive did not provide a downloadable file. Check its download permission or download limit in Drive, then try again.');
  const action = new URL(form.getAttribute('action') || responseUrl, responseUrl);
  if (action.protocol !== 'https:' || action.hostname !== 'drive.usercontent.google.com' || !/^\/(?:u\/\d+\/)?(?:download|uc)$/.test(action.pathname) || action.username || action.password) throw fail('Google Drive returned an unsupported download confirmation. Open the file in Drive and try again.');
  const allowed = new Set(['id', 'export', 'confirm', 'uuid', 'at', 'authuser', 'resourcekey']);
  const seen = new Set();
  const inputs = Array.from(form.getElementsByTagName('input'));
  if (inputs.length > 16) throw fail('Complete the download confirmation in Google Drive, then try again.');
  for (const input of inputs) {
    const name = input.getAttribute('name');
    if (!name) continue;
    const value = input.getAttribute('value') || '';
    if (!allowed.has(name) || seen.has(name) || input.getAttribute('type')?.toLowerCase() !== 'hidden' || value.length > 2000 || /[\x00-\x1f]/.test(value)) throw fail('Complete the download confirmation in Google Drive, then try again.');
    seen.add(name); action.searchParams.set(name, value);
  }
  const original = new URL(originalUrl);
  for (const name of ['resourcekey', 'authuser']) if (!action.searchParams.has(name) && original.searchParams.has(name)) action.searchParams.set(name, original.searchParams.get(name));
  const account = original.pathname.match(/^\/u\/(\d+)\//)?.[1];
  if (account && !action.searchParams.has('authuser')) action.searchParams.set('authuser', account);
  if (driveDownloadId(action.href) !== id || !action.searchParams.get('confirm') || [...action.searchParams.keys()].some(name => !allowed.has(name))) throw fail('Google Drive returned a confirmation for a different or unsupported file. Open the file in Drive and try again.');
  return action.href;
}

export async function fetchDriveDownload(url, options, fetcher = globalThis.fetch, Parser = globalThis.DOMParser, timeoutMs = 90000) {
  if (!driveDownloadId(url)) throw fail('This is not a Google Drive file download.');
  let next = url; let notice = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetchWithIdleTimeout(next, { ...options, credentials: 'include' }, fetcher, timeoutMs);
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw fail('Google Drive refused this download. Check that your signed-in account has download access and that the file has not reached its download limit.');
    }
    const type = response.headers.get('content-type') || '';
    if (/^(?:video|audio)\/|^application\/octet-stream(?:;|$)/i.test(type)) {
      const final = new URL(response.url || next);
      if (final.protocol !== 'https:' || !['drive.google.com', 'drive.usercontent.google.com'].includes(final.hostname) && !/(^|\.)googleusercontent\.com$/.test(final.hostname)) { await response.body?.cancel().catch(() => {}); throw fail('Google Drive redirected to an unsupported download host.'); }
      if (response.status === 206 && !new Headers(options?.headers).has('range')) { await response.body?.cancel().catch(() => {}); throw fail('Google Drive returned only part of the file. Try the download again.'); }
      return { response, url: next, notice };
    }
    if (!/text\/html/i.test(type)) { await response.body?.cancel().catch(() => {}); throw fail('Google Drive returned an unexpected response instead of the media file.'); }
    if (attempt) { await response.body?.cancel().catch(() => {}); throw fail('Google Drive still requires confirmation. Open the file in Drive, complete its download prompt, then try again.'); }
    if (driveDownloadId(response.url || next) !== driveDownloadId(url)) { await response.body?.cancel().catch(() => {}); throw fail('Open this file in Google Drive and sign in to the account that can download it, then rescan.'); }
    const text = await boundedText(response, 256000);
    next = driveConfirmation(text, response.url || next, url, Parser);
    notice = DRIVE_SCAN_NOTICE;
  }
}
