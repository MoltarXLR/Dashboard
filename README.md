# SITREP://TERMINAL

A retro, terminal-style situational dashboard. Plain HTML/CSS/JS: no build step, no dependencies.

**Live:** <https://moltarxlr.github.io/Dashboard/>

```
[00 WORLD GRID ..............................]
[01 LOCATION] [02 SYSTEM / NETWORK]
[03 RESPIRATORY / PANDEMIC CONDITIONS ......]
[04 SEISMIC M4.0+] [05 NEAR-EARTH OBJECTS]
```

## Tiles

| # | Tile | Source |
|---|------|--------|
| 00 | Dot-matrix world map (60×30, each dot ≈ 6° lon × 4.8° lat, 84°N to 60°S). **Cyan** = your device, **red** = latest M4.0+ quake, **magenta** = the top two earthquake hotspots (densest clusters of M4.0+ events in the past 7 days), dashed red ring = USGS tsunami flag. Hover or tap a dot to read its coordinates. | Land mask from [Natural Earth](https://www.naturalearthdata.com/) 1:110m via `world-atlas`, pre-generated into `worldmask.js`. Quakes from USGS (same request as tile 04). |
| 01 | Device location (lat/lon, accuracy, city/county/state) | Browser [Geolocation API](https://developer.mozilla.org/docs/Web/API/Geolocation_API), reverse geocoded with [BigDataCloud](https://www.bigdatacloud.com/free-api/free-reverse-geocode-to-city-api). Falls back to IP geolocation if permission is denied. |
| 02 | Browser, OS, public IP, ISP, screen, cores, connection | `navigator` / User-Agent Client Hints, [ipify](https://www.ipify.org/), [GeoJS](https://www.geojs.io/) |
| 03 | % of ER visits for COVID-19, flu, and RSV, with CDC trend direction, for your county, your state, and the US | [CDC NSSP ED Visit Trajectories](https://data.cdc.gov/Public-Health-Surveillance/NSSP-Emergency-Department-Visit-Trajectories-by-St/rdmq-nq56) (`data.cdc.gov` Socrata API). Outside the US, or if the CDC is unreachable, it shows general COVID-19 totals from [disease.sh](https://disease.sh/). |
| 04 | Most recent earthquake of magnitude 4.0 or higher worldwide: location, depth, distance from you, tsunami flag, plus the previous few | [USGS FDSN Event API](https://earthquake.usgs.gov/fdsnws/event/1/) |
| 05 | Asteroids making close approaches to Earth over the next 7 days: miss distance, size, speed, hazard flag | [NASA NeoWs](https://api.nasa.gov/) |

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
- Auto-refresh: earthquakes every 5 minutes; NEO and CDC data hourly

## NASA API key

Out of the box it uses NASA's shared `DEMO_KEY`, which is rate limited (about 30 requests/hour and 50/day per IP). Get a free key at <https://api.nasa.gov/> and paste it into the `NASA_API_KEY>` box in the footer. It is saved in your browser's localStorage only.

## Notes

- CDC NSSP data is updated weekly (Fridays). County figures are reported per Health Service Area (HSA).
- disease.sh COVID-19 totals may be stale; the tile shows the source's last-updated time.
- Nothing is sent anywhere except the public API requests listed above.
