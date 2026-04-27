import fs from 'node:fs';
import path from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

type SourceViolation = Readonly<{
  file: string;
  line: number;
  text: string;
}>;

const MAIN_DIR = __dirname;

function readSourceFile(filePath: string): ts.SourceFile {
  return ts.createSourceFile(
    filePath,
    fs.readFileSync(filePath, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
}

function collectTypeScriptFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return collectTypeScriptFiles(fullPath);
    }
    return entry.isFile() && entry.name.endsWith('.ts') ? [fullPath] : [];
  });
}

function formatLocation(sourceFile: ts.SourceFile, node: ts.Node): SourceViolation {
  const location = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return {
    file: path.relative(MAIN_DIR, sourceFile.fileName),
    line: location.line + 1,
    text: node.getText(sourceFile),
  };
}

function isClosedWindowListener(node: ts.CallExpression): boolean {
  if (!ts.isPropertyAccessExpression(node.expression)) {
    return false;
  }
  if (node.expression.name.text !== 'on' && node.expression.name.text !== 'once') {
    return false;
  }

  const [eventName, listener] = node.arguments;
  return Boolean(
    eventName
      && ts.isStringLiteral(eventName)
      && eventName.text === 'closed'
      && listener
      && (ts.isArrowFunction(listener) || ts.isFunctionExpression(listener)),
  );
}

function findWebContentsAccesses(sourceFile: ts.SourceFile, root: ts.Node): SourceViolation[] {
  const violations: SourceViolation[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node) && node.name.text === 'webContents') {
      violations.push(formatLocation(sourceFile, node));
    }
    ts.forEachChild(node, visit);
  };

  ts.forEachChild(root, visit);
  return violations;
}

function findClosedWindowListenerWebContentsAccesses(sourceFile: ts.SourceFile): SourceViolation[] {
  const violations: SourceViolation[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && isClosedWindowListener(node)) {
      const listener = node.arguments[1];
      violations.push(...findWebContentsAccesses(sourceFile, listener));
      return;
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return violations;
}

function findMainWebContentsIDAccesses(sourceFile: ts.SourceFile): SourceViolation[] {
  const violations: SourceViolation[] = [];

  const visit = (node: ts.Node): void => {
    if (
      ts.isPropertyAccessExpression(node)
      && node.name.text === 'id'
      && ts.isPropertyAccessExpression(node.expression)
      && node.expression.name.text === 'webContents'
    ) {
      violations.push(formatLocation(sourceFile, node));
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return violations;
}

describe('window lifecycle contract', () => {
  it('keeps closed-window callbacks away from destroyed webContents', () => {
    const violations = collectTypeScriptFiles(MAIN_DIR)
      .flatMap((filePath) => findClosedWindowListenerWebContentsAccesses(readSourceFile(filePath)));

    expect(violations).toEqual([]);
  });

  it('keeps main-process window identity on tracked snapshots', () => {
    const mainSource = readSourceFile(path.join(MAIN_DIR, 'main.ts'));

    expect(findMainWebContentsIDAccesses(mainSource)).toEqual([]);
  });
});
