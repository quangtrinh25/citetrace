/** Positions are zero-based UTF-16 line/character coordinates, as in VS Code. */
export interface SourcePosition {
  line: number;
  character: number;
}

export interface SourceRange {
  start: SourcePosition;
  end: SourcePosition;
}

/** The artifact is repository-relative. Cell indices are display hints, not identities. */
export interface SourceUnit {
  artifact: string;
  kind: 'file' | 'cell';
  source: string;
  cell?: { index: number; id?: string };
}

export interface SourceDiagnostic {
  artifact: string;
  code: string;
  severity: 'warning' | 'error';
  message: string;
  cellIndex?: number;
  range?: SourceRange;
}

export interface SourceReadResult {
  units: SourceUnit[];
  diagnostics: SourceDiagnostic[];
}

export interface CodeSymbol {
  kind: 'class' | 'function' | 'method';
  name: string;
  qualifiedName: string;
  fingerprint: string;
  range: SourceRange;
}

export interface UnitAnalysis {
  unit: SourceUnit;
  fingerprint: string;
  symbols: CodeSymbol[];
  diagnostics: SourceDiagnostic[];
}
