const vscode = require('vscode');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

async function eventually(check, message) {
  const deadline = Date.now() + 10_000;
  while (!check() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
  assert.ok(check(), message);
}

exports.run = async function run() {
  const extension = vscode.extensions.getExtension('citetrace.citetrace');
  assert.ok(extension, 'CiteTrace development extension must be discoverable');
  const api = await extension.activate();
  const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
  const commands = await vscode.commands.getCommands(true);
  assert.ok(commands.includes('citetrace.link'));
  assert.ok(commands.includes('citetrace.export'));
  const service = api.service(root);
  await service.initialize();
  const id = await service.add({ title: 'Host smoke paper', authors: ['A Researcher'], metadataSource: 'manual' });
  const audit = await api.audit(root);
  const unit = audit.analyses.find(a => a.unit.artifact === 'model.py');
  const symbol = unit.symbols[0];
  const anchor = { schemaVersion: 1, artifact: unit.unit.artifact, unitKind: unit.unit.kind, unitFingerprint: unit.fingerprint, symbol: { kind: symbol.kind, qualifiedName: symbol.qualifiedName, fingerprint: symbol.fingerprint } };
  await service.link(id, anchor, 'implements');
  const reopened = await api.audit(root);
  assert.equal(reopened.links.length, 1);
  const notebookPath = path.join(root, 'research.ipynb');
  const notebookBytes = await fs.readFile(notebookPath, 'utf8');
  const notebook = await vscode.workspace.openNotebookDocument(vscode.Uri.file(path.join(root, 'research.ipynb')));
  assert.ok(notebook.cellCount > 0);
  await vscode.window.showNotebookDocument(notebook);
  const notebookAudit = await api.audit(root);
  const cell = notebookAudit.analyses.find(a => a.unit.artifact === 'research.ipynb' && a.unit.kind === 'cell');
  assert.ok(cell, 'Saved Python notebook must produce a cell analysis');
  const cellAnchor = { schemaVersion: 1, artifact: cell.unit.artifact, unitKind: cell.unit.kind, unitFingerprint: cell.fingerprint, ...(cell.unit.cell.id ? { cellId: cell.unit.cell.id } : {}) };
  await service.link(id, cellAnchor, 'uses-method', { note: 'Notebook reproduction', referenceUrl: 'https://github.com/example/research/blob/main/research.ipynb' });
  assert.equal(await fs.readFile(notebookPath, 'utf8'), notebookBytes, 'Linking must not rewrite notebook bytes');
  const withNotebookLink = await api.audit(root);
  assert.equal(withNotebookLink.links.length, 2);
  assert.ok(withNotebookLink.ledger.links.some(link => link.anchor.unitKind === 'cell' && link.note === 'Notebook reproduction' && link.referenceUrl));

  const unknownPath = path.join(root, 'unknown-language.ipynb');
  const unknownBytes = JSON.stringify({ nbformat: 4, nbformat_minor: 5, metadata: {}, cells: [{ cell_type: 'code', id: 'unknown', metadata: {}, source: ['class RMSNorm:\n', '    pass\n'], outputs: [], execution_count: null }] });
  await fs.writeFile(unknownPath, unknownBytes);
  const unknown = await vscode.workspace.openNotebookDocument(vscode.Uri.file(unknownPath));
  const unknownEditor = await vscode.window.showNotebookDocument(unknown);
  const unknownCell = unknown.cellAt(0).document;
  const dirtyEdit = new vscode.WorkspaceEdit();
  dirtyEdit.insert(unknownCell.uri, new vscode.Position(0, 0), '# unsaved\n');
  assert.equal(await vscode.workspace.applyEdit(dirtyEdit), true);
  assert.equal(unknown.isDirty, true);
  const unauthorized = await api.audit(root);
  assert.ok(!unauthorized.suggestions.some(suggestion => suggestion.anchor.artifact === 'unknown-language.ipynb'), 'Synthesized native Python metadata must not authorize analysis');
  await vscode.commands.executeCommand('citetrace.pythonNotebook');
  const authorized = await api.audit(root);
  assert.ok(authorized.suggestions.some(suggestion => suggestion.conceptId === 'rmsnorm' && suggestion.anchor.artifact === 'unknown-language.ipynb'));
  assert.equal(await fs.readFile(unknownPath, 'utf8'), unknownBytes, 'Session language authorization must not rewrite notebook bytes');

  const unresolvedPath = path.join(root, 'unresolved.py');
  await fs.writeFile(unresolvedPath, 'class GELU:\n    pass\n');
  await vscode.commands.executeCommand('citetrace.refresh');
  const unresolvedUri = vscode.Uri.file(unresolvedPath);
  await eventually(() => vscode.languages.getDiagnostics(unresolvedUri).length > 0, 'Successful audit must publish suggestion diagnostics');
  const modelUri = vscode.Uri.file(path.join(root, 'model.py'));
  const hoverPosition = new vscode.Position(symbol.range.start.line, symbol.range.start.character);
  const hoversBefore = await vscode.commands.executeCommand('vscode.executeHoverProvider', modelUri, hoverPosition);
  assert.ok(hoversBefore.length > 0, 'Successful audit must publish confirmed-link hover');
  const ledgerPath = path.join(root, '.citetrace', 'ledger.json');
  const ledgerBytes = await fs.readFile(ledgerPath, 'utf8');
  await fs.writeFile(ledgerPath, '{broken');
  await vscode.commands.executeCommand('citetrace.refresh');
  // A filesystem watcher can supersede the explicit refresh. Wait for the
  // current debounced scan, not merely the cancelled command promise.
  await eventually(() => vscode.languages.getDiagnostics(unresolvedUri).length === 0, 'Failed audit must clear stale diagnostics');
  const hoversAfter = await vscode.commands.executeCommand('vscode.executeHoverProvider', modelUri, hoverPosition);
  assert.equal(hoversAfter.length, 0, 'Failed audit must clear stale hover state');
  await fs.writeFile(ledgerPath, ledgerBytes);
  await vscode.commands.executeCommand('citetrace.refresh');
  await vscode.commands.executeCommand('citetrace.export');
  assert.match(await fs.readFile(path.join(root, 'references.citetrace.bib'), 'utf8'), /Host smoke paper/);
  const outside = await fs.mkdtemp(path.join(path.dirname(root), 'citetrace-outside-'));
  const alias = `${root}-alias`;
  try {
    await fs.symlink(root, alias);
    await assert.rejects(api.audit(outside), /unknown workspace/i);
    await assert.rejects(api.audit(path.dirname(root)), /unknown workspace/i);
    await assert.rejects(api.audit(alias), /unknown workspace/i);
  } finally {
    await fs.rm(alias, { force: true });
    await fs.rm(outside, { recursive: true, force: true });
  }
  // Removing the first folder can restart the extension host. Use a secondary
  // folder in a saved multi-root workspace to verify removal in this host.
  const secondaryRoot = vscode.workspace.workspaceFolders[1].uri.fsPath;
  await api.audit(secondaryRoot);
  assert.equal(vscode.workspace.updateWorkspaceFolders(1, 1), true);
  await eventually(() => !vscode.workspace.workspaceFolders.some(folder => folder.uri.fsPath === secondaryRoot), 'Workspace removal must be delivered');
  await assert.rejects(api.audit(secondaryRoot), /unknown workspace/i);
  await fs.writeFile(path.join(root, 'host-result.json'), JSON.stringify({ success: true, vscode: vscode.version, notebookCells: notebook.cellCount, links: withNotebookLink.links.length, unknownLanguageAuthorizedExplicitly: true, staleStateCleared: true }, null, 2));
};
