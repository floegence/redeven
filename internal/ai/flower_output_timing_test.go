package ai

import (
	"encoding/json"
	flruntime "github.com/floegence/floret/v7/runtime"
	"testing"
	"time"
)

func TestFlowerPublicItemPreservesCanonicalOutputTiming(t *testing.T) {
	start := time.Unix(1700000000, 123456789).UTC()
	end := start.Add(350 * time.Millisecond)
	for _, kind := range []flruntime.ThreadItemKind{flruntime.ThreadItemThinking, flruntime.ThreadItemAssistant} {
		item := projectFlowerItem(flruntime.ThreadItem{ID: "source", Kind: kind, OutputStartedAt: &start, OutputEndedAt: &end}, "thread", nil)
		data, err := json.Marshal(item)
		if err != nil {
			t.Fatal(err)
		}
		var decoded map[string]any
		if err = json.Unmarshal(data, &decoded); err != nil {
			t.Fatal(err)
		}
		if decoded["output_started_at"] != start.Format(time.RFC3339Nano) || decoded["output_ended_at"] != end.Format(time.RFC3339Nano) {
			t.Fatalf("canonical timing omitted: %s", data)
		}
	}
	old := projectFlowerItem(flruntime.ThreadItem{ID: "old", Kind: flruntime.ThreadItemThinking}, "thread", nil)
	data, err := json.Marshal(old)
	if err != nil {
		t.Fatal(err)
	}
	var decoded map[string]any
	if err = json.Unmarshal(data, &decoded); err != nil {
		t.Fatal(err)
	}
	if _, ok := decoded["output_started_at"]; ok {
		t.Fatal("invented old start")
	}
	if _, ok := decoded["output_ended_at"]; ok {
		t.Fatal("invented old end")
	}
}
