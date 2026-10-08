# Precession source and calculation notes

The sky's clock is the astronomical ground under Aion's precessional argument. It states where the spring equinox lies among the stars at a year, under stated conventions, beside Jung's own boundaries. It does not predict, endorse astrology, or turn a calculation into an event. This follows `docs/AION-SOURCES.md`; the sky layer's own notes are in `docs/SKY-SOURCES.md` (decisions 61 onward).

## Generate and verify

Nothing is generated: `src/aion/precession.ts` is pure and ships its constants. What is pinned is its agreement with the sidecar's golden data in `public/data/sky.json` (`golden.ayanamsa`, `golden.constellationBoundaries`).

```sh
npx vitest run tests/aion                      # precession.test.ts, skyclock.test.ts
node tests/ui/e2e/aion-clock.mjs chromium      # the ring and the card disclosure, in the page (also: webkit)
npm run sky:check                              # the golden data the tests read is the sidecar's
```

The site never calls the sidecar for this: Aion mode needs only `history.json`. The sidecar is the *source of the golden values the module is tested against*, not a runtime dependency of the clock.

## Source basis

| What | Source | Where it lives |
| --- | --- | --- |
| Long-term precession (primary) | Vondrák, J., Capitaine, N. & Wallace, P. (2011), "New precession expressions, valid for long time intervals", *A&A* 534, A22, Tables 1 (ecliptic pole P_A, Q_A) and 2 (equator pole X_A, Y_A), with the corrigendum *A&A* 541, C1 (2012): Q_A cos term 198.296701 | `PQ_*` and `XY_*` constants in `precession.ts`; coefficients transcribed from the published tables, then checked against the golden table below |
| Obliquity at J2000.0 | IAU 2006, 84381.406″ | `EPS0` |
| Cross-check | Capitaine, N., Wallace, P. T. & Chapront, J. (2003), *A&A* 412, 567, general precession in longitude p_A (adopted IAU 2006): 5028.796195 T + 1.1054348 T² + 0.00007964 T³ − 0.000023857 T⁴ − 0.0000000383 T⁵ arcsec, T in Julian centuries from J2000.0 | `generalPrecessionIau2006` |
| Sidereal zero points | Fagan–Bradley: 24.042044444444457° at JD(TT) 2433282.42345905 (1950.0); Lahiri (Chitrapaksha): 23.85709166666667° at JD(TT) 2451545.0 (J2000.0). Conventions of their authors, not measurements. | `AYANAMSA`; equal to the sidecar's `golden.ayanamsa.definitions` (tested) |
| Constellation boundaries | IAU, Delporte (1930), read by the sidecar through Skyfield's constellation map and bisected along the J2000.0 ecliptic: 13 crossings, from Psc→Ari at 28.6889° to Aqr→Psc at 351.6526° | `IAU_BOUNDARIES`; equal to `golden.constellationBoundaries` (tested) |
| Jung's months and the conditional Aquarian dating | Aion ¶149, n.84 (cw09ii, pdf p106): 2,143-year months; 1997 or 2154 from the reference star chosen; a range of 2000–2200, "very indefinite" | `JUNG_MONTH_YEARS`, `JUNG_AQUARIAN`; the 1997 and 2154 figures are read from the reading's own events |

The golden ayanamsa values come from the sidecar (libephemeris 3.2.2 over ERFA's `ltpecl`/`ltpequ`, which implement the same paper). The module re-derives them from the published tables independently, in TypeScript, so agreement with the sidecar is a check on the transcription, not a restatement.

## The calculation

The ecliptic pole and the equator pole of any epoch are each a polynomial plus periodic terms in T (Julian centuries from J2000.0). The equinox of date is their node (the cross product of the two pole vectors). The **accumulated precession** from an epoch t0 to a date is minus the longitude of the date's equinox measured on the *fixed mean ecliptic of t0* (the sidecar's "Method B"). It is not additive in t0 because the ecliptic itself tilts, and it is returned unwrapped, so a crossing can be found by bisection.

- **Ayanamsa** = the convention's defining value + the accumulated precession from its epoch.
- **Equinox in a sidereal convention** sits at sidereal longitude −ayanamsa; the sign is the 30° sector it falls in. Pisces is where the ayanamsa is between 0° and 30°.
- **Equinox among the IAU constellations** sits at −(accumulated precession from J2000.0), on the J2000.0 ecliptic, and is read against the 13 boundaries.
- **Jung's equal months** are arithmetic: month k = ⌊year / 2143⌋; Pisces is month 0 (0 to 2143), Aries −1, Aquarius +1. No measurement of the sky enters.

Crossing years come from a 10-year scan of ±13,000 years and a 40-step bisection.

## Verification

**Against the sidecar's golden table** (56 rows: −13000 to +13000 in 500-year steps, plus −6, 0, 1900, 2000, 2026): the worst disagreement over both conventions is **0.00024″** (at +11500), against a plan tolerance of arcminutes (1′ = 60″). The table's Julian Dates are reproduced exactly (the calendar is proleptic Gregorian, 1 January 12:00, astronomical year numbering).

**IAU 2006 cross-check**, polynomial p_A against the long-term model's accumulated precession from J2000.0 (arcseconds, polynomial minus long-term):

| year | −13000 | −10000 | −6000 | −3000 | −2000 | 0 | 1800 | 2026 | 3000 | 4000 | 6000 | 10000 | 13000 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| difference ″ | +619 | +377 | +85 | +4.8 | −0.4 | −0.6 | 0.0 | 0.0 | +0.02 | −0.03 | −7.3 | −224 | −1006 |

The polynomial and the long-term model agree within 2″ from 2000 BCE to 4000 CE, and part company beyond, by about 10′ at −13000 and 17′ at +13000, which is the reason the polynomial is not used for anything shown. (The fixed-ecliptic accumulation and the polynomial's ecliptic-of-date definition differ by a few hundredths of an arcsecond per century; that is inside these figures.) The card prints the cross-check for the year it speaks of, in words.

**Time scales.** Years are turned into Julian Dates and treated as TT. UT and TT differ by about 8 days at −13000 (≈ 1″ of precession) and under a minute near the present, far inside every tolerance here. Year numbering is the identity bridge between the atlas's display years (BCE negative, its own year 0 = the beginning of the Christian era) and astronomical years (1 BCE = 0): at most one year, 0.014°.

## What the conventions say

Boundaries of the equinox's stay, first calculated year to last (c. = approximate; the three sidereal readings are chosen conventions, the IAU boundaries are the constellations' as drawn):

| Sign | Jung's display (reading) | Jung's equal months | Fagan–Bradley | Lahiri | IAU constellations |
| --- | --- | --- | --- | --- | --- |
| Taurus | −4286 – −2143 | −4286 – −2143 | c. −4143 – −1952 | c. −4078 – −1888 | c. −4538 – −1856 |
| Aries | −2143 – 0 | −2143 – 0 | c. −1952 – 222 | c. −1888 – 286 | c. −1856 – −63 |
| Pisces | 0 – 2200 | 0 – 2143 | c. 222 – 2376 | c. 286 – 2439 | c. −63 – 2597 |
| Aquarius | 2200 – 4343 | 2143 – 4286 | c. 2376 – 4510 | c. 2439 – 4573 | c. 2597 – 4316 |

They disagree by centuries about the same sign, and by about 350 years about when the equinox entered Pisces. That disagreement is the finding, and it is shown, not resolved. Jung's own Aquarian dating (1997 or 2154 from the reference star, a range of 2000–2200) is shown in the card as *his conditional calculations*, with each convention's own beginning of Aquarius beside it; none of them is called an event.

An illustration the card makes available: the 7 BCE Jupiter–Saturn conjunction of Aion's account falls in Aries by the three equal-sign readings and in Pisces by the IAU boundaries (the equinox having crossed from Aries to Pisces about 63 BCE on the IAU's drawing); the atlas's chronological epoch for it stays Aries, as AION-SOURCES says.

## The two clocks

The historical clock (display years, −4300 to +4343 in Aion) and the sky's clock (the equinox's place) are different instruments. Aion mode is the only place they meet, and the bridge is explicit and labelled: the ring and the disclosure read the year the cursor stands on as a calendar year; choosing a convention, opening the disclosure and playing the equinox never move the historical clock (tested in the page). The sky layer's own moment (live UTC, the birth sky) is a third thing and is untouched by Aion.

## Limitations, plainly

- The model is mean precession of the equinox and ecliptic; nutation (±17″ in longitude, about a third of a year of precession) is not applied, which is far below the resolution shown (years).
- The IAU boundaries are fixed on the J2000.0 ecliptic. The stars move; the constellations' drawn boundaries do not, and a boundary from 1930 is read against a frame of 2000.
- Sidereal zero points are conventions, and so are the equal 30° signs: the constellations are not that wide, and Ophiuchus is not a "sign" in the sidereal readings.
- Years beyond about ±5,000 depend on the long-term model's fit to a numerical integration; the paper states its validity for ±200,000 years, and the table is checked here only to ±13,000.
- Crossing years are shown to the year and marked approximate; they are not meant to resolve a year.
- Nothing here predicts. A boundary after the present is a calculation under a convention, and is labelled as one.
