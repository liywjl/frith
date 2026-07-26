// The demo, phone edition: the same three spaces scripts/demo-spaces.mjs
// seeds on desktop — Acme (work), Blade Crew (rollerblading friends),
// Static Bloom (a band). The corpora are bundled JSON (there is no seed dir
// inside an app sandbox), and the run ends back on Acme.
import { space } from '../../server/src/space/space.js';
import { seedCorpusData, type Corpus } from '../../server/src/domain/seed.js';
import acme from '../../server/seed/corpus.json';
import skate from '../../server/seed/corpus-skate.json';
import band from '../../server/seed/corpus-band.json';

const DEMO_SPACES: { name: string; corpus: unknown }[] = [
  { name: 'Acme', corpus: acme },
  { name: 'Blade Crew 🛼', corpus: skate },
  { name: 'Static Bloom 🎸', corpus: band },
];

export async function seedDemoSpaces(): Promise<void> {
  let home: string | null = null;
  for (const { name, corpus } of DEMO_SPACES) {
    await space.createSpace(name);
    home ??= space.listSpaces().active;
    await seedCorpusData(corpus as Corpus);
  }
  await space.switchSpace(home!);
}
