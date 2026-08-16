import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '..');
const wireDir = path.join(root, 'src/ui/protocol/redeven_v1/wire');
const codecDir = path.join(root, 'src/ui/protocol/redeven_v1/codec');
const outputPath = path.join(wireDir, 'schemas.generated.ts');

const configPath = ts.findConfigFile(root, ts.sys.fileExists, 'tsconfig.json');
if (!configPath) throw new Error('tsconfig.json not found');
const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
if (configFile.error) throw new Error(ts.flattenDiagnosticMessageText(configFile.error.messageText, '\n'));
const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, root);
const program = ts.createProgram(parsed.fileNames, parsed.options);
const checker = program.getTypeChecker();

const wireFiles = program.getSourceFiles().filter((source) => (
  source.fileName.startsWith(`${wireDir}${path.sep}`) && !source.fileName.endsWith('schemas.generated.ts')
));

const allowedJsonPaths = new Set([
  'wire_ai_event_notify.diag.*',
  'wire_ai_event_notify.stream_event',
  'wire_ai_list_messages_resp.messages[].message_json',
]);
const emittedJsonPaths = new Set();

function jsonSchema(pathname) {
  if (!allowedJsonPaths.has(pathname)) {
    throw new Error(`Unbounded JSON is not allowed at ${pathname}`);
  }
  emittedJsonPaths.add(pathname);
  return { kind: 'json' };
}

function schemaFor(type, stack = new Set(), pathname) {
  if (allowedJsonPaths.has(pathname)) {
    const nonUndefined = type.isUnion()
      ? type.types.filter((item) => !(item.flags & ts.TypeFlags.Undefined))
      : [type];
    const rendered = nonUndefined.length === 1 ? checker.typeToString(nonUndefined[0]) : checker.typeToString(type);
    if (rendered !== 'JsonValue' && rendered !== 'JsonValue | undefined') {
      throw new Error(`Allowed JSON path ${pathname} must use JsonValue, received ${rendered}`);
    }
    return jsonSchema(pathname);
  }
  if (type.aliasSymbol?.getName() === 'JsonValue') return jsonSchema(pathname);
  if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return jsonSchema(pathname);
  if (type.flags & ts.TypeFlags.Never) return { kind: 'never' };
  if (type.flags & ts.TypeFlags.String) return { kind: 'string' };
  if (type.flags & ts.TypeFlags.Number) return { kind: 'number' };
  if (type.flags & ts.TypeFlags.Boolean) return { kind: 'boolean' };
  if (type.flags & ts.TypeFlags.Null) return { kind: 'null' };
  if (type.flags & ts.TypeFlags.Undefined) return { kind: 'undefined' };
  if (type.isStringLiteral()) return { kind: 'literal', value: type.value };
  if (type.isNumberLiteral()) return { kind: 'literal', value: type.value };
  if (type.flags & ts.TypeFlags.BooleanLiteral) {
    return { kind: 'literal', value: type.intrinsicName === 'true' };
  }
  if (type.isUnion()) {
    const options = type.types
      .filter((item) => !(item.flags & ts.TypeFlags.Undefined))
      .map((item) => schemaFor(item, stack, pathname));
    return options.length === 1 ? options[0] : { kind: 'union', options };
  }
  if (!(type.flags & (ts.TypeFlags.Object | ts.TypeFlags.Intersection))) {
    throw new Error(`Unsupported wire type ${checker.typeToString(type)} at ${pathname}`);
  }
  if (checker.isArrayType(type)) {
    return { kind: 'array', item: schemaFor(checker.getTypeArguments(type)[0], stack, `${pathname}[]`) };
  }
  if (checker.isTupleType(type)) {
    return {
      kind: 'tuple',
      items: checker.getTypeArguments(type).map((item, index) => schemaFor(item, stack, `${pathname}[${index}]`)),
    };
  }
  if (type.symbol?.getName() === 'Uint8Array') return { kind: 'never' };
  if (stack.has(type)) {
    throw new Error(`Recursive wire type is not allowed at ${pathname}`);
  }

  const nextStack = new Set(stack);
  nextStack.add(type);
  const stringIndex = checker.getIndexTypeOfType(type, ts.IndexKind.String);
  const properties = {};
  const required = [];
  for (const property of checker.getPropertiesOfType(type)) {
    const declaration = property.valueDeclaration ?? property.declarations?.[0];
    if (!declaration) continue;
    const propertyType = checker.getTypeOfSymbolAtLocation(property, declaration);
    properties[property.getName()] = schemaFor(propertyType, nextStack, `${pathname}.${property.getName()}`);
    if (!(property.flags & ts.SymbolFlags.Optional)) required.push(property.getName());
  }
  if (stringIndex && Object.keys(properties).length === 0) {
    return { kind: 'record', value: schemaFor(stringIndex, nextStack, `${pathname}.*`) };
  }
  return {
    kind: 'object',
    properties,
    required: required.sort(),
    ...(stringIndex ? { additional: schemaFor(stringIndex, nextStack, `${pathname}.*`) } : {}),
  };
}

const schemas = {};
for (const source of wireFiles) {
  for (const statement of source.statements) {
    if (!ts.isTypeAliasDeclaration(statement)) continue;
    const name = statement.name.text;
    if (!name.startsWith('wire_') || (!name.endsWith('_resp') && !name.endsWith('_notify'))) continue;
    schemas[name] = schemaFor(checker.getTypeAtLocation(statement), new Set(), name);
  }
}

for (const pathname of allowedJsonPaths) {
  if (!emittedJsonPaths.has(pathname)) {
    throw new Error(`Allowed JSON path is stale or was not generated: ${pathname}`);
  }
}

const decoderSchemaNames = {};
for (const source of program.getSourceFiles()) {
  if (!source.fileName.startsWith(`${codecDir}${path.sep}`) || source.fileName.endsWith('.test.ts')) continue;
  for (const statement of source.statements) {
    if (!ts.isFunctionDeclaration(statement) || !statement.name?.text.startsWith('fromWire') || statement.parameters.length === 0) continue;
    const parameter = statement.parameters[0];
    if (!parameter.type) continue;
    const parameterType = checker.getTypeAtLocation(parameter.type);
    const aliasName = parameterType.aliasSymbol?.getName() ?? parameter.type.getText(source);
    if (schemas[aliasName]) decoderSchemaNames[statement.name.text] = aliasName;
  }
}

const banner = '// Generated by scripts/generateRedevenWireSchemas.mjs. Do not edit.\n';
const output = `${banner}import type { WireSchema } from './validate';\n\nexport const redevenWireSchemas = ${JSON.stringify(schemas, null, 2)} as const satisfies Readonly<Record<string, WireSchema>>;\n\nexport type RedevenWireSchemaName = keyof typeof redevenWireSchemas;\n\nexport const redevenWireSchemaNames = ${JSON.stringify(decoderSchemaNames, null, 2)} as const satisfies Readonly<Record<string, RedevenWireSchemaName>>;\n`;

if (process.argv.includes('--check')) {
  if (!fs.existsSync(outputPath) || fs.readFileSync(outputPath, 'utf8') !== output) {
    throw new Error('Redeven wire schemas are stale; run npm run generate:wire-schemas');
  }
} else {
  fs.writeFileSync(outputPath, output);
}
