/*
 * pOS — js/modules/pomodoro.js
 * ----------------------------------------------------------------------
 * Pomodoro module — a live focus timer (Spec §8, amendment).
 *
 * Configurable work/break interval lengths (defaults 25 min / 5 min),
 * start/pause/reset controls and a large mm:ss countdown. When a phase
 * completes, the timer switches to the other phase automatically and
 * keeps running; the time display flashes on the switch as a visual cue.
 *
 * Deliberately NOT persisted (Spec §9 does not apply here): it is a live
 * session timer, so it resets on page reload. The tick interval lives in
 * mount scope; unmount clears it so a closed window stops ticking.
 */

import { registerModule } from '../modules.js';

const POMODORO_ICON = '\uf2f2'; // nf-fa-stopwatch

const MIN_MINUTES = 1;
const MAX_MINUTES = 180;

let teardown = null; // set by mount, called by unmount to stop the interval

function mount(container) {
  // live session state — resets on every mount/reload by design
  let workMin = 25;
  let breakMin = 5;
  let phase = 'work'; // 'work' | 'break'
  let remaining = workMin * 60; // seconds left in the current phase
  let running = false;
  let timerId = null;

  // embedded title: icon + module name (Spec §2)
  const title = document.createElement('div');
  title.className = 'module-title';
  const titleIcon = document.createElement('span');
  titleIcon.className = 'module-title-icon';
  titleIcon.textContent = POMODORO_ICON;
  const titleName = document.createElement('span');
  titleName.textContent = 'Pomodoro';
  title.append(titleIcon, titleName);

  // countdown + phase label
  const timeEl = document.createElement('div');
  timeEl.className = 'pomodoro-time';
  const phaseEl = document.createElement('div');
  phaseEl.className = 'pomodoro-phase';

  // controls: start/pause + reset
  const controls = document.createElement('div');
  controls.className = 'pomodoro-controls';
  const startBtn = document.createElement('button');
  startBtn.type = 'button';
  startBtn.className = 'pomodoro-btn';
  const resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.className = 'pomodoro-btn';
  resetBtn.textContent = 'reset';
  resetBtn.title = 'reset current phase';
  controls.append(startBtn, resetBtn);

  // configurable interval lengths
  const config = document.createElement('div');
  config.className = 'pomodoro-config';
  const workLabel = document.createElement('span');
  workLabel.textContent = 'work';
  const workInput = document.createElement('input');
  workInput.type = 'number';
  workInput.min = String(MIN_MINUTES);
  workInput.max = String(MAX_MINUTES);
  workInput.step = '1';
  const breakLabel = document.createElement('span');
  breakLabel.textContent = 'break';
  const breakInput = document.createElement('input');
  breakInput.type = 'number';
  breakInput.min = String(MIN_MINUTES);
  breakInput.max = String(MAX_MINUTES);
  breakInput.step = '1';
  config.append(workLabel, workInput, breakLabel, breakInput);

  container.append(title, timeEl, phaseEl, controls, config);

  /* ---- timer logic ---- */
  const durationSec = () => (phase === 'work' ? workMin : breakMin) * 60;

  const fmt = (s) =>
    String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');

  function renderTime() {
    timeEl.textContent = fmt(remaining);
    phaseEl.textContent = phase;
    phaseEl.classList.toggle('work', phase === 'work');
    phaseEl.classList.toggle('break', phase === 'break');
    startBtn.textContent = running ? 'pause' : 'start';
    startBtn.title = running ? 'pause the countdown' : 'start the countdown';
  }

  function stopTimer() {
    if (timerId != null) {
      clearInterval(timerId);
      timerId = null;
    }
  }

  // visual cue on automatic phase switches (Spec amendment: optional)
  function flash() {
    timeEl.classList.add('flash');
    setTimeout(() => timeEl.classList.remove('flash'), 800);
  }

  function tick() {
    remaining -= 1;
    if (remaining <= 0) {
      phase = phase === 'work' ? 'break' : 'work';
      remaining = durationSec();
      flash();
    }
    renderTime();
  }

  function setRunning(run) {
    running = run;
    if (running) {
      timerId = setInterval(tick, 1000);
    } else {
      stopTimer();
    }
    renderTime();
  }

  // tolerate anything typed: clamp to sane bounds, fall back to previous
  const parseMinutes = (raw, fallback) => {
    const v = Math.round(Number(raw));
    if (!Number.isFinite(v)) return fallback;
    return Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, v));
  };

  /* ---- events ---- */
  startBtn.addEventListener('click', () => setRunning(!running));
  resetBtn.addEventListener('click', () => {
    stopTimer();
    running = false;
    remaining = durationSec();
    renderTime();
  });
  workInput.addEventListener('input', () => {
    workMin = parseMinutes(workInput.value, workMin);
    if (!running) {
      remaining = durationSec(); // paused: apply to the current phase now
      renderTime();
    }
  });
  breakInput.addEventListener('input', () => {
    breakMin = parseMinutes(breakInput.value, breakMin);
    if (!running) {
      remaining = durationSec();
      renderTime();
    }
  });

  teardown = () => stopTimer();
  renderTime();
}

function unmount(container) {
  if (teardown) teardown(); // stop the interval so closed windows don't tick
  teardown = null;
  container.innerHTML = ''; // listeners die with the elements
}

registerModule({
  id: 'pomodoro',
  name: 'Pomodoro',
  icon: POMODORO_ICON,
  mount,
  unmount,
});
