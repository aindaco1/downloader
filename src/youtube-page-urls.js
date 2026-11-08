// Runs in the matching YouTube frame's MAIN world. Use the URL processor that
// the page has already loaded; never fetch, inject or evaluate player code.
// Export names change, so recognize the narrow URL-wrapper prototype instead.
export function prepareYoutubeUrls(videoId, urls, signatureTimestamp) {
  try {
    const page = new URL(location.href);
    const currentId = page.searchParams.get('v') || page.pathname.match(/^\/(?:embed|shorts|live)\/([^/]+)/)?.[1];
    if (!/(^|\.)(youtube\.com|youtube-nocookie\.com)$/.test(page.hostname) || currentId !== videoId || !Array.isArray(urls) || urls.length > 24) return null;
    const timestamp = globalThis.ytcfg?.get?.('STS');
    if (timestamp && Number(timestamp) !== signatureTimestamp) return null;
    const candidates = Object.values(Object.getOwnPropertyDescriptors(globalThis._yt_player || {})).slice(0, 10000)
      .map(descriptor => descriptor.value).filter(value => {
        if (typeof value !== 'function' || !value.prototype) return false;
        const properties = Object.getOwnPropertyDescriptors(value.prototype);
        return Object.keys(properties).length === 5 && ['get', 'set', 'clone'].every(key => typeof properties[key]?.value === 'function');
      });
    if (candidates.length !== 1) return null;
    const Wrapper = candidates[0];
    const method = Object.getOwnPropertyNames(Wrapper.prototype).find(key => !['constructor', 'get', 'set', 'clone'].includes(key));
    if (typeof Object.getOwnPropertyDescriptor(Wrapper.prototype, method)?.value !== 'function') return null;
    return urls.map(value => {
      const url = new URL(value);
      if (url.protocol !== 'https:' || !/(^|\.)googlevideo\.com$/.test(url.hostname) || url.pathname !== '/videoplayback') throw new Error('Invalid media URL.');
      if (!url.searchParams.has('n')) return value;
      const wrapped = new Wrapper(value, true);
      return wrapped[method]();
    });
  } catch { return null; }
}
