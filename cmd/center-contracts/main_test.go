package main

import (
	"reflect"
	"testing"
)

func TestGeneratedContractRetainsSemanticBounds(t *testing.T) {
	type bounded struct {
		State    string `json:"state" enum:"connecting,ready,failed,canceled"`
		Sequence int64  `json:"sequence" minimum:"0"`
	}
	got := contract(reflect.TypeOf(bounded{}))
	properties := got.schema["properties"].(map[string]any)
	state := properties["state"].(map[string]any)
	if !reflect.DeepEqual(state["enum"], []string{"connecting", "ready", "failed", "canceled"}) {
		t.Fatal("wire contract discarded enum values")
	}
	sequence := properties["sequence"].(map[string]any)
	if sequence["minimum"] != int64(0) || sequence["maximum"] != int64(9007199254740991) {
		t.Fatal("wire contract discarded revision bounds")
	}
	if got.ts != `{ state: "connecting" | "ready" | "failed" | "canceled"; sequence: number }` {
		t.Fatal("TypeScript permits undeclared owner states", got.ts)
	}
}
