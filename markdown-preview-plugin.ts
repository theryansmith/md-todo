// Markdown-it plugin used by VS Code's built-in markdown preview to give
// md-todo's #tags, @users, and `+YYYY-MM-DD` / `✓YYYY-MM-DD` date code spans
// distinct CSS hooks so media/markdown-todo.css can color/highlight them.
//
// Wired up via `contributes.markdown.markdownItPlugins: true` in package.json
// and re-exported from extension.ts as `extendMarkdownIt`. VS Code calls that
// export to extend the markdown-it instance that powers the built-in preview.

// markdown-it is loaded by VS Code; we don't bundle it. Use structural types
// for the bits we touch so we avoid a hard dependency at compile time.
interface MarkdownItToken {
    type: string;
    tag: string;
    content: string;
    children: MarkdownItToken[] | null;
    attrJoin(name: string, value: string): void;
}

interface MarkdownItRendererSelf {
    renderToken(tokens: MarkdownItToken[], idx: number, opts: unknown): string;
}

type CodeInlineRule = (
    tokens: MarkdownItToken[],
    idx: number,
    opts: unknown,
    env: unknown,
    self: MarkdownItRendererSelf,
) => string;

interface MarkdownItState {
    tokens: MarkdownItToken[];
    Token: new (type: string, tag: string, nesting: number) => MarkdownItToken;
}

interface MarkdownIt {
    core: { ruler: { push(name: string, fn: (state: MarkdownItState) => void): void } };
    renderer: { rules: Record<string, CodeInlineRule | undefined> };
}

const DATE_CODE_RE = /^([+✓])(\d{4}-\d{2}-\d{2})$/;
// Tags and @mentions: require a non-word boundary (or start of string) before
// the sigil so we don't grab "foo#bar" mid-word. \w covers [A-Za-z0-9_];
// tag names additionally allow hyphens, mirroring extension.ts's tag regex.
const TAG_RE = /(^|[^\w])#([A-Za-z0-9_-]+)/g;
const USER_RE = /(^|[^\w])@([A-Za-z0-9_-]+)/g;

export function extendMarkdownIt(md: MarkdownIt): MarkdownIt {
    // 1. Tag inline code spans whose content looks like a +date or ✓date.
    const defaultCodeInline: CodeInlineRule =
        md.renderer.rules.code_inline ?? ((tokens, idx, opts, _env, self) => self.renderToken(tokens, idx, opts));
    md.renderer.rules.code_inline = (tokens, idx, opts, env, self) => {
        const token = tokens[idx];
        const match = DATE_CODE_RE.exec(token.content);
        if (match) {
            const cls = match[1] === '+' ? 'md-todo-date-added' : 'md-todo-date-completed';
            token.attrJoin('class', cls);
        }
        return defaultCodeInline(tokens, idx, opts, env, self);
    };

    // 2. Walk inline tokens after parsing and wrap #tags / @users in classed spans.
    md.core.ruler.push('md-todo-wrap-tags-users', (state) => {
        for (const blockToken of state.tokens) {
            if (blockToken.type !== 'inline' || !blockToken.children) {
                continue;
            }
            blockToken.children = wrapInChildren(blockToken.children, state);
        }
    });

    return md;
}

function wrapInChildren(children: MarkdownItToken[], state: MarkdownItState): MarkdownItToken[] {
    const out: MarkdownItToken[] = [];
    for (const child of children) {
        if (child.type !== 'text') {
            out.push(child);
            continue;
        }
        out.push(...splitTextToken(child.content, state));
    }
    return out;
}

function splitTextToken(text: string, state: MarkdownItState): MarkdownItToken[] {
    interface Match {
        start: number;
        leadingLen: number;
        end: number;
        kind: 'tag' | 'user';
        sigilAndName: string;
    }
    const matches: Match[] = [];
    for (const re of [TAG_RE, USER_RE]) {
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(text)) !== null) {
            const leading = m[1];
            const name = m[2];
            matches.push({
                start: m.index,
                leadingLen: leading.length,
                end: m.index + m[0].length,
                kind: re === TAG_RE ? 'tag' : 'user',
                sigilAndName: (re === TAG_RE ? '#' : '@') + name,
            });
        }
    }
    if (matches.length === 0) {
        const token = new state.Token('text', '', 0);
        token.content = text;
        return [token];
    }
    matches.sort((a, b) => a.start - b.start);

    const tokens: MarkdownItToken[] = [];
    let cursor = 0;
    for (const match of matches) {
        // Preserve leading text up to (and including) the leading non-word char.
        const textEnd = match.start + match.leadingLen;
        if (textEnd > cursor) {
            const t = new state.Token('text', '', 0);
            t.content = text.slice(cursor, textEnd);
            tokens.push(t);
        }
        const cls = match.kind === 'tag' ? 'md-todo-tag' : 'md-todo-user';
        const open = new state.Token('html_inline', '', 0);
        open.content = `<span class="${cls}">`;
        tokens.push(open);
        const body = new state.Token('text', '', 0);
        body.content = match.sigilAndName;
        tokens.push(body);
        const close = new state.Token('html_inline', '', 0);
        close.content = '</span>';
        tokens.push(close);
        cursor = match.end;
    }
    if (cursor < text.length) {
        const t = new state.Token('text', '', 0);
        t.content = text.slice(cursor);
        tokens.push(t);
    }
    return tokens;
}
