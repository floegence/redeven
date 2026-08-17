package threadstore

import (
	"context"
	"errors"
	"path/filepath"
	"testing"
)

func TestAdoptCanonicalRootSettingsIsExactAndIdempotent(t *testing.T) {
	store, err := Open(filepath.Join(t.TempDir(), "threads.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	settings := ThreadSettings{
		ThreadID: "thread_orphan", EndpointID: "env_a", NamespacePublicID: "ns_a", ModelID: "provider/model",
		ReasoningSelectionJSON: `{"level":"high"}`,
		PermissionType:         "approval_required", WorkingDir: t.TempDir(), CreatedByUserPublicID: "operator_a",
		UpdatedByUserPublicID: "operator_a",
	}
	if err := store.AdoptCanonicalRootSettings(context.Background(), settings); err != nil {
		t.Fatalf("first adoption: %v", err)
	}
	retry := settings
	retry.CreatedByUserPublicID = "operator_b"
	retry.UpdatedByUserPublicID = "operator_b"
	if err := store.AdoptCanonicalRootSettings(context.Background(), retry); err != nil {
		t.Fatalf("idempotent retry: %v", err)
	}
	conflict := settings
	conflict.EndpointID = "env_b"
	if err := store.AdoptCanonicalRootSettings(context.Background(), conflict); !errors.Is(err, ErrCanonicalThreadSettingsConflict) {
		t.Fatalf("cross-endpoint conflict = %v", err)
	}
	reasoningConflict := settings
	reasoningConflict.ReasoningSelectionJSON = `{"level":"low"}`
	if err := store.AdoptCanonicalRootSettings(context.Background(), reasoningConflict); !errors.Is(err, ErrCanonicalThreadSettingsConflict) {
		t.Fatalf("reasoning conflict = %v", err)
	}
	loaded, err := store.GetThreadSettingsByCanonicalThreadID(context.Background(), settings.ThreadID)
	if err != nil || loaded == nil || loaded.EndpointID != settings.EndpointID || loaded.CreatedByUserPublicID != "operator_a" || loaded.ReasoningSelectionJSON != settings.ReasoningSelectionJSON {
		t.Fatalf("stored adoption = %#v, %v", loaded, err)
	}
}
