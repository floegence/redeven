package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"reflect"
	"testing"

	flprovider "github.com/floegence/floret/v7/provider"
	fltools "github.com/floegence/floret/v7/tools"
)

func TestStrictToolRequiredOrderPreservesDeclaredProperties(t *testing.T) {
	for _, strict := range []bool{false, true} {
		raw := json.RawMessage(`{"type":"object","properties":{"content":{"type":"string"},"file_path":{"type":"string"},"z":{"type":["string","null"]},"a":{"type":"boolean"}},"required":["file_path","content"],"additionalProperties":false}`)
		defs, aliases, err := prepareOpenAIToolSchemas([]ToolDef{{Name: "file.write", InputSchema: raw, Strict: true}}, strict)
		if err != nil {
			t.Fatal(err)
		}
		var schema struct{ Required []string }
		if err := json.Unmarshal(defs[0].InputSchema, &schema); err != nil {
			t.Fatal(err)
		}
		want := []string{"file_path", "content"}
		if strict {
			want = append(want, "a", "z")
		}
		if !reflect.DeepEqual(schema.Required, want) {
			t.Fatalf("strict=%v required=%v want=%v", strict, schema.Required, want)
		}
		if strict {
			restored := aliases.restoreArguments("file.write", map[string]any{"file_path": "a.txt", "content": "body", "a": nil, "z": nil})
			if _, ok := restored["a"]; ok {
				t.Fatal("adapter-added null did not restore omission")
			}
			if _, ok := restored["z"]; !ok {
				t.Fatal("declared nullable value lost")
			}
		}
		if !bytes.Equal(raw, json.RawMessage(`{"type":"object","properties":{"content":{"type":"string"},"file_path":{"type":"string"},"z":{"type":["string","null"]},"a":{"type":"boolean"}},"required":["file_path","content"],"additionalProperties":false}`)) {
			t.Fatal("caller schema mutated")
		}
	}
}

func TestFileToolSchemasKeepDeclaredOrderAcrossStrictAndFrozenReplay(t *testing.T) {
	for _, def := range builtInToolDefinitions() {
		if def.Name != "file.write" && def.Name != "file.edit" {
			continue
		}
		// Transport-only target selection is removed by the existing runtime surface.
		var schema map[string]any
		if err := json.Unmarshal(def.InputSchema, &schema); err != nil {
			t.Fatal(err)
		}
		delete(schema["properties"].(map[string]any), "target_id")
		var err error
		def.InputSchema, err = json.Marshal(schema)
		if err != nil {
			t.Fatal(err)
		}
		def.Strict = true
		for _, strict := range []bool{false, true} {
			defs, _, err := prepareOpenAIToolSchemas([]ToolDef{def}, strict)
			if err != nil {
				t.Fatal(err)
			}
			if err = json.Unmarshal(defs[0].InputSchema, &schema); err != nil {
				t.Fatal(err)
			}
			order, err := fltools.InputPropertyOrder(schema)
			if err != nil {
				t.Fatal(err)
			}
			want := []string{"file_path", "content"}
			if def.Name == "file.edit" {
				want = []string{"file_path", "old_string", "new_string", "replace_all"}
			}
			if !reflect.DeepEqual(order, want) {
				t.Fatalf("%s strict=%v order=%v", def.Name, strict, order)
			}
			var sent []byte
			params := map[string]any{"input": []any{map[string]any{"role": "user", "content": "edit"}}, "tools": []any{map[string]any{"type": "function", "name": "file_write", "parameters": schema}}}
			prepared, err := newPreparedModelWire("openai", "gpt-4o", flprovider.RequestFormatOpenAIResponses, params, ModelGatewayRequest{}, providerToolAliases{}, func(_ context.Context, raw []byte, _ func(StreamEvent)) (ModelGatewayResult, error) {
				sent = bytes.Clone(raw)
				return ModelGatewayResult{}, nil
			})
			if err != nil {
				t.Fatal(err)
			}
			frozen := bytes.Clone(prepared.payload)
			if !bytes.Contains(frozen, []byte(`"properties":{"file_path":`)) {
				t.Fatalf("final wire order: %s", frozen)
			}
			replay, err := prepared.replay(t.Context(), flprovider.Request{})
			if err != nil {
				t.Fatal(err)
			}
			if _, err = replay.StreamTurn(t.Context(), nil); err != nil || !bytes.Equal(frozen, sent) {
				t.Fatalf("retry changed wire: %v", err)
			}
			if err = prepared.Close(); err != nil {
				t.Fatal(err)
			}
		}
	}
}
