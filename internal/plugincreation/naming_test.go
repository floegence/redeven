package plugincreation

import (
	"context"
	"errors"
	"path/filepath"
	"strings"
	"testing"

	"github.com/floegence/redeven/internal/session"
)

type namingBackend struct{ onInitialize func() }

func (namingBackend) CreateWorkspace(context.Context, *session.Meta, string) (string, error) {
	return "workspace", nil
}
func (namingBackend) SourceScope(context.Context, *session.Meta, string) (SourceScope, error) {
	return SourceScope{}, nil
}
func (namingBackend) RemoveWorkspace(context.Context, *session.Meta, string) error { return nil }
func (b namingBackend) AuthorOperation(_ context.Context, _ *session.Meta, _ string, operation string, _ map[string]any) (any, error) {
	if operation == "initialize" && b.onInitialize != nil {
		b.onInitialize()
	}
	return map[string]any{"workspace": "workspace"}, nil
}
func (namingBackend) ProjectPresentation(context.Context, *session.Meta, string) (string, string, error) {
	return "Generated timer", "/verified/icon", nil
}

func TestDraftNamesFollowGenerationAndAuthorizedConversation(t *testing.T) {
	store, err := Open(filepath.Join(t.TempDir(), "drafts.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	svc := New(store)
	svc.SetBackend(namingBackend{})
	meta := &session.Meta{UserPublicID: "user", EndpointID: "env", CanRead: true, CanWrite: true, CanExecute: true}
	owner, _ := OwnerFromSession(meta)
	d, err := svc.Create(t.Context(), meta, "request")
	if err != nil {
		t.Fatal(err)
	}
	d, err = store.FreezeLaunch(t.Context(), owner, d.ID, "turn", "{}")
	if err != nil {
		t.Fatal(err)
	}
	d, err = store.BindThread(t.Context(), owner, d.ID, "turn", "thread")
	if err != nil {
		t.Fatal(err)
	}
	if shown := svc.PresentDraft(t.Context(), meta, d); shown.Title != "Generated timer" {
		t.Fatal(shown.Title)
	}
	stored, _ := store.Get(t.Context(), owner, d.ID)
	if stored.Title != "" || stored.Revision != d.Revision {
		t.Fatal("read-only projection changed draft")
	}
	_, err = svc.AuthorOperation(t.Context(), meta, "thread", "initialize", map[string]any{"display_name": "Focus timer"})
	if err != nil {
		t.Fatal(err)
	}
	d, _ = store.Get(t.Context(), owner, d.ID)
	if d.Title != "Focus timer" {
		t.Fatalf("generated name missing: %+v", d)
	}
	_, err = svc.AuthorOperation(t.Context(), meta, "thread", "rename", map[string]any{"title": "Daily focus", "revision": float64(d.Revision)})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = svc.AuthorOperation(t.Context(), meta, "thread", "rename", map[string]any{"title": "Stale overwrite", "revision": float64(d.Revision)}); !errors.Is(err, ErrConflict) {
		t.Fatalf("stale rename: %v", err)
	}
	d, _ = store.Get(t.Context(), owner, d.ID)
	if shown := svc.PresentDraft(t.Context(), meta, d); shown.Title != "Daily focus" || shown.IconURL != "/verified/icon" {
		t.Fatal("explicit title replaced")
	}
	if d.Title != "Daily focus" {
		t.Fatal(d.Title)
	}
	for _, args := range []map[string]any{
		{"title": " ", "revision": float64(d.Revision)},
		{"title": strings.Repeat("x", 121), "revision": float64(d.Revision)},
		{"title": "Invalid revision", "revision": 1.5},
		{"title": "Invalid revision", "revision": "1"},
		{"title": "Invalid revision", "revision": float64(0)},
		{"title": "Invalid target", "revision": float64(d.Revision), "workspace_id": "foreign"},
	} {
		if _, err = svc.AuthorOperation(t.Context(), meta, "thread", "rename", args); !errors.Is(err, ErrInvalid) {
			t.Fatalf("invalid rename accepted: %v", err)
		}
	}
	unchanged, _ := store.Get(t.Context(), owner, d.ID)
	if unchanged.Title != d.Title || unchanged.Revision != d.Revision {
		t.Fatal("invalid rename changed the project")
	}
	other := *meta
	other.UserPublicID = "other"
	if _, err = svc.AuthorOperation(t.Context(), &other, "thread", "rename", map[string]any{"title": "Wrong owner", "revision": float64(d.Revision)}); !errors.Is(err, ErrNotFound) {
		t.Fatal(err)
	}
	readonly := *meta
	readonly.CanWrite = false
	if _, err = svc.AuthorOperation(t.Context(), &readonly, "thread", "rename", map[string]any{"title": "Read only", "revision": float64(d.Revision)}); !errors.Is(err, ErrNotFound) {
		t.Fatal(err)
	}
	// Source initialization must not overwrite a name entered while it runs.
	d, err = store.Rename(t.Context(), owner, d.ID, d.Revision, "")
	if err != nil {
		t.Fatal(err)
	}
	svc.SetBackend(namingBackend{onInitialize: func() {
		if _, err := store.Rename(t.Context(), owner, d.ID, d.Revision, "User-selected name"); err != nil {
			t.Fatal(err)
		}
	}})
	if _, err = svc.AuthorOperation(t.Context(), meta, "thread", "initialize", map[string]any{"display_name": strings.Repeat("x", 121)}); !errors.Is(err, ErrInvalid) {
		t.Fatal("invalid name reached source initialization", err)
	}
	unchanged, _ = store.Get(t.Context(), owner, d.ID)
	if unchanged.Revision != d.Revision {
		t.Fatal("invalid initialization invoked the backend")
	}
	if _, err = svc.AuthorOperation(t.Context(), meta, "thread", "initialize", map[string]any{"display_name": "Generated replacement"}); err != nil {
		t.Fatal(err)
	}
	d, _ = store.Get(t.Context(), owner, d.ID)
	if d.Title != "User-selected name" {
		t.Fatal("initialization replaced the user's concurrent name")
	}
}
