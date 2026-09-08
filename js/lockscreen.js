/*
 * pOS — js/lockscreen.js
 * ----------------------------------------------------------------------
 * Lock screen overlay (Spec §12, as amended).
 *
 * A minimal, purely client-side UI gate — a soft deterrent, not real
 * security (the PIN is hardcoded below by spec; localStorage data is
 * not encrypted or protected).
 *
 * Behaviour:
 *   - Full-screen, theme-aware overlay covering everything (shown on
 *     every page load via initLockScreen(), Spec §12).
 *   - "pOS" is a display label, NOT an editable input.
 *   - PIN: 000000. Unlocks the moment the correct PIN is fully typed —
 *     no Enter needed. The overlay fades out via a CSS opacity
 *     transition instead of vanishing instantly.
 *   - Wrong PIN -> brief error text + shake animation + input cleared;
 *     no lockout, no limiting. Enter still works as a redundant submit.
 *
 * NOTE: lockNow() is exported but intentionally unbound (the spec's
 * manual-lock trigger is optional). Wire it to any spare key later
 * (e.g. Alt+Shift+P) or a small top-bar icon if wanted.
 */

const LOCK_PIN = '000000';
const FADE_MS = 400; // keep in sync with the #lock-screen CSS transition

let lockOverlay = null;
let lockInput = null;

function buildOverlay() {
  const overlay = document.createElement('div');
  overlay.id = 'lock-screen';

  const box = document.createElement('div');
  box.className = 'lock-box';

  // display label — pre-filled and not editable (Spec §12)
  const title = document.createElement('div');
  title.className = 'lock-title';
  title.textContent = 'pOS';

  const input = document.createElement('input');
  input.className = 'lock-input';
  input.type = 'password';
  input.placeholder = 'PIN';
  input.inputMode = 'numeric';
  input.autocomplete = 'off';

  const error = document.createElement('div');
  error.className = 'lock-error';

  box.append(title, input, error);
  overlay.appendChild(box);

  input.addEventListener('input', () => {
    error.textContent = '';
    // unlock as soon as the full PIN is typed
    if (input.value === LOCK_PIN) unlock();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (input.value === LOCK_PIN) {
      unlock(); // redundant path — auto-unlock already covers this
    } else {
      error.textContent = 'wrong PIN';
      box.classList.remove('shake');
      void box.offsetWidth; // restart the CSS animation
      box.classList.add('shake');
      input.value = '';
    }
  });

  return { overlay, input };
}

/** Fade the overlay out, then remove it from the DOM. */
function unlock() {
  // the Enter keydown can land right after auto-unlock — nothing to do then
  if (!lockOverlay) return;
  const overlay = lockOverlay;
  lockInput.disabled = true; // block edits during the fade
  lockOverlay = null;
  lockInput = null;
  overlay.classList.add('hiding'); // CSS opacity transition (style.css)
  setTimeout(() => overlay.remove(), FADE_MS);
}

/** Show the lock overlay (idempotent). */
export function lockNow() {
  if (lockOverlay) return;
  const { overlay, input } = buildOverlay();
  document.body.appendChild(overlay);
  lockOverlay = overlay;
  lockInput = input;
  input.focus();
}

/** Lock automatically on every page load (Spec §12). */
export function initLockScreen() {
  lockNow();
}

