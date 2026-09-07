import { analyzePython, createAnchor, resolveAnchor } from '../packages/core/dist/index.js';

const original = await analyzePython({
  artifact: 'old.py', kind: 'file', source: 'def normalize(x):\n    return x / 2\n',
});
const saved = JSON.parse(JSON.stringify(createAnchor(original, original.symbols[0])));
const moved = await analyzePython({
  artifact: 'models/new.py', kind: 'file', source: 'def rescale(x):\n    return x / 2\n',
});
console.log(JSON.stringify(resolveAnchor(saved, [moved]), null, 2));

