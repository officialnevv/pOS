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
 * Data persists under the module's own moduleData.notes slice (Spec §9)
 * as { notes: [{ title, body }…], sidebarWidth } — legacy bare-array
 * slices are normalized on load. The stored body is always the raw
 * markdown source — rendering is display-only.
 */

import { createModuleTitle, registerModule } from '../modules.js';

const NOTES_ICON = '\uf249'; // Nerd Font sticky-note

// Minimal markdown → HTML for the preview pane. Text is HTML-escaped
// first so a note can never inject markup; only the syntax listed below
// is supported (single-level lists, no nesting — plenty for personal
// notes; underscores inside words may read as emphasis).
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

// Table helpers. A row is a candidate table row when it contains a pipe;
// \| escapes a literal pipe. Tables only start on a pipe row whose next
// line is a well-formed separator — otherwise the line stays a paragraph.
function splitCells(line) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split(/(?<!\\)\|/)
    .map((cell) => cell.replaceAll('\\|', '|').trim());
}

function isSeparatorRow(cells) {
  return cells.length > 0 && cells.every((cell) => /^:?-+:?$/.test(cell));
}

function cellAlign(cell) {
  if (cell.startsWith(':') && cell.endsWith(':')) return 'center';
  if (cell.endsWith(':')) return 'right';
  return 'left';
}

function renderMarkdown(source) {
  const lines = escapeHtml(source).split('\n');
  const out = [];
  let list = null; // currently open list tag: 'ul' | 'ol' | null
  let code = null; // collected body lines while a ``` fence is open
  const closeList = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };
  const closeCode = () => {
    out.push(`<pre><code>${code.join('\n')}</code></pre>`);
    code = null;
  };

  for (let i = 0; i < lines.length; ) {
    const line = lines[i];

    // inside a fence everything is verbatim (already escaped) until the
    // closing fence; an unterminated block just ends at EOF
    if (code !== null) {
      if (/^\s*```\s*$/.test(line)) closeCode();
      else code.push(line);
      i += 1;
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    const rule = line.match(/^\s*-{3,}\s*$/);
    const bullet = line.match(/^\s*[-*]\s+(.+)$/);
    const numbered = line.match(/^\s*\d+\.\s+(.+)$/);

    // fenced code block opens (``` with an optional language tag)
    if (/^\s*```/.test(line)) {
      closeList();
      code = [];
      i += 1;
      continue;
    }

    if (line.includes('|') && i + 1 < lines.length) {
      const header = splitCells(line);
      const separator = splitCells(lines[i + 1]);
      if (isSeparatorRow(separator) && separator.length === header.length) {
        closeList();
        const aligns = separator.map(cellAlign);
        const head = header
          .map((cell, c) => `<th style="text-align:${aligns[c]}">${inlineMarkdown(cell)}</th>`)
          .join('');
        let body = '';
        i += 2;
        while (i < lines.length && lines[i].includes('|')) {
          const row = splitCells(lines[i]);
          body += `<tr>${aligns
            .map((align, c) => `<td style="text-align:${align}">${inlineMarkdown(row[c] ?? '')}</td>`)
            .join('')}</tr>`;
          i += 1;
        }
        out.push(`<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`);
        continue;
      }
    }

    if (heading) {
      closeList();
      const level = heading[1].length;
      out.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
    } else if (rule) {
      closeList();
      out.push('<hr>');
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
    i += 1;
  }
  if (code) closeCode();
  closeList();
  return out.join('\n');
}

// Sidebar width: remembered in the slice, clamped to these bounds
// (120px keeps tab titles readable; the upper bound is half the window).
const SIDEBAR_DEFAULT = 150;
const SIDEBAR_MIN = 120;

// The slice used to be a bare notes array; wrap legacy data and tolerate
// partial saves (same spirit as Tasks' normalize).
function normalize(data) {
  const notes = Array.isArray(data)
    ? data
    : Array.isArray(data?.notes)
      ? data.notes
      : [];
  const sidebarWidth =
    typeof data?.sidebarWidth === 'number' ? data.sidebarWidth : SIDEBAR_DEFAULT;
  return { notes, sidebarWidth };
}

function mount(container, context) {
  const loaded = normalize(context.load());
  let notes = loaded.notes;
  const maxSidebar = () =>
    Math.max(SIDEBAR_MIN, Math.floor(container.clientWidth / 2));
  // remembered width, clamped against the window it's opening in
  let sidebarWidth = Math.min(Math.max(loaded.sidebarWidth, SIDEBAR_MIN), maxSidebar());
  let selected = notes.length ? 0 : -1; // index into notes, -1 = none

  const persist = () => context.persist({ notes, sidebarWidth });
  const current = () => notes[selected] ?? null;

  // view mode of the note being looked at: false = raw textarea,
  // true = rendered markdown preview (display-only, never persisted)
  let preview = false;

  const title = createModuleTitle(NOTES_ICON, 'Notes');

  // sidebar: always-visible new-note row (title input + add button) on
  // top of the note list; the resize handle is anchored inside the
  // editor column because the sidebar clips its own overflow
  const sidebar = document.createElement('div');
  sidebar.className = 'notes-sidebar';
  sidebar.style.width = `${sidebarWidth}px`;
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'notes-name-input';
  nameInput.placeholder = 'note title…';
  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'notes-add';
  addBtn.textContent = '+';
  addBtn.title = 'add note';
  const newNoteRow = document.createElement('div');
  newNoteRow.className = 'notes-new';
  newNoteRow.append(nameInput, addBtn);
  const tabs = document.createElement('ul');
  tabs.className = 'notes-tabs';
  sidebar.append(newNoteRow, tabs);

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
  bodyEl.className = 'notes-editor-body';
  bodyEl.placeholder = 'write something…';
  const previewEl = document.createElement('div');
  previewEl.className = 'notes-preview';
  const editorEmpty = document.createElement('div');
  editorEmpty.className = 'notes-empty';
  editorEmpty.textContent = 'no notes — add one with +';
  // drag handle straddling the sidebar/editor border (col-resize)
  const resizeHandle = document.createElement('div');
  resizeHandle.className = 'notes-resize';
  editor.append(titleRow, bodyEl, previewEl, editorEmpty, resizeHandle);

  // sidebar + editor live in a row wrapper below the title
  const body = document.createElement('div');
  body.className = 'notes-body';
  body.append(sidebar, editor);

  container.append(title, body);

  /* ---- events ---- */
  // enter in the title input or a + click creates the note; an empty
  // title falls back to "untitled"; the input clears but stays visible
  const createNote = () => {
    notes.push({ title: nameInput.value.trim() || 'untitled', body: '' });
    selected = notes.length - 1;
    nameInput.value = '';
    persist();
    render();
  };

  addBtn.addEventListener('click', createNote);
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') createNote();
  });

  // drag the sidebar's right edge to resize it (width persisted on release)
  resizeHandle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = sidebarWidth;
    const onMove = (ev) => {
      sidebarWidth = Math.max(
        SIDEBAR_MIN,
        Math.min(startWidth + ev.clientX - startX, maxSidebar())
      );
      sidebar.style.width = `${sidebarWidth}px`;
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      persist();
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
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
