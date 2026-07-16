import * as vscode from 'vscode';
import { DecorationController, tokenScanLine } from '../../vscode/decoration-controller';
import { PROJECT_TOKEN_RE_G } from '../../core/tokens';

/**
 * `` `[project]` `` tokens: distinct, visible color (orange) — clearly
 * separate from #tags (purple) and @mentions (bold blue).
 */
export const projectDecoration = new DecorationController({
    id: 'project',
    incremental: true,
    createType: () =>
        vscode.window.createTextEditorDecorationType({
            color: new vscode.ThemeColor('charts.orange'),
        }),
    scanLine: tokenScanLine(PROJECT_TOKEN_RE_G),
});
