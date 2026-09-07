import { writeFile } from 'node:fs/promises';
import { lookupPaperMetadata } from '../../src/metadata.js';

const [, , root, identifier, marker] = process.argv;
if (!root || !identifier || !marker) throw new Error('Expected root, identifier and marker arguments.');

await lookupPaperMetadata(root, { kind: 'arxiv', identifier }, {
  retries: 0,
  fetch: async () => {
    await writeFile(marker, String(Date.now()));
    return new Response(`<feed><entry><id>http://arxiv.org/abs/${identifier}</id><title>Fixture ${identifier}</title><author><name>Test Author</name></author></entry></feed>`, { status: 200 });
  },
});
