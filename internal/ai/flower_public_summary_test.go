package ai

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	flruntime "github.com/floegence/floret/v7/runtime"
)

func TestFlowerPublicSummaryCarriesShapeWithoutRepeatedBodyLocators(t *testing.T) {
	source := &flruntime.ThreadActivitySummary{
		Version: "canonical-version", Label: "Tool result", Renderer: "terminal",
		Values: map[string]json.RawMessage{"/payload/status": json.RawMessage("\"complete\"")},
		Fields: []flruntime.ThreadActivityField{
			{Path: "/payload/output", Kind: "string", Bytes: 8 << 20, EntryID: "canonical-entry", SourcePath: "/payload/output", SourceSHA256: strings.Repeat("a", 64)},
			{Path: "/payload/rows", Kind: "array", Count: 4096, EntryID: "canonical-entry", SourceSHA256: strings.Repeat("a", 64)},
			{Path: "/payload/exit_code", Kind: "scalar", Value: json.RawMessage("0"), EntryID: "canonical-entry"},
			{Path: "/payload/status", Kind: "string", Bytes: 8, EntryID: "canonical-entry"},
		},
	}
	before, err := json.Marshal(source)
	if err != nil {
		t.Fatal(err)
	}
	projected := publicFlowerActivitySummary(source)
	want := []flruntime.ThreadActivityField{
		{Path: "/payload/output", Kind: "string", Bytes: 8 << 20},
		{Path: "/payload/rows", Kind: "array", Count: 4096},
		{Path: "/payload/exit_code", Kind: "scalar", Value: json.RawMessage("0")},
		{Path: "/payload/status", Kind: "string", Bytes: 8},
	}
	if !reflect.DeepEqual(projected.Fields, want) || projected.Version != source.Version || !reflect.DeepEqual(projected.Values, source.Values) {
		t.Fatalf("summary must preserve exact shape and display facts: %+v", projected)
	}
	after, _ := json.Marshal(source)
	if string(before) != string(after) {
		t.Fatal("projection mutated canonical source")
	}
	wire, _ := json.Marshal(projected)
	if strings.Contains(string(wire), "canonical-entry") || strings.Contains(string(wire), "source_sha256") {
		t.Fatal("collapsed summary repeated detail-only source locators")
	}
	if publicFlowerActivitySummary(nil) != nil {
		t.Fatal("nil summary must remain absent")
	}
	item := flruntime.ThreadItem{ID: "tool", Kind: flruntime.ThreadItemTool, Ordinal: 1, ActivitySummary: source}
	canonical, _ := json.Marshal(item)
	public, err := projectFlowerWindowItem(item, "thread", nil)
	if err != nil || public.WindowBytes != len(canonical) {
		t.Fatalf("compaction lost canonical selection cost: %d, %v", public.WindowBytes, err)
	}
	item.ActivitySummary.Values["invalid"] = json.RawMessage("invalid JSON")
	if _, err := projectFlowerWindowItem(item, "thread", nil); err == nil {
		t.Fatal("invalid canonical metadata must not publish a cost")
	}
}
