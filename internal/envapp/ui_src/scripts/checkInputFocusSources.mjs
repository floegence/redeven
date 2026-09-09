import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, URL } from 'node:url';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const inputTags = new Set(['input', 'textarea', 'select', 'Input', 'Textarea', 'NumberInput', 'AffixInput', 'DirectoryInput']);
const nonTextTypes = new Set(['checkbox', 'radio', 'range', 'color', 'file', 'button', 'submit', 'reset', 'image']);

export function inputClassLiterals(source, filename = 'source.tsx') {
  const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declarations = new Map();
  const literals = new Set();
  function declarationsIn(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) declarations.set(node.name.text, node.initializer);
    ts.forEachChild(node, declarationsIn);
  }
  declarationsIn(ast);
  function collect(node, seen = new Set()) {
    if (!node) return;
    if (ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) { literals.add(node); return; }
    if (ts.isIdentifier(node) && declarations.has(node.text) && !seen.has(node.text)) {
      seen.add(node.text); collect(declarations.get(node.text), seen); return;
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) { collect(node.right, seen); return; }
    if (ts.isConditionalExpression(node)) { collect(node.whenTrue, seen); collect(node.whenFalse, seen); return; }
    if (ts.isCallExpression(node)) { node.arguments.forEach(argument => collect(argument, seen)); return; }
    if (ts.isPropertyAccessExpression(node)) return;
    ts.forEachChild(node, child => collect(child, seen));
  }
  function visit(node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const attrs = node.attributes.properties.filter(ts.isJsxAttribute);
      const tag = node.tagName.getText(ast);
      const type = attrs.find(attr => attr.name.getText(ast) === 'type')?.initializer;
      const surface = attrs.some(attr => attr.name.getText(ast) === 'data-floe-input-surface');
      const textInput = inputTags.has(tag) && !(tag === 'input' && type && nonTextTypes.has(type.text));
      if (textInput || surface) {
        for (const attr of attrs.filter(attr => ['class', 'className'].includes(attr.name.getText(ast)))) collect(attr.initializer);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return [...literals].map(node => ({ text: node.text, start: node.getStart(ast), end: node.end, line: ast.getLineAndCharacterOfPosition(node.pos).line + 1 }));
}

export function inspectInputClasses(source, filename = 'source.tsx') {
  const literals = inputClassLiterals(source, filename);
  const violations = [];
  for (const { text, line } of literals) {
    for (const token of text.split(/\s+/)) {
      if (/^(?:focus(?:-visible|-within)?:)?!?ring(?:-|$)(?!0(?:$|:))/.test(token)
        || /^focus(?:-visible|-within)?:!?(?:outline-(?!none|0)|shadow-(?!none)|bg-|border-(?:[0248](?:$|\s)|\[\d)|(?:p[xytrbl]?|[wh])-)/.test(token)) {
        violations.push(`${filename}:${line}: input focus utility ${token}`);
      }
    }
  }
  return { literals, violations };
}

export function inspectInputCSS(source, classes, filename = 'source.css') {
  const violations = [];
  for (const [, selector, body] of source.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!/:focus(?:-within|-visible)?\b/.test(selector)) continue;
    const ownsInput = /(?:^|[\s>+~,(])(?:input|textarea|select)(?=[.#:[\s>+~),]|$)|\[data-floe-input-surface/.test(selector)
      || [...selector.matchAll(/\.([\w-]+)/g)].some(([, name]) => classes.has(name));
    if (!ownsInput) continue;
    for (const [, property, value] of body.matchAll(/([\w-]+)\s*:\s*([^;]+);?/g)) {
      if ((/^(?:outline(?:-width|-offset)?|box-shadow)$/.test(property) && !/^(?:none|0(?:px)?)(?:\s*!important)?$/.test(value.trim()))
        || /^(?:border(?:-\w+)?-width|padding(?:-\w+)?|width|height|background(?:-color)?)$/.test(property)) {
        violations.push(`${filename}: ${selector.trim()} changes ${property}`);
      }
    }
  }
  return violations;
}

function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (['node_modules', 'dist'].includes(entry.name)) return [];
    const path = join(directory, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}
export function checkRepository() {
  const paths = ['desktop/src', 'internal/flower_ui/src', 'internal/envapp/ui_src/src'].flatMap(dir => files(join(root, dir)))
    .filter(path => !/\.test\.|testHarness|\/test\//.test(path));
  const classes = new Set(['address-wrap']);
  const violations = [];
  for (const path of paths.filter(path => path.endsWith('.tsx'))) {
    const result = inspectInputClasses(readFileSync(path, 'utf8'), relative(root, path));
    result.literals.forEach(({ text }) => text.split(/\s+/).filter(token => /^[\w-]+$/.test(token)).forEach(token => classes.add(token)));
    violations.push(...result.violations);
  }
  for (const path of paths.filter(path => path.endsWith('.css') || path.endsWith('/webServiceBrowserDocument.ts'))) {
    violations.push(...inspectInputCSS(readFileSync(path, 'utf8'), classes, relative(root, path)));
  }
  if (violations.length) throw new Error(violations.join('\n'));
  return 'Redeven input focus source policy passed.';
}
if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(checkRepository());
