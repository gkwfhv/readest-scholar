// LLMs often emit LaTeX with `\[ ... \]` / `\( ... \)` delimiters, or wrap a
// display formula in bare square brackets `[ ... ]`. remark-math only recognises
// `$$ ... $$` and `$ ... $`, so those forms fall through to CommonMark — which
// eats the leading backslash (`\[` -> `[`) and leaves the rest as raw text, the
// exact "unrendered formula" symptom in the notebook chat. Normalise them to the
// `$` forms here, before either markdown pipeline (react-markdown or the
// assistant-ui wrapper) tokenises the text.

// A display block may still contain redundant `\( ... \)` grouping; KaTeX rejects
// `\(` inside math mode ("Can't use function '\(' in math mode"), so drop those
// delimiters and keep the content when re-wrapping as `$$`.
const stripInlineDelims = (inner: string) => inner.replace(/\\\(|\\\)/g, '').trim();

const DISPLAY_LATEX = /\\\[([\s\S]+?)\\\]/g;
// A whole line of the form `[ ...backslash... ]`: the greedy inner match runs to
// the last `]` so `\end{bmatrix} ]` tails are kept. Requiring a backslash inside
// skips markdown links (`[t](u)` ends in `)`), citations (`[1]`), and link defs.
const BARE_BRACKET_LINE = /^[ \t]*\[([^\n]*\\[^\n]*)\][ \t]*$/gm;
// A bracketed formula embedded in prose (`设 … [ y = \phi^T \theta ] …`). To
// avoid eating ordinary bracketed text it must contain a LaTeX command
// (backslash + letter) and no inner brackets.
const INLINE_BRACKET = /\[([^\[\]]*\\[a-zA-Z][^\[\]]*)\]/g;
const INLINE_LATEX = /\\\(([\s\S]+?)\\\)/g;
const CODE_FENCE = /(```[\s\S]*?```|~~~[\s\S]*?~~~)/g;

function repairSegment(text: string): string {
  return (
    text
      .replace(DISPLAY_LATEX, (_m, inner: string) => `$$${stripInlineDelims(inner)}$$`)
      // Bare-bracket rules run before inline so a nested `\( ... \)` is stripped
      // rather than turned into `$ ... $` inside the new display block.
      .replace(BARE_BRACKET_LINE, (_m, inner: string) => `$$${stripInlineDelims(inner)}$$`)
      .replace(INLINE_BRACKET, (_m, inner: string) => `$$${stripInlineDelims(inner)}$$`)
      .replace(INLINE_LATEX, (_m, inner: string) => `$${inner.trim()}$`)
  );
}

export function repairMathDelimiters(text: string): string {
  // Every pattern needs a literal backslash; without one nothing can match.
  if (!text || !text.includes('\\')) return text;
  // Fenced code is left alone — `\[` and `\(` there are literal source, not math.
  return text
    .split(CODE_FENCE)
    .map((part, i) => (i % 2 === 1 ? part : repairSegment(part)))
    .join('');
}
