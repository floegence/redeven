import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, 'dist');

rmSync(dist, { recursive: true, force: true });
mkdirSync(join(dist, 'ui', 'assets'), { recursive: true });
cpSync(join(root, 'manifest.json'), join(dist, 'manifest.json'));
cpSync(join(root, 'ui', 'index.html'), join(dist, 'ui', 'index.html'));
cpSync(join(root, 'ui', 'assets', 'styles.css'), join(dist, 'ui', 'assets', 'styles.css'));

const result = await build({
  entryPoints: [join(root, 'src', 'main.ts')],
  outfile: join(dist, 'ui', 'assets', 'app.js'),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  nodePaths: [join(root, 'node_modules')],
  target: ['es2022'],
  legalComments: 'none',
  minify: false,
  sourcemap: false,
  write: false,
});

if (result.outputFiles.length !== 1) throw new Error('expected one bundled Containers plugin worker');
writeFileSync(join(dist, 'ui', 'assets', 'app.js'), rewriteRegularExpressionLiterals(result.outputFiles[0].text));

function rewriteRegularExpressionLiterals(source) {
  const sourceFile = ts.createSourceFile('containers-plugin.js', source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);
  const transform = ts.transform(sourceFile, [
    (context) => {
      const visit = (node) => {
        if (node.kind === ts.SyntaxKind.RegularExpressionLiteral) {
          const literal = node.text;
          const delimiter = literal.lastIndexOf('/');
          if (delimiter <= 0) throw new Error('invalid regular expression literal in Containers plugin bundle');
          const args = [ts.factory.createStringLiteral(literal.slice(1, delimiter))];
          const flags = literal.slice(delimiter + 1);
          if (flags) args.push(ts.factory.createStringLiteral(flags));
          return ts.factory.createNewExpression(ts.factory.createIdentifier('RegExp'), undefined, args);
        }
        return ts.visitEachChild(node, visit, context);
      };
      return (rootNode) => ts.visitNode(rootNode, visit);
    },
  ]);
  const output = ts.createPrinter({ removeComments: true }).printFile(transform.transformed[0]);
  transform.dispose();
  return output;
}
