/*
 * pOS — js/modules/storage.js
 * ----------------------------------------------------------------------
 * Storage module — a local, Google-Drive-style file manager (Spec §8).
 *
 * Registers itself with the central module registry at import time; the
 * WM core never references this file (zero WM changes to add it).
 *
 * Behaviour:
 *   - Folder tree + file nodes, persisted under the module's own
 *     moduleData.storage slice via the persistence context (Spec §9).
 *   - Upload files (button or drag-and-drop) — file contents are stored
 *     as base64 data URLs inside localStorage (client-only app: no
 *     backend, Spec §1). localStorage is small (~5MB), so a soft-limit
 *     warning shows when the data grows large, and every save is
 *     verified — a failed save (quota exceeded) surfaces as an error.
 *   - Create folders, rename, delete (folders delete recursively),
 *     navigate via breadcrumb, download files back to disk.
 */

import { registerModule } from '../modules.js';

const STORAGE_ICON = '\uf0c7';  // Nerd Font floppy/save
const FOLDER_ICON = '\uf07b';   // folder
const FILE_ICON = '\uf016';     // file
const DOWNLOAD_ICON = '\uf019'; // download arrow
const RENAME_ICON = '\uf044';   // pencil
const HOME_LABEL = 'home';

// localStorage is typically capped ~5MB per origin — warn before that.
const SOFT_LIMIT_BYTES = 4 * 1024 * 1024;

const fmtSize = (bytes) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
};

function mount(container, context) {
  /* ---- state: { nodes: [{id, name, type, parentId, content?, size, modified}], nextId, rev } ---- */
  let data = context.load();
  if (!data || !Array.isArray(data.nodes)) data = { nodes: [], nextId: 1, rev: 0 };
  let cwd = null; // current folder id (null = root)

  const nodeById = (id) => data.nodes.find((n) => n.id === id);

  /* ---- DOM skeleton (an inner wrapper keeps unmount simple: listeners
     attached here die with the wrapper when the container is cleared) ---- */
  const page = document.createElement('div');
  page.className = 'storage';

  const title = document.createElement('div');
  title.className = 'module-title';
  const titleIcon = document.createElement('span');
  titleIcon.className = 'module-title-icon';
  titleIcon.textContent = STORAGE_ICON;
  const titleName = document.createElement('span');
  titleName.textContent = 'Storage';
  title.append(titleIcon, titleName);

  const toolbar = document.createElement('div');
  toolbar.className = 'storage-toolbar';

  // upload: hidden multi-file input behind a styled button
  const uploadBtn = document.createElement('label');
  uploadBtn.className = 'storage-btn';
  uploadBtn.textContent = 'upload';
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.multiple = true;
  fileInput.style.display = 'none';
  uploadBtn.appendChild(fileInput);

  const newFolderBtn = document.createElement('button');
  newFolderBtn.type = 'button';
  newFolderBtn.className = 'storage-btn';
  newFolderBtn.textContent = '+ folder';

  toolbar.append(uploadBtn, newFolderBtn);

  const breadcrumb = document.createElement('div');
  breadcrumb.className = 'storage-breadcrumb';

  const warning = document.createElement('div');
  warning.className = 'storage-warning';
  warning.style.display = 'none';

  const list = document.createElement('ul');
  list.className = 'storage-list';

  page.append(title, toolbar, breadcrumb, warning, list);
  container.appendChild(page);

  /* ---- persistence ---- */
  function warn(msg, isError) {
    warning.textContent = msg;
    warning.style.display = 'block';
    warning.classList.toggle('error', !!isError);
  }

  function persist() {
    data.rev = (data.rev ?? 0) + 1;
    context.persist({ nodes: data.nodes, nextId: data.nextId, rev: data.rev });
    // verify the save actually landed (saveState swallows quota errors)
    const saved = context.load();
    if (!saved || saved.rev !== data.rev) {
      warn('save failed — localStorage quota exceeded; delete some files', true);
    } else if (JSON.stringify(saved).length > SOFT_LIMIT_BYTES) {
      warn(`storage nearly full (${fmtSize(JSON.stringify(saved).length)} used)`);
    } else {
      warning.style.display = 'none';
    }
  }

  /* ---- tree helpers ---- */
  function siblings(parentId, excludeId = null) {
    return data.nodes.filter(
      (n) => n.parentId === parentId && n.id !== excludeId
    );
  }

  /** Folders first, then files, each alphabetical (case-insensitive). */
  function sortedChildren(parentId) {
    return siblings(parentId).sort((a, b) => {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });
  }

  /** Chain of nodes from a folder up to the root (for the breadcrumb). */
  function pathOf(folderId) {
    const chain = [];
    let cur = folderId;
    while (cur != null) {
      const node = nodeById(cur);
      if (!node) break;
      chain.unshift(node);
      cur = node.parentId;
    }
    return chain;
  }

  /** Collect a node + all its descendants (for recursive delete). */
  function subtreeIds(id, out = []) {
    out.push(id);
    for (const child of siblings(id)) subtreeIds(child.id, out);
    return out;
  }

  const uniqueName = (desired, parentId, excludeId) => {
    let name = desired;
    const taken = new Set(
      siblings(parentId, excludeId).map((n) => n.name.toLowerCase())
    );
    if (!taken.has(name.toLowerCase())) return name;
    const dot = desired.lastIndexOf('.');
    const base = dot > 0 ? desired.slice(0, dot) : desired;
    const ext = dot > 0 ? desired.slice(dot) : '';
    let i = 2;
    while (taken.has(`${base} (${i})${ext}`.toLowerCase())) i++;
    return `${base} (${i})${ext}`;
  };

  /* ---- operations ---- */
  function createFolder() {
    const desired = window.prompt('folder name');
    if (desired === null) return; // cancelled
    const name = desired.trim();
    if (!name) return;
    data.nodes.push({
      id: data.nextId++,
      name: uniqueName(name, cwd),
      type: 'folder',
      parentId: cwd,
      modified: Date.now(),
    });
    persist();
    render();
  }

  function uploadFiles(files) {
    const pending = Array.from(files ?? []);
    if (!pending.length) return;
    let remaining = pending.length;
    for (const file of pending) {
      const reader = new FileReader();
      reader.onload = () => {
        data.nodes.push({
          id: data.nextId++,
          name: uniqueName(file.name, cwd),
          type: 'file',
          parentId: cwd,
          content: reader.result, // data URL (client-only persistence)
          size: file.size ?? 0,
          modified: Date.now(),
        });
        if (--remaining === 0) {
          persist();
          render();
        }
      };
      reader.onerror = () => {
        if (--remaining === 0) {
          warn(`could not read "${file.name}"`, true);
          render();
        }
      };
      reader.readAsDataURL(file);
    }
  }

  function renameNode(id) {
    const node = nodeById(id);
    if (!node) return;
    const desired = window.prompt('rename', node.name);
    if (desired === null) return; // cancelled
    const name = desired.trim();
    if (!name || name === node.name) return;
    node.name = uniqueName(name, node.parentId, node.id);
    node.modified = Date.now();
    persist();
    render();
  }

  function removeNode(id) {
    const node = nodeById(id);
    if (!node) return;
    if (!window.confirm(`delete "${node.name}"${node.type === 'folder' ? ' and everything inside it' : ''}?`)) return;
    const doomed = new Set(subtreeIds(id));
    data.nodes = data.nodes.filter((n) => !doomed.has(n.id));
    if (doomed.has(cwd)) cwd = node.parentId; // deleted the open folder
    persist();
    render();
  }

  function downloadNode(id) {
    const node = nodeById(id);
    if (!node || node.type !== 'file' || !node.content) return;
    const a = document.createElement('a');
    a.href = node.content;
    a.download = node.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  /* ---- rendering ---- */
  function renderBreadcrumb() {
    breadcrumb.innerHTML = '';
    const rootCrumb = document.createElement('span');
    rootCrumb.className = 'storage-crumb' + (cwd === null ? ' current' : '');
    rootCrumb.textContent = HOME_LABEL;
    rootCrumb.addEventListener('click', () => { cwd = null; render(); });
    breadcrumb.appendChild(rootCrumb);
    for (const node of pathOf(cwd)) {
      const sep = document.createElement('span');
      sep.className = 'storage-sep';
      sep.textContent = '/';
      const crumb = document.createElement('span');
      crumb.className = 'storage-crumb' + (node.id === cwd ? ' current' : '');
      crumb.textContent = node.name;
      crumb.addEventListener('click', () => { cwd = node.id; render(); });
      breadcrumb.append(sep, crumb);
    }
  }

  function makeRow(node) {
    const li = document.createElement('li');
    li.className = 'storage-row';

    const icon = document.createElement('span');
    icon.className = 'storage-row-icon';
    icon.textContent = node.type === 'folder' ? FOLDER_ICON : FILE_ICON;

    const name = document.createElement('span');
    name.className = 'storage-name';
    name.textContent = node.name;
    name.title = node.type === 'folder' ? 'open folder' : 'download';
    name.addEventListener('click', () => {
      if (node.type === 'folder') { cwd = node.id; render(); }
      else downloadNode(node.id);
    });

    const meta = document.createElement('span');
    meta.className = 'storage-meta';
    meta.textContent =
      node.type === 'file' ? fmtSize(node.size ?? 0) : `${siblings(node.id).length} items`;

    const actions = document.createElement('span');
    actions.className = 'storage-actions';
    const action = (label, title, fn) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'storage-action';
      btn.textContent = label;
      btn.title = title;
      btn.addEventListener('click', fn);
      return btn;
    };
    if (node.type === 'file') {
      actions.appendChild(action(DOWNLOAD_ICON, 'download', () => downloadNode(node.id)));
    }
    actions.appendChild(action(RENAME_ICON, 'rename', () => renameNode(node.id)));
    actions.appendChild(action('×', 'delete', () => removeNode(node.id)));

    li.append(icon, name, meta, actions);
    return li;
  }

  function render() {
    renderBreadcrumb();
    list.innerHTML = '';
    const children = sortedChildren(cwd);
    if (!children.length) {
      const empty = document.createElement('li');
      empty.className = 'storage-empty';
      empty.textContent = 'empty — upload files or create a folder';
      list.appendChild(empty);
      return;
    }
    for (const node of children) list.appendChild(makeRow(node));
  }

  /* ---- events ---- */
  fileInput.addEventListener('change', () => {
    uploadFiles(fileInput.files);
    fileInput.value = ''; // allow re-uploading the same file
  });
  newFolderBtn.addEventListener('click', createFolder);

  // drag-and-drop upload (plain events — Alt+drag stays with the WM)
  page.addEventListener('dragover', (e) => e.preventDefault());
  page.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadFiles(e.dataTransfer?.files);
  });

  render();
}

function unmount(container) {
  container.innerHTML = ''; // the page wrapper (with its listeners) dies here
}

const storageModule = {
  id: 'storage',
  name: 'Storage',
  icon: STORAGE_ICON,
  mount,
  unmount,
};

registerModule(storageModule);

