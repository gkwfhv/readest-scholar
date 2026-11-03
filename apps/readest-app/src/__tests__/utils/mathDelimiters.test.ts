import { describe, it, expect } from 'vitest';
import { repairMathDelimiters } from '@/utils/mathDelimiters';

describe('repairMathDelimiters', () => {
  it('is a no-op without a backslash', () => {
    expect(repairMathDelimiters('plain text with [brackets] and (parens)')).toBe(
      'plain text with [brackets] and (parens)',
    );
  });

  it('converts LaTeX display \\[ ... \\] to $$ ... $$', () => {
    expect(repairMathDelimiters(String.raw`before \[ y = \phi^T \theta \] after`)).toBe(
      'before $$y = \\phi^T \\theta$$ after',
    );
  });

  it('converts LaTeX inline \\( ... \\) to $ ... $', () => {
    expect(repairMathDelimiters(String.raw`the value \(x_i\) here`)).toBe('the value $x_i$ here');
  });

  it('repairs the bare-bracket display line from the notebook screenshot', () => {
    // The exact failing shape: a whole line wrapped in bare [ ... ] with a
    // redundant nested \( ... \) group that KaTeX would reject inside math.
    const line = String.raw`[ \(x_i, y_i\), \quad i=1,2,\dots,N ]`;
    expect(repairMathDelimiters(line)).toBe('$$x_i, y_i, \\quad i=1,2,\\dots,N$$');
  });

  it('keeps \\end{bmatrix} tails inside a bare-bracket display line', () => {
    const line = String.raw`[ \Phi = \begin{bmatrix} \phi_1^T \\ \phi_2^T \end{bmatrix} ]`;
    const out = repairMathDelimiters(line);
    expect(out.startsWith('$$')).toBe(true);
    expect(out.endsWith('$$')).toBe(true);
    expect(out).toContain(String.raw`\begin{bmatrix}`);
    expect(out).toContain(String.raw`\end{bmatrix}`);
    expect(out).not.toContain('[');
    expect(out).not.toContain(']');
  });

  it('leaves markdown links, citations and link defs alone', () => {
    expect(repairMathDelimiters('[label](https://x.test)')).toBe('[label](https://x.test)');
    expect(repairMathDelimiters('[1]')).toBe('[1]');
    expect(repairMathDelimiters('[ref]: https://x.test')).toBe('[ref]: https://x.test');
  });

  it('repairs a bracketed formula embedded in prose (screenshot shape)', () => {
    // Chinese lead-in before the bracket: the whole-line rule can't fire, so the
    // inline rule (bracket containing a LaTeX command) must catch it.
    expect(repairMathDelimiters(String.raw`模型为 [ y = \phi^T \theta ] 其中`)).toBe(
      '模型为 $$y = \\phi^T \\theta$$ 其中',
    );
    expect(
      repairMathDelimiters(String.raw`设观测数据为 [ \(x_i, y_i\), \quad i=1,2,\dots,N ]`),
    ).toBe(String.raw`设观测数据为 $$x_i, y_i, \quad i=1,2,\dots,N$$`);
  });

  it('does not treat ordinary bracketed prose as math', () => {
    // No LaTeX command inside -> untouched, even with a stray backslash elsewhere.
    expect(repairMathDelimiters('see [the note] and \\(x\\)')).toBe('see [the note] and $x$');
  });

  it('leaves already-correct $$ / $ math untouched', () => {
    const good = 'text $$a^2+b^2=c^2$$ and $x$ inline';
    expect(repairMathDelimiters(good)).toBe(good);
  });

  it('does not rewrite LaTeX delimiters inside fenced code', () => {
    const src = '```js\nconst re = /\\(x\\)/;\n```\nafter \\(y\\)';
    const out = repairMathDelimiters(src);
    expect(out).toContain('```js\nconst re = /\\(x\\)/;\n```');
    // outside the fence the inline math is still repaired
    expect(out).toContain('after $y$');
  });

  it('handles multiple display blocks and multiline \\[ ... \\]', () => {
    const src = String.raw`\[ a = 1 \]
middle
\[ b = 2 \]`;
    expect(repairMathDelimiters(src)).toBe('$$a = 1$$\nmiddle\n$$b = 2$$');
  });

  it('fixes a stray \\( / \\) used as the \\left / \\right delimiter (notebook screenshot)', () => {
    // The model wrote `\left\(` / `\right\)`; the old inline-latex rule read the
    // inner `\(...\)` as an inline-math pair and produced `\left$...\right$`,
    // which remark-math then left as raw source. Normalise the delimiter first.
    const src = String.raw`$$x_{k+1}=x_k-\left\(\nabla^2 F(x_k)\right\)^{-1}\nabla F(x_k)$$`;
    expect(repairMathDelimiters(src)).toBe(
      String.raw`$$x_{k+1}=x_k-\left(\nabla^2 F(x_k)\right)^{-1}\nabla F(x_k)$$`,
    );
  });

  it('fixes a redundant \\( after \\left( and a stray \\) inside \\right)', () => {
    const src = String.raw`$$x_{k+1}=x_k-\left(\(\nabla^2 F(x_k)\right\)^{-1}\nabla F(x_k)$$`;
    expect(repairMathDelimiters(src)).toBe(
      String.raw`$$x_{k+1}=x_k-\left(\nabla^2 F(x_k)\right)^{-1}\nabla F(x_k)$$`,
    );
  });

  it('restores a literal $ sitting where the \\left / \\right delimiter belongs', () => {
    const src = String.raw`$x_{k+1}=x_k-\left($\nabla^2 F(x_k)\right$^{-1}\nabla F(x_k)$`;
    expect(repairMathDelimiters(src)).toBe(
      String.raw`$x_{k+1}=x_k-\left(\nabla^2 F(x_k)\right)^{-1}\nabla F(x_k)$`,
    );
  });

  it('leaves well-formed \\left( ... \\right) untouched', () => {
    const good = String.raw`$$\left(x+1\right)^{-1}$$`;
    expect(repairMathDelimiters(good)).toBe(good);
  });

  it('fixes the gradient-of-norm formula from the continuation screenshot', () => {
    // Same root cause as above, with a brace group and \| norm bars inside:
    // `\left\({\frac{1}{2}\|...\|_2^2} \right\)` used to become
    // `\left${\frac{1}{2}\|...\|_2^2} \right$`.
    const src = String.raw`$$\nabla_{\Delta x} \left\({\frac{1}{2}\|r_k+J_k\Delta x\|_2^2} \right\) = J_k^Tr_k+J_k^TJ_k\Delta x$$`;
    expect(repairMathDelimiters(src)).toBe(
      String.raw`$$\nabla_{\Delta x} \left({\frac{1}{2}\|r_k+J_k\Delta x\|_2^2} \right) = J_k^Tr_k+J_k^TJ_k\Delta x$$`,
    );
  });

  it('fixes a bare $ written as the \\left / \\right delimiter', () => {
    // Split around the literal `${` so it is not read as an interpolation.
    const src =
      String.raw`$$\nabla_{\Delta x} \left$` +
      String.raw`{\frac{1}{2}\|r_k+J_k\Delta x\|_2^2} \right$` +
      String.raw` = J_k^Tr_k+J_k^TJ_k\Delta x$$`;
    expect(repairMathDelimiters(src)).toBe(
      String.raw`$$\nabla_{\Delta x} \left({\frac{1}{2}\|r_k+J_k\Delta x\|_2^2} \right) = J_k^Tr_k+J_k^TJ_k\Delta x$$`,
    );
  });
});
