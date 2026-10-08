"""Archetypal Earth — ephemeris sidecar.

Localhost-only. The site never requires it: everything the page needs is
generated into public/data/sky.json by `npm run sky`; live features call this
service when present and degrade, labelled, when it is not.

    ephemeris/.venv/bin/python -m uvicorn app:app --host 127.0.0.1 --port 5187

Endpoint contracts are written out in docs/SKY-SOURCES.md.
"""

from __future__ import annotations

import os
import platform
from datetime import datetime, timezone
from typing import Annotated

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

import engine

SIDECAR_NAME = "archetypal-earth-ephemeris"
SIDECAR_VERSION = "1.1.0"
PORT = int(os.environ.get("EPHEMERIS_PORT", "5187"))

app = FastAPI(title=SIDECAR_NAME, version=SIDECAR_VERSION, docs_url=None, redoc_url=None)

# The page talks to the sidecar from the dev/preview servers on this machine only.
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^http://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_methods=["GET"],
    allow_headers=["*"],
)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _instant(iso: str | None) -> datetime:
    if not iso:
        return _now()
    try:
        return engine.parse_iso_utc(iso)
    except ValueError as e:
        raise HTTPException(422, f"unparseable instant: {iso}") from e


def _range_guard(fn):
    try:
        return fn()
    except engine.RangeError as e:
        raise HTTPException(422, {"error": "outside-ephemeris-range", "message": str(e), "kernel": engine.kernel_range()}) from e
    except ValueError as e:
        raise HTTPException(422, str(e)) from e


@app.get("/ping")
def ping():
    return {
        "name": SIDECAR_NAME,
        "version": SIDECAR_VERSION,
        "time": _now().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "python": platform.python_version(),
        "packages": engine.versions(),
        "ephemeris": engine.kernel_range(),
        "positions": "apparent geocentric for sun and moon; heliocentric for the planets and earth; ecliptic and equinox of date",
        "port": PORT,
    }


@app.get("/now")
def now():
    d = _now()
    snap = _range_guard(lambda: engine.snapshot(engine.jd_ut(d)))
    snap["phase"] = engine.lunar_phase_kerykeion(d)
    return snap


@app.get("/positions")
def positions(
    t: str | None = None,
    start: str | None = None,
    stepHours: Annotated[float, Query(gt=0, le=24 * 1000)] = 48.0,
    count: Annotated[int, Query(ge=1, le=200000)] = 1,
    bodies: str = "mercury,venus,mars,jupiter,saturn,uranus,neptune,pluto,earth",
    frame: Annotated[str, Query(pattern="^(helio|geo)$")] = "helio",
):
    """One instant (`t`) as a snapshot, or a uniform grid (`start`, `stepHours`, `count`)."""
    if start is None:
        d = _instant(t)
        snap = _range_guard(lambda: engine.snapshot(engine.jd_ut(d)))
        snap["phase"] = engine.lunar_phase_kerykeion(d)
        return snap
    names = [b for b in bodies.split(",") if b]
    return _range_guard(lambda: engine.grid(names, _instant(start), stepHours, count, frame))


@app.get("/chart")
def chart(
    local: str,
    lat: float,
    lon: float,
    tz: str | None = None,
    name: str = "Birth",
):
    """A natal chart. `local` is wall-clock time at the place, `YYYY-MM-DDTHH:MM`, no offset."""
    return _range_guard(lambda: engine.chart(local, lat, lon, tz, name))


@app.get("/geocode")
def geocode(q: Annotated[str, Query(min_length=2, max_length=120)]):
    try:
        return {"results": engine.geocode(q)}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(503, {"error": "geocoder-unreachable", "message": str(e)}) from e


@app.get("/golden")
def golden():
    """Reference values the generator pins into sky.json: golden epochs, ayanamsa table, constellation boundaries."""
    years = list(range(-13000, 13001, 500)) + [-6, 0, 1900, 2000, 2026]
    years = sorted(set(years))
    return {
        "epochs": [
            engine.golden_epoch("J2000.0", "2000-01-01T12:00:00Z"),
            engine.golden_epoch("Modern sample", "2026-10-08T12:00:00Z"),
            # an instant that is on no sample grid: the interpolation's honest probe
            engine.golden_epoch("Off-grid probe", "2026-03-17T07:23:00Z"),
            engine.golden_julian(
                "Jupiter–Saturn conjunction of Aion's account (29 May 7 BCE, Julian calendar)",
                -6, 5, 29, 12.0, "7 BCE-05-29 (Julian)",
            ),
        ],
        "ayanamsa": {"definitions": engine.ayanamsa_definitions(), "table": engine.ayanamsa_table(years)},
        "constellationBoundaries": engine.constellation_boundaries(),
        "equinoxFrame": "mean ecliptic and equinox of J2000.0 for boundary longitudes",
    }
