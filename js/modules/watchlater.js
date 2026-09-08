/*
 * pOS — js/modules/watchlater.js
 * ----------------------------------------------------------------------
 * Watch Later module — saved video links, not tied to any specific site
 * (Spec §8). Add a URL:
 *   - YouTube links get an automatic title fetch via YouTube's public
 *     oEmbed endpoint (no API key):
 *       https://www.youtube.com/oembed?url={url}&format=json
 *   - any other URL is never scraped: it shows the raw URL until a
 *     title is typed manually (inline input on the entry, committed
 *     with Enter or the inline add button)
 *   - a failed title fetch degrades to the same manual entry
 * Each entry has a watched toggle (watched entries render dimmed with a
 * strikethrough) and a remove button.
 *
 * Entries persist as an array of { url, title, watched } under the
 * module's own moduleData.watchLater slice (Spec §9). Partial/legacy
 * entries are normalized on load.
 */

import { registerModule } from '../modules.js';

const WATCHLATER_ICON = '\uf26c'; // nf-fa-television (site-agnostic)
const CHECK_GLYPH = '\uf00c';     // nf-fa-check, drawn inside the toggle
const OEMBED_URL = 'https://www.youtube.com/oembed?url=';

function normalize(list) {
  return (Array.isArray(list) ? list : []).map((it) => ({
    url: typeof it?.url === 'string' ? it.url : '',
    title: typeof it?.title === 'string' ? it.title : '',
    watched: !!it?.watched,
  })).filter((it) => it.url);
}

/** Only YouTube hosts get the automatic oEmbed title fetch. */
function isYouTube(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtu.be';
  } catch {
    return false; // unparseable -> treat as a plain link, never scraped
  }
}

let disposed = false;

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

function mount(container, context) {
  disposed = false;

  let items = normalize(context.load());
  const persist = () => context.persist(items);

  // embedded title: icon + module name (Spec §2)
  const title = document.createElement('div');
  title.className = 'module-title';
  const titleIcon = document.createElement('span');
  titleIcon.className = 'module-title-icon';
  titleIcon.textContent = WATCHLATER_ICON;
  const titleName = document.createElement('span');
  titleName.textContent = 'Watch Later';
  title.append(titleIcon, titleName);

  // add row: url + add button
  const addRow = document.createElement('div');
  addRow.className = 'watchlater-add';
  const urlInput = document.createElement('input');
  urlInput.type = 'text';
  urlInput.placeholder = 'https://… (video link)';
  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.textContent = '+';
  addRow.append(urlInput, addBtn);

  const list = document.createElement('ul');
  list.className = 'watchlater-list';

  container.append(title, addRow, list);

  /* ---- title fetching ---- */
  async function fetchTitle(item) {
    if (!isYouTube(item.url)) return;
    try {
      const data = await fetchJson(OEMBED_URL + encodeURIComponent(item.url) + '&format=json');
      if (disposed) return;
      const t = typeof data?.title === 'string' ? data.title : '';
      if (t) {
        item.title = t;
        persist();
        renderList(); // replace the manual-entry input with the fetched title
      }
    } catch {
      // oEmbed unavailable/blocked -> manual title entry stays available
    }
  }

  /* ---- rendering ---- */
  function renderList() {
    list.innerHTML = '';
    if (!items.length) {
      const li = document.createElement('li');
      li.className = 'watchlater-empty';
      li.textContent = 'nothing queued — paste a video link above';
      list.appendChild(li);
      return;
    }
    for (const item of items) {
      const li = document.createElement('li');
      li.className = 'watchlater-item' + (item.watched ? ' watched' : '');

      // watched toggle: theme-drawn box with the NF check glyph (like Tasks)
      const check = document.createElement('button');
      check.type = 'button';
      check.className = 'watchlater-check';
      check.textContent = item.watched ? CHECK_GLYPH : '';
      check.title = item.watched ? 'mark unwatched' : 'mark watched';
      check.addEventListener('click', () => {
        item.watched = !item.watched;
        persist();
        renderList();
      });

      // the link itself: title when known, raw URL otherwise
      const link = document.createElement('a');
      link.className = 'watchlater-link';
      link.href = item.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = item.title || item.url;
      link.title = item.url;

      li.append(check, link);

      // manual title entry: shown while the title is unknown (non-YouTube
      // URLs, or a failed oEmbed fetch). Typing is draft-only (no side
      // effects); the title commits on Enter or the inline add button,
      // the same explicit-submit pattern as the URL row above.
      if (!item.title) {
        const titleInput = document.createElement('input');
        titleInput.type = 'text';
        titleInput.className = 'watchlater-title-input';
        titleInput.placeholder = 'title…';
        const commitTitle = () => {
          const t = titleInput.value.trim();
          if (!t) return; // empty draft -> nothing to save
          item.title = t;
          persist();
          renderList(); // input graduates to the title text
        };
        titleInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') commitTitle();
        });
        const titleBtn = document.createElement('button');
        titleBtn.type = 'button';
        titleBtn.className = 'watchlater-title-commit';
        titleBtn.textContent = '+';
        titleBtn.title = 'save title';
        titleBtn.addEventListener('click', commitTitle);
        li.append(titleInput, titleBtn);
      }

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'watchlater-remove';
      removeBtn.textContent = '×';
      removeBtn.title = 'remove entry';
      removeBtn.addEventListener('click', () => {
        items.splice(items.indexOf(item), 1);
        persist();
        renderList();
      });
      li.append(removeBtn);

      list.appendChild(li);
    }
  }

  function addItem() {
    const url = urlInput.value.trim();
    if (!url) return;
    const entry = normalize([{ url }])[0];
    items.push(entry);
    urlInput.value = '';
    persist();
    renderList();
    fetchTitle(entry); // async: YouTube only; re-renders on success
  }

  /* ---- events ---- */
  addBtn.addEventListener('click', addItem);
  urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addItem();
  });

  renderList();
}

function unmount(container) {
  disposed = true; // abandon any in-flight title fetch
  container.innerHTML = ''; // listeners die with the elements
}

registerModule({
  id: 'watchLater',
  name: 'Watch Later',
  icon: WATCHLATER_ICON,
  mount,
  unmount,
});

