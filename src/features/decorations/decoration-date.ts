import * as vscode from 'vscode';
import { DecorationController, tokenScanLine } from '../../vscode/decoration-controller';

/**
 * `` `+YYYY-MM-DD` `` / `` `✓YYYY-MM-DD` `` date stamps: faded via the
 * user-configurable `mdTodo.dateOpacity` setting (the controller rebuilds
 * the type when that key changes).
 */
export const dateDecoration = new DecorationController({
    id: 'date',
    incremental: true,
    configKeys: ['mdTodo.dateOpacity'],
    createType: () => {
        const opacity = vscode.workspace.getConfiguration('mdTodo').get<number>('dateOpacity', 0.5);
        return vscode.window.createTextEditorDecorationType({ opacity: String(opacity) });
    },
    scanLine: tokenScanLine(/`[+✓]\d{4}-\d{2}-\d{2}`/g),
});
