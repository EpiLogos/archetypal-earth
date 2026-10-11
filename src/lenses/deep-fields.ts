// The archetypes that have a deep field (src/lenses/depth.ts). Kept apart so the globe can link to one without loading
// the view.
export const DEEP_FIELDS: ReadonlySet<string> = new Set(['great-mother', 'self']);

/** The number archetypes one to ten (curation/archetypes.json admits them, synthesised): a focus on one opens its page, as a
 * focus on a theoretic opens its own — a node whose page is what the owner asked for is not left as a name and floats.
 * Seven to ten have no numbers.json page yet; their focus opens the archetype with nothing above its field page. */
export const NUMBER_ARCHETYPES: ReadonlySet<string> = new Set(['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']);
