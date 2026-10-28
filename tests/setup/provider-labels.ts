// Every suite runs over Archetypal Earth's own provider words, as the app does once its field has loaded (main.ts binds
// field.json's meta.provider.labels; the ingest publishes them from curation/provider.json, and
// tests/data/provider-labels.test.ts holds the two equal). A test that wants the neutral voice unbinds and restores.
import fs from 'node:fs';
import path from 'node:path';
import { setProviderLabels } from '../../src/data/labels';

const provider = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', 'curation', 'provider.json'), 'utf8'));
setProviderLabels(provider.labels);
