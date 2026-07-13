/**
 * Project token: `[name]` — backtick-wrapped bracketed name, e.g. `[game-x]`.
 * Backticks are required, which structurally excludes markdown links
 * [text](url), reference links, footnotes [^1], and the - [ ] checkbox.
 * Name charset matches tags/users: [\w-]+ (so `[]` never matches).
 */

/** Non-global: first project token on a line. Use with String.match. */
export const PROJECT_TOKEN_RE = /`\[([\w-]+)\]`/;

/**
 * Global: all project tokens. Use ONLY with matchAll() or replace() —
 * never .test()/.exec(), which mutate lastIndex on shared global regexes.
 */
export const PROJECT_TOKEN_RE_G = /`\[([\w-]+)\]`/g;

/** Valid bare project name (input validation). */
export const PROJECT_NAME_RE = /^[\w-]+$/;

export function formatProjectToken(name: string): string {
    return `\`[${name}]\``;
}
