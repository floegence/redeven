package ai

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/floegence/redeven/internal/filesystemscope"
	"github.com/floegence/redeven/internal/plugincreation"
	"github.com/floegence/redeven/internal/session"
)

type pluginScopeBackend struct{ root string }

func (b pluginScopeBackend) CreateWorkspace(_ context.Context, _ *session.Meta, id string) (string, error) {
	return id, os.MkdirAll(filepath.Join(b.root, id, "source"), 0700)
}
func (b pluginScopeBackend) SourceScope(_ context.Context, _ *session.Meta, id string) (plugincreation.SourceScope, error) {
	return plugincreation.SourceScope{PrivateRoot: b.root, Directory: filepath.Join(b.root, id, "source")}, nil
}
func (b pluginScopeBackend) RemoveWorkspace(_ context.Context, _ *session.Meta, id string) error {
	return os.RemoveAll(filepath.Join(b.root, id))
}
func (b pluginScopeBackend) AuthorOperation(context.Context, *session.Meta, string, string, map[string]any) (any, error) {
	return nil, nil
}

func TestPluginDraftManagedSourceAdmissionRecoveryAndScope(t *testing.T) {
	svc := newWorkingDirTestService(t, t.TempDir())
	store, err := plugincreation.Open(filepath.Join(t.TempDir(), "drafts.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	product := plugincreation.New(store)
	product.SetBackend(pluginScopeBackend{root})
	svc.pluginCreation = product
	meta := workingDirTestMeta()
	owner, err := plugincreation.OwnerFromSession(meta)
	if err != nil {
		t.Fatal(err)
	}
	draft, err := product.Create(t.Context(), meta, "draft-request")
	if err != nil {
		t.Fatal(err)
	}
	sibling, err := product.Create(t.Context(), meta, "sibling-request")
	if err != nil {
		t.Fatal(err)
	}
	source, err := product.SourceScope(t.Context(), meta, draft.ID)
	if err != nil {
		t.Fatal(err)
	}
	// An arbitrary create request cannot claim managed source authority.
	req := CreateThreadRequest{ClientRequestID: "managed-create", WorkingDir: source.Directory}
	if _, err = svc.buildThreadCreateSettings(t.Context(), meta, req); err == nil {
		t.Fatal("unbound create admitted private source")
	}
	req.managedSource = &source
	settings, err := svc.buildThreadCreateSettings(t.Context(), meta, req)
	if err != nil || settings.WorkingDir != source.Directory {
		t.Fatalf("managed source admission: %+v %v", settings, err)
	}
	snapshot, err := json.Marshal(req)
	if err != nil {
		t.Fatal(err)
	}
	draft, err = store.FreezeLaunch(t.Context(), owner, draft.ID, req.ClientRequestID, string(snapshot))
	if err != nil {
		t.Fatal(err)
	}
	resumed, err := svc.ResumePluginDraft(t.Context(), meta, draft.ID)
	if err != nil {
		t.Fatal(err)
	}
	again, err := svc.ResumePluginDraft(t.Context(), meta, draft.ID)
	if err != nil || resumed.ThreadID == "" || resumed.ThreadID != again.ThreadID {
		t.Fatalf("resume identity: %+v %v", again, err)
	}
	host, err := svc.bindRunHostCapabilities(meta.EndpointID, resumed.ThreadID)
	if err != nil {
		t.Fatal(err)
	}
	r := newRun(runOptions{StateDir: svc.stateDir, TaskFiles: &svc.taskFiles, AgentHomeDir: svc.agentHomeDir, WorkingDir: source.Directory, FilesystemScope: svc.scope, HostCapabilities: host, ThreadID: resumed.ThreadID, SessionMeta: meta, EndpointID: meta.EndpointID})
	scope, err := r.runPathScope()
	if err != nil {
		t.Fatal(err)
	}
	if _, err = scope.ResolveTargetPath("ui/new.ts"); err != nil {
		t.Fatal(err)
	}
	task, err := r.prepareTaskFiles()
	if err != nil {
		t.Fatal(err)
	}
	if _, err = scope.ResolveTargetPath(filepath.Join(task.Root, "result.txt")); err != nil {
		t.Fatal(err)
	}
	other, err := product.SourceScope(t.Context(), meta, sibling.ID)
	if err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{other.Directory, filepath.Dir(source.Directory), root, filepath.Join(filepath.Dir(task.Root), "another-task")} {
		if _, err = scope.ResolveTargetPath(path); !errors.Is(err, filesystemscope.ErrPathOutsideScope) {
			t.Fatalf("private path %s: %v", path, err)
		}
	}
	foreign := *meta
	foreign.UserPublicID = "another-user"
	r.sessionMeta = &foreign
	if _, err = r.runPathScope(); !errors.Is(err, plugincreation.ErrNotFound) {
		t.Fatalf("foreign owner: %v", err)
	}
	r.sessionMeta = meta
	deleting, err := store.BeginDelete(t.Context(), owner, draft.ID, again.Revision)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = r.runPathScope(); !errors.Is(err, plugincreation.ErrDeleting) {
		t.Fatalf("deleted authority: %v", err)
	}
	if _, err = svc.DeletePluginDraft(t.Context(), meta, draft.ID, deleting.Revision); err != nil {
		t.Fatal(err)
	}
	if _, err = os.Stat(source.Directory); !os.IsNotExist(err) {
		t.Fatalf("deleted source remains: %v", err)
	}
	if _, err = os.Stat(other.Directory); err != nil {
		t.Fatalf("sibling removed: %v", err)
	}
	pending, err := product.Create(t.Context(), meta, "discard-pending")
	if err != nil {
		t.Fatal(err)
	}
	pendingSource, err := product.SourceScope(t.Context(), meta, pending.ID)
	if err != nil {
		t.Fatal(err)
	}
	pendingRequest := CreateThreadRequest{ClientRequestID: "discard-pending-create", WorkingDir: pendingSource.Directory}
	raw, err := json.Marshal(pendingRequest)
	if err != nil {
		t.Fatal(err)
	}
	pending, err = store.FreezeLaunch(t.Context(), owner, pending.ID, pendingRequest.ClientRequestID, string(raw))
	if err != nil {
		t.Fatal(err)
	}
	removed, err := svc.DeletePluginDraft(t.Context(), meta, pending.ID, pending.Revision)
	if err != nil || removed.Lifecycle != "deleted" || removed.ThreadID == "" {
		t.Fatalf("pending launch cleanup: %+v %v", removed, err)
	}

}
