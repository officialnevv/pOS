/*
 * pOS — js/modules/repositories.js
 * ----------------------------------------------------------------------
 * Repositories module — a personal library of GitHub repos (Spec §8).
 *
 * Add a repo URL (https://github.com/owner/repo): owner/name are parsed
 * from it and description, stars, primary language and the owner avatar
 * are fetched ONCE from GitHub's public REST API (no auth — fine for a
 * single-user tool at manual add/retry cadence; unauthenticated calls
 * are rate-limited to 60/hour per IP, so there is deliberately no
 * bulk/auto refresh). A small per-card button re-fetches on demand; a
 * failed fetch (rate limit, private repo, 404, network) sets fetchFailed
 * and renders a retry state instead of dropping the entry.
 *
 * Cards render in a responsive grid ("shelf" layout). Each entry also
 * carries an always-visible personal note (Tasks description convention)
 * and free-typed tags with suggestions drawn from previously used tags
 * (Goals category convention). Data persists as an array of repo objects
 * under the module's own moduleData.repositories slice (Spec §9); array
 * order is the display order. Entries saved before the extra fields
 * existed are normalized on load.
 */

import { registerModule } from '../modules.js';

const REPOS_ICON = '\uf09b';    // nf-fa-github
const STAR_GLYPH = '\uf005';    // nf-fa-star
const REFRESH_GLYPH = '\uf021'; // nf-fa-refresh
const CARET_DOWN = '\uf0d7';    // nf-fa-caret_down
const CARET_UP = '\uf0d8';      // nf-fa-caret_up
const API_BASE = 'https://api.github.com/repos/';

// Tolerate old/partial saved entries: missing fields default to "not
// fetched yet" (empty details, no note/tags, no failure flag).
function normalize(list) {
  return (Array.isArray(list) ? list : [])
    .map((repo) => ({
      id: typeof repo?.id === 'string' ? repo.id : crypto.randomUUID(),
      url: typeof repo?.url === 'string' ? repo.url : '',
      owner: typeof repo?.owner === 'string' ? repo.owner : '',
      name: typeof repo?.name === 'string' ? repo.name : '',
      description: typeof repo?.description === 'string' ? repo.description : '',
      stars: typeof repo?.stars === 'number' ? repo.stars : 0,
      language: typeof repo?.language === 'string' ? repo.language : '',
      avatarUrl: typeof repo?.avatarUrl === 'string' ? repo.avatarUrl : '',
      note: typeof repo?.note === 'string' ? repo.note : '',
      tags: (Array.isArray(repo?.tags) ? repo.tags : [])
        .filter((tag) => typeof tag === 'string' && tag),
      addedAt: typeof repo?.addedAt === 'number' ? repo.addedAt : Date.now(),
      fetchFailed: !!repo?.fetchFailed,
    }))
    .filter((repo) => repo.url);
}

// Reduce a pasted URL to its canonical https://github.com/owner/name
// form: www optional, a .git suffix and extra path segments tolerated.
// Anything else is rejected (validated inline by the caller).
function parseRepoUrl(input) {
  let url;
  try {
    url = new URL(input);
  } catch {
    return null; // unparseable -> not a URL
  }
  if (url.hostname.replace(/^www\./, '') !== 'github.com') return null;
  const [owner, name] = url.pathname.split('/').filter(Boolean);
  if (!owner || !name) return null;
  const cleanName = name.replace(/\.git$/, '');
  return { url: `https://github.com/${owner}/${cleanName}`, owner, name: cleanName };
}

// One GitHub API call per repo: description, stars, primary language and
// the owner avatar all come from the same response.
async function fetchRepoDetails(repo) {
  const res = await fetch(API_BASE + repo.owner + '/' + repo.name);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const data = await res.json();
  return {
    description: typeof data?.description === 'string' ? data.description : '',
    stars: typeof data?.stargazers_count === 'number' ? data.stargazers_count : 0,
    language: typeof data?.language === 'string' ? data.language : '',
    avatarUrl: typeof data?.owner?.avatar_url === 'string' ? data.owner.avatar_url : '',
  };
}

let disposed = false;

function mount(container, context) {
  disposed = false;

  let repos = normalize(context.load());
  const persist = () => context.persist(repos);

  // view state, deliberately not persisted: which card's note editor is
  // open, and which repos have a fetch in flight
  let expanded = null;
  const fetching = new Set();
  // active tag filters + search query: view state, deliberately not
  // persisted (they reset on reload)
  const activeTags = new Set();

  // embedded title: icon + module name (Spec §2)
  const title = document.createElement('div');
  title.className = 'module-title';
  const titleIcon = document.createElement('span');
  titleIcon.className = 'module-title-icon';
  titleIcon.textContent = REPOS_ICON;
  const titleName = document.createElement('span');
  titleName.textContent = 'Repositories';
  title.append(titleIcon, titleName);

  // add row (always visible, Notes/Goals-style): paste a URL, Enter or '+'
  const addRow = document.createElement('div');
  addRow.className = 'repos-add';
  const urlInput = document.createElement('input');
  urlInput.type = 'text';
  urlInput.placeholder = 'https://github.com/owner/repo';
  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.textContent = '+';
  addRow.append(urlInput, addBtn);

  // inline validation error for non-github URLs (hidden while empty)
  const error = document.createElement('div');
  error.className = 'repos-error';

  // filter row (always visible): live name search + clickable tag chips
  // built from all tags in use across saved repos
  const filterBar = document.createElement('div');
  filterBar.className = 'repos-filter';
  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.className = 'repos-search';
  searchInput.placeholder = 'search by name…';
  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.className = 'repos-clear';
  clearBtn.textContent = 'clear filters';
  clearBtn.title = 'clear search and tag filters';
  clearBtn.style.display = 'none'; // only meaningful while a filter is active
  const tagFilter = document.createElement('div');
  tagFilter.className = 'repos-tag-filter';
  filterBar.append(searchInput, clearBtn, tagFilter);

  const grid = document.createElement('ul');
  grid.className = 'repos-list';

  container.append(title, addRow, error, filterBar, grid);

  /* ---- events ---- */
  addBtn.addEventListener('click', addRepo);
  urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addRepo();
  });
  urlInput.addEventListener('input', () => {
    error.textContent = '';
  });
  searchInput.addEventListener('input', renderGrid); // live filter, no Enter
  clearBtn.addEventListener('click', () => {
    activeTags.clear();
    searchInput.value = '';
    renderGrid();
  });

  /* ---- rendering ---- */
  function renderGrid() {
    grid.innerHTML = '';
    renderFilterChips();
    clearBtn.style.display = activeTags.size || searchInput.value ? '' : 'none';
    if (!repos.length) {
      empty('no repos — add one above');
      return;
    }
    const visible = visibleRepos();
    if (!visible.length) {
      empty('no repos match');
      return;
    }
    for (let i = 0; i < visible.length; i++) {
      grid.appendChild(renderCard(visible[i], i, visible.length));
    }
  }

  function empty(text) {
    const li = document.createElement('li');
    li.className = 'repos-empty';
    li.textContent = text;
    grid.appendChild(li);
  }

  // search (case-insensitive name substring) AND tag filters (a repo
  // must carry every active tag) — display only, storage and order
  // are untouched
  function visibleRepos() {
    const query = searchInput.value.trim().toLowerCase();
    return repos.filter((repo) =>
      repo.name.toLowerCase().includes(query) &&
      [...activeTags].every((tag) => repo.tags.includes(tag))
    );
  }

  // filter chips: every tag in use across saved repos (same aggregation
  // as the tag-entry suggestions); click toggles the tag as a filter
  function renderFilterChips() {
    tagFilter.innerHTML = '';
    for (const tag of usedTags()) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'repo-filter-chip' + (activeTags.has(tag) ? ' active' : '');
      chip.textContent = tag;
      chip.title = activeTags.has(tag) ? 'stop filtering by this tag' : 'filter by this tag';
      chip.addEventListener('click', () => {
        if (activeTags.has(tag)) activeTags.delete(tag);
        else activeTags.add(tag);
        renderGrid();
      });
      tagFilter.appendChild(chip);
    }
  }

  function renderCard(repo, index, visibleCount) {
    const li = document.createElement('li');
    li.className = 'repo-card'
      + (repo.fetchFailed ? ' fetch-failed' : '')
      + (fetching.has(repo.id) ? ' fetching' : '');

    const head = document.createElement('div');
    head.className = 'repo-head';

    if (repo.avatarUrl) {
      const avatar = document.createElement('img');
      avatar.className = 'repo-avatar';
      avatar.src = repo.avatarUrl;
      avatar.alt = '';
      head.appendChild(avatar);
    }

    // a real anchor like Bookmarks: middle-click / ctrl-click / plain
    // click all open the repo in a new tab. Main title is the repo name
    // only; the owner stays visible as a small secondary label
    const titleWrap = document.createElement('div');
    titleWrap.className = 'repo-title';
    const link = document.createElement('a');
    link.className = 'repo-link';
    link.href = repo.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = repo.name;
    link.title = repo.url;
    const owner = document.createElement('span');
    owner.className = 'repo-owner';
    owner.textContent = repo.owner;
    owner.title = repo.owner;
    titleWrap.append(link, owner);
    head.appendChild(titleWrap);

    const actions = document.createElement('div');
    actions.className = 'repo-actions';

    const moveUp = document.createElement('button');
    moveUp.type = 'button';
    moveUp.className = 'repo-move';
    moveUp.textContent = CARET_UP;
    moveUp.title = 'move up';
    moveUp.disabled = index === 0;
    moveUp.addEventListener('click', () => moveRepo(repo, -1));
    const moveDown = document.createElement('button');
    moveDown.type = 'button';
    moveDown.className = 'repo-move';
    moveDown.textContent = CARET_DOWN;
    moveDown.title = 'move down';
    moveDown.disabled = index === visibleCount - 1;
    moveDown.addEventListener('click', () => moveRepo(repo, +1));

    // re-fetch on demand (stale stars/description); on a fetchFailed card
    // the same button is the retry
    const refetch = document.createElement('button');
    refetch.type = 'button';
    refetch.className = 'repo-refetch';
    refetch.textContent = REFRESH_GLYPH;
    refetch.title = repo.fetchFailed ? 'retry fetch' : 'refresh details';
    refetch.addEventListener('click', () => fetchDetails(repo));

    const expand = document.createElement('button');
    expand.type = 'button';
    expand.className = 'repo-expand';
    expand.textContent = expanded === repo ? CARET_UP : CARET_DOWN;
    expand.title = expanded === repo ? 'hide note editor' : 'edit note';
    expand.addEventListener('click', () => {
      expanded = expanded === repo ? null : repo;
      renderGrid();
    });

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'repo-remove';
    removeBtn.textContent = '×';
    removeBtn.title = 'remove repo';
    removeBtn.addEventListener('click', () => {
      repos.splice(repos.indexOf(repo), 1);
      if (expanded === repo) expanded = null;
      persist();
      renderGrid();
    });

    actions.append(moveUp, moveDown, refetch, expand, removeBtn);
    head.appendChild(actions);
    li.appendChild(head);

    if (fetching.has(repo.id)) {
      const loading = document.createElement('div');
      loading.className = 'repo-loading';
      loading.textContent = 'fetching…';
      li.appendChild(loading);
    } else if (repo.fetchFailed) {
      const failed = document.createElement('div');
      failed.className = 'repo-failed';
      failed.textContent = "couldn't fetch details — rate limit, private repo or 404?";
      li.appendChild(failed);
    } else {
      if (repo.description) {
        const desc = document.createElement('p');
        desc.className = 'repo-desc';
        desc.textContent = repo.description;
        li.appendChild(desc);
      }
      if (repo.language || repo.stars) {
        const stats = document.createElement('div');
        stats.className = 'repo-stats';
        if (repo.language) {
          const lang = document.createElement('span');
          lang.className = 'repo-language';
          lang.textContent = repo.language;
          stats.appendChild(lang);
        }
        const stars = document.createElement('span');
        stars.className = 'repo-stars';
        const glyph = document.createElement('span');
        glyph.className = 'repo-star';
        glyph.textContent = STAR_GLYPH;
        stars.append(glyph, String(repo.stars));
        stats.appendChild(stars);
        li.appendChild(stats);
      }
    }

    // personal note: always visible in the card (Tasks description
    // convention) — italic/muted so it reads as "your commentary" next
    // to the fetched description
    if (repo.note) {
      const note = document.createElement('p');
      note.className = 'repo-note';
      note.textContent = repo.note;
      li.appendChild(note);
    }

    // tags: chips (always visible) + the add row (hover-revealed per
    // card, see .repo-tag-add) — available on every card, they're user
    // data independent of the fetch state
    const tagList = document.createElement('ul');
    tagList.className = 'repo-tags';
    for (const tag of repo.tags) {
      const tagLi = document.createElement('li');
      tagLi.className = 'repo-tag';
      const tagLabel = document.createElement('span');
      tagLabel.textContent = tag;
      const tagRemove = document.createElement('button');
      tagRemove.type = 'button';
      tagRemove.className = 'repo-tag-remove';
      tagRemove.textContent = '×';
      tagRemove.title = 'remove tag';
      tagRemove.addEventListener('click', () => {
        repo.tags.splice(repo.tags.indexOf(tag), 1);
        persist();
        renderGrid();
      });
      tagLi.append(tagLabel, tagRemove);
      tagList.appendChild(tagLi);
    }
    const tagAdd = document.createElement('li');
    tagAdd.className = 'repo-tag-add';
    const tagInput = document.createElement('input');
    tagInput.type = 'text';
    tagInput.placeholder = 'add tag…';
    const tagBtn = document.createElement('button');
    tagBtn.type = 'button';
    tagBtn.textContent = '+';
    tagBtn.title = 'add tag';
    const addTag = () => {
      const tag = tagInput.value.trim();
      if (!tag) return;
      if (!repo.tags.includes(tag)) repo.tags.push(tag);
      tagInput.value = '';
      persist();
      renderGrid();
    };
    tagBtn.addEventListener('click', addTag);
    tagInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') addTag();
    });
    tagAdd.append(tagInput, tagBtn);
    tagList.appendChild(tagAdd);
    li.appendChild(tagList);

    // tag suggestions: tags already in use on this device, filtered to
    // what has been typed so far (Goals category convention); a click
    // adds the tag immediately
    const suggestions = document.createElement('div');
    suggestions.className = 'repo-tag-suggestions';
    function renderSuggestions() {
      suggestions.innerHTML = '';
      const typed = tagInput.value.trim().toLowerCase();
      for (const used of usedTags()) {
        if (repo.tags.includes(used)) continue;
        if (used.toLowerCase() === typed) continue;
        if (typed && !used.toLowerCase().includes(typed)) continue;
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'repo-tag-chip';
        chip.textContent = used;
        chip.addEventListener('click', () => {
          repo.tags.push(used);
          persist();
          renderGrid();
        });
        suggestions.appendChild(chip);
      }
    }
    tagInput.addEventListener('input', renderSuggestions);
    renderSuggestions();
    li.appendChild(suggestions);

    // note editor opens inside the card so the grid row stays intact
    if (expanded === repo) {
      li.appendChild(renderNoteEditor(repo));
    }

    return li;
  }

  function renderNoteEditor(repo) {
    const edit = document.createElement('div');
    edit.className = 'repo-note-edit';
    const note = document.createElement('textarea');
    note.placeholder = 'your note — why this repo?';
    note.value = repo.note;
    note.addEventListener('input', () => {
      repo.note = note.value;
      persist(); // no re-render: focus stays in the textarea (Tasks convention)
    });
    edit.appendChild(note);
    return edit;
  }

  function usedTags() {
    return [...new Set(repos.flatMap((repo) => repo.tags))];
  }

  // manual reordering: array order IS the display order, so moving swaps
  // positions with the neighbouring *visible* card (filter-aware, like
  // Tasks/Goals)
  function moveRepo(repo, dir) {
    const visible = visibleRepos();
    const neighbor = visible[visible.indexOf(repo) + dir];
    if (!neighbor) return; // already at the edge of the (visible) grid
    const from = repos.indexOf(repo);
    const to = repos.indexOf(neighbor);
    [repos[from], repos[to]] = [repos[to], repos[from]];
    persist();
    renderGrid();
  }

  // one API call, on demand only: adds populate once, the card button
  // re-fetches, failures set fetchFailed instead of dropping the entry
  async function fetchDetails(repo) {
    fetching.add(repo.id);
    renderGrid();
    try {
      const details = await fetchRepoDetails(repo);
      if (disposed) return;
      Object.assign(repo, details, { fetchFailed: false });
    } catch {
      if (disposed) return;
      repo.fetchFailed = true;
    }
    fetching.delete(repo.id);
    persist();
    renderGrid();
  }

  function addRepo() {
    error.textContent = '';
    const parsed = parseRepoUrl(urlInput.value.trim());
    if (!parsed) {
      error.textContent = 'not a github repo url — use https://github.com/owner/repo';
      return;
    }
    const repo = normalize([parsed])[0];
    repos.push(repo);
    urlInput.value = '';
    persist(); // entry saves immediately; details arrive async
    renderGrid();
    fetchDetails(repo);
  }

  renderGrid();
}

function unmount(container) {
  disposed = true; // abandon any in-flight details fetch
  container.innerHTML = ''; // listeners die with the elements
}

registerModule({
  id: 'repositories',
  name: 'Repositories',
  icon: REPOS_ICON,
  mount,
  unmount,
});