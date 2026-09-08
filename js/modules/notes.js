/*
 * pOS — js/modules/notes.js
 * ----------------------------------------------------------------------
 * Notes module — multiple freeform notes with a title and body each
 * (Spec §8, as amended).
 *
 * Registers itself with the module registry at import time; the WM core
 * only ever sees it through the registry. A small sidebar lists the
 * notes, the rest of the window is an inline editor (title input + body
 * textarea) with a preview toggle that renders the body's markdown.
 * Data persists as an array of { title, body } under the module's own
 * moduleData.notes slice (Spec §9); the stored body is always the raw
 * markdown source — rendering is display-only.
 */

import { registerModule } from '../modules.js';

const NOTES_ICON = '\uf249'; // Nerd Font sticky-note

// Minimal markdown → HTML for the preview pane. Text is HTML-escaped
// first so a note can never inject markup; only the syntax listed below
// is supported (single-level lists, no tables/nesting — plenty for
// personal notes; underscores inside words may read as emphasis).
function escapeHtml(text) {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

// Inline syntax on already-escaped text: code, bold, italic, links
// (code first so its content is left alone by the others).
function inlineMarkdown(text) {
  return text
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/_([^_]+)_/g, '<em>$1</em>')
    .replace(
      /\[([^\]]+)\]\(([^()\s]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
    );
}

function renderMarkdown(source) {
  const out = [];
  let list = null; // currently open list tag: 'ul' | 'ol' | null
  const closeList = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };

  for (const line of escapeHtml(source).split('\n')) {
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    const bullet = line.match(/^\s*[-*]\s+(.+)$/);
    const numbered = line.match(/^\s*\d+\.\s+(.+)$/);
    if (heading) {
      closeList();
      const level = heading[1].length;
      out.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
    } else if (bullet) {
      if (list !== 'ul') {
        closeList();
        out.push('<ul>');
        list = 'ul';
      }
      out.push(`<li>${inlineMarkdown(bullet[1])}</li>`);
    } else if (numbered) {
      if (list !== 'ol') {
        closeList();
        out.push('<ol>');
        list = 'ol';
      }
      out.push(`<li>${inlineMarkdown(numbered[1])}</li>`);
    } else {
      closeList();
      if (line.trim()) out.push(`<p>${inlineMarkdown(line)}</p>`);
    }
  }
  closeList();
  return out.join('\n');
}

function mount(container, context) {
  let notes = context.load() ?? [];
  if (!Array.isArray(notes)) notes = [];
  let selected = notes.length ? 0 : -1; // index into notes, -1 = none

  const persist = () => context.persist(notes);
  const current = () => notes[selected] ?? null;

  // view mode of the note being looked at: false = raw textarea,
  // true = rendered markdown preview (display-only, never persisted)
  let preview = false;

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

  // editor: title row (title input + preview toggle) + body, edited in
  // place; preview mode swaps the textarea for the rendered markdown
  const editor = document.createElement('div');
  editor.className = 'notes-editor';
  const titleRow = document.createElement('div');
  titleRow.className = 'notes-titlerow';
  const titleInput = document.createElement('input');
  titleInput.type = 'text';
  titleInput.className = 'notes-title';
  titleInput.placeholder = 'title…';
  const modeBtn = document.createElement('button');
  modeBtn.type = 'button';
  modeBtn.className = 'notes-mode';
  modeBtn.title = 'toggle preview';
  titleRow.append(titleInput, modeBtn);
  const bodyEl = document.createElement('textarea');
  bodyEl.className = 'notes-body';
  bodyEl.placeholder = 'write something…';
  const previewEl = document.createElement('div');
  previewEl.className = 'notes-preview';
  const editorEmpty = document.createElement('div');
  editorEmpty.className = 'notes-empty';
  editorEmpty.textContent = 'no notes — add one with +';
  editor.append(titleRow, bodyEl, previewEl, editorEmpty);

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

  modeBtn.addEventListener('click', () => {
    preview = !preview;
    renderEditor();
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
    const editing = has && !preview;
    titleRow.style.display = has ? '' : 'none';
    bodyEl.style.display = editing ? '' : 'none';
    previewEl.style.display = has && preview ? '' : 'none';
    editorEmpty.style.display = has ? 'none' : '';
    if (has) {
      titleInput.value = note.title;
      modeBtn.textContent = preview ? 'edit' : 'preview';
      modeBtn.classList.toggle('active', preview);
      if (preview) {
        previewEl.innerHTML = renderMarkdown(note.body);
      } else {
        bodyEl.value = note.body;
      }
    }
  }

  function render() {
    // render() only runs when the selected note changes (add, delete,
    // select), so this doubles as "a freshly opened note starts in
    // edit mode"
    preview = false;
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
