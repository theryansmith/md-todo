import * as vscode from 'vscode';
import { DecorationController, tokenScanLine } from '../../vscode/decoration-controller';

/**
 * `@user` mentions: distinct styling from tag decorations — bold + accent
 * color (charts.blue).
 */
export const mentionDecoration = new DecorationController({
    id: 'mention',
    incremental: true,
    createType: () =>
        vscode.window.createTextEditorDecorationType({
            color: new vscode.ThemeColor('charts.blue'),
            fontWeight: 'bold',
        }),
    scanLine: tokenScanLine(/@[\w-]+/g),
});
