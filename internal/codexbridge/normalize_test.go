package codexbridge

import (
	"encoding/json"
	"testing"
)

func TestNormalizeItem_UsesContentTextWhenDirectTextMissing(t *testing.T) {
	t.Parallel()

	item := normalizeItem(wireThreadItem{
		ID:   "item_1",
		Type: "userMessage",
		Content: []wireUserInput{
			{Type: "text", Text: "first line"},
			{Type: "local_image", Path: "/tmp/image.png"},
			{Type: "text", Text: "second line"},
		},
	})

	if item.Text != "first line\n\n/tmp/image.png\n\nsecond line" {
		t.Fatalf("Text=%q", item.Text)
	}
	if len(item.Inputs) != 3 {
		t.Fatalf("Inputs len=%d, want=3", len(item.Inputs))
	}
}

func TestNormalizeAvailableDecisions_DeduplicatesAndNormalizesValues(t *testing.T) {
	t.Parallel()

	raw := []json.RawMessage{
		json.RawMessage(`"accept"`),
		json.RawMessage(`"acceptForSession"`),
		json.RawMessage(`"decline"`),
		json.RawMessage(`{"acceptWithExecpolicyAmendment":{}}`),
		json.RawMessage(`"accept"`),
		json.RawMessage(`"cancel"`),
	}

	got := normalizeAvailableDecisions(raw)
	want := []string{"accept", "accept_for_session", "decline", "cancel"}
	if len(got) != len(want) {
		t.Fatalf("len(got)=%d, want=%d; got=%v", len(got), len(want), got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("got[%d]=%q, want=%q (all=%v)", i, got[i], want[i], got)
		}
	}
}

func TestNormalizePermissionProfile_ReturnsNilWhenEmpty(t *testing.T) {
	t.Parallel()

	if got := normalizePermissionProfile(&wirePermissionProfile{}); got != nil {
		t.Fatalf("expected nil profile, got=%+v", got)
	}

	enabled := true
	got := normalizePermissionProfile(&wirePermissionProfile{
		Network: &wireAdditionalNetworkPermissions{Enabled: &enabled},
		FileSystem: &wireAdditionalFileSystemPermissions{
			Read:  []string{"/workspace/readme.md"},
			Write: []string{"/workspace"},
		},
	})
	if got == nil {
		t.Fatalf("expected non-nil profile")
	}
	if len(got.FileSystemRead) != 1 || got.FileSystemRead[0] != "/workspace/readme.md" {
		t.Fatalf("unexpected read permissions: %+v", got.FileSystemRead)
	}
	if len(got.FileSystemWrite) != 1 || got.FileSystemWrite[0] != "/workspace" {
		t.Fatalf("unexpected write permissions: %+v", got.FileSystemWrite)
	}
	if got.NetworkEnabled == nil || !*got.NetworkEnabled {
		t.Fatalf("expected network_enabled=true, got=%v", got.NetworkEnabled)
	}
}
