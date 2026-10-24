# SITREP://TERMINAL

A retro, terminal-style situational dashboard. Plain HTML/CSS/JS: no build step, no dependencies.

**Live:** <https://moltarxlr.github.io/Dashboard/>

```
[!! SEVERE-ALERT BANNER (only when one is active) !!]
[01 WEATHER] [02 LOCAL ALERTS] [03 WORLD GRID ........]
[04 LOCATION ...........] [05 SYSTEM / NETWORK .....]
[06 RESPIRATORY / PANDEMIC CONDITIONS ......]
[07 SEISMIC M4.0+] [08 NEAR-EARTH OBJECTS]
```

That's the layout on wide screens (1400 CSS px and up, including kiosk mode on a TV). There the map shrinks to the height of the weather and alerts tiles. Narrower screens show two columns with the map full width, and phones show one column.

## Tiles

| # | Tile | Source |
|---|------|--------|
| 01 | Current conditions with ASCII icon, feels-like, wind/gusts, humidity, pressure, UV, US AQI + PM2.5, sunrise/sunset, 24 h temperature and rain sparklines, 5-day outlook. °F/mph in the US, °C/km/h elsewhere. | [Open-Meteo](https://open-meteo.com/) forecast + air-quality APIs (free, no key, worldwide, non-commercial use) |
| 02 | Local alerts: active NWS watches/warnings/advisories for your exact point (including civil emergencies NWS relays), air-quality advisory, M2.5+ earthquakes within 300 km in the past 7 days, and FEMA disaster declarations in your state in the last 90 days (flagged if your county is included). Severe/Extreme NWS alerts also raise a sticky red banner at the top of the page. | [NWS api.weather.gov](https://www.weather.gov/documentation/services-web-api) (US and territories only), [OpenFEMA](https://www.fema.gov/about/openfema/api), USGS, Open-Meteo |
| 03 | Dot-matrix world map (60×30, each dot ≈ 6° lon × 4.8° lat, 84°N to 60°S). **Cyan** = your device, **red** = latest M4.0+ quake, **magenta** = the top two earthquake hotspots (densest clusters of M4.0+ events in the past 7 days), dashed red ring = USGS tsunami flag. Hover or tap a dot to read its coordinates. | Land mask from [Natural Earth](https://www.naturalearthdata.com/) 1:110m via `world-atlas`, pre-generated into `worldmask.js`. Quakes from USGS (same request as tile 07). |
| 04 | Device location (lat/lon, accuracy, city/county/state) | Browser [Geolocation API](https://developer.mozilla.org/docs/Web/API/Geolocation_API), reverse geocoded with [BigDataCloud](https://www.bigdatacloud.com/free-api/free-reverse-geocode-to-city-api). Falls back to IP geolocation if permission is denied. |
| 05 | Browser, OS, public IP, ISP, screen, cores, connection | `navigator` / User-Agent Client Hints, [ipify](https://www.ipify.org/), [GeoJS](https://www.geojs.io/) |
| 06 | % of ER visits for COVID-19, flu, and RSV, with CDC trend direction, for your county, your state, and the US | [CDC NSSP ED Visit Trajectories](https://data.cdc.gov/Public-Health-Surveillance/NSSP-Emergency-Department-Visit-Trajectories-by-St/rdmq-nq56) (`data.cdc.gov` Socrata API). Outside the US, or if the CDC is unreachable, it shows general COVID-19 totals from [disease.sh](https://disease.sh/). |
| 07 | Most recent earthquake of magnitude 4.0 or higher worldwide: location, depth, distance from you, tsunami flag, plus the previous few | [USGS FDSN Event API](https://earthquake.usgs.gov/fdsnws/event/1/) |
| 08 | Asteroids making close approaches to Earth over the next 7 days: miss distance, size, speed, hazard flag | [NASA NeoWs](https://api.nasa.gov/) |

## Run it

The Geolocation API only works on `https://` or `localhost`, so serve the folder instead of opening the file directly:

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

### GitHub Pages

The site is served straight from the repository root (`.nojekyll` tells Pages to skip the Jekyll build). One-time setup:

1. Repo **Settings → Pages**
2. **Source:** Deploy from a branch
3. **Branch:** `claude/vibrant-hopper-vt0if8`, folder `/ (root)` → **Save**

After a minute or so it's live at <https://moltarxlr.github.io/Dashboard/>. Every push to that branch redeploys automatically.

### Changing the map resolution

`worldmask.js` is generated offline, so the page itself has no dependencies. To rebuild it at another size, e.g. 30×30:

```sh
cd tools && npm install
node gen-worldmask.mjs 30 30        # args: cols rows [latTop=84] [latBottom=-60]
```

## Controls

- `R` or **[R]EFRESH**: reload every feed
- `T` or **[T]HEME**: toggle green and amber phosphor
- `K` or **[K]IOSK**: toggle hotel-TV kiosk mode (see below)
- Auto-refresh: local alerts every 3 minutes; earthquakes every 5; weather every 15; NEO and CDC data hourly

### URL options

| Option | Effect |
|--------|--------|
| `?kiosk` | Start in kiosk mode |
| `?lat=40.7580&lon=-73.9855` | Pin the location instead of asking the browser (handy when IP geolocation is wrong on hotel Wi-Fi) |
| `?units=metric` / `?units=imperial` | Override the automatic unit choice |

Options combine, e.g. `https://moltarxlr.github.io/Dashboard/?kiosk&units=imperial`.

## Hotel TV / kiosk mode

Kiosk mode is meant for a small computer plugged into a TV's HDMI port. It:

- scales the whole page up to fill a 1080p or 4K screen, and hides the mouse cursor and buttons
- keeps the screen awake (Screen Wake Lock API)
- slowly auto-scrolls through every tile, pausing at the top and bottom; the severe-alert banner stays pinned on screen while it scrolls
- shifts the picture a few pixels every 3 minutes to avoid burn-in
- reloads itself every 6 hours

Setup on the mini PC:

1. Join the hotel Wi-Fi and get through its sign-in page first.
2. Open `https://moltarxlr.github.io/Dashboard/` once in a normal browser window and **allow location** when asked. Chromium remembers that for the site.
3. Launch it full screen, e.g.:
   ```sh
   chromium --kiosk --noerrdialogs --disable-infobars "https://moltarxlr.github.io/Dashboard/?kiosk"
   ```
   (Without `--kiosk`, click or press any key once to go fullscreen.)

If the location looks wrong, the mini PC probably has no Wi-Fi positioning and fell back to the hotel's IP address, which can be in another city. Add `&lat=..&lon=..` for the hotel to the URL.

## NASA API key

Out of the box it uses NASA's shared `DEMO_KEY`, which is rate limited (about 30 requests/hour and 50/day per IP). Get a free key at <https://api.nasa.gov/> and paste it into the `NASA_API_KEY>` box in the footer. It is saved in your browser's localStorage only.

## Notes

- CDC NSSP data is updated weekly (Fridays). County figures are reported per Health Service Area (HSA).
- disease.sh COVID-19 totals may be stale; the tile shows the source's last-updated time.
- NWS alerts only exist for the US and its territories. Elsewhere the alerts tile still shows nearby earthquakes and air quality.
- OpenFEMA is called straight from the browser. If FEMA stops allowing that, the FEMA line just disappears and the rest of the tile keeps working.
- Nothing is sent anywhere except the public API requests listed above.
