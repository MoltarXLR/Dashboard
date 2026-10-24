/* SITREP://TERMINAL — a retro terminal situational dashboard.
 * Pure browser JS, no build step. All data sources are public, keyless
 * (or use NASA's DEMO_KEY) and CORS-enabled so they can be called from the page.
 */
(() => {
  "use strict";

  const API = {
    reverseGeo: "https://api.bigdatacloud.net/data/reverse-geocode-client",
    ip: "https://api.ipify.org?format=json",
    ipGeo: "https://get.geojs.io/v1/ip/geo.json",
    cdcEd: "https://data.cdc.gov/resource/rdmq-nq56.json",
    cdcEdPage: "https://data.cdc.gov/Public-Health-Surveillance/NSSP-Emergency-Department-Visit-Trajectories-by-St/rdmq-nq56",
    diseaseSh: "https://disease.sh/v3/covid-19",
    usgs: "https://earthquake.usgs.gov/fdsnws/event/1/query",
    neoFeed: "https://api.nasa.gov/neo/rest/v1/feed",
    weather: "https://api.open-meteo.com/v1/forecast",
    airQuality: "https://air-quality-api.open-meteo.com/v1/air-quality",
    nwsAlerts: "https://api.weather.gov/alerts/active",
    fema: "https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries",
  };

  const REFRESH_MS = {
    quake: 5 * 60 * 1000,
    neo: 60 * 60 * 1000,
    health: 60 * 60 * 1000,
    weather: 15 * 60 * 1000,
    alerts: 3 * 60 * 1000,
  };

  // URL options: ?kiosk  ?lat=..&lon=..  ?units=metric|imperial
  const URLQ = new URLSearchParams(location.search);

  // Countries/territories that use Fahrenheit and are covered by NWS alerts.
  const US_CODES = ["US", "PR", "GU", "VI", "AS", "MP"];

  const LUNAR_KM = 384400;

  // ---------- helpers ----------

  const $ = (id) => document.getElementById(id);

  const esc = (v) =>
    String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const fmtNum = (n, digits = 0) =>
    n == null || Number.isNaN(Number(n)) ? "--" : Number(n).toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits });

  const pad = (n) => String(n).padStart(2, "0");
  const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  function ago(ms) {
    const s = Math.round((Date.now() - ms) / 1000);
    const future = s < 0;
    const a = Math.abs(s);
    let out;
    if (a < 60) out = `${a}s`;
    else if (a < 3600) out = `${Math.round(a / 60)}m`;
    else if (a < 86400) out = `${(a / 3600).toFixed(1)}h`;
    else out = `${(a / 86400).toFixed(1)}d`;
    return future ? `in ${out}` : `${out} ago`;
  }

  function haversineKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const rad = (x) => (x * Math.PI) / 180;
    const dLat = rad(lat2 - lat1);
    const dLon = rad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  // ASCII meter, e.g. [######----]
  function meter(value, max, width = 20) {
    const v = Math.max(0, Math.min(1, (Number(value) || 0) / max));
    const filled = Math.round(v * width);
    return `[${"#".repeat(filled)}${"-".repeat(width - filled)}]`;
  }

  async function fetchJSON(url, { timeout = 15000 } = {}) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) {
        const err = new Error(`HTTP ${res.status}`);
        err.status = res.status;
        throw err;
      }
      return await res.json();
    } finally {
      clearTimeout(t);
    }
  }

  function log(msg, level = "info") {
    const el = $("bootlog");
    const ts = new Date().toLocaleTimeString([], { hour12: false });
    const tag = { ok: "[ OK ]", warn: "[WARN]", err: "[FAIL]", info: "[ .. ]" }[level];
    const line = document.createElement("span");
    line.className = level;
    line.textContent = `${ts} ${tag} ${msg}\n`;
    el.appendChild(line);
    el.scrollTop = el.scrollHeight;
  }

  const setBody = (id, html) => { $(id).innerHTML = html; };
  const errBox = (msg) => `<span class="alert">ERR: ${esc(msg)}</span>`;
  const kv = (pairs) =>
    `<dl class="kv">${pairs.filter(Boolean).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join("")}</dl>`;

  // ---------- clock / theme ----------

  function startClock() {
    const tick = () => {
      const d = new Date();
      $("clock").textContent = `${isoDate(d)} ${d.toLocaleTimeString([], { hour12: false })} ${Intl.DateTimeFormat().resolvedOptions().timeZone}`;
    };
    tick();
    setInterval(tick, 1000);
  }

  function initTheme() {
    let theme = "green";
    try { theme = localStorage.getItem("sitrep_theme") || "green"; } catch (_) {}
    const apply = (t) => {
      if (t === "amber") document.documentElement.dataset.theme = "amber";
      else delete document.documentElement.dataset.theme;
    };
    apply(theme);
    $("btn-theme").addEventListener("click", () => {
      theme = theme === "amber" ? "green" : "amber";
      apply(theme);
      try { localStorage.setItem("sitrep_theme", theme); } catch (_) {}
    });
  }

  // ---------- 05: system / network ----------

  function parseUA(ua) {
    const browsers = [
      [/Edg(?:e|A|iOS)?\/([\d.]+)/, "Microsoft Edge"],
      [/OPR\/([\d.]+)/, "Opera"],
      [/SamsungBrowser\/([\d.]+)/, "Samsung Internet"],
      [/Firefox\/([\d.]+)/, "Firefox"],
      [/FxiOS\/([\d.]+)/, "Firefox (iOS)"],
      [/CriOS\/([\d.]+)/, "Chrome (iOS)"],
      [/Chrome\/([\d.]+)/, "Chrome"],
      [/Version\/([\d.]+).*Safari/, "Safari"],
    ];
    let browser = "Unknown";
    for (const [re, name] of browsers) {
      const m = ua.match(re);
      if (m) { browser = `${name} ${m[1]}`; break; }
    }
    let os = "Unknown";
    let m;
    if ((m = ua.match(/Windows NT ([\d.]+)/))) os = `Windows (NT ${m[1]})`;
    else if ((m = ua.match(/Android ([\d.]+)/))) os = `Android ${m[1]}`;
    else if ((m = ua.match(/(?:iPhone|iPad|iPod).*OS ([\d_]+)/))) os = `iOS ${m[1].replace(/_/g, ".")}`;
    else if ((m = ua.match(/Mac OS X ([\d_.]+)/))) os = `macOS ${m[1].replace(/_/g, ".")}`;
    else if (/CrOS/.test(ua)) os = "ChromeOS";
    else if (/Linux/.test(ua)) os = "Linux";
    return { browser, os };
  }

  async function detectSystem() {
    const ua = navigator.userAgent;
    let { browser, os } = parseUA(ua);

    // User-Agent Client Hints give more accurate data on Chromium browsers.
    if (navigator.userAgentData?.getHighEntropyValues) {
      try {
        const hints = await navigator.userAgentData.getHighEntropyValues(["platform", "platformVersion", "fullVersionList", "architecture"]);
        const brand = (hints.fullVersionList || []).find((b) => !/Not.?A.?Brand|Chromium/i.test(b.brand));
        if (brand) browser = `${brand.brand} ${brand.version}`;
        if (hints.platform) {
          let ver = hints.platformVersion || "";
          // Windows 11 reports platformVersion >= 13
          if (hints.platform === "Windows" && ver) ver = parseInt(ver, 10) >= 13 ? "11" : "10";
          os = `${hints.platform} ${ver}`.trim() + (hints.architecture ? ` (${hints.architecture})` : "");
        }
      } catch (_) { /* fall back to UA string */ }
    }
    return { browser, os };
  }

  async function loadSystem() {
    const { browser, os } = await detectSystem();
    const conn = navigator.connection;
    const base = [
      ["BROWSER", esc(browser)],
      ["OS", esc(os)],
      ["LANGUAGE", esc(navigator.language)],
      ["TIMEZONE", esc(Intl.DateTimeFormat().resolvedOptions().timeZone)],
      ["SCREEN", `${screen.width}x${screen.height} @${window.devicePixelRatio}x`],
      ["CPU CORES", esc(navigator.hardwareConcurrency ?? "--")],
      navigator.deviceMemory ? ["MEMORY", `~${navigator.deviceMemory} GB`] : null,
      conn?.effectiveType ? ["LINK", `${esc(conn.effectiveType)}${conn.downlink ? ` / ${conn.downlink} Mbps` : ""}`] : null,
      ["ONLINE", navigator.onLine ? "YES" : '<span class="alert">NO</span>'],
    ];
    setBody("system-body", kv([["PUBLIC IP", '<span class="dim">resolving…</span>'], ...base]));
    log(`system: ${browser} on ${os}`, "ok");

    let ip = null;
    let ipGeo = null;
    try {
      ip = (await fetchJSON(API.ip)).ip;
    } catch (e) {
      log(`ipify: ${e.message}`, "warn");
    }
    try {
      ipGeo = await fetchJSON(API.ipGeo);
      ip = ip || ipGeo.ip;
    } catch (e) {
      log(`geojs: ${e.message}`, "warn");
    }
    const ipRows = [
      ["PUBLIC IP", ip ? `<span class="big">${esc(ip)}</span>` : '<span class="alert">unavailable</span>'],
      ipGeo?.organization_name ? ["ISP / ORG", esc(ipGeo.organization_name)] : null,
      ipGeo?.city || ipGeo?.country ? ["IP GEO", esc([ipGeo.city, ipGeo.region, ipGeo.country].filter(Boolean).join(", "))] : null,
    ];
    setBody("system-body", kv([...ipRows, ...base]) + `<div class="src">src: navigator · UA-CH · ipify.org · geojs.io</div>`);
    if (ip) log(`public ip ${ip}`, "ok");
    return ipGeo;
  }

  // ---------- 04: location ----------

  function getBrowserPosition() {
    return new Promise((resolve, reject) => {
      if (!("geolocation" in navigator)) return reject(new Error("Geolocation API not supported"));
      if (!window.isSecureContext) return reject(new Error("Geolocation requires https:// or localhost"));
      navigator.geolocation.getCurrentPosition(resolve, (e) => reject(new Error(e.message || "permission denied")), {
        enableHighAccuracy: false,
        timeout: 15000,
        maximumAge: 5 * 60 * 1000,
      });
    });
  }

  async function loadLocation(ipGeoPromise) {
    let loc = null;
    const qLat = parseFloat(URLQ.get("lat"));
    const qLon = parseFloat(URLQ.get("lon"));
    if (Math.abs(qLat) <= 90 && Math.abs(qLon) <= 180) {
      loc = { lat: qLat, lon: qLon, accuracy: null, source: "manual (?lat=&lon= in URL)" };
      log(`location pinned by URL: ${qLat}, ${qLon}`, "ok");
    } else {
      try {
        log("requesting geolocation fix…");
        const pos = await getBrowserPosition();
        loc = {
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          source: "GPS/Wi-Fi (Geolocation API)",
        };
        log(`geolocation fix ±${Math.round(loc.accuracy)} m`, "ok");
      } catch (e) {
        log(`geolocation: ${e.message} — falling back to IP geolocation`, "warn");
        const ipGeo = await ipGeoPromise;
        if (ipGeo?.latitude && ipGeo?.longitude) {
          loc = {
            lat: Number(ipGeo.latitude),
            lon: Number(ipGeo.longitude),
            accuracy: null,
            source: "IP geolocation (approximate)",
            fallback: { city: ipGeo.city, state: ipGeo.region, country: ipGeo.country, countryCode: ipGeo.country_code },
          };
        }
      }
    }

    if (!loc) {
      setBody("location-body", errBox("no location available (permission denied and IP lookup failed)"));
      return null;
    }

    try {
      const q = new URLSearchParams({ latitude: loc.lat, longitude: loc.lon, localityLanguage: "en" });
      const g = await fetchJSON(`${API.reverseGeo}?${q}`);
      const admin = g.localityInfo?.administrative || [];
      const county = admin.find((a) => /county|parish|borough/i.test(a.name) || /county/i.test(a.description || ""));
      loc.city = g.city || g.locality;
      loc.state = g.principalSubdivision;
      loc.stateCode = (g.principalSubdivisionCode || "").split("-").pop();
      loc.county = county?.name;
      loc.country = g.countryName;
      loc.countryCode = g.countryCode;
      loc.postcode = g.postcode;
      log(`reverse geocode: ${[loc.city, loc.state, loc.countryCode].filter(Boolean).join(", ")}`, "ok");
    } catch (e) {
      log(`reverse geocode: ${e.message}`, "warn");
      if (loc.fallback) Object.assign(loc, loc.fallback);
    }

    const latStr = `${Math.abs(loc.lat).toFixed(4)}°${loc.lat >= 0 ? "N" : "S"}`;
    const lonStr = `${Math.abs(loc.lon).toFixed(4)}°${loc.lon >= 0 ? "E" : "W"}`;
    setBody(
      "location-body",
      `<div class="big">${esc(loc.city || "UNKNOWN")}</div>` +
        `<div>${esc([loc.county, loc.state, loc.country].filter(Boolean).join(" · "))}</div><br>` +
        kv([
          ["LAT", latStr],
          ["LON", lonStr],
          loc.accuracy != null ? ["ACCURACY", `±${fmtNum(loc.accuracy)} m`] : null,
          loc.postcode ? ["POSTCODE", esc(loc.postcode)] : null,
          ["FIX SOURCE", esc(loc.source)],
          ["MAP", `<a href="https://www.openstreetmap.org/?mlat=${loc.lat}&mlon=${loc.lon}#map=11/${loc.lat}/${loc.lon}" target="_blank" rel="noopener">openstreetmap ↗</a>`],
        ]) +
        `<div class="src">src: navigator.geolocation · bigdatacloud.net</div>`
    );
    return loc;
  }

  // ---------- 01: weather ----------

  // WMO weather interpretation codes used by Open-Meteo -> [label, icon kind]
  const WMO = {
    0: ["CLEAR", "sun"], 1: ["MAINLY CLEAR", "sun"], 2: ["PARTLY CLOUDY", "part"], 3: ["OVERCAST", "cloud"],
    45: ["FOG", "fog"], 48: ["RIME FOG", "fog"],
    51: ["LIGHT DRIZZLE", "rain"], 53: ["DRIZZLE", "rain"], 55: ["HEAVY DRIZZLE", "rain"],
    56: ["FREEZING DRIZZLE", "sleet"], 57: ["HEAVY FREEZING DRIZZLE", "sleet"],
    61: ["LIGHT RAIN", "rain"], 63: ["RAIN", "rain"], 65: ["HEAVY RAIN", "rain"],
    66: ["FREEZING RAIN", "sleet"], 67: ["HEAVY FREEZING RAIN", "sleet"],
    71: ["LIGHT SNOW", "snow"], 73: ["SNOW", "snow"], 75: ["HEAVY SNOW", "snow"], 77: ["SNOW GRAINS", "snow"],
    80: ["RAIN SHOWERS", "rain"], 81: ["RAIN SHOWERS", "rain"], 82: ["VIOLENT RAIN SHOWERS", "rain"],
    85: ["SNOW SHOWERS", "snow"], 86: ["HEAVY SNOW SHOWERS", "snow"],
    95: ["THUNDERSTORM", "storm"], 96: ["THUNDERSTORM + HAIL", "storm"], 99: ["THUNDERSTORM + HEAVY HAIL", "storm"],
  };

  const CLOUD = ["     .-.     ", "    (   ).   ", "   (___(__)  "];
  const WX_ICONS = {
    sun: ["    \\   /    ", "     .-.     ", "  - (   ) -  ", "     `-'     ", "    /   \\    "],
    moon: ["      _      ", "    ,' )     ", "   (  (      ", "    `._)     ", "             "],
    part: ["   \\  /      ", ' _ /"".-.    ', "   \\_(   ).  ", "   /(___(__) ", "             "],
    cloud: ["             ", "     .--.    ", "  .-(    ).  ", " (___.__)__) ", "             "],
    fog: ["             ", " _ - _ - _ - ", "  _ - _ - _  ", " _ - _ - _ - ", "             "],
    rain: [...CLOUD, "    / / / /  ", "   / / / /   "],
    sleet: [...CLOUD, "    / * / *  ", "   * / * /   "],
    snow: [...CLOUD, "    *  *  *  ", "   *  *  *   "],
    storm: [...CLOUD, "    _/ / _/  ", "    /  /  /  "],
  };
  const WX_SHORT = { sun: "SUN", moon: "CLR", part: "P/CLD", cloud: "CLDY", fog: "FOG", rain: "RAIN", sleet: "ICE", snow: "SNOW", storm: "TSTM" };

  const COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  const compass = (deg) => COMPASS[Math.round((deg % 360) / 22.5) % 16];

  // Unicode block sparkline, e.g. ▁▂▄▆█
  function spark(values) {
    const bars = "▁▂▃▄▅▆▇█";
    const nums = values.filter((v) => v != null);
    const lo = Math.min(...nums);
    const hi = Math.max(...nums);
    return values.map((v) => (v == null ? " " : bars[Math.round(((v - lo) / (hi - lo || 1)) * (bars.length - 1))])).join("");
  }

  function aqiCategory(aqi) {
    if (aqi == null) return ["--", ""];
    if (aqi <= 50) return ["GOOD", ""];
    if (aqi <= 100) return ["MODERATE", ""];
    if (aqi <= 150) return ["UNHEALTHY (SENSITIVE)", "warn"];
    if (aqi <= 200) return ["UNHEALTHY", "alert"];
    if (aqi <= 300) return ["VERY UNHEALTHY", "alert"];
    return ["HAZARDOUS", "alert"];
  }

  function unitsFor(loc) {
    const u = URLQ.get("units");
    if (u === "metric" || u === "imperial") return u;
    return US_CODES.includes(loc?.countryCode) ? "imperial" : "metric";
  }

  async function loadWeather(locPromise) {
    const loc = await locPromise;
    if (!loc) {
      setBody("weather-body", errBox("no location — weather unavailable"));
      return;
    }
    const imperial = unitsFor(loc) === "imperial";
    const params = new URLSearchParams({
      latitude: loc.lat.toFixed(4),
      longitude: loc.lon.toFixed(4),
      current: "temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m",
      hourly: "temperature_2m,precipitation_probability",
      daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset,uv_index_max",
      timezone: "auto",
      forecast_days: "5",
      temperature_unit: imperial ? "fahrenheit" : "celsius",
      wind_speed_unit: imperial ? "mph" : "kmh",
      precipitation_unit: imperial ? "inch" : "mm",
    });
    const aqParams = new URLSearchParams({ latitude: loc.lat.toFixed(4), longitude: loc.lon.toFixed(4), current: "us_aqi,pm2_5", timezone: "auto" });

    try {
      const [wx, aq] = await Promise.all([
        fetchJSON(`${API.weather}?${params}`),
        fetchJSON(`${API.airQuality}?${aqParams}`).catch((e) => { log(`open-meteo air quality: ${e.message}`, "warn"); return null; }),
      ]);
      alertState.aq = aq?.current ?? null;
      renderAlerts();

      const cur = wx.current;
      const u = wx.current_units;
      const deg = u.temperature_2m; // "°F" / "°C"
      const [label, kindRaw] = WMO[cur.weather_code] || ["UNKNOWN", "cloud"];
      const kind = kindRaw === "sun" && !cur.is_day ? "moon" : kindRaw;
      const iconCls = kind === "sun" ? "warn" : kind === "storm" ? "alert" : "";

      // Next 24 hours from the current hour.
      const hourStart = wx.hourly.time.findIndex((t) => t >= cur.time.slice(0, 13) + ":00");
      const from = Math.max(0, hourStart);
      const every2h = (_, i) => i % 2 === 0;
      const temps = wx.hourly.temperature_2m.slice(from, from + 24).filter(every2h);
      const pops = wx.hourly.precipitation_probability.slice(from, from + 24).filter(every2h);

      const d = wx.daily;
      const days = d.time.slice(0, 5).map((t, i) => {
        const [, k] = WMO[d.weather_code[i]] || ["", "cloud"];
        const name = i === 0 ? "TODAY" : new Date(`${t}T12:00`).toLocaleDateString([], { weekday: "short" }).toUpperCase();
        return `<tr><td>${name}</td><td>${WX_SHORT[k]}</td>` +
          `<td>${fmtNum(d.temperature_2m_max[i])}° / ${fmtNum(d.temperature_2m_min[i])}°</td>` +
          `<td>${fmtNum(d.precipitation_probability_max[i])}% precip</td></tr>`;
      }).join("");

      const [aqLabel, aqCls] = aqiCategory(alertState.aq?.us_aqi);
      setBody(
        "weather-body",
        `<div class="wx-now"><pre class="wx-icon ${iconCls}">${WX_ICONS[kind].join("\n")}</pre>` +
          `<div><div class="big">${fmtNum(cur.temperature_2m)}${esc(deg)}</div>` +
          `<div>${label}</div><div class="dim">feels ${fmtNum(cur.apparent_temperature)}${esc(deg)}</div></div></div>` +
          kv([
            ["WIND", `${fmtNum(cur.wind_speed_10m)} ${imperial ? "mph" : "km/h"} ${compass(cur.wind_direction_10m)} · gusts ${fmtNum(cur.wind_gusts_10m)}`],
            ["HUMIDITY", `${fmtNum(cur.relative_humidity_2m)}%`],
            ["PRECIP NOW", `${fmtNum(cur.precipitation, imperial ? 2 : 1)} ${esc(u.precipitation)}`],
            ["PRESSURE", `${fmtNum(cur.pressure_msl)} hPa`],
            ["CLOUD", `${fmtNum(cur.cloud_cover)}%`],
            ["UV MAX", fmtNum(d.uv_index_max[0], 1)],
            ["AIR QUALITY", alertState.aq ? `<span class="${aqCls}">US AQI ${fmtNum(alertState.aq.us_aqi)} ${aqLabel}</span> · PM2.5 ${fmtNum(alertState.aq.pm2_5)} µg/m³` : '<span class="dim">n/a</span>'],
            ["SUN", `↑ ${esc(d.sunrise[0].slice(11, 16))}  ↓ ${esc(d.sunset[0].slice(11, 16))} ${esc(wx.timezone_abbreviation || "")}`],
            ["24H TEMP", `<span class="bar">${fmtNum(Math.min(...temps))}° ${spark(temps)} ${fmtNum(Math.max(...temps))}°</span>`],
            ["24H RAIN", `<span class="bar">0% ${spark([0, ...pops, 100]).slice(1, -1)} ${fmtNum(Math.max(...pops))}%</span>`],
          ]) +
          `<br><div class="scroll-x"><table class="tt">${days}</table></div>` +
          `<div class="src">src: open-meteo.com (forecast + air quality) · updated ${new Date().toLocaleTimeString([], { hour12: false })}</div>`
      );
      log(`weather: ${fmtNum(cur.temperature_2m)}${deg} ${label}`, "ok");
    } catch (e) {
      log(`open-meteo: ${e.message}`, "err");
      setBody("weather-body", errBox(`weather request failed: ${e.message}`));
    }
  }

  // ---------- 02: local alerts / emergencies ----------

  // undefined = loading, null = unavailable, [] = none
  const alertState = { loc: undefined, nws: undefined, nwsError: null, nearby: undefined, fema: undefined, aq: undefined };
  const NEARBY_KM = 300;
  const SEVERITY_RANK = { Extreme: 4, Severe: 3, Moderate: 2, Minor: 1, Unknown: 0 };
  const sevClass = (s) => (SEVERITY_RANK[s] >= 3 ? "alert" : SEVERITY_RANK[s] === 2 ? "warn" : "");
  const shortTime = (iso) =>
    iso ? new Date(iso).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }) : "--";

  async function loadNwsAlerts(loc) {
    if (!US_CODES.includes(loc.countryCode)) {
      alertState.nws = null;
      return;
    }
    try {
      // Plain GET with no custom headers: setting User-Agent from a browser breaks the CORS preflight.
      const data = await fetchJSON(`${API.nwsAlerts}?point=${loc.lat.toFixed(4)},${loc.lon.toFixed(4)}`);
      alertState.nws = (data.features || [])
        .map((f) => f.properties)
        .filter((p) => p.status === "Actual")
        .sort((a, b) => (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0) || String(a.onset).localeCompare(String(b.onset)));
      alertState.nwsError = null;
      log(`nws: ${alertState.nws.length} active alert(s)`, alertState.nws.length ? "warn" : "ok");
    } catch (e) {
      alertState.nws = null;
      alertState.nwsError = e.message;
      log(`nws alerts: ${e.message}`, "err");
    }
  }

  async function loadNearbyQuakes(loc) {
    try {
      const params = new URLSearchParams({
        format: "geojson",
        latitude: loc.lat.toFixed(3),
        longitude: loc.lon.toFixed(3),
        maxradiuskm: String(NEARBY_KM),
        minmagnitude: "2.5",
        starttime: new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 19),
        orderby: "time",
        limit: "200",
      });
      const data = await fetchJSON(`${API.usgs}?${params}`);
      alertState.nearby = (data.features || []).map((f) => ({
        mag: f.properties.mag,
        place: f.properties.place,
        time: f.properties.time,
        km: haversineKm(loc.lat, loc.lon, f.geometry.coordinates[1], f.geometry.coordinates[0]),
      }));
    } catch (e) {
      alertState.nearby = null;
      log(`usgs nearby: ${e.message}`, "warn");
    }
  }

  async function loadFema(loc) {
    if (loc.countryCode !== "US" || !loc.stateCode) {
      alertState.fema = null;
      return;
    }
    try {
      const since = new Date(Date.now() - 90 * 86400000).toISOString();
      const filter = `state eq '${loc.stateCode}' and declarationDate ge '${since}'`;
      const url = `${API.fema}?$filter=${encodeURIComponent(filter)}&$orderby=${encodeURIComponent("declarationDate desc")}&$top=500`;
      const rows = (await fetchJSON(url)).DisasterDeclarationsSummaries || [];
      // One row per designated county; group into one entry per disaster.
      const county = (loc.county || "").replace(/\s+(County|Parish|Borough)$/i, "").toLowerCase();
      const byNumber = new Map();
      for (const r of rows) {
        const d = byNumber.get(r.disasterNumber) || { ...r, counties: 0, local: false };
        d.counties++;
        if (county && (r.designatedArea || "").toLowerCase().startsWith(county)) d.local = true;
        if (/statewide/i.test(r.designatedArea || "")) d.local = true;
        byNumber.set(r.disasterNumber, d);
      }
      alertState.fema = [...byNumber.values()].sort((a, b) => b.local - a.local || String(b.declarationDate).localeCompare(String(a.declarationDate)));
    } catch (e) {
      alertState.fema = null;
      log(`fema: ${e.message}`, "warn");
    }
  }

  async function loadAlerts(locPromise) {
    const loc = await locPromise;
    alertState.loc = loc;
    if (!loc) {
      renderAlerts();
      return;
    }
    await Promise.all([loadNwsAlerts(loc), loadNearbyQuakes(loc), loadFema(loc)]);
    renderAlerts();
  }

  function renderBanner() {
    const severe = (alertState.nws || []).filter((a) => SEVERITY_RANK[a.severity] >= 3);
    const banner = $("alert-banner");
    if (!severe.length) {
      banner.hidden = true;
      return;
    }
    banner.hidden = false;
    banner.innerHTML = severe
      .map((a) => `<span class="blink">!!</span> ${esc(a.event.toUpperCase())} <span class="dim-on-alert">until ${esc(shortTime(a.ends || a.expires))}</span>`)
      .join("  ·  ");
  }

  function renderAlerts() {
    const { loc, nws, nwsError, nearby, fema, aq } = alertState;
    renderBanner();
    if (loc === undefined) return;
    if (!loc) {
      setBody("alerts-body", errBox("no location — local alerts unavailable"));
      return;
    }
    const isUS = US_CODES.includes(loc.countryCode);
    const sections = [];

    // Overall status line.
    const severe = (nws || []).filter((a) => SEVERITY_RANK[a.severity] >= 3).length;
    const aqBad = aq?.us_aqi > 100;
    let status;
    if (nws === undefined && isUS) status = '<span class="dim">checking…</span>';
    else if (nws?.length) status = `<span class="${severe ? "alert" : "warn"}">${nws.length} ACTIVE ALERT${nws.length > 1 ? "S" : ""}${severe ? ` (${severe} SEVERE)` : ""}</span>`;
    else if (aqBad) status = '<span class="warn">AIR QUALITY ADVISORY</span>';
    else if (isUS && nws) status = "ALL CLEAR";
    else status = '<span class="dim">NO OFFICIAL ALERT FEED</span>';
    sections.push(`<div class="big">${status}</div>`);

    // NWS watches / warnings / advisories (includes civil emergency messages relayed by NWS).
    if (!isUS) {
      sections.push('<div class="dim">&gt; NWS alerts cover the US and its territories only.</div>');
    } else if (nws === undefined) {
      sections.push('<div class="dim">&gt; querying weather.gov…</div>');
    } else if (nws === null) {
      sections.push(errBox(`NWS alerts unavailable: ${nwsError || "unknown error"}`));
    } else if (!nws.length) {
      sections.push("<div>&gt; no active NWS watches, warnings or advisories for this point</div>");
    } else {
      sections.push(
        nws.slice(0, 6).map((a) =>
          `<div class="alert-item ${sevClass(a.severity)}">` +
            `<div><b>${esc(a.event.toUpperCase())}</b> <span class="dim">[${esc(a.severity)} · ${esc(a.urgency)}]</span></div>` +
            `<div class="dim">${esc(shortTime(a.onset || a.effective))} → ${esc(shortTime(a.ends || a.expires))}</div>` +
            (a.headline ? `<div>${esc(a.headline)}</div>` : "") +
            (a.instruction ? `<div class="dim">&gt; ${esc(a.instruction.replace(/\s+/g, " ").slice(0, 280))}${a.instruction.length > 280 ? "…" : ""}</div>` : "") +
          `</div>`
        ).join("") + (nws.length > 6 ? `<div class="dim">+${nws.length - 6} more</div>` : "")
      );
    }

    const rows = [];
    if (aq) {
      const [label, cls] = aqiCategory(aq.us_aqi);
      rows.push(["AIR QUALITY", `<span class="${cls}">US AQI ${fmtNum(aq.us_aqi)} — ${label}</span>`]);
    }
    if (nearby === undefined) rows.push([`QUAKES ≤${NEARBY_KM} km`, '<span class="dim">checking…</span>']);
    else if (nearby === null) rows.push([`QUAKES ≤${NEARBY_KM} km`, '<span class="dim">unavailable</span>']);
    else if (!nearby.length) rows.push([`QUAKES ≤${NEARBY_KM} km`, "none M2.5+ in 7 days"]);
    else {
      const big = nearby.reduce((a, b) => (b.mag > a.mag ? b : a));
      rows.push([`QUAKES ≤${NEARBY_KM} km`,
        `${nearby.length}× M2.5+ in 7d · largest <span class="${big.mag >= 5 ? "alert" : big.mag >= 4 ? "warn" : ""}">M${fmtNum(big.mag, 1)}</span> ${esc(big.place || "")} (${fmtNum(big.km)} km, ${ago(big.time)})`]);
    }
    if (fema === undefined && isUS) rows.push(["FEMA (90d)", '<span class="dim">checking…</span>']);
    else if (fema?.length) {
      rows.push(["FEMA (90d)", fema.slice(0, 3).map((d) =>
        `<div class="${d.local ? "warn" : ""}">${esc(d.declarationType)}-${esc(d.disasterNumber)} ${esc(d.incidentType)}: ${esc(d.declarationTitle)} · ${esc(String(d.declarationDate).slice(0, 10))}${d.local ? " · YOUR COUNTY" : ` · ${d.counties} area${d.counties > 1 ? "s" : ""}`}</div>`).join("")]);
    } else if (fema) rows.push(["FEMA (90d)", `no disaster declarations in ${esc(loc.stateCode)}`]);
    sections.push(kv(rows));

    sections.push(
      `<div class="src">src: ${isUS ? `NWS api.weather.gov (<a href="https://forecast.weather.gov/MapClick.php?lat=${loc.lat.toFixed(4)}&lon=${loc.lon.toFixed(4)}" target="_blank" rel="noopener">local forecast page ↗</a>) · OpenFEMA · ` : ""}USGS · open-meteo air quality · checked ${new Date().toLocaleTimeString([], { hour12: false })}</div>`
    );
    setBody("alerts-body", sections.join("<br>"));
  }

  // ---------- 06: CDC / pandemic ----------

  const PATHOGENS = [
    ["covid", "COVID-19"],
    ["influenza", "INFLUENZA"],
    ["rsv", "RSV"],
    ["combined", "COMBINED"],
  ];

  function trendTag(t) {
    if (!t) return '<span class="dim">trend n/a</span>';
    const s = String(t).toLowerCase();
    if (s.includes("increas")) return `<span class="warn">▲ ${esc(t)}</span>`;
    if (s.includes("decreas")) return `<span>▼ ${esc(t)}</span>`;
    return `<span class="dim">■ ${esc(t)}</span>`;
  }

  // Find the value for a pathogen with tolerant field-name matching.
  const pick = (row, prefix, key) => {
    const k = Object.keys(row).find((f) => f.startsWith(prefix) && f.includes(key));
    return k ? row[k] : undefined;
  };

  function renderCdcRow(row, label) {
    const cells = PATHOGENS.map(([key, name]) => {
      const pct = pick(row, "percent_visits", key);
      if (pct === undefined) return "";
      const trend = pick(row, "ed_trends", key);
      return `<div><div class="dim">${name}</div>` +
        `<div class="big">${fmtNum(pct, 2)}%</div>` +
        `<div class="bar">${meter(pct, key === "combined" ? 10 : 5)}</div>` +
        `<div>${trendTag(trend)}</div></div>`;
    }).join("");
    return `<div class="dim">&gt; ${esc(label)} — % of emergency dept. visits</div><div class="health-grid">${cells}</div>`;
  }

  const dateKeyOf = (row) => Object.keys(row).find((k) => /^\d{4}-\d{2}-\d{2}T/.test(row[k]));

  // Query the CDC NSSP ED-visit dataset for one geography (a state or "United States").
  async function queryCdc(geography) {
    const params = new URLSearchParams({
      $where: `geography='${geography.replace(/'/g, "''")}'`,
      $order: "week_end DESC",
      $limit: "1000",
    });
    let rows;
    try {
      rows = await fetchJSON(`${API.cdcEd}?${params}`);
    } catch (e) {
      if (e.status !== 400) throw e;
      // Schema changed? fall back to full-text search and sort client-side.
      rows = await fetchJSON(`${API.cdcEd}?${new URLSearchParams({ $q: geography, $limit: "5000" })}`);
    }
    if (!rows.length) return null;
    const dk = dateKeyOf(rows[0]);
    const latest = rows.reduce((m, r) => (r[dk] > m ? r[dk] : m), "");
    return { week: latest, rows: rows.filter((r) => r[dk] === latest) };
  }

  const isAggregateRow = (r) => !r.county || /^all\b/i.test(r.county);

  async function loadHealth(locPromise) {
    const loc = await locPromise;
    const blocks = [];
    let week = null;

    if (loc?.countryCode === "US" && loc.state) {
      try {
        log(`cdc nssp: querying ${loc.state}…`);
        const res = await queryCdc(loc.state);
        if (res) {
          week = res.week;
          const countyName = (loc.county || "").replace(/\s+(County|Parish|Borough)$/i, "").toLowerCase();
          const countyRow = countyName && res.rows.find((r) => (r.county || "").toLowerCase().replace(/\s+(county|parish|borough)$/, "") === countyName);
          const stateRow = res.rows.find(isAggregateRow);
          if (countyRow) blocks.push(renderCdcRow(countyRow, `${loc.county} (HSA: ${countyRow.hsa || "n/a"})`));
          if (stateRow) blocks.push(renderCdcRow(stateRow, `${loc.state} statewide`));
          if (!countyRow && !stateRow && res.rows[0]) blocks.push(renderCdcRow(res.rows[0], loc.state));
          log(`cdc nssp: ${loc.state} week ending ${week.slice(0, 10)}`, "ok");
        }
      } catch (e) {
        log(`cdc nssp (${loc.state}): ${e.message}`, "warn");
      }
    }

    // National CDC picture, always useful as context (and the fallback outside the US).
    try {
      const nat = await queryCdc("United States");
      if (nat) {
        week = week || nat.week;
        const row = nat.rows.find(isAggregateRow) || nat.rows[0];
        blocks.push(renderCdcRow(row, "United States (national)"));
        log("cdc nssp: national data loaded", "ok");
      }
    } catch (e) {
      log(`cdc nssp (national): ${e.message}`, "warn");
    }

    // General pandemic data (global / country COVID-19 totals) when CDC isn't available or the user is outside the US.
    if (!blocks.length || (loc && loc.countryCode !== "US")) {
      try {
        const [all, country] = await Promise.all([
          fetchJSON(`${API.diseaseSh}/all`),
          loc?.countryCode && loc.countryCode !== "US"
            ? fetchJSON(`${API.diseaseSh}/countries/${encodeURIComponent(loc.countryCode)}?strict=true`).catch(() => null)
            : Promise.resolve(null),
        ]);
        const summary = (d, label) =>
          `<div><div class="dim">${esc(label)}</div>` +
          kv([
            ["CASES", fmtNum(d.cases)],
            ["DEATHS", fmtNum(d.deaths)],
            ["ACTIVE", fmtNum(d.active)],
            ["CRITICAL", fmtNum(d.critical)],
            ["NEW TODAY", fmtNum(d.todayCases)],
            ["SOURCE UPDATED", esc(new Date(d.updated).toLocaleString())],
          ]) +
          `</div>`;
        blocks.push(
          `<div class="dim">&gt; COVID-19 cumulative totals (general pandemic data)</div><div class="health-grid">` +
            (country ? summary(country, country.country) : "") +
            summary(all, `GLOBAL · ${fmtNum(all.affectedCountries)} countries`) +
            `</div>`
        );
        log("disease.sh: global pandemic data loaded", "ok");
      } catch (e) {
        log(`disease.sh: ${e.message}`, "warn");
      }
    }

    if (!blocks.length) {
      setBody("health-body", errBox("no pandemic data source reachable (CDC + disease.sh failed)"));
      return;
    }
    setBody(
      "health-body",
      (week ? `<div>REPORTING WEEK ENDING <b>${esc(week.slice(0, 10))}</b></div><br>` : "") +
        blocks.join("<br>") +
        `<div class="src">src: <a href="${API.cdcEdPage}" target="_blank" rel="noopener">CDC NSSP ED visit trajectories (data.cdc.gov rdmq-nq56)</a>` +
        ` · disease.sh (fallback). Trends: CDC-classified week-over-week direction. Not medical advice.</div>`
    );
  }

  // ---------- 03: world grid ----------

  const mapState = { loc: null, quakes: null };

  // lon/lat -> grid cell, clamped to the mapped latitude band.
  function toCell(lon, lat) {
    const m = window.WORLD_MASK;
    const clamp = (v, max) => Math.min(max - 1, Math.max(0, v));
    return {
      r: clamp(Math.floor(((m.latTop - lat) / (m.latTop - m.latBottom)) * m.rows), m.rows),
      c: clamp(Math.floor(((lon + 180) / 360) * m.cols), m.cols),
    };
  }

  function cellBounds(r, c) {
    const m = window.WORLD_MASK;
    const lonStep = 360 / m.cols;
    const latStep = (m.latTop - m.latBottom) / m.rows;
    const fLat = (v) => `${Math.abs(v).toFixed(1)}°${v >= 0 ? "N" : "S"}`;
    const fLon = (v) => `${Math.abs(v).toFixed(0)}°${v >= 0 ? "E" : "W"}`;
    const north = m.latTop - r * latStep;
    const west = -180 + c * lonStep;
    return `${fLat(north - latStep)}…${fLat(north)} ${fLon(west)}…${fLon(west + lonStep)}`;
  }

  const shortPlace = (place) => (place || "unknown").replace(/^.*?\bof\s+/, "");
  const strongest = (events) => events.reduce((a, b) => (b.properties.mag > a.properties.mag ? b : a));

  // Hotspots: cells with the most events in their 3x3 neighbourhood (longitude wraps),
  // picked greedily so two hotspots are never within 3 cells of each other.
  function findHotspots(quakes, max = 2) {
    const m = window.WORLD_MASK;
    const cells = new Map();
    for (const f of quakes) {
      const { r, c } = toCell(f.geometry.coordinates[0], f.geometry.coordinates[1]);
      const k = `${r},${c}`;
      if (!cells.has(k)) cells.set(k, []);
      cells.get(k).push(f);
    }
    const colDist = (a, b) => Math.min(Math.abs(a - b), m.cols - Math.abs(a - b));
    const scored = [...cells.keys()].map((k) => {
      const [r, c] = k.split(",").map(Number);
      const events = [];
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          events.push(...(cells.get(`${r + dr},${(c + dc + m.cols) % m.cols}`) || []));
        }
      }
      return { r, c, events, top: strongest(events) };
    });
    scored.sort((a, b) => b.events.length - a.events.length || b.top.properties.mag - a.top.properties.mag);

    const picks = [];
    for (const s of scored) {
      if (picks.length >= max || s.events.length < 2) break;
      if (picks.some((p) => Math.abs(p.r - s.r) <= 3 && colDist(p.c, s.c) <= 3)) continue;
      picks.push(s);
    }
    return picks;
  }

  function renderMap() {
    const m = window.WORLD_MASK;
    if (!m) {
      setBody("map-body", errBox("worldmask.js failed to load"));
      return;
    }
    const lonStep = 360 / m.cols;
    const latStep = (m.latTop - m.latBottom) / m.rows;
    $("map-scale").textContent = `// ${m.cols}×${m.rows} · ${+lonStep.toFixed(2)}° lon × ${+latStep.toFixed(2)}° lat per dot`;

    const { loc, quakes } = mapState;
    const latest = quakes?.[0];
    const hotspots = quakes ? findHotspots(quakes) : [];
    const tsunamis = (quakes || []).filter((f) => f.properties.tsunami);

    // Per-cell labels for the hover readout.
    const labels = new Map();
    const label = (r, c, text) => labels.set(`${r},${c}`, [...(labels.get(`${r},${c}`) || []), text]);

    const dot = (r, c, rad, cls) => `<circle cx="${c + 0.5}" cy="${r + 0.5}" r="${rad}" class="${cls}"/>`;
    const parts = [];
    for (let r = 0; r < m.rows; r++) {
      for (let c = 0; c < m.cols; c++) {
        parts.push(m.grid[r][c] === "#" ? dot(r, c, 0.34, "land") : dot(r, c, 0.1, "ocean"));
      }
    }
    // Overlay, lowest priority first so the device marker is drawn on top.
    hotspots.forEach((h, i) => {
      parts.push(dot(h.r, h.c, 0.42, "mk mk-hot"), dot(h.r, h.c, 0.9, "ring hot"));
      label(h.r, h.c, `HOTSPOT #${i + 1}: ${h.events.length}× M4+`);
    });
    for (const f of tsunamis) {
      const { r, c } = toCell(f.geometry.coordinates[0], f.geometry.coordinates[1]);
      parts.push(dot(r, c, 0.75, "ring tsunami"));
      label(r, c, `TSUNAMI FLAG M${fmtNum(f.properties.mag, 1)}`);
    }
    if (latest) {
      const { r, c } = toCell(latest.geometry.coordinates[0], latest.geometry.coordinates[1]);
      parts.push(dot(r, c, 0.42, "mk mk-quake"), dot(r, c, 0.6, "ring quake ping"));
      label(r, c, `LATEST M${fmtNum(latest.properties.mag, 1)} ${shortPlace(latest.properties.place)}`);
    }
    if (loc) {
      const { r, c } = toCell(loc.lon, loc.lat);
      parts.push(dot(r, c, 0.42, "mk mk-you"), dot(r, c, 0.6, "ring you ping"));
      label(r, c, "YOU ARE HERE");
    }

    const legendRow = (glyph, cls, name, text) => `<tr><td><span class="${cls}">${glyph}</span> ${name}</td><td>${text}</td></tr>`;
    const legend = [
      legendRow("●", "dot-you", "YOU", loc
        ? esc([loc.city, loc.state, loc.countryCode].filter(Boolean).join(", ") || `${loc.lat.toFixed(2)}, ${loc.lon.toFixed(2)}`)
        : '<span class="dim">location unavailable</span>'),
      legendRow("●", "dot-quake", "LATEST M4+", latest
        ? `M${fmtNum(latest.properties.mag, 1)} · ${esc(latest.properties.place || "unknown")} · ${ago(latest.properties.time)}`
        : '<span class="dim">waiting for USGS</span>'),
      ...hotspots.map((h, i) =>
        legendRow("●", "dot-hot", `HOTSPOT #${i + 1}`,
          `${h.events.length}× M4+ in ${QUAKE_WINDOW_DAYS}d · max M${fmtNum(h.top.properties.mag, 1)} · near ${esc(shortPlace(h.top.properties.place))}`)),
      quakes && !hotspots.length ? legendRow("●", "dot-hot", "HOTSPOT", '<span class="dim">no clusters this week</span>') : "",
      legendRow("◌", "dot-quake", "TSUNAMI FLAG", tsunamis.length
        ? tsunamis.map((f) => `M${fmtNum(f.properties.mag, 1)} ${esc(shortPlace(f.properties.place))}`).join(" · ")
        : `<span class="dim">${quakes ? `none in last ${QUAKE_WINDOW_DAYS}d` : "waiting for USGS"}</span>`),
    ].join("");

    setBody(
      "map-body",
      `<svg class="worldmap" viewBox="0 0 ${m.cols} ${m.rows}" role="img" aria-label="Dot-matrix world map showing your location and recent earthquake activity">${parts.join("")}</svg>` +
        `<div class="map-readout" id="map-readout">&gt; hover a dot for coordinates</div>` +
        `<table class="tt legend">${legend}</table>` +
        `<div class="src">src: Natural Earth 1:110m land mask · USGS M4.0+ events, last ${QUAKE_WINDOW_DAYS} days · hotspot = densest 3×3-dot cluster · tsunami flag = USGS marks a large oceanic event (links to NOAA tsunami info; not a confirmed tsunami)</div>`
    );

    const svg = $("map-body").querySelector("svg");
    const readout = $("map-readout");
    const onPoint = (ev) => {
      const box = svg.getBoundingClientRect();
      const c = Math.floor(((ev.clientX - box.left) / box.width) * m.cols);
      const r = Math.floor(((ev.clientY - box.top) / box.height) * m.rows);
      if (r < 0 || r >= m.rows || c < 0 || c >= m.cols) return;
      const what = labels.get(`${r},${c}`);
      readout.textContent = `> [${pad(r)},${pad(c)}] ${cellBounds(r, c)} · ${m.grid[r][c] === "#" ? "LAND" : "OCEAN"}${what ? " · " + what.join(" · ") : ""}`;
    };
    svg.addEventListener("mousemove", onPoint);
    svg.addEventListener("click", onPoint);
  }

  // ---------- 07: earthquakes ----------

  const QUAKE_WINDOW_DAYS = 7;

  async function loadQuake(locPromise) {
    try {
      // One request serves both the latest-event tile and the map hotspots.
      const params = new URLSearchParams({
        format: "geojson",
        minmagnitude: "4",
        orderby: "time",
        starttime: new Date(Date.now() - QUAKE_WINDOW_DAYS * 86400000).toISOString().slice(0, 19),
        limit: "2000",
      });
      const data = await fetchJSON(`${API.usgs}?${params}`, { timeout: 25000 });
      const feats = data.features || [];
      mapState.quakes = feats;
      renderMap();
      if (!feats.length) {
        setBody("quake-body", '<span class="dim">no M4.0+ events returned</span>');
        return;
      }
      const loc = await locPromise;
      const [q, ...more] = feats;
      const rest = more.slice(0, 5);
      const p = q.properties;
      const [lon, lat, depth] = q.geometry.coordinates;
      const dist = loc ? haversineKm(loc.lat, loc.lon, lat, lon) : null;
      const magClass = p.mag >= 6 ? "alert" : p.mag >= 5 ? "warn" : "";

      const recent = rest
        .map((f) => {
          const fp = f.properties;
          return `<tr><td class="${fp.mag >= 6 ? "alert" : fp.mag >= 5 ? "warn" : ""}">M${fmtNum(fp.mag, 1)}</td><td>${esc(fp.place || "--")}</td><td>${ago(fp.time)}</td></tr>`;
        })
        .join("");

      setBody(
        "quake-body",
        `<div class="big ${magClass}">M${fmtNum(p.mag, 1)} <span style="font-size:14px">${esc(p.magType || "")}</span></div>` +
          `<div>${esc(p.place || "Unknown location")}</div><br>` +
          kv([
            ["TIME", `${esc(new Date(p.time).toLocaleString())} (${ago(p.time)})`],
            ["EPICENTER", `${lat.toFixed(3)}, ${lon.toFixed(3)}`],
            ["DEPTH", `${fmtNum(depth, 1)} km`],
            dist != null ? ["FROM YOU", `${fmtNum(dist)} km / ${fmtNum(dist * 0.621371)} mi`] : null,
            ["TSUNAMI", p.tsunami ? '<span class="alert">FLAG SET</span>' : "no"],
            p.alert ? ["PAGER", `<span class="${p.alert === "green" ? "" : "alert"}">${esc(p.alert.toUpperCase())}</span>`] : null,
            ["DETAIL", `<a href="${esc(p.url)}" target="_blank" rel="noopener">usgs event page ↗</a>`],
          ]) +
          (recent ? `<br><div class="dim">&gt; previous M4.0+ events</div><div class="scroll-x"><table class="tt">${recent}</table></div>` : "") +
          `<div class="src">src: USGS FDSN event service · refreshed ${new Date().toLocaleTimeString([], { hour12: false })}</div>`
      );
      log(`usgs: latest M${p.mag} ${p.place}`, "ok");
    } catch (e) {
      log(`usgs: ${e.message}`, "err");
      setBody("quake-body", errBox(`USGS request failed: ${e.message}`));
    }
  }

  // ---------- 08: near-earth objects ----------

  function getNasaKey() {
    try { return localStorage.getItem("nasa_api_key") || "DEMO_KEY"; } catch (_) { return "DEMO_KEY"; }
  }

  async function loadNeo() {
    const key = getNasaKey();
    const start = new Date();
    const end = new Date(start.getTime() + 7 * 86400000); // NeoWs feed allows max 7 days
    const params = new URLSearchParams({ start_date: isoDate(start), end_date: isoDate(end), api_key: key });
    try {
      const data = await fetchJSON(`${API.neoFeed}?${params}`, { timeout: 25000 });
      const now = Date.now();
      const approaches = [];
      for (const list of Object.values(data.near_earth_objects || {})) {
        for (const neo of list) {
          for (const ca of neo.close_approach_data || []) {
            if (ca.orbiting_body !== "Earth") continue;
            approaches.push({
              name: neo.name.replace(/[()]/g, "").trim(),
              url: neo.nasa_jpl_url,
              hazardous: neo.is_potentially_hazardous_asteroid,
              sentry: neo.is_sentry_object,
              dMin: neo.estimated_diameter?.meters?.estimated_diameter_min,
              dMax: neo.estimated_diameter?.meters?.estimated_diameter_max,
              t: ca.epoch_date_close_approach,
              ld: Number(ca.miss_distance.lunar),
              km: Number(ca.miss_distance.kilometers),
              kps: Number(ca.relative_velocity.kilometers_per_second),
            });
          }
        }
      }
      const upcoming = approaches.filter((a) => a.t >= now).sort((a, b) => a.t - b.t);
      const hazardous = upcoming.filter((a) => a.hazardous).length;
      const closest = [...upcoming].sort((a, b) => a.km - b.km)[0];

      const rows = upcoming
        .slice(0, 12)
        .map(
          (a) =>
            `<tr class="${a.hazardous ? "warn" : ""}">` +
            `<td><a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.name)}</a>${a.hazardous ? " ⚠" : ""}</td>` +
            `<td>${esc(new Date(a.t).toLocaleString([], { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }))}</td>` +
            `<td>${fmtNum(a.ld, 1)} LD</td>` +
            `<td>${fmtNum(a.dMin)}–${fmtNum(a.dMax)} m</td>` +
            `<td>${fmtNum(a.kps, 1)} km/s</td></tr>`
        )
        .join("");

      setBody(
        "neo-body",
        kv([
          ["WINDOW", `${isoDate(start)} → ${isoDate(end)}`],
          ["INBOUND", `<b>${upcoming.length}</b> close approaches`],
          ["PHA", hazardous ? `<span class="warn">${hazardous} potentially hazardous</span>` : "0 potentially hazardous"],
          closest
            ? ["CLOSEST", `<span class="${closest.ld < 1 ? "alert" : ""}">${esc(closest.name)} — ${fmtNum(closest.ld, 2)} LD / ${fmtNum(closest.km)} km (${ago(closest.t)})</span>`]
            : null,
        ]) +
          (rows
            ? `<br><div class="scroll-x"><table class="tt"><thead><tr><th>OBJECT</th><th>APPROACH</th><th>MISS</th><th>DIAM</th><th>VEL</th></tr></thead><tbody>${rows}</tbody></table></div>`
            : '<br><span class="dim">no upcoming approaches in window</span>') +
          `<div class="src">src: NASA NeoWs (JPL CNEOS data) · LD = lunar distance (${fmtNum(LUNAR_KM)} km) · ⚠ = potentially hazardous asteroid · key: ${key === "DEMO_KEY" ? "DEMO_KEY (rate limited)" : "custom"}</div>`
      );
      log(`nasa neows: ${upcoming.length} upcoming approaches`, "ok");
    } catch (e) {
      const hint = e.status === 429 || e.status === 403
        ? " — DEMO_KEY rate limit hit. Get a free key at api.nasa.gov and set it in the footer."
        : "";
      log(`nasa neows: ${e.message}${hint}`, "err");
      setBody("neo-body", errBox(`NASA NeoWs request failed: ${e.message}${hint}`));
    }
  }

  function initNasaKeyForm() {
    const input = $("nasa-key");
    const current = getNasaKey();
    if (current !== "DEMO_KEY") input.value = current;
    $("nasa-key-form").addEventListener("submit", (ev) => {
      ev.preventDefault();
      const v = input.value.trim();
      try {
        if (v) localStorage.setItem("nasa_api_key", v);
        else localStorage.removeItem("nasa_api_key");
      } catch (_) {}
      log(`nasa key ${v ? "updated" : "reset to DEMO_KEY"}`, "ok");
      loadNeo();
    });
  }

  // ---------- kiosk mode (hotel TV) ----------
  // Big type, hidden cursor, screen kept awake, slow auto-scroll, small pixel shift
  // against burn-in, and a periodic full reload to recover from stale state.

  const kiosk = { on: false, wakeLock: null, timers: [], raf: 0, pos: 0, pauseUntil: 0 };
  const KIOSK_RELOAD_MS = 6 * 60 * 60 * 1000;
  const SCROLL_PX_PER_MS = 0.03; // ~30 px/s

  async function requestWakeLock() {
    if (!kiosk.on || !navigator.wakeLock || document.visibilityState !== "visible") return;
    try {
      kiosk.wakeLock = await navigator.wakeLock.request("screen");
    } catch (e) {
      log(`wake lock: ${e.message}`, "warn");
    }
  }

  function applyKioskZoom() {
    // Lay the page out as if the screen were ~1280px wide, then scale it up to fill the TV.
    document.body.style.zoom = kiosk.on ? String(Math.min(3, Math.max(1, window.innerWidth / 1280))) : "";
  }

  // Scroll slowly to the bottom, hold 10 s, return to the top, hold 20 s, repeat.
  function startAutoScroll() {
    let last = performance.now();
    kiosk.pos = window.scrollY;
    kiosk.pauseUntil = last + 15000;
    const step = (now) => {
      if (!kiosk.on) return;
      const dt = now - last;
      last = now;
      const max = document.documentElement.scrollHeight - document.documentElement.clientHeight;
      if (max > 4 && now >= kiosk.pauseUntil) {
        kiosk.pos = Math.min(max, kiosk.pos + dt * SCROLL_PX_PER_MS);
        window.scrollTo(0, kiosk.pos);
        if (kiosk.pos >= max) {
          kiosk.pos = 0;
          kiosk.pauseUntil = now + 30000;
          setTimeout(() => kiosk.on && window.scrollTo({ top: 0, behavior: "smooth" }), 10000);
        }
      }
      kiosk.raf = requestAnimationFrame(step);
    };
    kiosk.raf = requestAnimationFrame(step);
  }

  function goFullscreen() {
    if (kiosk.on && !document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
  }

  function setKiosk(on) {
    kiosk.on = on;
    document.documentElement.classList.toggle("kiosk", on);
    kiosk.timers.forEach(clearInterval);
    kiosk.timers = [];
    cancelAnimationFrame(kiosk.raf);
    applyKioskZoom();

    // Keep ?kiosk in the URL so a reload (or a bookmark) stays in kiosk mode.
    const q = new URLSearchParams(location.search);
    q.delete("kiosk");
    const rest = q.toString();
    const search = on ? `?kiosk${rest ? `&${rest}` : ""}` : rest ? `?${rest}` : "";
    history.replaceState(null, "", location.pathname + search + location.hash);

    if (!on) {
      kiosk.wakeLock?.release().catch(() => {});
      kiosk.wakeLock = null;
      $("crt").style.transform = "";
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      log("kiosk mode off", "ok");
      return;
    }
    requestWakeLock();
    startAutoScroll();
    kiosk.timers.push(
      // Nudge the whole screen a few pixels now and then to avoid burn-in.
      setInterval(() => {
        const dx = Math.round(Math.random() * 6 - 3);
        const dy = Math.round(Math.random() * 6 - 3);
        $("crt").style.transform = `translate(${dx}px, ${dy}px)`;
      }, 3 * 60 * 1000),
      setInterval(() => location.reload(), KIOSK_RELOAD_MS)
    );
    log("kiosk mode on (K to exit) — click or press any key for fullscreen", "ok");
  }

  function initKiosk() {
    window.addEventListener("resize", applyKioskZoom);
    document.addEventListener("visibilitychange", requestWakeLock);
    // Manual scrolling pauses the auto-scroll for a minute.
    const hold = () => {
      kiosk.pauseUntil = performance.now() + 60000;
      kiosk.pos = window.scrollY;
    };
    window.addEventListener("wheel", hold, { passive: true });
    window.addEventListener("touchstart", hold, { passive: true });
    // Fullscreen needs a user gesture, so take the first click/key in kiosk mode.
    document.addEventListener("click", goFullscreen);
    document.addEventListener("keydown", goFullscreen);
    $("btn-kiosk").addEventListener("click", () => setKiosk(!kiosk.on));
    if (URLQ.has("kiosk")) setKiosk(true);
  }

  // ---------- boot ----------

  let locPromise = null;

  function refreshAll() {
    log("refresh: all feeds");
    const ipGeoPromise = loadSystem().catch((e) => { log(`system: ${e.message}`, "err"); return null; });
    locPromise = loadLocation(ipGeoPromise).catch((e) => { log(`location: ${e.message}`, "err"); return null; });
    locPromise.then((loc) => { mapState.loc = loc; renderMap(); });
    loadWeather(locPromise);
    loadAlerts(locPromise);
    loadHealth(locPromise).catch((e) => setBody("health-body", errBox(e.message)));
    loadQuake(locPromise);
    loadNeo();
  }

  function boot() {
    log("SITREP terminal booting…");
    startClock();
    initTheme();
    initNasaKeyForm();
    initKiosk();
    renderMap();
    refreshAll();

    $("btn-refresh").addEventListener("click", refreshAll);
    document.addEventListener("keydown", (e) => {
      if (e.target.closest("input, textarea") || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "r" || e.key === "R") refreshAll();
      if (e.key === "t" || e.key === "T") $("btn-theme").click();
      if (e.key === "k" || e.key === "K") {
        setKiosk(!kiosk.on);
        goFullscreen();
      }
    });

    setInterval(() => loadQuake(locPromise), REFRESH_MS.quake);
    setInterval(loadNeo, REFRESH_MS.neo);
    setInterval(() => loadHealth(locPromise), REFRESH_MS.health);
    setInterval(() => loadWeather(locPromise), REFRESH_MS.weather);
    setInterval(() => loadAlerts(locPromise), REFRESH_MS.alerts);
  }

  boot();
})();
