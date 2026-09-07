/*
 * PersonalOS — js/lockscreen.js
 * ----------------------------------------------------------------------
 * Lock screen overlay (Spec §12).
 *
 * A minimal, purely client-side UI gate — a soft deterrent, not real
 * security (the PIN is hardcoded below by spec; localStorage data is
 * not encrypted or protected).
 *
 * Behaviour:
 *   - Full-screen, theme-aware overlay covering everything (shown on
 *     every page load via initLockScreen(), Spec §12).
 *   - "Personal OS" is a display label, NOT an editable input.
 *   - PIN: 464466. Correct -> overlay dismissed. Wrong -> brief error
 *     text + shake animation + input cleared; no lockout, no limiting.
 *
 * NOTE: the spec's optional manual-lock example (Alt+Shift+L) collides
 * with the Spec §10 resize keybind Alt+Shift+L, so lockNow() is
 * exported but intentionally unbound. Wire it to any spare key later
 * (e.g. Alt+Shift+P) or a small top-bar icon if wanted.
 */

const LOCK_PIN = '464466';

let lockOverlay = null;

function buildOverlay() {
  const overlay = document.createElement('div');
  overlay.id = 'lock-screen';

  const box = document.createElement('div');
  box.className = 'lock-box';

  // display label — pre-filled and not editable (Spec §12)
  const title = document.createElement('div');
  title.className = 'lock-title';
  title.textContent = 'Personal OS';

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

  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (input.value === LOCK_PIN) {
      overlay.remove();
      lockOverlay = null;
    } else {
      error.textContent = 'wrong PIN';
      box.classList.remove('shake');
      void box.offsetWidth; // restart the CSS animation
      box.classList.add('shake');
      input.value = '';
    }
  });
  input.addEventListener('input', () => {
    error.textContent = '';
  });

  return { overlay, input };
}

/** Show the lock overlay (idempotent). */
export function lockNow() {
  if (lockOverlay) return;
  const { overlay, input } = buildOverlay();
  document.body.appendChild(overlay);
  lockOverlay = overlay;
  input.focus();
}

/** Lock automatically on every page load (Spec §12). */
export function initLockScreen() {
  lockNow();
}
