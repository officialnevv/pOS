/*
 * pOS — js/modules/pomodoro.js
 * ----------------------------------------------------------------------
 * Pomodoro module — a live focus timer (Spec §8, amendment).
 *
 * Centerpiece is an SVG progress ring: the mm:ss countdown sits in the
 * middle and a circular stroke depletes around it as the current phase
 * (work/break) counts down (stroke-dasharray/stroke-dashoffset vs the
 * phase's total duration). Below it: custom start/pause + reset buttons,
 * then custom +/- steppers for the work/break lengths (no native input
 * elements — everything themed via CSS variables, sharp corners).
 *
 * Configurable work/break interval lengths (defaults 25 min / 5 min).
 * When a phase completes, the timer switches to the other phase
 * automatically and keeps running; the time display flashes and the ring
 * refills on the switch as a visual cue.
 *
 * Persistence is deliberately partial (Spec §9): the live countdown
 * (phase, remaining time, running state) resets on page reload and is
 * never saved. Completed work sessions, however, log to
 * moduleData.pomodoro as { completedAt, durationMinutes } entries —
 * history for the Dashboard's session chart. The tick interval lives in
 * mount scope; unmount clears it so a closed window stops ticking.
 */

import { registerModule } from '../modules.js';

const POMODORO_ICON = '\uf2f2'; // nf-fa-stopwatch

const MIN_MINUTES = 1;
const MAX_MINUTES = 180;

let teardown = null; // set by mount, called by unmount to stop the interval

function mount(container, context) {
  // live session state — resets on every mount/reload by design (only
  // completed work sessions are logged to moduleData, see logSession)
  let workMin = 25;
  let breakMin = 5;
  let phase = 'work'; // 'work' | 'break'
  let remaining = workMin * 60; // seconds left in the current phase
  let running = false;
  let timerId = null;

  // completed work sessions log to moduleData.pomodoro (feeding the
  // Dashboard's session-history chart); the live countdown itself is
  // still deliberately session-only
  const logSession = (minutes) => {
    const data = context.load() ?? {};
    const sessionLog = Array.isArray(data.sessionLog) ? data.sessionLog : [];
    sessionLog.push({ completedAt: Date.now(), durationMinutes: minutes });
    context.persist({ sessionLog });
  };

  // embedded title: icon + module name (Spec §2)
  const title = document.createElement('div');
  title.className = 'module-title';
  const titleIcon = document.createElement('span');
  titleIcon.className = 'module-title-icon';
  titleIcon.textContent = POMODORO_ICON;
  const titleName = document.createElement('span');
  titleName.textContent = 'Pomodoro';
  title.append(titleIcon, titleName);

  /* ---- progress ring (SVG) ---- */
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const RING_R = 52; // ring radius inside the 120x120 viewBox
  const RING_C = 2 * Math.PI * RING_R; // full circumference

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 120 120');
  svg.setAttribute('class', 'pomodoro-ring');

  const track = document.createElementNS(SVG_NS, 'circle');
  track.setAttribute('cx', '60');
  track.setAttribute('cy', '60');
  track.setAttribute('r', String(RING_R));
  track.setAttribute('class', 'pomodoro-ring-track');

  const progress = document.createElementNS(SVG_NS, 'circle');
  progress.setAttribute('cx', '60');
  progress.setAttribute('cy', '60');
  progress.setAttribute('r', String(RING_R));
  progress.setAttribute('class', 'pomodoro-ring-progress');
  // start at 12 o'clock so depletion reads like a clock winding down
  progress.setAttribute('transform', 'rotate(-90 60 60)');
  // dasharray = circumference; dashoffset grows from 0 (full ring) to
  // C (empty) as remaining shrinks — see renderTime()
  progress.setAttribute('stroke-dasharray', String(RING_C));
  progress.setAttribute('stroke-dashoffset', '0');

  // countdown + phase label, centered inside the ring
  const timeEl = document.createElementNS(SVG_NS, 'text');
  timeEl.setAttribute('class', 'pomodoro-time');
  timeEl.setAttribute('x', '60');
  timeEl.setAttribute('y', '66');
  timeEl.setAttribute('text-anchor', 'middle');
  const phaseEl = document.createElementNS(SVG_NS, 'text');
  phaseEl.setAttribute('class', 'pomodoro-phase');
  phaseEl.setAttribute('x', '60');
  phaseEl.setAttribute('y', '88');
  phaseEl.setAttribute('text-anchor', 'middle');

  svg.append(track, progress, timeEl, phaseEl);

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

  // configurable interval lengths: custom steppers (label − value +),
  // no native number inputs (their spinner arrows don't reskin)
  const config = document.createElement('div');
  config.className = 'pomodoro-config';

  function makeStepper(labelText, get, set) {
    const wrap = document.createElement('div');
    wrap.className = 'pomodoro-stepper';
    // label on its own line above the controls
    const label = document.createElement('span');
    label.className = 'pomodoro-stepper-label';
    label.textContent = labelText;
    const row = document.createElement('div');
    row.className = 'pomodoro-step-controls';
    const minus = document.createElement('button');
    minus.type = 'button';
    minus.className = 'pomodoro-step-btn';
    minus.textContent = '\u2212'; // minus sign
    minus.title = 'decrease ' + labelText + ' duration';
    const value = document.createElement('span');
    value.className = 'pomodoro-step-value';
    const plus = document.createElement('button');
    plus.type = 'button';
    plus.className = 'pomodoro-step-btn';
    plus.textContent = '+';
    plus.title = 'increase ' + labelText + ' duration';
    minus.addEventListener('click', () => {
      set(Math.max(MIN_MINUTES, get() - 1));
      value.textContent = String(get());
      if (!running) {
        remaining = durationSec(); // paused: apply to the current phase now
        renderTime();
      }
    });
    plus.addEventListener('click', () => {
      set(Math.min(MAX_MINUTES, get() + 1));
      value.textContent = String(get());
      if (!running) {
        remaining = durationSec();
        renderTime();
      }
    });
    row.append(minus, value, plus);
    wrap.append(label, row);
    return { wrap, value };
  }

  const workStep = makeStepper(
    'work',
    () => workMin,
    (v) => { workMin = v; }
  );
  const breakStep = makeStepper(
    'break',
    () => breakMin,
    (v) => { breakMin = v; }
  );
  // both steppers must show their current duration from the start
  workStep.value.textContent = String(workMin);
  breakStep.value.textContent = String(breakMin);
  config.append(workStep.wrap, breakStep.wrap);

  // single root wrapper: .pomodoro is a flex column with align-items
  // center, so the ring, the buttons and the steppers all share one
  // centering authority and stay aligned at any window width
  const rootEl = document.createElement('div');
  rootEl.className = 'pomodoro';
  rootEl.append(title, svg, controls, config);
  container.append(rootEl);

  /* ---- timer logic ---- */
  const durationSec = () => (phase === 'work' ? workMin : breakMin) * 60;

  const fmt = (s) =>
    String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');

  function renderTime() {
    timeEl.textContent = fmt(remaining);
    phaseEl.textContent = phase;
    phaseEl.classList.toggle('work', phase === 'work');
    phaseEl.classList.toggle('break', phase === 'break');
    svg.classList.toggle('break', phase === 'break'); // ring recolors per phase
    startBtn.textContent = running ? 'pause' : 'start';
    startBtn.title = running ? 'pause the countdown' : 'start the countdown';
    startBtn.classList.toggle('running', running);
    // ring depletes: full circle (offset 0) at the phase start, gone
    // (offset = circumference) at zero
    progress.setAttribute(
      'stroke-dashoffset',
      String(RING_C * (1 - remaining / durationSec()))
    );
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
      if (phase === 'work') logSession(workMin); // work session completed
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

  /* ---- events ---- */
  startBtn.addEventListener('click', () => setRunning(!running));
  resetBtn.addEventListener('click', () => {
    stopTimer();
    running = false;
    remaining = durationSec();
    renderTime();
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
