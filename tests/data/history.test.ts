import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
// @ts-expect-error Plain ESM data generator, shared with the CLI.
import { generateHistory, loadCuration, validateHistory, verifySourcePassages } from '../../scripts/aion.mjs';
import type { History } from '../../src/types/history';
import type { Field } from '../../src/types/field';

const ROOT = path.resolve(__dirname, '..', '..');
const history: History = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/history.json'), 'utf8'));
const field: Field = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/field.json'), 'utf8'));
const curated = loadCuration(ROOT);
const copy = <T,>(value: T): T => structuredClone(value);

describe('Aion curation and generated history', () => {
  it('satisfies the actual history contract and all existing field links', () => {
    expect(validateHistory(history, { field })).toEqual([]);
    expect(history.readings.map((r) => r.id)).toContain('jung-aion');
    const jung = history.readings.find((r) => r.id === 'jung-aion')!;
    expect(jung.epochs.length).toBeGreaterThanOrEqual(6);
    expect(jung.events.length).toBeGreaterThanOrEqual(15);
    expect(jung.threads.length).toBeGreaterThanOrEqual(3);
    expect(jung.epochs.filter((e) => e.parentId === 'pisces').map((e) => e.id)).toEqual(['pisces-first-fish', 'pisces-second-fish']);
  });

  it('matches reviewable curation without regenerating or changing timestamps', () => {
    expect(generateHistory({ root: ROOT, check: true })).toMatchObject({ readings: history.readings.length });
    expect(history.readings).toEqual(curated.flatMap((source: { readings: History['readings'] }) => source.readings));
  });

  it('every quote resolves verbatim to the actual cited corpus pages and source revision', () => {
    // No mocks or skip: missing corpus is a failed source acceptance check.
    for (const source of curated) expect(verifySourcePassages(source, { vault: process.env.JUNG_VAULT })).toEqual([]);
  });

  it('rejects a fabricated quote even when its work and locator are real', () => {
    const source = copy(curated[0]);
    source.readings[0].events[0].passages[0].text += ' Jung said the atlas predicts the future.';
    expect(verifySourcePassages(source)).toEqual(expect.arrayContaining([expect.stringContaining('quotation not verbatim')]));
  });

  it('rejects an invented paragraph locator and a quote moved to a different source page', () => {
    const source = copy(curated[0]);
    source.readings[0].events[0].passages[0].locator = '¶999 (pdf p103)';
    expect(verifySourcePassages(source)).toEqual(expect.arrayContaining([expect.stringContaining('unregistered source locator')]));
    const misplaced = copy(curated[0]);
    const passage = misplaced.readings[0].events[0].passages[0];
    misplaced.sourceBindings[`${passage.work}:${passage.locator}`].pages = [104];
    expect(verifySourcePassages(misplaced)).toEqual(expect.arrayContaining([expect.stringContaining('quotation not verbatim')]));
  });

  it('rejects broken field links and incomplete geographic placement', () => {
    const altered = copy(history);
    altered.readings[0].events[0].occurrenceIds.push('not-in-the-existing-field');
    delete altered.readings[0].events[0].lon;
    expect(validateHistory(altered, { field })).toEqual(expect.arrayContaining([
      expect.stringContaining('unresolved occurrenceIds'), expect.stringContaining('coordinate pair incomplete'),
    ]));
  });

  it('rejects an event outside its epoch and a child outside its parent', () => {
    const altered = copy(history);
    altered.readings[0].events[0].year = 3000;
    altered.readings[0].epochs.find((e) => e.id === 'pisces-first-fish')!.to = 2300;
    expect(validateHistory(altered, { field })).toEqual(expect.arrayContaining([
      expect.stringContaining('event outside epoch span'), expect.stringContaining('child outside parent span'),
    ]));
  });

  it('rejects a reversed thread rather than accepting merely resolvable IDs', () => {
    const altered = copy(history);
    altered.readings[0].threads[0].eventIds.reverse();
    expect(validateHistory(altered, { field })).toEqual(expect.arrayContaining([expect.stringContaining('chronological order')]));
  });

  it('keeps future author readings separate and rejects extension cycles', () => {
    const altered = copy(history);
    const extension = copy(altered.readings[0]);
    extension.id = 'owner-reading';
    extension.author = 'Owner';
    extension.extends = 'jung-aion';
    altered.readings.push(extension);
    expect(validateHistory(altered, { field })).toEqual([]);
    expect(altered.readings[0]).toEqual(history.readings[0]);
    altered.readings[0].extends = 'owner-reading';
    expect(validateHistory(altered, { field })).toEqual(expect.arrayContaining([expect.stringContaining('extension cycle')]));
  });

  it('preserves conditional dates, approximate period markers, and the letter Jung actually cites', () => {
    const events = history.readings[0].events;
    expect(events.find((e) => e.id === 'nostradamus-letter')?.year).toBe(1558);
    for (const id of ['aquarius-alternative-1997', 'aquarius-alternative-2154']) {
      expect(events.find((e) => e.id === id)?.yearDisplay).toContain('conditional');
    }
    expect(history.readings[0].epochs.find((e) => e.id === 'taurus')?.body.join(' ')).toContain('not dates Jung gives');
  });
});
