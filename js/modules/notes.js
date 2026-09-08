/*
 * pOS — js/modules/notes.js
 * ----------------------------------------------------------------------
 * Notes module — multiple freeform notes with a title and body each
 * (Spec §8, as amended).
 *
 * Registers itself with the module registry at import time; the WM core
 * only ever sees it through the registry. A small sidebar lists the
 * notes, the rest of the window is an inline editor (title input + body
 * textarea). Data persists as an array of { title, body } under the
 * module's own moduleData.notes slice (Spec §9).
 */

import { registerModule } from '../modules.js';

const NOTES_ICON = '\uf249'; // Nerd Font sticky-note

function mount(container, context) {
  let notes = context.load() ?? [];
  if (!Array.isArray(notes)) notes = [];
  let selected = notes.length ? 0 : -1; // index into notes, -1 = none

  const persist = () => context.persist(notes);
  const current = () => notes[selected] ?? null;

  // embedded title: icon + module name (Spec §2)
  const title = document.createElement('div');
  title.className = 'module-title';
  const titleIcon = document.createElement('span');
  titleIcon.className = 'module-title-icon';
  titleIcon.textContent = NOTES_ICON;
  const titleName = document.createElement('span');
  titleName.textContent = 'Notes';
  title.append(titleIcon, titleName);

  // sidebar: note list + add button
  const sidebar = document.createElement('div');
  sidebar.className = 'notes-sidebar';
  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'notes-add';
  addBtn.textContent = '+';
  addBtn.title = 'new note';
  const tabs = document.createElement('ul');
  tabs.className = 'notes-tabs';
  sidebar.append(addBtn, tabs);

  // editor: title + body, edited in place
  const editor = document.createElement('div');
  editor.className = 'notes-editor';
  const titleInput = document.createElement('input');
  titleInput.type = 'text';
  titleInput.className = 'notes-title';
  titleInput.placeholder = 'title…';
  const bodyEl = document.createElement('textarea');
  bodyEl.className = 'notes-body';
  bodyEl.placeholder = 'write something…';
  const editorEmpty = document.createElement('div');
  editorEmpty.className = 'notes-empty';
  editorEmpty.textContent = 'no notes — add one with +';
  editor.append(titleInput, bodyEl, editorEmpty);

  // sidebar + editor live in a row wrapper below the title
  const body = document.createElement('div');
  body.className = 'notes-body';
  body.append(sidebar, editor);

  container.append(title, body);

  /* ---- events ---- */
  addBtn.addEventListener('click', () => {
    notes.push({ title: '', body: '' });
    selected = notes.length - 1;
    persist();
    render();
  });

  titleInput.addEventListener('input', () => {
    const note = current();
    if (!note) return;
    note.title = titleInput.value;
    persist();
    renderSidebar(); // keep the tab label in sync; focus stays in the input
  });

  bodyEl.addEventListener('input', () => {
    const note = current();
    if (!note) return;
    note.body = bodyEl.value;
    persist();
  });

  /* ---- rendering ---- */
  function renderSidebar() {
    tabs.innerHTML = '';
    notes.forEach((note, i) => {
      const li = document.createElement('li');
      li.className = 'notes-tab' + (i === selected ? ' selected' : '');

      const label = document.createElement('span');
      label.className = 'notes-tab-label';
      label.textContent = note.title || 'untitled';
      label.title = note.title || 'untitled';
      label.addEventListener('click', () => {
        selected = i;
        render();
      });

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'notes-tab-remove';
      removeBtn.textContent = '×';
      removeBtn.title = 'delete note';
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!window.confirm(`delete "${note.title || 'untitled'}"?`)) return;
        notes.splice(i, 1);
        if (selected >= notes.length) selected = notes.length - 1;
        if (selected > i) selected -= 1;
        persist();
        render();
      });

      li.append(label, removeBtn);
      tabs.appendChild(li);
    });
  }

  function renderEditor() {
    const note = current();
    const has = !!note;
    titleInput.style.display = has ? '' : 'none';
    bodyEl.style.display = has ? '' : 'none';
    editorEmpty.style.display = has ? 'none' : '';
    if (has) {
      titleInput.value = note.title;
      bodyEl.value = note.body;
    }
  }

  function render() {
    renderSidebar();
    renderEditor();
  }

  render();
}

function unmount(container) {
  container.innerHTML = ''; // listeners die with the elements
}

registerModule({
  id: 'notes',
  name: 'Notes',
  icon: NOTES_ICON,
  mount,
  unmount,
});
