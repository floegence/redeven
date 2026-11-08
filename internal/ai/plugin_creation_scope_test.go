package ai

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/floegence/floret/v7/identity"
	flruntime "github.com/floegence/floret/v7/runtime"
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
	// Dedicated conversations remain readable by their canvas, but never enter
	// the ordinary paginated list or live sidebar baseline.
	ordinary, err := svc.CreateThread(t.Context(), meta, "Ordinary conversation", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.threadsDB.SetThreadPinned(t.Context(), meta.EndpointID, resumed.ThreadID, true); err != nil {
		t.Fatal(err)
	}
	page, err := svc.ListThreads(t.Context(), meta, 1, "")
	if err != nil || len(page.Threads) != 1 || page.Threads[0].ThreadID != ordinary.ThreadID || page.NextCursor != "" {
		t.Fatalf("ordinary list leaked or skipped a thread: %+v %v", page, err)
	}
	if _, err := svc.GetThread(t.Context(), meta, resumed.ThreadID); err != nil {
		t.Fatal(err)
	}
	baseline, err := svc.listFlowerLiveBaseline(t.Context(), meta)
	if err != nil || len(baseline) != 1 || baseline[0].ThreadID != ordinary.ThreadID {
		t.Fatalf("baseline: %+v %v", baseline, err)
	}
	host, err := svc.bindRunHostCapabilities(meta.EndpointID, resumed.ThreadID)
	if err != nil {
		t.Fatal(err)
	}
	r := newRun(runOptions{StateDir: svc.stateDir, TaskFiles: &svc.taskFiles, AgentHomeDir: svc.agentHomeDir, WorkingDir: source.Directory, FilesystemScope: svc.scope, HostCapabilities: host, ThreadID: resumed.ThreadID, SessionMeta: meta, EndpointID: meta.EndpointID})
	ordinaryRun := newRun(runOptions{AgentHomeDir: svc.agentHomeDir, WorkingDir: svc.agentHomeDir, SessionMeta: meta})
	ordinaryRun.ensureSkillManager().userHome = t.TempDir()
	contextSnapshot, err := ordinaryRun.collectModelContextSnapshot(t.Context(), FlowerPermissionFullAccess, time.Now)
	if err != nil {
		t.Fatal(err)
	}
	for _, section := range contextSnapshot.Sections {
		if section.Key == "skills" && strings.Contains(section.Text, "redeven-plugin-authoring") {
			t.Fatal("ordinary model context advertises plugin authoring")
		}
	}
	activationContext := contextWithToolAuthorizationSnapshot(t.Context(), PermissionSnapshot{SnapshotID: "authoring", PermissionType: FlowerPermissionFullAccess})
	if _, _, err := ordinaryRun.activateSkill(activationContext, "redeven-plugin-authoring"); err == nil {
		t.Fatal("ordinary run activated dedicated authoring skill")
	}
	assertAuthorTools := func(run *run, want int) {
		t.Helper()
		registry := NewInMemoryToolRegistry()
		if err := registerBuiltInTools(registry, run); err != nil {
			t.Fatal(err)
		}
		count := 0
		for _, def := range registry.Snapshot() {
			if strings.HasPrefix(def.Name, "plugin_author.") {
				count++
			}
		}
		if count != want {
			t.Fatalf("author tools=%d want=%d", count, want)
		}
	}
	assertAuthorTools(ordinaryRun, 0)
	assertAuthorTools(r, 5)
	r.ensureSkillManager().userHome = t.TempDir()
	contextSnapshot, err = r.collectModelContextSnapshot(t.Context(), FlowerPermissionFullAccess, time.Now)
	if err != nil || !strings.Contains(modelContextSnapshotText(contextSnapshot), pluginAuthoringSkillName) {
		t.Fatalf("dedicated catalog: %v", err)
	}
	if _, _, err := r.activateSkill(activationContext, "redeven-plugin-authoring"); err != nil {
		t.Fatal(err)
	}
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
	assertAuthorTools(r, 0)
	if _, _, err := r.activateSkill(activationContext, pluginAuthoringSkillName); err == nil {
		t.Fatal("foreign owner loaded authoring skill")
	}
	if _, err = r.runPathScope(); !errors.Is(err, plugincreation.ErrNotFound) {
		t.Fatalf("foreign owner: %v", err)
	}
	r.sessionMeta = meta
	deleting, err := store.BeginDelete(t.Context(), owner, draft.ID, again.Revision)
	if err != nil {
		t.Fatal(err)
	}
	assertAuthorTools(r, 0)
	if _, _, err := r.activateSkill(activationContext, pluginAuthoringSkillName); err == nil {
		t.Fatal("deleting project loaded authoring skill")
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

func TestPluginDraftRecoversOwnershipBeforeSettingsAdmission(t *testing.T) {
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
	owner, _ := plugincreation.OwnerFromSession(meta)
	draft, err := product.Create(t.Context(), meta, "crash-project")
	if err != nil {
		t.Fatal(err)
	}
	source, err := product.SourceScope(t.Context(), meta, draft.ID)
	if err != nil {
		t.Fatal(err)
	}
	request := CreateThreadRequest{ClientRequestID: "crash-launch", WorkingDir: source.Directory}
	raw, _ := json.Marshal(request)
	draft, err = store.FreezeLaunch(t.Context(), owner, draft.ID, request.ClientRequestID, string(raw))
	if err != nil {
		t.Fatal(err)
	}
	canonical, err := svc.threadRuntime.Create(t.Context(), flruntime.CreateThreadInput{RequestKey: flruntime.RequestKey(request.ClientRequestID)})
	if err != nil {
		t.Fatal(err)
	}
	draft, err = store.BindThread(t.Context(), owner, draft.ID, request.ClientRequestID, canonical.ThreadID.String())
	if err != nil {
		t.Fatal(err)
	}
	// Simulate interruption after durable ownership and before settings adoption.
	recovered, err := svc.ResumePluginDraft(t.Context(), meta, draft.ID)
	if err != nil || recovered.ThreadID != canonical.ThreadID.String() {
		t.Fatalf("recovery: %+v %v", recovered, err)
	}
	if _, err := svc.GetThread(t.Context(), meta, recovered.ThreadID); err != nil {
		t.Fatal(err)
	}
	page, err := svc.ListThreads(t.Context(), meta, 25, "")
	if err != nil || len(page.Threads) != 0 {
		t.Fatalf("recovered project leaked: %+v %v", page, err)
	}
	deleted, err := svc.DeletePluginDraft(t.Context(), meta, draft.ID, recovered.Revision)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.DeletePluginDraft(t.Context(), meta, draft.ID, deleted.Revision); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.threadRuntime.View(t.Context(), identity.ThreadID(recovered.ThreadID)); !errors.Is(err, flruntime.ErrThreadDeleted) && !errors.Is(err, flruntime.ErrThreadNotFound) {
		t.Fatalf("deleted thread returned: %v", err)
	}
}
