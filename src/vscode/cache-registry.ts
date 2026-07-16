import * as vscode from 'vscode';

/**
 * Registry of per-URI cache clearers (F-11). Any module that memoizes state
 * per document URI registers its clear callback here (once, at module
 * initialization); the composition root then invalidates every cache with a
 * single clearAllForUri call on document close instead of hand-enumerating
 * per-module clear functions — forgetting one used to leak cache entries.
 */
type ClearUriCache = (uri?: vscode.Uri) => void;

const clearers: ClearUriCache[] = [];

/** Register a per-URI cache. `clear(uri)` drops one entry; `clear()` drops all. */
export function registerUriCache(clear: ClearUriCache): void {
    clearers.push(clear);
}

/** Drop every registered cache's entry for one document. */
export function clearAllForUri(uri: vscode.Uri): void {
    for (const clear of clearers) {
        clear(uri);
    }
}

/** Drop every entry in every registered cache (deactivate-time teardown). */
export function clearAll(): void {
    for (const clear of clearers) {
        clear();
    }
}
