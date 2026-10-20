package ai

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"reflect"

	fltools "github.com/floegence/floret/v7/tools"
	"github.com/santhosh-tekuri/jsonschema/v5"
)

// Rules belong to the frozen provider request, never to a mutable tool registry.
// Only nullability added by this adapter represents an omitted argument.
type strictArgumentRule struct {
	omitNull   bool
	properties map[string]*strictArgumentRule
	items      *strictArgumentRule
	branches   []strictArgumentBranch
}

type strictArgumentBranch struct {
	schema *jsonschema.Schema
	rule   *strictArgumentRule
}

func compileArgumentSchema(schema map[string]any) (*jsonschema.Schema, error) {
	raw, err := json.Marshal(schema)
	if err != nil {
		return nil, err
	}
	c := jsonschema.NewCompiler()
	if err := c.AddResource("https://redeven.invalid/tool.json", bytes.NewReader(raw)); err != nil {
		return nil, err
	}
	// No remote acquisition is allowed while preparing a model request.
	c.LoadURL = func(string) (io.ReadCloser, error) {
		return nil, fmt.Errorf("external schema references are unsupported")
	}
	return c.Compile("https://redeven.invalid/tool.json")
}

func prepareOpenAIToolSchemas(defs []ToolDef, strict bool) ([]ToolDef, providerToolAliases, error) {
	aliases, err := newOpenAIProviderToolAliases(defs)
	if err != nil {
		return nil, aliases, err
	}
	wire := append([]ToolDef(nil), defs...)
	aliases.argumentRules = make(map[string]*strictArgumentRule)
	for i, def := range defs {
		if !strict || !def.Strict {
			continue
		}
		var schema map[string]any
		if err := json.Unmarshal(def.InputSchema, &schema); err != nil || schema == nil {
			return nil, aliases, strictSchemaError("strict tool %s requires an object schema", def.Name)
		}
		if schema["type"] != "object" {
			return nil, aliases, strictSchemaError("strict tool %s requires an object root", def.Name)
		}
		if _, err := compileArgumentSchema(schema); err != nil {
			return nil, aliases, strictSchemaError("strict tool %s: %w", def.Name, err)
		}
		rule, err := compileStrictArgumentRule(schema, 0)
		if err != nil {
			return nil, aliases, strictSchemaError("strict tool %s: %w", def.Name, err)
		}
		wire[i].InputSchema, err = json.Marshal(schema)
		if err != nil {
			return nil, aliases, strictSchemaError("strict tool %s: %w", def.Name, err)
		}
		aliases.argumentRules[def.Name] = rule
	}
	return wire, aliases, nil
}

func compileStrictArgumentRule(schema map[string]any, depth int) (*strictArgumentRule, error) {
	if depth > 64 {
		return nil, fmt.Errorf("schema nesting exceeds 64")
	}
	for _, key := range []string{"$ref", "$defs", "definitions", "allOf", "oneOf", "not", "if", "then", "else", "patternProperties", "dependentSchemas", "dependentRequired", "unevaluatedProperties", "prefixItems", "contains"} {
		if _, ok := schema[key]; ok {
			return nil, fmt.Errorf("unsupported strict schema keyword %s", key)
		}
	}
	if _, typed := schema["type"]; !typed {
		if _, union := schema["anyOf"]; !union {
			return nil, fmt.Errorf("strict schema requires an explicit type or anyOf")
		}
	}
	rule := &strictArgumentRule{}
	if branches, ok := schema["anyOf"].([]any); ok {
		for _, value := range branches {
			child, ok := value.(map[string]any)
			if !ok {
				return nil, fmt.Errorf("anyOf requires schema objects")
			}
			childRule, err := compileStrictArgumentRule(child, depth+1)
			if err != nil {
				return nil, err
			}
			validator, err := compileArgumentSchema(child)
			if err != nil {
				return nil, err
			}
			rule.branches = append(rule.branches, strictArgumentBranch{validator, childRule})
		}
	}
	object := schema["type"] == "object"
	if types, ok := schema["type"].([]any); ok {
		for _, typ := range types {
			if typ == "object" {
				object = true
			}
		}
	}
	if object {
		if schema["additionalProperties"] != false {
			return nil, fmt.Errorf("object schema must set additionalProperties:false")
		}
		properties, ok := schema["properties"].(map[string]any)
		if !ok && schema["properties"] != nil {
			return nil, fmt.Errorf("properties must be an object")
		}
		if properties == nil {
			properties = map[string]any{}
			schema["properties"] = properties
		}
		required := make(map[string]bool)
		if values, ok := schema["required"].([]any); ok {
			for _, value := range values {
				name, ok := value.(string)
				if !ok {
					return nil, fmt.Errorf("required must contain names")
				}
				required[name] = true
			}
		}
		for name := range required {
			if _, exists := properties[name]; !exists {
				return nil, fmt.Errorf("required property %s is undefined", name)
			}
		}
		names, err := fltools.InputPropertyOrder(schema)
		if err != nil {
			return nil, err
		}
		rule.properties = make(map[string]*strictArgumentRule, len(properties))
		for name, value := range properties {
			child, ok := value.(map[string]any)
			if !ok {
				return nil, fmt.Errorf("property %s requires a schema object", name)
			}
			validator, err := compileArgumentSchema(child)
			if err != nil {
				return nil, err
			}
			acceptsNull := validator.Validate(nil) == nil
			childRule, err := compileStrictArgumentRule(child, depth+1)
			if err != nil {
				return nil, fmt.Errorf("property %s: %w", name, err)
			}
			if !required[name] && !acceptsNull {
				properties[name] = map[string]any{"anyOf": []any{child, map[string]any{"type": "null"}}}
				childRule.omitNull = true
			}
			rule.properties[name] = childRule
		}
		schema["required"] = names
	}
	if child, ok := schema["items"].(map[string]any); ok {
		var err error
		rule.items, err = compileStrictArgumentRule(child, depth+1)
		if err != nil {
			return nil, err
		}
	} else if schema["type"] == "array" {
		return nil, fmt.Errorf("array requires an item schema")
	}
	return rule, nil
}

func (a providerToolAliases) restoreArguments(name string, args map[string]any) map[string]any {
	if rule := a.argumentRules[name]; rule != nil {
		rule.restore(args)
	}
	return args
}

func (r *strictArgumentRule) restore(value any) {
	if r == nil {
		return
	}
	if len(r.branches) > 0 {
		// Ambiguous branches must agree; otherwise leave the value for canonical
		// validation rather than guessing which optional fields the model meant.
		var candidate any
		matched := false
		for _, branch := range r.branches {
			if branch.schema.Validate(value) != nil {
				continue
			}
			raw, _ := json.Marshal(value)
			var restored any
			_ = json.Unmarshal(raw, &restored)
			branch.rule.restore(restored)
			if matched && !reflect.DeepEqual(candidate, restored) {
				return
			}
			matched, candidate = true, restored
		}
		if matched {
			if object, ok := value.(map[string]any); ok {
				for key := range object {
					delete(object, key)
				}
				for key, child := range candidate.(map[string]any) {
					object[key] = child
				}
			}
			if array, ok := value.([]any); ok {
				copy(array, candidate.([]any))
			}
		}
	}
	if object, ok := value.(map[string]any); ok {
		for name, childRule := range r.properties {
			child, exists := object[name]
			if !exists {
				continue
			}
			if child == nil && childRule.omitNull {
				delete(object, name)
				continue
			}
			childRule.restore(child)
		}
	}
	if array, ok := value.([]any); ok {
		for _, child := range array {
			r.items.restore(child)
		}
	}
}

func parseProviderToolArguments(raw string) map[string]any {
	var args map[string]any
	if json.Unmarshal([]byte(raw), &args) != nil {
		return nil
	}
	return args
}

func cloneProviderToolArguments(args map[string]any) map[string]any {
	if args == nil {
		return nil
	}
	return cloneAnyMap(args)
}
