import { youtubeContext, withYoutubeContext } from './youtube.js';
import { vimeoContext, withVimeoContext } from './vimeo.js';

// Both sites use the same frame-scoped metadata and late-enrichment path.
const sites = { youtube: [youtubeContext, withYoutubeContext], vimeo: [vimeoContext, withVimeoContext] };
export function siteContext(pageUrl, metadata = {}) {
  for (const [site, [read]] of Object.entries(sites)) {
    const context = read(pageUrl, metadata);
    if (context.videoId) return { ...context, site };
  }
  return {};
}
export function withSiteContext(raw, context) {
  for (const [site, [, enrich]] of Object.entries(sites)) raw = enrich(raw, { ...context, [site]: context.video?.site === site ? context.video : undefined });
  return raw;
}
