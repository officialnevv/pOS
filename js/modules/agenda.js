/*
 * pOS — js/modules/agenda.js
 * ----------------------------------------------------------------------
 * Agenda module — personal, standalone date-based reminders/notes
 * (Spec §8, amendment). Entirely manual: entries are added with a date
 * and a short note, shown soonest-first; nothing syncs to any external
 * calendar service.
 *
 * Entries persist as an array of { date, note } under the module's own
 * moduleData.agenda slice (Spec §9). Partial/legacy entries are
 * normalized on load (empty date sorts last, missing note -> '').
 */

import { registerModule } from '../modules.js';

const AGENDA_ICON = '\uf073'; // nf-fa-calendar

function normalize(list) {
  return (Array.isArray(list) ? list : []).map((it) => ({
    date: typeof it?.date === 'string' ? it.date : '',
    note: typeof it?.note === 'string' ? it.note : '',
  }));
}

function mount(container, context) {
  let items = normalize(context.load());
  const persist = () => context.persist(items);

  // embedded title: icon + module name (Spec §2)
  const title = document.createElement('div');
  title.className = 'module-title';
  const titleIcon = document.createElement('span');
  titleIcon.className = 'module-title-icon';
  titleIcon.textContent = AGENDA_ICON;
  const titleName = document.createElement('span');
  titleName.textContent = 'Agenda';
  title.append(titleIcon, titleName);

  // add row: date + note + add button (same form pattern as .tasks-add)
  const addRow = document.createElement('div');
  addRow.className = 'agenda-add';
  const dateInput = document.createElement('input');
  dateInput.type = 'date';
  const noteInput = document.createElement('input');
  noteInput.type = 'text';
  noteInput.placeholder = 'what and why…';
  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.textContent = '+';
  addRow.append(dateInput, noteInput, addBtn);

  const list = document.createElement('ul');
  list.className = 'agenda-list';

  container.append(title, addRow, list);

  /* ---- helpers ---- */
  // ascending by date; undated entries sort last, then by insertion order
  const byDate = (a, b) => {
    if (a.date === b.date) return 0;
    if (!a.date) return 1;
    if (!b.date) return -1;
    return a.date < b.date ? -1 : 1;
  };

  const formatDate = (iso) => {
    if (!iso) return 'no date';
    const d = new Date(iso + 'T12:00:00'); // noon avoids TZ day-shifts
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' });
  };

  /* ---- rendering ---- */
  function renderList() {
    list.innerHTML = '';
    const visible = [...items].sort(byDate);
    if (!visible.length) {
      const li = document.createElement('li');
      li.className = 'agenda-empty';
      li.textContent = 'nothing planned — add an entry above';
      list.appendChild(li);
      return;
    }
    for (const item of visible) {
      const li = document.createElement('li');
      li.className = 'agenda-item';

      const date = document.createElement('span');
      date.className = 'agenda-date';
      date.textContent = formatDate(item.date);
      date.title = item.date || 'no date';

      const note = document.createElement('span');
      note.className = 'agenda-note';
      note.textContent = item.note;

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'agenda-remove';
      removeBtn.textContent = '×';
      removeBtn.title = 'remove entry';
      removeBtn.addEventListener('click', () => {
        items.splice(items.indexOf(item), 1);
        persist();
        renderList();
      });

      li.append(date, note, removeBtn);
      list.appendChild(li);
    }
  }

  function addItem() {
    const note = noteInput.value.trim();
    if (!note && !dateInput.value) return;
    items.push(normalize([{ date: dateInput.value, note }])[0]);
    noteInput.value = '';
    persist();
    renderList(); // render sorts soonest-first
  }

  /* ---- events ---- */
  addBtn.addEventListener('click', addItem);
  noteInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addItem();
  });
  dateInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addItem();
  });

  renderList();
}

function unmount(container) {
  container.innerHTML = ''; // listeners die with the elements
}

registerModule({
  id: 'agenda',
  name: 'Agenda',
  icon: AGENDA_ICON,
  mount,
  unmount,
});
