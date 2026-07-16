import * as vscode from 'vscode';
import { setExtensionContext } from './vscode/workspace-state';
import { clearAllForUri, clearAll } from './vscode/cache-registry';
import { registerCommands } from './registrations/commands';
import { registerTreeViews } from './registrations/views';
import { registerLanguageProviders } from './registrations/providers';
import { registerAutoDateHandler, registerEditorUiEvents } from './registrations/events';

/**
 * Composition root: activation is a sequence of registration calls into the
 * registrations/ layer — the command registry loop (plus the self-registering
 * focus dimensions), the tree views, the language providers, and the editor
 * event fan-out. extension.ts imports only registrations/ and vscode/
 * (lint-enforced); features reach activation exclusively through the
 * declarative command table in registrations/commands.ts.
 */
export function activate(context: vscode.ExtensionContext) {
    console.log('MD Todo is now active');
    setExtensionContext(context);

    registerCommands(context);
    registerTreeViews(context);
    registerLanguageProviders(context);
    registerAutoDateHandler(context);
    registerEditorUiEvents(context);

    // Every per-URI cache (parse memo + decoration caches) registers itself
    // with the CacheRegistry, so closing a document invalidates all of them
    // with one call (F-11) and deactivation empties them wholesale (F-12).
    context.subscriptions.push(
        vscode.workspace.onDidCloseTextDocument((doc) => {
            clearAllForUri(doc.uri);
        }),
        { dispose: clearAll }
    );
}

export function deactivate() {
    // Nothing to do here (F-12): every decoration type and per-URI cache is
    // owned by a DecorationController pushed to context.subscriptions, the
    // status-bar items, tree views, providers, and event listeners are all
    // subscription-managed, and the CacheRegistry clearAll disposable empties
    // the remaining memos. VS Code requires the export to exist.
}
