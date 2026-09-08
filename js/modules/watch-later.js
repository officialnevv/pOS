/*
 * pOS — js/modules/watch-later.js
 * ----------------------------------------------------------------------
 * Watch Later module — a site-agnostic saved-video-links list (Spec §8,
 * as amended).
 *
 * Registers itself with the central module registry at import time; the
 * WM core never references this file (zero WM changes to add it).
 *
 * Behaviour:
 *   - Paste any video URL (YouTube, Vimeo, anything) + add.
 *   - Title auto-detection ONLY for YouTube links, via YouTube's public
 *     oEmbed endpoint (no API key, CORS-friendly). Non-YouTube URLs are
 *     never scraped (CORS + no backend): they show the raw URL until a
 *     title is typed manually (edit via the pencil action).
 *   - Each entry: clickable link (opens in a new tab), watched toggle
 *     (dimmed + strikethrough), editable title, remove button.
 *   - Data persists as { entries: [{id, url, title, watched}] } under
 *     the module's own moduleData.watchLater slice (Spec §9).
 */

import { registerModule } from '../modules.js';

const WL_ICON = '\uf017';       // Nerd Font clock
const RENAME_ICON = '\uf044';   // pencil

// YouTube-only title detection (Spec amendment: no generic scraping)
const YT_HOST = /(?:^|\.)youtube\.com$|^youtu\.be$/i;

function isYouTube(url) {
  try {
    return YT_HOST.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

function mount(container, context) {
  /* ---- state: { entries: [{ id, url, title, watched }] } ---- */
  let entries = context.load()?.entries ?? [];
  if (!Array.isArray(entries)) entries = [];
  let nextId = entries.reduce((max, e) => Math.max(max, e.id), 0) + 1;
  const persist = () => context.persist({ entries });

  /* ---- embedded title: icon + module name (Spec §2) ---- */
  const title = document.createElement('div');
  title.className = 'module-title';
  const titleIcon = document.createElement('span');
  titleIcon.className = 'module-title-icon';
  titleIcon.textContent = WL_ICON;
  const titleName = document.createElement('span');
  titleName.textContent = 'Watch Later';
  title.append(titleIcon, titleName);

  /* ---- add row ---- */
  const addRow = document.createElement('div');
  addRow.className = 'wl-add';
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'paste a video URL…';
  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.textContent = '+';
  addRow.append(input, addBtn);

  const list = document.createElement('ul');
  list.className = 'wl-list';

  container.append(title, addRow, list);

  /* ---- title auto-detection (YouTube oEmbed only) ---- */
  function fetchTitle(entry) {
    fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(entry.url)}&format=json`
    )
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data) => {
        if (data && typeof data.title === 'string' && data.title) {
          entry.title = data.title;
          persist();
          renderList();
        }
      })
      .catch(() => {
        /* offline / CORS / bad link — keep the manual/URL fallback */
      });
  }

  /* ---- operations ---- */
  function addEntry() {
    const url = input.value.trim();
    if (!url) return;
    const entry = { id: nextId++, url, title: '', watched: false };
    entries = [...entries, entry];
    input.value = '';
    persist();
    renderList();
    if (isYouTube(url)) fetchTitle(entry); // async; re-renders on success
  }

  function editTitle(entry) {
    const desired = window.prompt('title (blank = show the URL)', entry.title);
    if (desired === null) return; // cancelled
    entry.title = desired.trim();
    persist();
    renderList();
  }

  function removeEntry(id) {
    entries = entries.filter((e) => e.id !== id);
    persist();
    renderList();
  }

  /* ---- rendering ---- */
  function renderList() {
    list.innerHTML = '';
    if (!entries.length) {
      const empty = document.createElement('li');
      empty.className = 'wl-empty';
      empty.textContent = 'nothing saved — paste a video URL above';
      list.appendChild(empty);
      return;
    }
    for (const entry of entries) {
      const li = document.createElement('li');
      li.className = 'wl-row' + (entry.watched ? ' watched' : '');

      const watched = document.createElement('input');
      watched.type = 'checkbox';
      watched.checked = entry.watched;
      watched.title = 'mark watched';
      watched.addEventListener('change', () => {
        entry.watched = watched.checked;
        persist();
        renderList();
      });

      // the link itself (title if known, else the raw URL)
      const link = document.createElement('a');
      link.className = 'wl-link';
      link.href = entry.url;
      link.target = '_blank'; // open in a new tab (Spec amendment)
      link.rel = 'noopener noreferrer';
      link.textContent = entry.title || entry.url;
      link.title = entry.url;

      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'wl-action';
      editBtn.textContent = RENAME_ICON;
      editBtn.title = 'edit title';
      editBtn.addEventListener('click', () => editTitle(entry));

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'wl-action';
      removeBtn.textContent = '×';
      removeBtn.title = 'remove';
      removeBtn.addEventListener('click', () => removeEntry(entry.id));

      li.append(watched, link, editBtn, removeBtn);
      list.appendChild(li);
    }
  }

  /* ---- events ---- */
  addBtn.addEventListener('click', addEntry);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addEntry();
  });

  renderList();
}

function unmount(container) {
  container.innerHTML = ''; // listeners die with the elements
}

const watchLaterModule = {
  id: 'watchLater',
  name: 'Watch Later',
  icon: WL_ICON,
  mount,
  unmount,
};

registerModule(watchLaterModule);

