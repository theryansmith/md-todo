import * as vscode from 'vscode';
import {
    userHoverProvider,
    userCompletionProvider,
    tagCompletionProvider,
    projectCompletionProvider,
} from '../features/completions/completions';

/**
 * Completion providers register against all docs so tags/users can be
 * autocompleted in any file (e.g. code, notes) sourced from the last
 * active mdtodo doc. The providers themselves no-op when no source is
 * available. Hover for @mentions stays scoped to markdown (it reads from
 * the current document, not a remembered source).
 */
export function registerLanguageProviders(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider('*', tagCompletionProvider, '#'),
        vscode.languages.registerCompletionItemProvider('*', userCompletionProvider, '@'),
        vscode.languages.registerCompletionItemProvider('*', projectCompletionProvider, '['),
        vscode.languages.registerHoverProvider({ language: 'markdown' }, userHoverProvider)
    );
}
