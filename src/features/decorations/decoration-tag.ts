import * as vscode from 'vscode';
import { DecorationController, tokenScanLine } from '../../vscode/decoration-controller';

/**
 * `#tag` tokens: distinct, visible color (purple). Less prominent than
 * @mentions (which are bold + charts.blue), but clearly stands out from
 * body text.
 */
export const tagDecoration = new DecorationController({
    id: 'tag',
    incremental: true,
    createType: () =>
        vscode.window.createTextEditorDecorationType({
            color: new vscode.ThemeColor('charts.purple'),
        }),
    scanLine: tokenScanLine(/#[\w-]+/g),
});
