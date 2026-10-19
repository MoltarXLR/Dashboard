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
  };

  const REFRESH_MS = {
    quake: 5 * 60 * 1000,
    neo: 60 * 60 * 1000,
    health: 60 * 60 * 1000,
  };

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

  // ---------- 02: system / network ----------

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

  // ---------- 01: location ----------

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

  // ---------- 03: CDC / pandemic ----------

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

  // ---------- 00: world grid ----------

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

  // ---------- 04: earthquakes ----------

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

  // ---------- 05: near-earth objects ----------

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

  // ---------- boot ----------

  let locPromise = null;

  function refreshAll() {
    log("refresh: all feeds");
    const ipGeoPromise = loadSystem().catch((e) => { log(`system: ${e.message}`, "err"); return null; });
    locPromise = loadLocation(ipGeoPromise).catch((e) => { log(`location: ${e.message}`, "err"); return null; });
    locPromise.then((loc) => { mapState.loc = loc; renderMap(); });
    loadHealth(locPromise).catch((e) => setBody("health-body", errBox(e.message)));
    loadQuake(locPromise);
    loadNeo();
  }

  function boot() {
    log("SITREP terminal booting…");
    startClock();
    initTheme();
    initNasaKeyForm();
    renderMap();
    refreshAll();

    $("btn-refresh").addEventListener("click", refreshAll);
    document.addEventListener("keydown", (e) => {
      if (e.target.closest("input, textarea") || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "r" || e.key === "R") refreshAll();
      if (e.key === "t" || e.key === "T") $("btn-theme").click();
    });

    setInterval(() => loadQuake(locPromise), REFRESH_MS.quake);
    setInterval(loadNeo, REFRESH_MS.neo);
    setInterval(() => loadHealth(locPromise), REFRESH_MS.health);
  }

  boot();
})();
