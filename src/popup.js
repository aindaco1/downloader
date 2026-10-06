import { durationLabel, sizeLabel, unavailableMessage } from './core.js';
import { pending, downloading } from './toolbar.js';
import { youtubeItemId } from './youtube.js';
const $ = selector => document.querySelector(selector);
const create = (tag, className, text) => { const element = document.createElement(tag); if (className) element.className = className; if (text !== undefined) element.textContent = text; return element; };
let tabId;
let view = 'media';
let snapshot;
let rendering = '';
let busy = false;
const picks = new Map();
const messages = new Map();
const names = new Map();
const renamed = new Set();
let lastDetection;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
function activity() {
  const mark = $('#activityMark');
  const job = snapshot.jobs.find(downloading);
  mark.dataset.activity = job ? 'download' : snapshot.tab.items.length ? 'detected' : 'idle';
  mark.setAttribute('aria-label', job ? 'Download in progress' : snapshot.tab.items.length ? 'Media detected' : 'Dust Wave Downloader');
  if (!job && snapshot.tab.items.length && snapshot.tab.detectedAt !== lastDetection && !reducedMotion.matches) {
    mark.animate([{ transform: 'scale(1)', filter: 'drop-shadow(0 0 0 #3cf0ff00)' }, { transform: 'scale(1.08)', filter: 'drop-shadow(0 0 7px #3cf0ffaa)', offset: .45 }, { transform: 'scale(1)', filter: 'drop-shadow(0 0 0 #3cf0ff00)' }], { duration: 900, iterations: 2 });
  }
  lastDetection = snapshot.tab.detectedAt;
}
async function rpc(type, extra = {}) {
  const result = await chrome.runtime.sendMessage({ type, tabId, ...extra });
  if (!result?.ok) throw new Error(result?.error || 'The extension could not complete this action.');
  return result;
}
function status(text = '') { $('#status').textContent = text; }
function button(text, className, action, label) {
  const element = create('button', className, text);
  if (label) { element.setAttribute('aria-label', label); element.title = label; }
  element.addEventListener('click', async () => { try { await action(); } catch (error) { status(error.message); } });
  return element;
}
function select(label, options, value, change, className = '') {
  const element = create('select', className); element.setAttribute('aria-label', label);
  for (const [id, text] of options) { const option = create('option', '', text); option.value = id; element.append(option); }
  element.value = value;
  element.addEventListener('change', () => change(element.value));
  return element;
}
function card(item) {
  const youtubePending = !item.sources.length && youtubeItemId(item);
  const unavailable = !item.sources.length && !youtubePending && unavailableMessage(item.unavailable);
  const article = create('article', 'media-card'); article.dataset.item = item.id;
  const thumb = create('div', 'thumbnail'); thumb.append(create('span', 'symbol', '▷'));
  if (item.thumbnail) { const image = create('img'); image.src = item.thumbnail; image.alt = ''; image.referrerPolicy = 'no-referrer'; image.loading = 'lazy'; image.onerror = () => image.remove(); thumb.append(image); }
  if (item.duration) thumb.append(create('span', 'duration', durationLabel(item.duration)));
  article.append(thumb);
  const body = create('div', 'card-body');
  const heading = create('div', 'card-heading'); const title = create('h2', 'title');
  title.append(create('span', 'tag', youtubePending || unavailable ? 'YOUTUBE' : [...new Set(item.sources.map(source => source.kind === 'file' ? 'FILE' : source.kind.toUpperCase()))].join(' / ')), document.createTextNode(item.title));
  heading.append(title, button('×', 'dismiss', async () => { await rpc('dismiss', { itemId: item.id }); await refresh(true); }, 'Dismiss item'));
  body.append(heading);
  const inspection = item.inspection;
  const choices = inspection?.choices || [];
  const previous = picks.get(item.id);
  const chosen = choices.find(choice => choice.id === previous) || choices[0];
  if (chosen) picks.set(item.id, chosen.id);
  const detail = create('p', 'detail', youtubePending ? 'Choose a quality to check available downloads' : unavailable ? 'Playback detected · Download unavailable' : chosen ? `${chosen.extension.toUpperCase()}${chosen.audioCodec ? ` · ${chosen.audioCodec.toUpperCase()} audio` : chosen.type === 'video' ? ' · Video only' : ' · Original audio'}${chosen.duration ? ` · ${durationLabel(chosen.duration)}` : ''}` : `${item.sources.length} source${item.sources.length === 1 ? '' : 's'} detected`);
  body.append(detail);
  if (renamed.has(item.id)) {
    const filename = create('input', 'filename'); filename.value = names.get(item.id) || item.title; filename.maxLength = 140; filename.setAttribute('aria-label', 'Filename'); filename.addEventListener('input', () => names.set(item.id, filename.value)); body.append(filename);
  }
  const controls = create('div', 'controls');
  if (chosen) {
    controls.append(button('✎', 'rename', () => { renamed.has(item.id) ? renamed.delete(item.id) : renamed.add(item.id); render(true); }, 'Rename file'));
    const types = [...new Set(choices.map(choice => choice.type))];
    controls.append(select('Media type', types.map(type => [type, type === 'audio' ? 'Audio only' : 'Video']), chosen.type, type => { picks.set(item.id, choices.find(choice => choice.type === type).id); render(true); }, 'mode'));
    controls.append(select('Quality', choices.filter(choice => choice.type === chosen.type).map(choice => [choice.id, choice.label]), chosen.id, value => { picks.set(item.id, value); render(true); }));
    const download = button('↓ Download', 'download', async () => {
      status(); const result = await rpc('start', { itemId: item.id, choiceId: picks.get(item.id), filename: names.get(item.id) || item.title });
      if (result.job.status === 'error') throw new Error(result.job.error);
      view = 'jobs'; await refresh(true);
    }); download.disabled = busy || snapshot.jobs.some(pending); controls.append(download);
  } else if (!unavailable) {
    const inspect = button(busy && messages.get(item.id) === 'Reading available qualities…' ? 'Reading…' : 'Choose quality', 'download inspect', async () => {
      if (busy) return;
      busy = true; status(); messages.set(item.id, 'Reading available qualities…'); render(true);
      try { await rpc('inspect', { itemId: item.id }); messages.delete(item.id); }
      catch (error) { messages.set(item.id, error.message); }
      finally { busy = false; await refresh(true); }
    }); inspect.disabled = busy; controls.append(inspect);
  }
  body.append(controls);
  if (unavailable) body.append(create('p', 'card-status error', unavailable));
  if (messages.has(item.id)) body.append(create('p', `card-status${busy ? '' : ' error'}`, messages.get(item.id)));
  if (inspection?.warnings?.length) body.append(create('p', 'card-status', 'Some sources could not be read. The choices above are available.'));
  article.append(body); return article;
}

function jobCard(job) {
  const article = create('article', 'job-card'); article.dataset.job = job.id;
  const top = create('div', 'job-top');
  top.append(create('p', 'job-title', job.filename), create('span', 'job-state'));
  const progress = create('div', 'job-progress'); progress.setAttribute('role', 'progressbar');
  progress.setAttribute('aria-label', 'Download progress'); progress.setAttribute('aria-valuemin', '0'); progress.setAttribute('aria-valuemax', '100');
  progress.append(create('span', 'job-progress-fill'));
  const detail = create('div', 'job-details'); detail.append(create('p', 'job-info'), create('div', 'job-action'));
  article.append(top, progress, detail); return article;
}

function updateJobCard(article, job) {
  const active = downloading(job);
  const percent = active && job.status === 'processing' && Number.isFinite(job.progress) ? Math.min(99, Math.floor(job.progress * 100)) : null;
  const labels = { processing: 'Assembling', ready: 'Preparing file', saving: 'Saving', complete: 'Complete', cancelled: 'Cancelled', error: 'Could not save' };
  const label = pending(job) && job.cancelRequested ? 'Cancelling…' : labels[job.status] || job.status;
  article.querySelector('.job-state').textContent = `${label}${percent === null ? '' : ` · ${percent}%`}`;
  const progress = article.querySelector('.job-progress'); progress.hidden = !active;
  progress.classList.toggle('indeterminate', active && percent === null);
  if (percent === null) progress.removeAttribute('aria-valuenow'); else progress.setAttribute('aria-valuenow', String(percent));
  progress.setAttribute('aria-valuetext', percent === null ? label : `${percent}%`);
  progress.firstElementChild.style.width = percent === null ? '' : `${percent}%`;
  const info = article.querySelector('.job-info'); info.classList.toggle('error', Boolean(job.error));
  info.textContent = job.error || sizeLabel(job.bytes) || 'Preparing the selected source…';
  const action = article.querySelector('.job-action');
  const actionKind = active ? 'cancel' : job.status === 'complete' ? 'show' : '';
  if (action.dataset.kind !== actionKind) {
    action.dataset.kind = actionKind; action.replaceChildren();
    if (active) action.append(button('Cancel', 'text-button', async () => { await rpc('cancel', { id: job.id }); await refresh(true); }));
    else if (job.status === 'complete') action.append(button('Show in folder', 'text-button', () => rpc('show', { id: job.id })));
  }
  return article;
}

function render(force = false) {
  if (!snapshot) return;
  activity();
  const signature = JSON.stringify({ view, tab: snapshot.tab, jobs: snapshot.jobs, settings: snapshot.settings, busy });
  if (!force && signature === rendering) return;
  if (!force && document.activeElement?.matches('input,select')) return;
  rendering = signature;
  $('#mediaCount').textContent = snapshot.tab.items.length;
  $('#jobCount').textContent = snapshot.jobs.length;
  $('#mediaTab').classList.toggle('selected', view === 'media'); $('#mediaTab').setAttribute('aria-pressed', String(view === 'media'));
  $('#jobsTab').classList.toggle('selected', view === 'jobs'); $('#jobsTab').setAttribute('aria-pressed', String(view === 'jobs'));
  $('#rescan').hidden = view !== 'media'; $('#helpButton').hidden = view !== 'media'; $('#clearButton').hidden = view !== 'jobs';
  $('#detection').textContent = snapshot.settings.automatic ? '● Detecting automatically' : '○ Detection paused';
  const list = $('#list');
  const entries = view === 'media' ? snapshot.tab.items : snapshot.jobs;
  if (view === 'jobs' && entries.length) {
    // Updating in place keeps the progress transition and unknown-size animation
    // running across snapshots, and preserves focus on the Cancel button.
    const previous = [...list.children];
    const cards = entries.map(job => updateJobCard(previous.find(node => node.dataset.job === job.id) || jobCard(job), job));
    if (cards.length !== previous.length || cards.some((node, index) => node !== previous[index])) list.replaceChildren(...cards);
    return;
  }
  list.replaceChildren();
  if (!entries.length) {
    const empty = create('section', 'empty'); empty.append(create('div', 'empty-icon', view === 'media' ? '▷' : '↓'), create('h2', '', view === 'media' ? 'Play something worth keeping' : 'Your downloads appear here'), create('p', '', view === 'media' ? 'Start the video or audio on this page. Available media will appear here as it loads.' : 'Choose an item and its quality. Downloads continue when you close this popup.')); list.append(empty);
  } else entries.forEach(entry => list.append(card(entry)));
}
async function refresh(force = false) { snapshot = await rpc('snapshot'); render(force); }
$('#mediaTab').onclick = () => { view = 'media'; render(true); };
$('#jobsTab').onclick = () => { view = 'jobs'; render(true); };
$('#rescan').onclick = async () => { try { await rpc('rescan'); messages.clear(); status('Rescanned.'); await refresh(true); setTimeout(() => void refresh(true), 900); } catch (error) { status(error.message); } };
$('#settingsButton').onclick = () => { $('#automatic').checked = snapshot.settings.automatic; $('#saveAs').checked = snapshot.settings.saveAs; $('#settingsDialog').showModal(); };
$('#helpButton').onclick = () => $('#helpDialog').showModal();
$('#saveSettings').onclick = async () => { try { await rpc('settings', { settings: { automatic: $('#automatic').checked, saveAs: $('#saveAs').checked } }); $('#settingsDialog').close(); await refresh(true); } catch (error) { status(error.message); } };
$('#clearButton').onclick = async () => { await rpc('clear'); await refresh(true); };
try {
  const specified = new URL(location.href).searchParams.get('tab');
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = specified ? Number(specified) : tab?.id;
  const page = specified ? await chrome.tabs.get(tabId) : tab;
  $('#siteName').textContent = page?.url?.startsWith('http') ? new URL(page.url).hostname : 'Open a webpage to find media';
  await refresh(true);
  setInterval(() => void refresh().catch(() => {}), 1000);
} catch (error) { status(error.message); }
