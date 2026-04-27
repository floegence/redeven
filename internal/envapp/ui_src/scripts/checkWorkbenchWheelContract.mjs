#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(scriptDir, '..');
const srcRoot = process.env.REDEVEN_WORKBENCH_WHEEL_CONTRACT_SRC_ROOT
  ? path.resolve(process.env.REDEVEN_WORKBENCH_WHEEL_CONTRACT_SRC_ROOT)
  : path.join(packageRoot, 'src');

const scanEntries = [
  'ui/codex',
  'ui/pages/AIChatSidebar.tsx',
  'ui/pages/EnvAIPage.tsx',
  'ui/pages/EnvCodespacesPage.tsx',
  'ui/pages/EnvPortForwardsPage.tsx',
  'ui/widgets',
  'ui/workbench',
].map((relativePath) => path.join(srcRoot, relativePath));

const allowedRawWheelAttrFiles = new Set([
  'src/ui/workbench/surface/workbenchWheelInteractive.ts',
]);

const localScrollViewportPropNames = new Set([
  'GIT_WORKBENCH_SCROLL_REGION_PROPS',
  'REDEVEN_WORKBENCH_LOCAL_SCROLL_VIEWPORT_PROPS',
  'REDEVEN_WORKBENCH_WHEEL_INTERACTIVE_PROPS',
]);

const layoutOnlyPropNames = new Set([
  'REDEVEN_WORKBENCH_WHEEL_LAYOUT_ONLY_PROPS',
]);

const wheelInteractiveAttr = 'data-floe-canvas-wheel-interactive';
const wheelRoleAttr = 'data-redeven-workbench-wheel-role';
const layoutOnlyRole = 'layout-only';
const boundedScrollClassPattern = /\boverflow(?:-[xy])?-(?:auto|scroll)\b/u;
const boundedViewportConstraintPattern = /\b(?:min-h-0|h-full|flex-1)\b/u;
const knownWorkbenchScrollClassPattern = /\b(?:codex-page-transcript-main|flower-chat-transcript-main)\b/u;
const knownWorkbenchScrollAttrs = new Set([
  'data-codex-transcript-scroll-region',
]);

function walkFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(fullPath, out);
      continue;
    }
    if (!/\.(?:ts|tsx)$/u.test(entry.name)) continue;
    if (/\.(?:test|spec|browser\.test)\.(?:ts|tsx)$/u.test(entry.name)) continue;
    out.push(fullPath);
  }
  return out;
}

function repoRelative(filePath) {
  return path.relative(packageRoot, filePath).split(path.sep).join('/');
}

function lineAndColumn(sourceFile, node) {
  const pos = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return `${repoRelative(sourceFile.fileName)}:${pos.line + 1}:${pos.character + 1}`;
}

function collectStringConstants(sourceFile) {
  const constants = new Map();

  function visit(node) {
    if (
      ts.isVariableDeclaration(node)
      && ts.isIdentifier(node.name)
      && node.initializer
      && ts.isStringLiteralLike(node.initializer)
    ) {
      constants.set(node.name.text, node.initializer.text);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return constants;
}

function attrName(attr) {
  if (!ts.isJsxAttribute(attr)) return null;
  return attr.name.getText();
}

function attrStringValue(attr, sourceFile, constants) {
  if (!ts.isJsxAttribute(attr) || !attr.initializer) return '';
  if (ts.isStringLiteral(attr.initializer)) {
    return attr.initializer.text;
  }
  if (!ts.isJsxExpression(attr.initializer)) {
    return attr.initializer.getText(sourceFile);
  }
  const expression = attr.initializer.expression;
  if (!expression) return '';
  if (ts.isStringLiteralLike(expression)) {
    return expression.text;
  }
  if (ts.isNoSubstitutionTemplateLiteral(expression)) {
    return expression.text;
  }
  if (ts.isIdentifier(expression) && constants.has(expression.text)) {
    return constants.get(expression.text) ?? '';
  }
  return expression.getText(sourceFile);
}

function hasSpreadProp(node, sourceFile, names) {
  return node.attributes.properties.some((attr) => (
    ts.isJsxSpreadAttribute(attr) && names.has(attr.expression.getText(sourceFile))
  ));
}

function readRoleAttr(node) {
  for (const attr of node.attributes.properties) {
    if (!ts.isJsxAttribute(attr)) continue;
    if (attr.name.getText() !== wheelRoleAttr) continue;
    if (!attr.initializer || !ts.isStringLiteral(attr.initializer)) return null;
    return attr.initializer.text;
  }
  return null;
}

function isContractedWheelNode(node, sourceFile) {
  if (hasSpreadProp(node, sourceFile, localScrollViewportPropNames)) return true;
  if (hasSpreadProp(node, sourceFile, layoutOnlyPropNames)) return true;

  const role = readRoleAttr(node);
  return role === layoutOnlyRole;
}

function classContractReason(node, sourceFile, constants) {
  const classAttr = node.attributes.properties.find((attr) => {
    const name = attrName(attr);
    return name === 'class' || name === 'className';
  });
  for (const attr of node.attributes.properties) {
    if (!ts.isJsxAttribute(attr)) continue;
    if (knownWorkbenchScrollAttrs.has(attr.name.getText())) {
      return 'known Workbench scroll viewport';
    }
  }

  if (!classAttr) return null;

  const classText = attrStringValue(classAttr, sourceFile, constants);
  if (knownWorkbenchScrollClassPattern.test(classText)) {
    return 'known Workbench scroll viewport';
  }
  if (!boundedScrollClassPattern.test(classText)) return null;
  if (!boundedViewportConstraintPattern.test(classText)) return null;
  return 'bounded scroll viewport candidate';
}

function checkJsxNode(node, sourceFile, constants, errors) {
  for (const attr of node.attributes.properties) {
    if (!ts.isJsxAttribute(attr)) continue;
    if (attr.name.getText() === wheelInteractiveAttr) {
      errors.push(`${lineAndColumn(sourceFile, attr)}: use exported Workbench wheel props instead of raw ${wheelInteractiveAttr}.`);
    }
  }

  const reason = classContractReason(node, sourceFile, constants);
  if (reason && !isContractedWheelNode(node, sourceFile)) {
    errors.push(`${lineAndColumn(sourceFile, node)}: ${reason} must spread REDEVEN_WORKBENCH_LOCAL_SCROLL_VIEWPORT_PROPS, GIT_WORKBENCH_SCROLL_REGION_PROPS, or REDEVEN_WORKBENCH_WHEEL_LAYOUT_ONLY_PROPS.`);
  }
}

function checkFile(filePath, errors) {
  const text = fs.readFileSync(filePath, 'utf8');
  const sourceKind = filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true, sourceKind);
  const constants = collectStringConstants(sourceFile);
  const relativePath = repoRelative(filePath);

  if (!allowedRawWheelAttrFiles.has(relativePath) && text.includes(wheelInteractiveAttr)) {
    const rawCount = text.split(wheelInteractiveAttr).length - 1;
    if (rawCount > 0) {
      errors.push(`${relativePath}: use exported Workbench wheel props instead of raw ${wheelInteractiveAttr}.`);
    }
  }

  function visit(node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      checkJsxNode(node, sourceFile, constants, errors);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
}

const errors = [];
for (const entry of scanEntries) {
  if (!fs.existsSync(entry)) continue;
  const stat = fs.statSync(entry);
  if (stat.isDirectory()) {
    for (const filePath of walkFiles(entry)) {
      checkFile(filePath, errors);
    }
  } else if (stat.isFile()) {
    checkFile(entry, errors);
  }
}

if (errors.length > 0) {
  console.error('Workbench wheel contract check failed:');
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log('Workbench wheel contract check passed.');
