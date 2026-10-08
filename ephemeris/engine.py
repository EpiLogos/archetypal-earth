"""Computation behind the ephemeris sidecar.

One authority: Kerykeion (v6) and the engine it is built on, libephemeris
(JPL DE440 through Skyfield, with an AGPL Swiss-Ephemeris-compatible API).
Charts, house cusps, aspects and the lunar phase come from Kerykeion's own
factories. Bulk sampling and distances call libephemeris directly — the same
engine Kerykeion calls — because Kerykeion's point model carries no distance.
There is no second ephemeris and nothing here is fabricated: a date outside the
loaded kernel raises, it is never approximated.
"""

from __future__ import annotations

import logging
import math
from datetime import datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import libephemeris as le

# libephemeris logs a warning per call when it falls back to a Keplerian
# approximation for bodies we never ask for; keep the sidecar's log readable.
logging.getLogger("libephemeris").setLevel(logging.ERROR)

AU_KM = 149_597_870.7
EARTH_RADIUS_KM = 6378.1366  # equatorial, the unit the globe uses for "R⊕" display

SIGNS = [
    "Aries", "Taurus", "Gemini", "Cancer", "Leo", "Virgo",
    "Libra", "Scorpio", "Sagittarius", "Capricorn", "Aquarius", "Pisces",
]

BODY_IDS: dict[str, int] = {
    "sun": le.SUN,
    "moon": le.MOON,
    "earth": le.EARTH,
    "mercury": le.MERCURY,
    "venus": le.VENUS,
    "mars": le.MARS,
    "jupiter": le.JUPITER,
    "saturn": le.SATURN,
    "uranus": le.URANUS,
    "neptune": le.NEPTUNE,
    "pluto": le.PLUTO,
}
PLANETS = ["mercury", "venus", "mars", "jupiter", "saturn", "uranus", "neptune", "pluto"]
KERYKEION_POINTS = ["Sun", "Moon", "Mercury", "Venus", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune", "Pluto"]

_FLAGS = le.FLG_SWIEPH | le.FLG_SPEED


class RangeError(ValueError):
    """The instant lies outside the loaded ephemeris kernel (never approximated)."""


def kernel_range() -> dict[str, Any]:
    """The loaded kernel's supported span, read from the engine's own error."""
    lo, hi = 2287184.5, 2688976.5  # DE440 as reported by libephemeris
    try:
        le.calc_ut(lo - 1000, le.SUN, _FLAGS)
    except Exception as e:  # noqa: BLE001 - we want the engine's own message
        msg = str(e)
        if "Supported range:" in msg:
            part = msg.split("Supported range:")[1].split("\n")[0]
            nums = [float(x) for x in part.replace("JD", " ").replace("to", " ").split() if _isnum(x)]
            if len(nums) >= 2:
                lo, hi = nums[0], nums[1]
    return {
        "kernel": "de440",
        "fromJd": lo,
        "toJd": hi,
        "from": jd_to_iso(lo),
        "to": jd_to_iso(hi),
    }


def _isnum(s: str) -> bool:
    try:
        float(s)
        return True
    except ValueError:
        return False


# ── time ────────────────────────────────────────────────────────────────────


def parse_iso_utc(iso: str) -> datetime:
    s = iso.strip()
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    d = datetime.fromisoformat(s)
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    return d.astimezone(timezone.utc)


def jd_ut(d: datetime) -> float:
    return le.julday(d.year, d.month, d.day, d.hour + d.minute / 60 + d.second / 3600 + d.microsecond / 3.6e9)


def jd_to_iso(jd: float) -> str:
    y, m, d, h = le.revjul(jd)
    secs = round(h * 3600)
    base = datetime(int(y), int(m), int(d), tzinfo=timezone.utc) if 1 <= int(y) <= 9999 else None
    if base is None:
        return f"{int(y):+05d}-{int(m):02d}-{int(d):02d}T{int(h):02d}:00:00Z"
    return (base + timedelta(seconds=secs)).strftime("%Y-%m-%dT%H:%M:%SZ")


def _wrap360(x: float) -> float:
    return x % 360.0


def _wrap180(x: float) -> float:
    return (x + 180.0) % 360.0 - 180.0


# ── bodies ──────────────────────────────────────────────────────────────────


def _calc(jd: float, body: str, extra: int = 0) -> tuple[float, float, float, float]:
    """(lon, lat, dist_au, lon_speed) — raises RangeError outside the kernel."""
    try:
        r, _ = le.calc_ut(jd, BODY_IDS[body], _FLAGS | extra)
    except le.EphemerisRangeError as e:
        raise RangeError(str(e).split("\n")[0]) from e
    return r[0], r[1], r[2], r[3]


def helio(jd: float, body: str) -> dict[str, float]:
    lon, lat, r, speed = _calc(jd, body, le.FLG_HELCTR)
    return {"lon": lon, "lat": lat, "r": r, "speed": speed}


def geo(jd: float, body: str) -> dict[str, float]:
    lon, lat, r, speed = _calc(jd, body)
    return {"lon": lon, "lat": lat, "r": r, "speed": speed}


def equatorial(jd: float, body: str) -> dict[str, float]:
    try:
        r, _ = le.calc_ut(jd, BODY_IDS[body], _FLAGS | le.FLG_EQUATORIAL)
    except le.EphemerisRangeError as e:
        raise RangeError(str(e).split("\n")[0]) from e
    return {"ra": r[0], "dec": r[1], "r": r[2]}


def gmst_deg(jd: float) -> float:
    return (le.sidtime(jd) * 15.0) % 360.0


def sub_point(jd: float, body: str) -> dict[str, float]:
    """Geographic point where `body` stands at the zenith: lat = declination, lon = RA − GST."""
    eq = equatorial(jd, body)
    return {"lat": eq["dec"], "lon": _wrap180(eq["ra"] - gmst_deg(jd))}


def snapshot(jd: float) -> dict[str, Any]:
    """Everything the sky view needs at one instant."""
    sun = geo(jd, "sun")
    moon = geo(jd, "moon")
    elong = _wrap360(moon["lon"] - sun["lon"])
    return {
        "jd": jd,
        "iso": jd_to_iso(jd),
        "sun": sun,
        "moon": {**moon, "distKm": moon["r"] * AU_KM},
        "elongation": elong,
        # geometric illuminated fraction from elongation (cos of phase angle ≈ −cos elongation)
        "illuminated": (1 - math.cos(math.radians(elong))) / 2,
        "waxing": elong < 180.0,
        "gmst": gmst_deg(jd),
        "subsolar": sub_point(jd, "sun"),
        "sublunar": sub_point(jd, "moon"),
        "earth": helio(jd, "earth"),
        "planets": {k: helio(jd, k) for k in PLANETS},
    }


def lunar_phase_kerykeion(d: datetime) -> dict[str, Any]:
    """The lunar-phase names Kerykeion assigns (windows centred on the syzygies)."""
    from kerykeion import AstrologicalSubjectFactory

    s = AstrologicalSubjectFactory.from_birth_data(
        name="phase", year=d.year, month=d.month, day=d.day, hour=d.hour, minute=d.minute,
        lng=0.0, lat=0.0, tz_str="UTC", online=False, active_points=["Sun", "Moon"],
    )
    lp = s.lunar_phase
    return {
        "name": lp.moon_phase_name,
        "major": lp.major_phase,
        "stage": lp.stage,
        "index": lp.moon_phase,
        "degreesBetween": lp.degrees_between_s_m,
    }


# ── bulk sampling ───────────────────────────────────────────────────────────

# `frame`: "helio" for planets and earth, "geo" for the moon. Columns are
# rounded for display-grade sampling; the file budget is part of the contract.
_ROUND = {"lon": 3, "lat": 3, "r": 5}


def grid(bodies: list[str], start: datetime, step_hours: float, count: int, frame: str) -> dict[str, Any]:
    if count < 1 or count > 200_000:
        raise ValueError("count outside 1..200000")
    jd0 = jd_ut(start)
    step = step_hours / 24.0
    out: dict[str, dict[str, list[float]]] = {}
    for b in bodies:
        if b not in BODY_IDS:
            raise ValueError(f"unknown body {b}")
        cols = {"lon": [], "lat": [], "r": []}
        rr = 7 if b == "moon" else _ROUND["r"]
        for i in range(count):
            p = (helio if frame == "helio" else geo)(jd0 + i * step, b)
            cols["lon"].append(round(p["lon"], _ROUND["lon"]))
            cols["lat"].append(round(p["lat"], _ROUND["lat"]))
            cols["r"].append(round(p["r"], rr))
        out[b] = cols
    return {"frame": frame, "start": start.strftime("%Y-%m-%dT%H:%M:%SZ"), "stepHours": step_hours, "count": count, "bodies": out}


# ── ayanamsa, constellations, golden epochs ─────────────────────────────────

AYANAMSA_MODES = {"fagan-bradley": le.SIDM_FAGAN_BRADLEY, "lahiri": le.SIDM_LAHIRI}


def ayanamsa(jd: float, mode: str) -> float:
    le.set_sid_mode(AYANAMSA_MODES[mode])
    return le.get_ayanamsa_ut(jd)


def ayanamsa_table(years: list[int]) -> list[dict[str, Any]]:
    rows = []
    for y in years:
        jd = le.julday(y, 1, 1, 12.0)  # proleptic Gregorian, astronomical year numbering
        rows.append({
            "year": y,
            "jd": jd,
            "fagan-bradley": ayanamsa(jd, "fagan-bradley"),
            "lahiri": ayanamsa(jd, "lahiri"),
        })
    return rows


def ayanamsa_definitions() -> dict[str, Any]:
    from libephemeris.ayanamsha_definitions import AYANAMSHA_DEFINING

    out = {}
    for name, mode in AYANAMSA_MODES.items():
        v, t0 = AYANAMSHA_DEFINING[mode]
        out[name] = {"valueDeg": v, "epochJdTT": t0}
    return out


def constellation_boundaries() -> list[dict[str, Any]]:
    """IAU (Delporte) constellation boundaries along the ecliptic of J2000.0.

    Scanned and bisected through Skyfield's bundled constellation map, so the
    boundary data is the IAU's, not a table typed here. Longitudes are on the
    mean ecliptic and equinox of J2000.0, latitude 0.
    """
    from skyfield.api import load_constellation_map, position_of_radec

    cmap = load_constellation_map()
    eps = math.radians(84381.406 / 3600.0)  # IAU 2006 mean obliquity at J2000.0

    def at(lon_deg: float) -> str:
        lam = math.radians(lon_deg)
        x, y, z = math.cos(lam), math.sin(lam) * math.cos(eps), math.sin(lam) * math.sin(eps)
        ra = (math.degrees(math.atan2(y, x)) % 360.0) / 15.0
        dec = math.degrees(math.asin(z))
        return str(cmap(position_of_radec(ra, dec)))

    n = 3600
    out: list[dict[str, Any]] = []
    prev = at(0.0)
    first = prev
    for i in range(1, n + 1):
        lo = (i - 1) * 360.0 / n
        hi = i * 360.0 / n
        cur = at(hi % 360.0)
        if cur != prev:
            a, b = lo, hi
            for _ in range(30):
                mid = (a + b) / 2
                if at(mid) == prev:
                    a = mid
                else:
                    b = mid
            out.append({"lon": round((a + b) / 2, 4), "from": prev, "to": cur})
            prev = cur
    assert prev == first, "ecliptic scan did not close"
    return out


def golden_epoch(label: str, iso: str) -> dict[str, Any]:
    """A fixed Gregorian instant with its sidecar values, or an honest `unavailable` record."""
    return _epoch_record(label, iso, jd_ut(parse_iso_utc(iso)), "gregorian")


def golden_julian(label: str, y: int, m: int, d: int, hour: float = 12.0, display: str = "") -> dict[str, Any]:
    """A Julian-calendar date (astronomical year numbering: 7 BCE is −6)."""
    jd = le.julday(y, m, d, hour, 0)  # last argument 0 = Julian calendar
    return _epoch_record(label, display or f"{y:+05d}-{m:02d}-{d:02d} (Julian)", jd, "julian")


def _epoch_record(label: str, iso: str, jd: float, calendar: str) -> dict[str, Any]:
    rec: dict[str, Any] = {"label": label, "iso": iso, "jd": jd, "calendar": calendar}
    try:
        snap = snapshot(jd)
    except RangeError as e:
        rec["status"] = "outside-ephemeris-range"
        # The library's own message varies with its backend mode (file vs LEB), so it is not stored:
        # generated output must be reproducible byte for byte.
        rec["reason"] = "The instant lies outside the loaded DE440 kernel (1549–2650); DE441 (≈3 GB) would be required."
        rec["ayanamsa"] = {k: ayanamsa(jd, k) for k in AYANAMSA_MODES}
        return rec
    rec["status"] = "ok"
    rec.update({k: snap[k] for k in ("sun", "moon", "elongation", "gmst", "subsolar", "sublunar", "earth", "planets")})
    rec["ayanamsa"] = {k: ayanamsa(jd, k) for k in AYANAMSA_MODES}
    return rec


# ── charts (Kerykeion) ──────────────────────────────────────────────────────


def resolve_timezone(lat: float, lon: float) -> str:
    from timezonefinder import TimezoneFinder

    tz = _TF.timezone_at(lat=lat, lng=lon)
    if not tz:
        raise ValueError("no timezone found for these coordinates (open water?); pass tz explicitly")
    return tz


try:
    from timezonefinder import TimezoneFinder

    _TF = TimezoneFinder()
except Exception:  # pragma: no cover - reported by /ping
    _TF = None


def local_to_utc(local: datetime, tz: str) -> tuple[datetime, int, list[str], bool]:
    """Resolve a naive local time in an IANA zone. Returns (utc, offset_minutes, warnings, larger_offset).

    `larger_offset` says which reading was taken when the wall time is not unique (twice, or never): True for the
    larger UTC offset, False for the smaller, in the sense Kerykeion's `is_dst` uses, so the two agree on the instant.
    """
    warnings: list[str] = []
    try:
        zone = ZoneInfo(tz)
    except ZoneInfoNotFoundError as e:
        raise ValueError(f"unknown timezone {tz}") from e
    a = local.replace(tzinfo=zone, fold=0)
    b = local.replace(tzinfo=zone, fold=1)
    if a.utcoffset() != b.utcoffset():
        # DST fold or gap: the wall time is repeated or does not exist
        rt = a.astimezone(timezone.utc).astimezone(zone).replace(tzinfo=None)
        if rt != local:
            warnings.append("This wall-clock time did not exist (clocks skipped forward); the earlier offset is used.")
        else:
            warnings.append("This wall-clock time occurred twice (clocks went back); the first occurrence is used.")
    off = a.utcoffset()
    assert off is not None
    return a.astimezone(timezone.utc), int(off.total_seconds() // 60), warnings, a.utcoffset() >= b.utcoffset()


def _point(p: Any) -> dict[str, Any]:
    lon = float(p.abs_pos)
    return {
        "lon": lon,
        "sign": SIGNS[int(lon // 30) % 12],
        "signIndex": int(lon // 30) % 12,
        "degree": lon % 30.0,
        "retrograde": bool(getattr(p, "retrograde", False)),
        "house": getattr(p, "house", None),
    }


def chart(local_iso: str, lat: float, lon: float, tz: str | None, name: str = "Birth") -> dict[str, Any]:
    from kerykeion import AstrologicalSubjectFactory, ChartDataFactory

    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        raise ValueError("coordinates outside range")
    local = datetime.fromisoformat(local_iso.replace("Z", ""))
    if local.tzinfo is not None:
        raise ValueError("pass local wall-clock time without an offset; the zone is resolved from the place")
    tz_name = tz or resolve_timezone(lat, lon)
    utc, off_min, warnings, larger_offset = local_to_utc(local, tz_name)
    jd = jd_ut(utc)
    kr = kernel_range()
    if not (kr["fromJd"] <= jd <= kr["toJd"]):
        raise RangeError(f"{utc.date()} lies outside the loaded ephemeris kernel ({kr['from'][:10]} to {kr['to'][:10]})")

    approximate = local.year < 1900
    reason = None
    if approximate:
        reason = (
            "Before 1900 civil time zones were not standardised; the offset comes from the tz database "
            "(local mean time where nothing else is recorded) and may differ from the clock actually used."
        )

    subject = AstrologicalSubjectFactory.from_birth_data(
        name=name, year=local.year, month=local.month, day=local.day, hour=local.hour, minute=local.minute,
        lng=lon, lat=lat, tz_str=tz_name, is_dst=larger_offset, online=False, active_points=KERYKEION_POINTS + ["Ascendant", "Medium_Coeli"],
    )
    k_utc = parse_iso_utc(subject.iso_formatted_utc_datetime)
    if abs((k_utc - utc).total_seconds()) > 1.0:
        raise RuntimeError(f"time-zone resolution disagrees with Kerykeion: {k_utc.isoformat()} vs {utc.isoformat()}")

    bodies = {k.lower(): _point(getattr(subject, k.lower())) for k in KERYKEION_POINTS}
    angles = {"ascendant": _point(subject.ascendant), "midheaven": _point(subject.medium_coeli)}
    cusps = [float(getattr(subject, f"{n}_house").abs_pos) for n in
             ("first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth", "eleventh", "twelfth")]

    data = ChartDataFactory.create_natal_chart_data(subject)
    aspects = [
        {"a": str(a.p1_name).lower(), "b": str(a.p2_name).lower(), "type": str(a.aspect), "orb": float(a.orbit)}
        for a in data.aspects
        if str(a.p1_name).lower() in bodies and str(a.p2_name).lower() in bodies
    ]
    lp = subject.lunar_phase
    return {
        "input": {"local": local_iso, "lat": lat, "lon": lon, "tz": tz_name, "utcOffsetMinutes": off_min},
        "utc": utc.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "jd": jd,
        "approximate": approximate,
        "approximateReason": reason,
        "warnings": warnings + list(getattr(subject, "ephemeris_warnings", None) or []),
        "zodiac": "tropical",
        "bodies": bodies,
        "angles": angles,
        "houses": {
            "requested": "Placidus",
            "effective": str(subject.effective_houses_system_name),
            "cusps": cusps,
        },
        "aspects": aspects,
        "moon": {"name": lp.moon_phase_name, "major": lp.major_phase, "stage": lp.stage} if lp else None,
        "gmst": gmst_deg(jd),
    }


# ── geocoding ───────────────────────────────────────────────────────────────


def geocode(q: str, limit: int = 5) -> list[dict[str, Any]]:
    """Free-text place lookup through OpenStreetMap Nominatim (one request per call, identified)."""
    import httpx

    r = httpx.get(
        "https://nominatim.openstreetmap.org/search",
        params={"q": q, "format": "jsonv2", "limit": limit, "addressdetails": 0},
        headers={"User-Agent": "ArchetypalEarth-ephemeris-sidecar/1.0 (local research atlas)"},
        timeout=6.0,
    )
    r.raise_for_status()
    return [
        {"name": it["display_name"], "lat": float(it["lat"]), "lon": float(it["lon"]), "source": "OpenStreetMap Nominatim"}
        for it in r.json()
    ]


def versions() -> dict[str, str]:
    from importlib.metadata import version

    out: dict[str, str] = {}
    for pkg in ("kerykeion", "libephemeris", "fastapi", "uvicorn", "skyfield", "timezonefinder", "pyerfa", "jplephem"):
        try:
            out[pkg] = version(pkg)
        except Exception:  # noqa: BLE001
            out[pkg] = "unavailable"
    return out
