import type { JsonValue } from '@floegence/flowersec-core';

import { redevenWireSchemas, type RedevenWireSchemaName } from './schemas.generated';

export type WireSchema =
  | Readonly<{ kind: 'json' | 'never' | 'string' | 'number' | 'boolean' | 'null' | 'undefined' }>
  | Readonly<{ kind: 'literal'; value: string | number | boolean }>
  | Readonly<{ kind: 'array'; item: WireSchema }>
  | Readonly<{ kind: 'tuple'; items: readonly WireSchema[] }>
  | Readonly<{ kind: 'union'; options: readonly WireSchema[] }>
  | Readonly<{ kind: 'record'; value: WireSchema }>
  | Readonly<{
    kind: 'object';
    properties: Readonly<Record<string, WireSchema>>;
    required: readonly string[];
    additional?: WireSchema;
  }>;

export function validateRedevenWireValue<Wire>(name: RedevenWireSchemaName, value: JsonValue): Wire {
  validateSchema(redevenWireSchemas[name], value, '$');
  return value as Wire;
}

function validateSchema(schema: WireSchema, value: JsonValue, path: string): void {
  switch (schema.kind) {
    case 'json':
      return;
    case 'never':
    case 'undefined':
      throw new Error(`${path} is not valid JSON for this contract`);
    case 'null':
      if (value !== null) throw new Error(`${path} must be null`);
      return;
    case 'string':
    case 'boolean':
      if (typeof value !== schema.kind) throw new Error(`${path} must be ${schema.kind}`);
      return;
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${path} must be a finite number`);
      return;
    case 'literal':
      if (value !== schema.value) throw new Error(`${path} must equal ${JSON.stringify(schema.value)}`);
      return;
    case 'array':
      if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
      value.forEach((entry, index) => validateSchema(schema.item, entry, `${path}[${index}]`));
      return;
    case 'tuple':
      if (!Array.isArray(value) || value.length !== schema.items.length) throw new Error(`${path} must be an exact tuple`);
      schema.items.forEach((item, index) => validateSchema(item, value[index]!, `${path}[${index}]`));
      return;
    case 'union': {
      const accepted = schema.options.some((option) => {
        try {
          validateSchema(option, value, path);
          return true;
        } catch {
          return false;
        }
      });
      if (!accepted) throw new Error(`${path} does not match any allowed shape`);
      return;
    }
    case 'record':
      if (!isObject(value)) throw new Error(`${path} must be an object`);
      for (const [key, entry] of Object.entries(value)) validateSchema(schema.value, entry, `${path}.${key}`);
      return;
    case 'object': {
      if (!isObject(value)) throw new Error(`${path} must be an object`);
      for (const required of schema.required) {
        if (!Object.prototype.hasOwnProperty.call(value, required)) throw new Error(`${path}.${required} is required`);
      }
      for (const [key, entry] of Object.entries(value)) {
        const property = schema.properties[key] ?? schema.additional;
        if (!property) throw new Error(`${path}.${key} is not allowed`);
        validateSchema(property, entry, `${path}.${key}`);
      }
      return;
    }
  }
}

function isObject(value: JsonValue): value is { [key: string]: JsonValue } {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
