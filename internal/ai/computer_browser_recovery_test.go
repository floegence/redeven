package ai

import (
	"context"
	"errors"
	"path/filepath"
	"slices"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/browserinstall"
	"github.com/floegence/redeven/internal/browserstore"
	"github.com/floegence/redeven/internal/session"
)

func TestBrowserRecoveryRebuildsOnceAndPreservesSavedTabs(t *testing.T) {
	runtime, meta := browserWorkspaceFixture(t)
	ctx, cancel := context.WithTimeout(t.Context(), 25*time.Second)
	defer cancel()
	owner := browserLibraryOwner(meta)
	if err := runtime.browserStore.PutProfile(ctx, owner, browserstore.Profile{ID: "browser-main", Name: "Default", Kind: browserstore.Managed}); err != nil {
		t.Fatal(err)
	}
	if err := runtime.browserStore.SaveTabs(ctx, owner, "browser-main", []browserstore.Tab{{URL: "about:blank", Title: "Saved", Pinned: true, Selected: true}}); err != nil {
		t.Fatal(err)
	}
	view, err := runtime.OpenBrowserWorkspace(ctx, meta, BrowserWorkspaceRequest{ManagedProfileID: "browser-main"})
	if err != nil {
		t.Fatal(err)
	}
	_ = observeBrowserFixture(t, ctx, runtime, meta, view)
	token, err := runtime.AcquireBrowserViewControl(ctx, meta, view.ID, view.InitialTarget, false, false)
	if err != nil {
		t.Fatal(err)
	}
	oldHost, oldProcess := runtime.browserHost, runtime.managedProfiles["browser-main"]
	if err := oldHost.cmd.Process.Kill(); err != nil {
		t.Fatal(err)
	}
	<-oldHost.done
	results := make(chan BrowserServiceStatus, 2)
	failures := make(chan error, 2)
	for range 2 {
		go func() {
			status, err := runtime.RecoverBrowser(ctx, meta, view.Generation)
			results <- status
			failures <- err
		}()
	}
	first, second := <-results, <-results
	for range 2 {
		if err := <-failures; err != nil {
			t.Fatal(err)
		}
	}
	if first != second || first.State != "ready" || first.Generation == view.Generation {
		t.Fatalf("recovery identities: %+v %+v", first, second)
	}
	if runtime.browserHost == oldHost || !oldProcess.stopped() {
		t.Fatal("recovery retained old processes")
	}
	currentHost := runtime.browserHost
	if _, err := runtime.RecoverBrowser(ctx, meta, view.Generation); err != nil || runtime.browserHost != currentHost {
		t.Fatal("late recovery restarted the new generation", err)
	}
	if _, err := runtime.OpenBrowserObservation(ctx, meta, view.ID); err == nil {
		t.Fatal("retired view remained observable")
	}
	if err := runtime.ReceiveBrowserView(ctx, meta, view.ID, token, []byte(`{"type":"command","id":9,"action":{"kind":"reload"}}`)); err == nil {
		t.Fatal("retired input token remained usable")
	}
	if _, err := runtime.OpenBrowserView(ctx, meta, BrowserViewRequest{Targets: []string{view.InitialTarget}}); err == nil {
		t.Fatal("retired source remained selectable")
	}
	saved, err := runtime.BrowserLibraryTabs(ctx, meta, "browser-main")
	if err != nil || len(saved) != 1 || !saved[0].Pinned {
		t.Fatalf("recovery erased saved tabs: %+v %v", saved, err)
	}
	reopened, err := runtime.OpenBrowserWorkspace(ctx, meta, BrowserWorkspaceRequest{ManagedProfileID: "browser-main"})
	if err != nil || reopened.Generation != first.Generation || reopened.InitialTarget == view.InitialTarget {
		t.Fatalf("reopen: %+v %v", reopened, err)
	}
	runtime.browserSourceGenerationEvent(view.Generation, browserHostEvent{Type: "source_closed", Target: reopened.InitialTarget})
	if !slices.Contains(runtime.browserViews[reopened.ID].targets, reopened.InitialTarget) {
		t.Fatal("old event retired a new source")
	}
}

func TestBrowserRecoveryRejectsStaleGenerationAndUnauthorizedRequests(t *testing.T) {
	runtime := NewComputerUseRuntime(NewTargetRegistry(), nil, t.TempDir())
	before := runtime.browserServiceSnapshot()
	meta := &session.Meta{CanRead: true, CanWrite: true, CanExecute: true}
	if _, err := runtime.RecoverBrowser(t.Context(), meta, "old"); !errors.Is(err, errBrowserGenerationChanged) {
		t.Fatalf("stale recovery: %v", err)
	}
	if _, err := runtime.RecoverBrowser(t.Context(), &session.Meta{CanRead: true}, before.Generation); err == nil {
		t.Fatal("read-only session admitted recovery")
	}
	if runtime.browserServiceSnapshot() != before || runtime.browserRecovery != nil {
		t.Fatal("rejected request changed browser service")
	}
}

func TestBrowserRecoveryPreservesUnresolvedExternalPrivacy(t *testing.T) {
	executor := NewPlaywrightTargetExecutor("/fixture/node", "/fixture/helper", "/fixture/profile")
	executor.CDPURL = "http://127.0.0.1:12345"
	runtime := NewComputerUseRuntime(NewTargetRegistry(), map[string]TargetToolExecutor{"external": executor}, t.TempDir())
	control := runtime.controlForTarget("external")
	control.browser = &browserTargetLease{private: true}
	before := runtime.browserServiceSnapshot()
	_, err := runtime.RecoverBrowser(t.Context(), &session.Meta{CanRead: true, CanWrite: true, CanExecute: true}, before.Generation)
	if !errors.Is(err, errBrowserRecoveryBlocked) {
		t.Fatalf("private recovery admitted: %v", err)
	}
	if runtime.browserRecovery != nil || runtime.browserServiceSnapshot() != before || control.browser == nil {
		t.Fatal("rejected recovery removed the privacy reservation")
	}
}

func TestBrowserRecoveryPreservesOrphanedExternalPrivacy(t *testing.T) {
	runtime := NewComputerUseRuntime(NewTargetRegistry(), nil, t.TempDir())
	control := runtime.controlForTarget("closed-private-opener")
	control.browser = &browserTargetLease{private: true}
	_, err := runtime.RecoverBrowser(t.Context(), &session.Meta{CanRead: true, CanWrite: true, CanExecute: true}, runtime.browserServiceSnapshot().Generation)
	if !errors.Is(err, errBrowserRecoveryBlocked) {
		t.Fatalf("retired opener lost its descendant barrier: %v", err)
	}
}

func TestBrowserRecoveryDoesNotReviveFlowerInitialTarget(t *testing.T) {
	runtime, meta := browserWorkspaceFixture(t)
	ctx, cancel := context.WithTimeout(t.Context(), 20*time.Second)
	defer cancel()
	target, err := runtime.registry.ResolveTarget(ctx, "browser-main")
	if err != nil {
		t.Fatal(err)
	}
	target, err = runtime.PrepareTarget(ctx, target)
	if err != nil {
		t.Fatal(err)
	}
	generation := runtime.browserServiceSnapshot().Generation
	if err := runtime.browserHost.cmd.Process.Kill(); err != nil {
		t.Fatal(err)
	}
	<-runtime.browserHost.done
	if _, err := runtime.RecoverBrowser(ctx, meta, generation); err != nil {
		t.Fatal(err)
	}
	if prepared, err := runtime.PrepareTarget(ctx, target); err != nil || prepared.Ready || prepared.State != "connection_required" {
		t.Fatalf("old Flower binding must require explicit reconnection: %+v %v", prepared, err)
	}
	if len(runtime.managedProfiles) != 0 {
		t.Fatal("old binding relaunched the browser")
	}
	if _, err := runtime.OpenBrowserWorkspace(ctx, meta, BrowserWorkspaceRequest{ManagedProfileID: "browser-main"}); err != nil {
		t.Fatal("explicit workspace open unavailable", err)
	}
}

func TestBrowserRecoveryRejectsLateHostEvents(t *testing.T) {
	runtime := NewComputerUseRuntime(NewTargetRegistry(), nil, t.TempDir())
	status := runtime.browserServiceSnapshot()
	runtime.browserHostStopped("retired")
	runtime.browserSourceGenerationEvent("retired", browserHostEvent{Type: "source_closed", Target: "browser-main"})
	if runtime.browserServiceSnapshot() != status {
		t.Fatal("retired host changed the current generation")
	}
}

func TestBrowserRecoveryFailureNeverPublishesPartialReadiness(t *testing.T) {
	runtime, meta := browserWorkspaceFixture(t)
	view, err := runtime.OpenBrowserWorkspace(t.Context(), meta, BrowserWorkspaceRequest{ManagedProfileID: "browser-main"})
	if err != nil {
		t.Fatal(err)
	}
	old := runtime.browserHost
	if err := old.cmd.Process.Kill(); err != nil {
		t.Fatal(err)
	}
	<-old.done
	base := runtime.executors["browser-main"].(*PlaywrightTargetExecutor)
	node := base.NodeBinary
	base.NodeBinary = filepath.Join(t.TempDir(), "missing-node")
	failed, err := runtime.RecoverBrowser(t.Context(), meta, view.Generation)
	if err == nil || failed.State != "failed" || failed.Generation == view.Generation || runtime.browserHost != nil {
		t.Fatalf("failed recovery published readiness: %+v %v", failed, err)
	}
	if len(runtime.managedProfiles) != 0 || len(runtime.browserViews) != 0 {
		t.Fatal("failed recovery retained old process or view authority")
	}
	base.NodeBinary = node
	if duplicate, err := runtime.RecoverBrowser(t.Context(), meta, view.Generation); err == nil || duplicate != failed {
		t.Fatal("late failed-generation request restarted the service")
	}
	if ready, err := runtime.RecoverBrowser(t.Context(), meta, failed.Generation); err != nil || ready.State != "ready" || ready.Generation == failed.Generation {
		t.Fatalf("explicit retry failed: %+v %v", ready, err)
	}
}

func TestBrowserManagedProcessFailureRequiresExplicitRecovery(t *testing.T) {
	runtime, meta := browserWorkspaceFixture(t)
	view, err := runtime.OpenBrowserWorkspace(t.Context(), meta, BrowserWorkspaceRequest{ManagedProfileID: "browser-main"})
	if err != nil {
		t.Fatal(err)
	}
	process := runtime.managedProfiles["browser-main"]
	if err := process.cmd.Process.Kill(); err != nil {
		t.Fatal(err)
	}
	<-process.done
	deadline := time.After(2 * time.Second)
	for runtime.browserServiceSnapshot().State != "failed" {
		select {
		case <-deadline:
			t.Fatal("managed process failure did not mark the service failed")
		case <-time.After(time.Millisecond):
		}
	}
	if _, err := runtime.OpenBrowserWorkspace(t.Context(), meta, BrowserWorkspaceRequest{ManagedProfileID: "browser-main"}); !errors.Is(err, errBrowserHostFailed) {
		t.Fatalf("failed process silently restarted: %v", err)
	}
	if _, err := runtime.RecoverBrowser(t.Context(), meta, view.Generation); err != nil {
		t.Fatal(err)
	}
}

func TestBrowserFailureCodesPreserveActionableReasons(t *testing.T) {
	for _, test := range []struct {
		err  error
		code string
	}{
		{browserinstall.ErrInstallRequired, "BROWSER_INSTALL_REQUIRED"},
		{browserinstall.ErrDisabled, "BROWSER_DISABLED"},
		{errBrowserHostFailed, "BROWSER_SERVICE_FAILED"},
		{errBrowserRecoveryBlocked, "BROWSER_RECOVERY_BLOCKED"},
		{context.DeadlineExceeded, "BROWSER_OPEN_TIMEOUT"},
		{errors.New("secret page data"), "BROWSER_OPEN_FAILED"},
	} {
		if actual := BrowserErrorCode(test.err); actual != test.code {
			t.Fatalf("code: %s, want %s", actual, test.code)
		}
	}
}
