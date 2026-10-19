package threadstore

import (
	"errors"
	"path/filepath"
	"testing"
)

func TestConversationPreferencesPersistIsolateAndRejectStaleWrites(t *testing.T) {
	path := filepath.Join(t.TempDir(), "product.sqlite")
	store, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	scope := ConversationPreferenceScope{NamespacePublicID: "ns", EndpointID: "env", UserPublicID: "alice"}
	empty, err := store.GetConversationPreferences(t.Context(), scope)
	if err != nil || empty.Revision != 0 {
		t.Fatalf("empty=%+v err=%v", empty, err)
	}
	model, directory := "provider/model-a", "/project-a"
	first, err := store.PatchConversationPreferences(t.Context(), scope, ConversationPreferencePatch{ExpectedRevision: 0, ModelID: &model})
	if err != nil {
		t.Fatal(err)
	}
	second, err := store.PatchConversationPreferences(t.Context(), scope, ConversationPreferencePatch{ExpectedRevision: first.Revision, WorkingDir: &directory, Reasoning: &ModelReasoningPreference{ModelID: "provider/model-b", SelectionJSON: `{"level":"off"}`}})
	if err != nil {
		t.Fatal(err)
	}
	if second.ModelID != model || second.WorkingDir != directory || second.ReasoningByModel["provider/model-b"] != `{"level":"off"}` {
		t.Fatalf("field merge=%+v", second)
	}
	if _, err := store.PatchConversationPreferences(t.Context(), scope, ConversationPreferencePatch{ExpectedRevision: first.Revision, ModelID: &directory}); !errors.Is(err, ErrConversationPreferenceConflict) {
		t.Fatalf("stale write=%v", err)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	got, err := reopened.GetConversationPreferences(t.Context(), scope)
	if err != nil || got.ModelID != model || got.WorkingDir != directory || got.Revision != second.Revision {
		t.Fatalf("restart=%+v err=%v", got, err)
	}
	for _, other := range []ConversationPreferenceScope{
		{NamespacePublicID: "ns", EndpointID: "env", UserPublicID: "bob"},
		{NamespacePublicID: "ns2", EndpointID: "env", UserPublicID: "alice"},
		{NamespacePublicID: "ns", EndpointID: "env2", UserPublicID: "alice"},
	} {
		got, err := reopened.GetConversationPreferences(t.Context(), other)
		if err != nil || got.Revision != 0 || got.ModelID != "" || got.WorkingDir != "" {
			t.Fatalf("isolation=%+v err=%v", got, err)
		}
	}
}
