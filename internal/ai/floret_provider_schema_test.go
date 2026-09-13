package ai

import (
	"encoding/json"
	"testing"

	fltools "github.com/floegence/floret/v7/tools"
)

func TestFlowerToolsFromFloretRejectsNullRequired(t *testing.T) {
	_, err := flowerToolsFromFloret([]fltools.ToolDefinition{{
		Name:        "broken",
		InputSchema: map[string]any{"type": "object", "required": nil},
	}})
	if err == nil {
		t.Fatal("accepted a schema with required:null")
	}
}

func TestFlowerToolsFromFloretAcceptsEmptyRequiredArray(t *testing.T) {
	tools, err := flowerToolsFromFloret([]fltools.ToolDefinition{{
		Name:        "valid",
		InputSchema: map[string]any{"type": "object", "required": []string{}},
	}})
	if err != nil {
		t.Fatal(err)
	}
	var schema map[string]any
	if err := json.Unmarshal(tools[0].InputSchema, &schema); err != nil {
		t.Fatal(err)
	}
	if _, ok := schema["required"].([]any); !ok {
		t.Fatalf("required = %#v, want array", schema["required"])
	}
}
