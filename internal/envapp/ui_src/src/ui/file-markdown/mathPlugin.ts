import katex from 'katex';

const MATH_PLACEHOLDER_PREFIX = '@@MATH_PLACEHOLDER_';

interface MathExtraction {
  renders: string[];
  processed: string;
}

const BLOCK_MATH_RE = /^```/;

export function extractMath(source: string): MathExtraction {
  const renders: string[] = [];
  const lines = source.split('\n');
  const outLines: string[] = [];
  let inBlockMath = false;
  let blockMathBuf = '';
  let inFence = false;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    if (BLOCK_MATH_RE.test(line.trimStart())) {
      inFence = !inFence;
      outLines.push(line);
      continue;
    }

    if (inFence) {
      outLines.push(line);
      continue;
    }

    let processed = line;

    if (inBlockMath) {
      if (/^\$\$/.test(processed.trimStart())) {
        inBlockMath = false;
        blockMathBuf += processed.replace(/\$\$/, '');
        const idx = renders.length;
        try {
          const rendered = katex.renderToString(blockMathBuf, {
            displayMode: true,
            throwOnError: false,
            output: 'htmlAndMathml',
            strict: 'ignore',
            trust: false,
          });
          renders.push(rendered);
        } catch {
          renders.push(`<span class="katex-error">${escapeMath(blockMathBuf)}</span>`);
        }
        outLines.push(`${MATH_PLACEHOLDER_PREFIX}${idx}@@`);
        blockMathBuf = '';
        processed = processed.replace(/.*\$\$/, '');
      } else {
        blockMathBuf += processed + '\n';
        continue;
      }
    } else if (/^\$\$/.test(processed.trimStart()) && !/\$\$.*\$\$/.test(processed)) {
      inBlockMath = true;
      blockMathBuf = processed.replace(/^\$\$/, '') + '\n';
      continue;
    }

    // Inline math $...$
    processed = processed.replace(/\$([^$\s\n](?:[^$\n]*?[^$\s\n])?)\$/g, (_match, expr: string) => {
      const idx = renders.length;
      try {
        const rendered = katex.renderToString(expr, {
          displayMode: false,
          throwOnError: false,
          output: 'htmlAndMathml',
          strict: 'ignore',
          trust: false,
        });
        renders.push(rendered);
      } catch {
        renders.push(`<span class="katex-error">${escapeMath(expr)}</span>`);
      }
      return `${MATH_PLACEHOLDER_PREFIX}${idx}@@`;
    });

    // Block math $$...$$ on a single line
    processed = processed.replace(/\$\$([^$]+)\$\$/g, (_match, expr: string) => {
      const idx = renders.length;
      try {
        const rendered = katex.renderToString(expr, {
          displayMode: true,
          throwOnError: false,
          output: 'htmlAndMathml',
          strict: 'ignore',
          trust: false,
        });
        renders.push(rendered);
      } catch {
        renders.push(`<span class="katex-error">${escapeMath(expr)}</span>`);
      }
      return `${MATH_PLACEHOLDER_PREFIX}${idx}@@`;
    });

    outLines.push(processed);
  }

  if (inBlockMath && blockMathBuf) {
    const idx = renders.length;
    renders.push(`<span class="katex-error">${escapeMath(blockMathBuf)}</span>`);
    outLines.push(`${MATH_PLACEHOLDER_PREFIX}${idx}@@`);
  }

  return { renders, processed: outLines.join('\n') };
}

export function reinjectMath(html: string, renders: string[]): string {
  return html.replace(
    new RegExp(`${escapeRegExp(MATH_PLACEHOLDER_PREFIX)}(\\d+)@@`, 'g'),
    (_match, idx) => renders[Number(idx)] ?? '',
  );
}

function escapeMath(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
