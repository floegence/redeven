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
		PermissionType:         "approval_required", WorkingDir: t.TempDir(),
	}
	if err := store.AdoptCanonicalRootSettings(context.Background(), settings); err != nil {
		t.Fatalf("first adoption: %v", err)
	}
	retry := settings
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
	if err != nil || loaded == nil || loaded.EndpointID != settings.EndpointID || loaded.ReasoningSelectionJSON != settings.ReasoningSelectionJSON {
		t.Fatalf("stored adoption = %#v, %v", loaded, err)
	}
}

func TestCanonicalForkPublicationRollsBackWithoutUploadRetention(t *testing.T) {
	store, err := Open(filepath.Join(t.TempDir(), "threads.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	settings := ThreadSettings{ThreadID: "thread_fork", EndpointID: "env_a", NamespacePublicID: "ns_a", ModelID: "provider/model", PermissionType: "full_access", WorkingDir: t.TempDir()}
	if err := store.AdoptCanonicalRootWithUploads(t.Context(), settings, []string{"upl_missing"}); err == nil {
		t.Fatal("published incomplete fork")
	}
	got, err := store.GetThreadSettingsByCanonicalThreadID(t.Context(), settings.ThreadID)
	if err != nil || got != nil {
		t.Fatalf("failed publication retained settings: %+v %v", got, err)
	}
	if err := store.AdoptCanonicalRootWithUploads(t.Context(), settings, nil); err != nil {
		t.Fatal(err)
	}
}
