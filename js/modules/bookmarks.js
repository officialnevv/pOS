/*
 * pOS — js/modules/bookmarks.js
 * ----------------------------------------------------------------------
 * Bookmarks module — a flat saved-links list (Spec §8, amendment).
 * No categories, no folders: add a URL with a manually typed label,
 * click to open in a new tab, remove entries. Titles are never fetched
 * (unlike Watch Later) — the label is whatever the user typed, falling
 * back to the raw URL when left blank.
 *
 * Entries persist as an array of { url, label } under the module's own
 * moduleData.bookmarks slice (Spec §9). Partial/legacy entries are
 * normalized on load.
 */

import { registerModule } from '../modules.js';

const BOOKMARKS_ICON = '\uf02e'; // nf-fa-bookmark

function normalize(list) {
  return (Array.isArray(list) ? list : []).map((it) => ({
    url: typeof it?.url === 'string' ? it.url : '',
    label: typeof it?.label === 'string' ? it.label : '',
  })).filter((it) => it.url);
}

function mount(container, context) {
  let items = normalize(context.load());
  const persist = () => context.persist(items);

  // embedded title: icon + module name (Spec §2)
  const title = document.createElement('div');
  title.className = 'module-title';
  const titleIcon = document.createElement('span');
  titleIcon.className = 'module-title-icon';
  titleIcon.textContent = BOOKMARKS_ICON;
  const titleName = document.createElement('span');
  titleName.textContent = 'Bookmarks';
  title.append(titleIcon, titleName);

  // add row: url + label + add button
  const addRow = document.createElement('div');
  addRow.className = 'bookmarks-add';
  const urlInput = document.createElement('input');
  urlInput.type = 'text';
  urlInput.placeholder = 'https://…';
  const labelInput = document.createElement('input');
  labelInput.type = 'text';
  labelInput.placeholder = 'label (optional)';
  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.textContent = '+';
  addRow.append(urlInput, labelInput, addBtn);

  const list = document.createElement('ul');
  list.className = 'bookmarks-list';

  container.append(title, addRow, list);

  /* ---- rendering ---- */
  function renderList() {
    list.innerHTML = '';
    if (!items.length) {
      const li = document.createElement('li');
      li.className = 'bookmarks-empty';
      li.textContent = 'no bookmarks — add one above';
      list.appendChild(li);
      return;
    }
    for (const item of items) {
      const li = document.createElement('li');
      li.className = 'bookmark-item';

      // a real anchor: middle-click / ctrl-click / plain click all open
      // a new tab; rel keeps the app isolated from the opened page
      const link = document.createElement('a');
      link.className = 'bookmark-link';
      link.href = item.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = item.label || item.url; // label falls back to the raw URL
      link.title = item.url;

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'bookmark-remove';
      removeBtn.textContent = '×';
      removeBtn.title = 'remove bookmark';
      removeBtn.addEventListener('click', () => {
        items.splice(items.indexOf(item), 1);
        persist();
        renderList();
      });

      li.append(link, removeBtn);
      list.appendChild(li);
    }
  }

  function addItem() {
    const url = urlInput.value.trim();
    if (!url) return;
    const label = labelInput.value.trim();
    items.push(normalize([{ url, label }])[0]);
    urlInput.value = '';
    labelInput.value = '';
    persist();
    renderList();
  }

  /* ---- events ---- */
  addBtn.addEventListener('click', addItem);
  const submitOnEnter = (e) => {
    if (e.key === 'Enter') addItem();
  };
  urlInput.addEventListener('keydown', submitOnEnter);
  labelInput.addEventListener('keydown', submitOnEnter);

  renderList();
}

function unmount(container) {
  container.innerHTML = ''; // listeners die with the elements
}

registerModule({
  id: 'bookmarks',
  name: 'Bookmarks',
  icon: BOOKMARKS_ICON,
  mount,
  unmount,
});
