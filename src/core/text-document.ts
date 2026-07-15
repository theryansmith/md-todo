/**
 * The minimal document surface `core/` parses and queries. `vscode.TextDocument`
 * is structurally assignable to it, so feature/vscode-layer callers keep passing
 * real documents unchanged — while `core/` stays host-free and unit-testable
 * from a plain string fixture.
 */
export interface TextDocumentLike {
    readonly lineCount: number;
    lineAt(line: number): { readonly text: string };
}
