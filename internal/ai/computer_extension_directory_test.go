package ai

import (
	"encoding/json"
	"testing"
)

func TestExtensionDirectoryOrdersNativeUpdatesAndRejectsGaps(t *testing.T) {
	client := &computerExtensionClient{}
	apply := func(body string) bool { return client.applyDirectory(json.RawMessage(body)) }
	if !apply(`{"revision":1,"tabs":[{"id":"7","native_target_id":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","title":"Initial","url":"https://example.test/"}]}`) {
		t.Fatal("initial snapshot rejected")
	}
	if !apply(`{"revision":2,"upsert":[{"id":"8","native_target_id":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","url":"chrome://settings/","availability":"unsupported"}],"removed":[],"order":["8","7"]}`) {
		t.Fatal("ordered update rejected")
	}
	tabs, err := client.directorySnapshot()
	if err != nil || len(tabs) != 2 || tabs[0].ID != "8" || tabs[1].Title != "Initial" {
		t.Fatalf("invalid directory: %#v, %v", tabs, err)
	}
	if apply(`{"revision":4,"upsert":[],"removed":[],"order":["8","7"]}`) {
		t.Fatal("revision gap accepted")
	}
	if apply(`{"revision":3,"upsert":[],"removed":["7"],"order":["8","8"]}`) {
		t.Fatal("duplicate identity accepted")
	}
	if !apply(`{"revision":3,"upsert":[],"removed":["7"],"order":["8"]}`) {
		t.Fatal("valid update after rejected input was lost")
	}
	tabs, _ = client.directorySnapshot()
	if len(tabs) != 1 || tabs[0].ID != "8" {
		t.Fatal("native removal did not update the directory")
	}
}
