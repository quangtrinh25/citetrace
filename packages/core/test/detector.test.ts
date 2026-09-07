import { describe, expect, test } from 'vitest';
import { analyzePython } from '../src/python.js';
import { detectConcepts } from '../src/detector.js';

// Explicit labels, independent from the production registry. Controlled fixtures,
// not an estimate of precision on independently sampled research repositories.
const cases = [
  ['rmsnorm', 'RMSNorm', 'rms_norm', 'torch.nn', 'RMSNorm'],
  ['layernorm', 'LayerNorm', 'layer_norm', 'torch.nn', 'LayerNorm'],
  ['batchnorm', 'BatchNorm', 'batch_norm', 'torch.nn', 'BatchNorm2d'],
  ['groupnorm', 'GroupNorm', 'group_norm', 'torch.nn', 'GroupNorm'],
  ['focal-loss', 'FocalLoss', 'focal_loss', 'torchvision.ops', 'sigmoid_focal_loss'],
  ['adam', 'Adam', 'adam_optimizer', 'torch.optim', 'Adam'],
  ['adamw', 'AdamW', 'adamw', 'torch.optim', 'AdamW'],
  ['gelu', 'GELU', 'gelu', 'torch.nn.functional', 'gelu'],
  ['rope', 'RotaryEmbedding', 'apply_rotary_pos_emb', 'rotary_embedding_torch', 'RotaryEmbedding'],
  ['lora', 'LoRALayer', 'lora', 'peft', 'LoraConfig'],
] as const;
async function detect(source: string) {
  return detectConcepts(await analyzePython({ artifact: 'model.py', kind: 'file', source }));
}

describe.each(cases)('%s controlled detector cases', (concept, className, functionName, module, callee) => {
  const positives = [
    `class ${className}:\n    pass\n`,
    `def ${functionName}(x):\n    return x\n`,
    `import ${module}\nx = ${module}.${callee}(4)\n`,
    `import ${module} as lib\nx = lib.${callee}(4)\n`,
    `from ${module} import ${callee}\nx = ${callee}(4)\n`,
    `from ${module} import ${callee} as operation\nx = operation(4)\n`,
    `from ${module} import ${callee} as operation\ndef build():\n    return operation(4)\n`,
    `def build():\n    from ${module} import ${callee} as operation\n    return operation(4)\n`,
    `from ${module} import ${callee} as operation\nclass Model:\n    def forward(self):\n        return operation(4)\n`,
    `from ${module} import (${callee} as operation,)\n# Note\nx = operation(4)\n`,
  ];
  const negatives = [
    `# class ${className}: pass\n`,
    `text = 'def ${functionName}(x): pass'\n`,
    `from ${module} import ${callee}\n`,
    `value = unknown.${callee}(4)\n`,
    `from unrelated import ${callee}\nvalue = ${callee}(4)\n`,
    `def test_${functionName}():\n    pass\n`,
    `from ${module} import ${callee} as operation\ndef build(operation):\n    return operation(4)\n`,
    `from ${module} import ${callee} as operation\noperation = custom\nvalue = operation(4)\n`,
    `from ${module} import ${callee} as operation\ndef build():\n    value = operation(4)\n    operation = custom\n    return value\n`,
    `from ${module} import *\nvalue = ${callee}(4)\n`,
    `from .${module} import ${callee}\nvalue = ${callee}(4)\n`,
    `if available:\n    from ${module} import ${callee} as operation\nvalue = operation(4)\n`,
  ];
  test.each(positives)('recognizes supported explicit evidence %#', async source => {
    const result = await detect(source);
    expect(result.map(s => s.conceptId)).toEqual([concept]);
    expect(result[0]?.evidence.length).toBeGreaterThan(0);
    expect(result[0]?.candidateIds[0]).toMatch(/^arxiv:/);
  });
  test.each(negatives)('does not infer evidence from hard negative %#', async source => {
    expect(await detect(source)).toEqual([]);
  });
});

test('groups repeated calls by concept and nearest symbol, with every evidence range', async () => {
  const result = await detect('import torch.nn as nn\ndef build():\n    a = nn.LayerNorm(4)\n    return nn.LayerNorm(8)\n');
  expect(result).toHaveLength(1);
  expect(result[0]?.anchor.symbol?.qualifiedName).toBe('build');
  expect(result[0]?.evidence.map(e => e.range.start.line)).toEqual([2, 3]);
});

test('does not reuse a class attribute binding as a method lexical import', async () => {
  expect(await detect('class Model:\n    from torch.nn import LayerNorm as operation\n    def build(self):\n        return operation(4)\n')).toEqual([]);
});

test.each([
  'from torch.nn import LayerNorm as op\nfor op in values:\n    x = op(4)\n',
  'from torch.nn import LayerNorm as op\nx = [op(4) for op in values]\n',
  'from torch.nn import LayerNorm as op\nx = (lambda op: op(4))(custom)\n',
  'import torch.nn as nn\nnn.LayerNorm = custom\nx = nn.LayerNorm(4)\n',
  'from torch.nn import LayerNorm as op\ndef build():\n    global op\n    return op(4)\n',
])('rejects uncertain lexical or mutated binding %#', async source => {
  expect(await detect(source)).toEqual([]);
});

test('unsupported notebook magic has no automatic suggestions', async () => {
  const analysis = await analyzePython({ artifact: 'run.ipynb', kind: 'cell', cell: { index: 0, id: 'a' }, source: '%time x\nclass RMSNorm: pass\n' });
  expect(await detectConcepts(analysis)).toEqual([]);
});

test.each([
  'from torch.nn import LayerNorm as op\nitems = [(op := custom) for item in values]\nvalue = op(4)\n',
  'import torch.nn as nn\nsetattr(nn, "LayerNorm", custom)\nvalue = nn.LayerNorm(4)\n',
  'from torch.nn import LayerNorm as op\ntype op = int\nvalue = op(4)\n',
  'from torch.nn import LayerNorm as op\ndef build[op]():\n    return op(4)\n',
  'class Family:\n    def adam(self):\n        return self.children[0]\n',
])('rejects reviewed binding/name collision %#', async source => {
  expect(await detect(source)).toEqual([]);
});

test('detects imported constructor in function defaults using the enclosing scope', async () => {
  const result = await detect('from peft import LoraConfig\ndef train(config=LoraConfig()):\n    return config\n');
  expect(result.map(s => s.conceptId)).toEqual(['lora']);
  expect(result[0]?.anchor.symbol?.qualifiedName).toBe('train');
});

test.each([
  'from peft import LoraConfig as train\ndef train(config=train()):\n    return config\n',
  'from peft import LoraConfig as train\n@train()\ndef train():\n    pass\n',
])('resolves imports in definition-time expressions before the declaration name is rebound %#', async source => {
  const result = await detect(source);
  expect(result.map(item => item.conceptId)).toEqual(['lora']);
  expect(result[0]?.anchor.symbol?.qualifiedName).toBe('train');
});

test('does not treat a PEP 695 bound type reference as a type-parameter binder', async () => {
  const result = await detect('from peft import LoraConfig\ndef train[T: LoraConfig](config=LoraConfig()):\n    return config\n');
  expect(result.map(item => item.conceptId)).toEqual(['lora']);
});

test('keeps imported bound references visible inside a PEP 695 generic body', async () => {
  const result = await detect('from peft import LoraConfig\ndef train[T: LoraConfig]():\n    return LoraConfig()\n');
  expect(result.map(item => item.conceptId)).toEqual(['lora']);
});

test('a generic type alias does not bind its bound references in module scope', async () => {
  const result = await detect('from peft import LoraConfig\ntype Alias[T: LoraConfig] = T\nvalue = LoraConfig()\n');
  expect(result.map(item => item.conceptId)).toEqual(['lora']);
});

test('keeps conservative assignment shadowing around definition-time expressions', async () => {
  expect(await detect('from peft import LoraConfig as train\ndef train(config=train()):\n    return config\ntrain = custom\n')).toEqual([]);
});

test('resolves an imported alias in a class body before the class name is rebound', async () => {
  const result = await detect('from peft import LoraConfig as Train\nclass Train:\n    config = Train()\n');
  expect(result.map(item => item.conceptId)).toEqual(['lora']);
  expect(result[0]?.anchor.symbol?.qualifiedName).toBe('Train');
});

test('keeps class bases in the definition-time environment', async () => {
  const result = await detect('from peft import LoraConfig as Train\nclass Train(Train()):\n    pass\n');
  expect(result.map(item => item.conceptId)).toEqual(['lora']);
});

test.each([
  'from peft import LoraConfig as train\ndef train():\n    return train()\n',
  'from peft import LoraConfig as Train\nclass Train:\n    Train = custom\n    config = Train()\n',
  'from peft import LoraConfig as Train\nclass Train:\n    def build(self):\n        return Train()\n',
])('uses post-rebinding or explicit class bindings outside definition-time class execution %#', async source => {
  expect(await detect(source)).toEqual([]);
});
