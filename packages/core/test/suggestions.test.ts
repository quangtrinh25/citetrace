import { describe, expect, test } from 'vitest';
import { analyzePython } from '../src/python.js';
import { createAnchor } from '../src/anchors.js';
import { addLink, addPaper, emptyLedger } from '../src/ledger.js';
import { detectConcepts } from '../src/detector.js';
import { acceptSuggestion, auditSuggestions, recordDecision, reopenDecision } from '../src/suggestions.js';

const source = 'import torch.nn as nn\nclass Model:\n    def build(self):\n        return nn.LayerNorm(4)\n';
const analyze = (text = source, artifact = 'model.py') => analyzePython({ artifact, kind: 'file', source: text });
async function setup() {
  const analysis = await analyze();
  const suggestion = (await detectConcepts(analysis))[0]!;
  return { analysis, suggestion, ledger: emptyLedger() };
}

describe('suggestion decisions and scoped provenance', () => {
  test('a project paper alone does not resolve its uses', async () => {
    const { ledger, analysis } = await setup();
    addPaper(ledger, { title: 'Layer Normalization', authors: [], arxiv: '1607.06450', metadataSource: 'manual' });
    expect((await auditSuggestions(ledger, [analysis])).map(s => s.status)).toEqual(['unresolved']);
  });

  test('accepting a registry candidate creates human attestation and reuses its existing paper', async () => {
    const { ledger, analysis, suggestion } = await setup();
    const paper = addPaper(ledger, { title: 'Layer Normalization', authors: ['Jimmy Lei Ba'], arxiv: '1607.06450', metadataSource: 'manual' });
    const link = acceptSuggestion(ledger, suggestion, { relation: 'uses-method' });
    expect(link).toMatchObject({ paperId: paper.id, actor: 'human', conceptId: 'layernorm', relation: 'uses-method' });
    expect(ledger.papers).toHaveLength(1);
    expect((await auditSuggestions(ledger, [analysis]))[0]).toMatchObject({ status: 'confirmed', coveredBy: [link.id] });
  });

  test('a matching class concept covers descendants but other concepts do not', async () => {
    const { ledger, analysis } = await setup();
    const paper = addPaper(ledger, { title: 'Paper', authors: [], metadataSource: 'manual' });
    const link = addLink(ledger, { paperId: paper.id, anchor: createAnchor(analysis, analysis.symbols[0]), relation: 'uses-method', actor: 'human', conceptId: 'rmsnorm' });
    expect((await auditSuggestions(ledger, [analysis]))[0]?.status).toBe('unresolved');
    link.conceptId = 'layernorm';
    expect((await auditSuggestions(ledger, [analysis]))[0]?.status).toBe('confirmed');
    const changed = await analyze(source.replace('(4)', '(8)'));
    expect((await auditSuggestions(ledger, [changed]))[0]?.status).toBe('unresolved');
  });

  test('ignore survives comments and unique moves but reopens on meaningful changes', async () => {
    const { ledger, analysis, suggestion } = await setup();
    recordDecision(ledger, suggestion, 'ignore');
    expect((await auditSuggestions(ledger, [analysis]))[0]?.status).toBe('ignored');
    const moved = await analyze('# moved\n' + source, 'src/renamed.py');
    expect((await auditSuggestions(ledger, [moved]))[0]?.status).toBe('ignored');
    const changed = await analyze(source.replace('(4)', '(8)'));
    expect((await auditSuggestions(ledger, [changed]))[0]?.status).toBe('unresolved');
  });

  test('exemption requires a reason and can be reopened explicitly', async () => {
    const { ledger, analysis, suggestion } = await setup();
    expect(() => recordDecision(ledger, suggestion, 'exempt')).toThrow(/reason/i);
    const decision = recordDecision(ledger, suggestion, 'exempt', { reason: 'Teaching example' });
    expect((await auditSuggestions(ledger, [analysis]))[0]?.status).toBe('exempt');
    reopenDecision(ledger, decision.id);
    expect((await auditSuggestions(ledger, [analysis]))[0]?.status).toBe('unresolved');
  });

  test('reject-paper removes only that candidate, leaving the concept unresolved', async () => {
    const { ledger, analysis, suggestion } = await setup();
    recordDecision(ledger, suggestion, 'reject-paper', { paperId: 'arxiv:1607.06450' });
    const result = (await auditSuggestions(ledger, [analysis]))[0]!;
    expect(result).toMatchObject({ status: 'unresolved', candidateIds: [] });
    expect(() => acceptSuggestion(ledger, result, { relation: 'uses-method' })).toThrow(/candidate|paper/i);
    const paper = addPaper(ledger, { title: 'Alternative', authors: [], metadataSource: 'manual' });
    expect(acceptSuggestion(ledger, result, { relation: 'adapted-from', paperId: paper.id }).paperId).toBe(paper.id);
  });

  test('cell-level coverage does not hide a different cell or concept', async () => {
    const ledger = emptyLedger();
    const cells = await Promise.all(['a', 'b'].map((id, index) => analyzePython({ artifact: 'n.ipynb', kind: 'cell', cell: { id, index }, source: 'class LayerNorm:\n    pass\n' })));
    const paper = addPaper(ledger, { title: 'Paper', authors: [], metadataSource: 'manual' });
    addLink(ledger, { paperId: paper.id, anchor: createAnchor(cells[0]!), relation: 'implements', actor: 'human', conceptId: 'layernorm' });
    expect((await auditSuggestions(ledger, cells)).map(s => s.status)).toEqual(['confirmed', 'unresolved']);
  });
});
