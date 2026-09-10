/*
 * pOS — js/modules/shoppingcart.js
 * ----------------------------------------------------------------------
 * Shopping Cart module — a manual shopping/tracking list.
 *
 * Closest to Tasks-style reordering: add an item with a name and a
 * numeric price (validated
 * inline), optionally a stored link (the name becomes a clickable link,
 * opened in a new tab) and a free-text site label. Quantity is adjusted
 * with a custom +/- stepper (Pomodoro/Goals pattern); purchased items
 * toggle dimmed/strikethrough (the shared purchased/watched convention)
 * in the list. Totals: "remaining" (unpurchased) always, plus a smaller
 * "purchased" total when any purchased items exist.
 *
 * No checkout integration, no price/title auto-fetch, no currency
 * handling — amounts are plain numbers rendered with a "$" prefix in a
 * single assumed currency. Data persists as an array of item objects
 * under the module's own moduleData.shoppingCart slice; array
 * order is the display order. Entries saved before the extra fields
 * existed are normalized on load.
 */

import { createModuleTitle, registerModule } from '../modules.js';

const CART_ICON = '\uf07a';   // nf-fa-shopping-cart
const CHECK_GLYPH = '\uf00c'; // Nerd Font check, drawn inside the checkbox
const CARET_DOWN = '\uf0d7';  // nf-fa-caret_down
const CARET_UP = '\uf0d8';    // nf-fa-caret_up
const MIN_QUANTITY = 1;

// single assumed currency; amounts are plain numbers in moduleData
const money = (amount) => `$${amount.toFixed(2)}`;

// Tolerate old/partial saved entries: missing fields default to
// quantity 1, not purchased, no link/site.
function normalize(list) {
  return (Array.isArray(list) ? list : [])
    .map((item) => ({
      id: typeof item?.id === 'string' ? item.id : crypto.randomUUID(),
      name: typeof item?.name === 'string' ? item.name : '',
      price: typeof item?.price === 'number' ? item.price : 0,
      link: typeof item?.link === 'string' ? item.link : '',
      site: typeof item?.site === 'string' ? item.site : '',
      quantity: Number.isInteger(item?.quantity) && item.quantity > 0
        ? item.quantity
        : 1,
      purchased: !!item?.purchased,
      addedAt: typeof item?.addedAt === 'number' ? item.addedAt : Date.now(),
    }))
    .filter((item) => item.name);
}

function mount(container, context) {
  let items = normalize(context.load());
  const persist = () => context.persist(items);

  const title = createModuleTitle(CART_ICON, 'Shopping Cart');

  // add row (always visible): name + price required, link/site optional
  const addRow = document.createElement('div');
  addRow.className = 'module-add-row';
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.placeholder = 'item name…';
  const priceInput = document.createElement('input');
  priceInput.type = 'text';
  priceInput.placeholder = 'price…';
  priceInput.setAttribute('inputmode', 'decimal');
  const linkInput = document.createElement('input');
  linkInput.type = 'text';
  linkInput.placeholder = 'link (optional)…';
  const siteInput = document.createElement('input');
  siteInput.type = 'text';
  siteInput.placeholder = 'site (optional)…';
  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.textContent = '+';
  addRow.append(nameInput, priceInput, linkInput, siteInput, addBtn);

  // inline validation error (hidden while empty)
  const errorEl = document.createElement('div');
  errorEl.className = 'cart-error';

  const list = document.createElement('ul');
  list.className = 'cart-list';

  const totalsEl = document.createElement('div');
  totalsEl.className = 'cart-totals';

  container.append(title, addRow, errorEl, list, totalsEl);

  /* ---- events ---- */
  addBtn.addEventListener('click', addItem);
  for (const input of [nameInput, priceInput, linkInput, siteInput]) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') addItem();
    });
    input.addEventListener('input', () => {
      errorEl.textContent = '';
    });
  }

  /* ---- rendering ---- */
  function renderCart() {
    list.innerHTML = '';
    if (!items.length) {
      const empty = document.createElement('li');
      empty.className = 'cart-empty';
      empty.textContent = 'nothing here — add an item above';
      list.appendChild(empty);
    }
    for (const item of items) {
      list.appendChild(renderItem(item));
    }
    renderTotals();
  }

  function renderItem(item) {
    const li = document.createElement('li');
    li.className = 'cart-item' + (item.purchased ? ' purchased' : '');

    // purchased toggle: theme-drawn box, NF check glyph when purchased
    const check = document.createElement('button');
    check.type = 'button';
    check.className = 'cart-check';
    check.textContent = item.purchased ? CHECK_GLYPH : '';
    check.title = item.purchased ? 'mark as not purchased' : 'mark as purchased';
    check.addEventListener('click', () => {
      item.purchased = !item.purchased;
      persist();
      renderCart();
    });

    const main = document.createElement('div');
    main.className = 'cart-main';

    // name: a real link when a link is stored,
    // plain text otherwise
    const nameEl = item.link
      ? document.createElement('a')
      : document.createElement('span');
    nameEl.className = item.link ? 'cart-link' : 'cart-name';
    if (item.link) {
      nameEl.href = item.link;
      nameEl.target = '_blank';
      nameEl.rel = 'noopener noreferrer';
    }
    nameEl.textContent = item.name;
    nameEl.title = item.name;

    const siteEl = document.createElement('span');
    siteEl.className = 'cart-site';
    siteEl.textContent = item.site;
    siteEl.title = item.site;

    const priceEl = document.createElement('span');
    priceEl.className = 'cart-price';
    priceEl.textContent = money(item.price);
    // line total (price x quantity) only when the quantity is above one
    let lineTotal = null;
    if (item.quantity > 1) {
      lineTotal = document.createElement('span');
      lineTotal.className = 'cart-line-total';
      lineTotal.textContent = `${money(item.price * item.quantity)} total`;
    }

    const nameRow = document.createElement('div');
    nameRow.className = 'cart-name-row';
    nameRow.append(nameEl);
    if (item.site) nameRow.appendChild(siteEl);

    const priceRow = document.createElement('div');
    priceRow.className = 'cart-price-row';
    priceRow.appendChild(priceEl);
    if (lineTotal) priceRow.appendChild(lineTotal);

    main.append(nameRow, priceRow);

    const stepper = document.createElement('div');
    stepper.className = 'cart-qty';
    const minus = document.createElement('button');
    minus.type = 'button';
    minus.className = 'cart-qty-btn';
    minus.textContent = '\u2212'; // minus sign
    minus.title = 'decrease quantity';
    const qty = document.createElement('span');
    qty.className = 'cart-qty-value';
    qty.textContent = String(item.quantity);
    const plus = document.createElement('button');
    plus.type = 'button';
    plus.className = 'cart-qty-btn';
    plus.textContent = '+';
    plus.title = 'increase quantity';
    minus.addEventListener('click', () => {
      item.quantity = Math.max(MIN_QUANTITY, item.quantity - 1);
      persist();
      renderCart();
    });
    plus.addEventListener('click', () => {
      item.quantity += 1;
      persist();
      renderCart();
    });
    stepper.append(minus, qty, plus);

    const actions = document.createElement('div');
    actions.className = 'cart-actions';
    const moveUp = document.createElement('button');
    moveUp.type = 'button';
    moveUp.className = 'cart-move';
    moveUp.textContent = CARET_UP;
    moveUp.title = 'move up';
    moveUp.disabled = item === items[0];
    moveUp.addEventListener('click', () => moveItem(item, -1));
    const moveDown = document.createElement('button');
    moveDown.type = 'button';
    moveDown.className = 'cart-move';
    moveDown.textContent = CARET_DOWN;
    moveDown.title = 'move down';
    moveDown.disabled = item === items[items.length - 1];
    moveDown.addEventListener('click', () => moveItem(item, +1));
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'cart-remove';
    removeBtn.textContent = '×';
    removeBtn.title = 'remove item';
    removeBtn.addEventListener('click', () => {
      items.splice(items.indexOf(item), 1);
      persist();
      renderCart();
    });
    actions.append(moveUp, moveDown, removeBtn);

    li.append(check, main, stepper, actions);
    return li;
  }

  // totals: "remaining" (unpurchased) always; the purchased total shows
  // separately only while any purchased items exist, so the headline
  // total is never silently inflated by already-bought items
  function renderTotals() {
    totalsEl.innerHTML = '';
    const remaining = items
      .filter((item) => !item.purchased)
      .reduce((sum, item) => sum + item.price * item.quantity, 0);
    const purchased = items
      .filter((item) => item.purchased)
      .reduce((sum, item) => sum + item.price * item.quantity, 0);

    const remainingEl = document.createElement('span');
    remainingEl.className = 'cart-total-remaining';
    remainingEl.textContent = `remaining: ${money(remaining)}`;
    totalsEl.appendChild(remainingEl);

    if (purchased > 0) {
      const purchasedEl = document.createElement('span');
      purchasedEl.className = 'cart-total-purchased';
      purchasedEl.textContent = `purchased: ${money(purchased)}`;
      totalsEl.appendChild(purchasedEl);
    }
  }

  // manual reordering: array order IS the display order
  function moveItem(item, dir) {
    const from = items.indexOf(item);
    const to = from + dir;
    if (to < 0 || to >= items.length) return; // already at a list edge
    [items[from], items[to]] = [items[to], items[from]];
    persist();
    renderCart();
  }

  function addItem() {
    errorEl.textContent = '';
    const name = nameInput.value.trim();
    const priceValue = priceInput.value.trim();
    if (!name || !priceValue) {
      errorEl.textContent = 'name and price are required';
      return;
    }
    const price = Number(priceValue);
    if (!Number.isFinite(price) || price < 0) {
      errorEl.textContent = 'price must be a non-negative number';
      return;
    }
    items.push(normalize([{
      name,
      price,
      link: linkInput.value.trim(),
      site: siteInput.value.trim(),
    }])[0]);
    nameInput.value = '';
    priceInput.value = '';
    linkInput.value = '';
    siteInput.value = '';
    persist();
    renderCart();
  }

  renderCart();
}

function unmount(container) {
  container.innerHTML = ''; // listeners die with the elements
}

registerModule({
  id: 'shoppingCart',
  name: 'Shopping Cart',
  icon: CART_ICON,
  mount,
  unmount,
});