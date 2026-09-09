/*
 * pOS — js/modules/weather.js
 * ----------------------------------------------------------------------
 * Weather module — current conditions (temperature, condition, wind,
 * relative humidity) + short forecast for a saved city
 * (Spec §8, amendment). Data comes from Open-Meteo's free APIs (no key):
 *   geocoding: https://geocoding-api.open-meteo.com/v1/search?name={city}
 *   forecast:  https://api.open-meteo.com/v1/forecast?latitude={lat}&
 *              longitude={lon}&current_weather=true&
 *              daily=temperature_2m_max,temperature_2m_min,weathercode&
 *              timezone=auto
 *
 * The saved city persists as moduleData.weather = {
 *   city, place, country, lat, lon, forecast, fetchedAt } (Spec §9).
 * The last forecast is cached alongside a timestamp: reopening the module
 * renders instantly from cache and only refetches when the data is older
 * than CACHE_TTL_MS (~30 min). A small pencil icon reopens the city form.
 * In-flight fetches are abandoned if the window closes (disposed flag).
 */

import { registerModule } from '../modules.js';

const WEATHER_ICON = '\ueef0'; // nf-fa-cloud_sun
const HUMIDITY_ICON = '\uf043'; // nf-fa-tint (water drop)
const PENCIL_ICON = '\uf040';  // nf-fa-pencil (change-city affordance)

const GEO_URL = 'https://geocoding-api.open-meteo.com/v1/search?name=';
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const CACHE_TTL_MS = 30 * 60 * 1000; // refetch when older than ~30 minutes
const FORECAST_DAYS = 5;

// Nerd Font glyphs per WMO weather code family (verified against the
// official Nerd Fonts webfont.css)
const ICONS = {
  sun: '\uf185',      // nf-fa-sun
  cloudSun: '\ueef0', // nf-fa-cloud_sun
  cloud: '\uf0c2',    // nf-fa-cloud
  rain: '\uef1c',     // nf-fa-cloud_rain
  snow: '\uf2dc',     // nf-fa-snowflake
  fog: '\uef29',      // nf-fa-smog
  storm: '\uf0e7',    // nf-fa-bolt
};

/** WMO weather interpretation code -> [label, glyph]. */
function describeCode(code) {
  if (code === 0) return ['clear sky', ICONS.sun];
  if (code === 1 || code === 2) return ['partly cloudy', ICONS.cloudSun];
  if (code === 3) return ['overcast', ICONS.cloud];
  if (code === 45 || code === 48) return ['fog', ICONS.fog];
  if (code >= 51 && code <= 57) return ['drizzle', ICONS.rain];
  if (code >= 61 && code <= 67) return ['rain', ICONS.rain];
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return ['snow', ICONS.snow];
  if (code >= 80 && code <= 82) return ['showers', ICONS.rain];
  if (code >= 95) return ['thunderstorm', ICONS.storm];
  return ['unknown', ICONS.cloud];
}

let disposed = false;

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

function mount(container, context) {
  disposed = false;

  // persisted slice: { city, place, country, lat, lon, forecast, fetchedAt }
  let state = context.load();
  if (!state || typeof state !== 'object' || Array.isArray(state)) state = {};
  const persist = () => context.persist(state);

  // embedded title: icon + module name (Spec §2)
  const title = document.createElement('div');
  title.className = 'module-title';
  const titleIcon = document.createElement('span');
  titleIcon.className = 'module-title-icon';
  titleIcon.textContent = WEATHER_ICON;
  const titleName = document.createElement('span');
  titleName.textContent = 'Weather';
  title.append(titleIcon, titleName);

  // city entry / change form
  const form = document.createElement('div');
  form.className = 'weather-form';
  const cityInput = document.createElement('input');
  cityInput.type = 'text';
  cityInput.placeholder = 'city name…';
  const setBtn = document.createElement('button');
  setBtn.type = 'button';
  setBtn.textContent = 'save';
  setBtn.title = 'save city and load its forecast';
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.textContent = 'cancel';
  cancelBtn.title = 'keep the saved city';
  form.append(cityInput, setBtn, cancelBtn);

  const errorEl = document.createElement('div');
  errorEl.className = 'weather-error';

  // current-conditions view (icon + temp + condition/wind + humidity)
  const head = document.createElement('div');
  head.className = 'weather-head';
  const placeEl = document.createElement('span');
  placeEl.className = 'weather-place';
  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.className = 'weather-edit';
  editBtn.textContent = PENCIL_ICON;
  editBtn.title = 'change city';
  const stampEl = document.createElement('span');
  stampEl.className = 'weather-stamp';
  head.append(placeEl, editBtn, stampEl);

  const current = document.createElement('div');
  current.className = 'weather-current';
  const currentIcon = document.createElement('span');
  currentIcon.className = 'weather-icon';
  const tempEl = document.createElement('span');
  tempEl.className = 'weather-temp';
  const condEl = document.createElement('span');
  condEl.className = 'weather-cond';
  const humidityEl = document.createElement('span');
  humidityEl.className = 'weather-humidity';
  const humidityGlyph = document.createElement('span');
  humidityGlyph.className = 'weather-humidity-glyph';
  const humidityText = document.createElement('span');
  humidityEl.append(humidityGlyph, humidityText);
  current.append(currentIcon, tempEl, condEl, humidityEl);

  const daysEl = document.createElement('ul');
  daysEl.className = 'weather-days';

  const view = document.createElement('div');
  view.className = 'weather';
  view.append(form, errorEl, head, current, daysEl);
  container.append(title, view);

  /* ---- rendering ---- */
  const showForm = (prefill) => {
    form.style.display = '';
    cancelBtn.style.display = state.city ? '' : 'none';
    head.style.display = 'none';
    current.style.display = 'none';
    daysEl.style.display = 'none';
    cityInput.value = prefill ?? '';
  };

  const showView = () => {
    form.style.display = 'none';
    head.style.display = '';
    current.style.display = '';
    daysEl.style.display = '';
    placeEl.textContent = state.place || state.city;
  };

  const stamp = (text) => { stampEl.textContent = text; };

  function renderForecast() {
    const fc = state.forecast;
    if (!fc) {
      currentIcon.textContent = '';
      tempEl.textContent = '';
      condEl.textContent = 'no forecast yet';
      humidityGlyph.textContent = '';
      humidityText.textContent = '';
      daysEl.innerHTML = '';
      return;
    }
    const [label, glyph] = describeCode(fc.current?.weathercode);
    currentIcon.textContent = glyph;
    tempEl.textContent = `${Math.round(fc.current?.temperature ?? 0)}°C`;
    const wind = fc.current?.windspeed;
    condEl.textContent = label + (Number.isFinite(wind) ? ` · wind ${Math.round(wind)} km/h` : '');
    const humidity = fc.current?.relative_humidity_2m;
    humidityGlyph.textContent = Number.isFinite(humidity) ? HUMIDITY_ICON : '';
    humidityText.textContent = Number.isFinite(humidity) ? `${Math.round(humidity)}%` : '';

    daysEl.innerHTML = '';
    const days = fc.daily ?? {};
    const times = days.time ?? [];
    times.slice(0, FORECAST_DAYS).forEach((day, i) => {
      const li = document.createElement('li');
      li.className = 'weather-day';
      const name = document.createElement('span');
      name.className = 'weather-day-name';
      name.textContent = new Date(day + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short' });
      const [dayLabel, dayGlyph] = describeCode(days.weathercode?.[i]);
      const icon = document.createElement('span');
      icon.className = 'weather-day-icon';
      icon.textContent = dayGlyph;
      icon.title = dayLabel;
      const temps = document.createElement('span');
      temps.className = 'weather-day-temps';
      const min = document.createElement('span');
      min.className = 'min';
      min.textContent = `${Math.round(days.temperature_2m_min?.[i] ?? 0)}°`;
      const max = document.createElement('span');
      max.textContent = ` / ${Math.round(days.temperature_2m_max?.[i] ?? 0)}°`;
      temps.append(min, max);
      li.append(name, icon, temps);
      daysEl.appendChild(li);
    });
  }

  const cacheFresh = () =>
    !!state.forecast && Date.now() - (state.fetchedAt ?? 0) < CACHE_TTL_MS;

  const stampFresh = () =>
    stamp('updated ' + new Date(state.fetchedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }));

  /* ---- data flow ---- */
  async function refresh() {
    if (state.forecast) renderForecast(); // stale-while-revalidate: show cache
    if (cacheFresh()) {
      stampFresh();
      return;
    }
    stamp('updating…');
    try {
      const url = `${FORECAST_URL}?latitude=${state.lat}&longitude=${state.lon}` +
        `&current_weather=true&daily=temperature_2m_max,temperature_2m_min,weathercode&timezone=auto`;
      const data = await fetchJson(url);
      if (disposed) return;
      state.forecast = { current: data.current_weather, daily: data.daily };
      state.fetchedAt = Date.now();
      persist();
      renderForecast();
      stampFresh();
    } catch {
      if (disposed) return;
      if (state.forecast) {
        stamp('update failed — showing cached forecast');
      } else {
        errorEl.textContent = 'weather fetch failed — check your connection';
        showForm('');
      }
    }
  }

  async function setCity(name) {
    errorEl.textContent = '';
    stamp('looking up city…');
    try {
      const geo = await fetchJson(GEO_URL + encodeURIComponent(name));
      if (disposed) return;
      const hit = Array.isArray(geo.results) ? geo.results[0] : null;
      if (!hit) {
        errorEl.textContent = `no city named "${name}" found`;
        showForm(name);
        return;
      }
      state.city = name; // keep the user's spelling
      state.place = hit.name;
      state.country = hit.country ?? '';
      state.lat = hit.latitude;
      state.lon = hit.longitude;
      state.forecast = null;
      state.fetchedAt = 0;
      persist();
      showView();
      await refresh();
    } catch {
      if (disposed) return;
      errorEl.textContent = 'city lookup failed — check your connection';
      showForm(name);
    }
  }

  const submit = () => {
    const name = cityInput.value.trim();
    if (!name) {
      errorEl.textContent = 'enter a city name';
      return;
    }
    setCity(name);
  };

  /* ---- events ---- */
  setBtn.addEventListener('click', submit);
  cityInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    }
  });
  cancelBtn.addEventListener('click', () => {
    errorEl.textContent = '';
    showView();
    refresh();
  });
  editBtn.addEventListener('click', () => showForm(state.city));

  /* ---- initial paint ---- */
  if (state.city) {
    showView();
    refresh(); // renders cached data, refetches only when stale
  } else {
    showForm('');
  }
}

function unmount(container) {
  disposed = true; // abandon any in-flight fetch
  container.innerHTML = ''; // listeners die with the elements
}

registerModule({
  id: 'weather',
  name: 'Weather',
  icon: WEATHER_ICON,
  mount,
  unmount,
});

