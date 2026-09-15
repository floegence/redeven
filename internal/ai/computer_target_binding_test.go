package ai

import (
	"context"
	"errors"
	"path/filepath"
	"testing"

	"github.com/floegence/redeven/internal/ai/threadstore"
)

type bindingTestExecutor struct {
	recordingTargetExecutor
	readinessErr error
}

func (e *bindingTestExecutor) EnsureTargetReady(context.Context, string) error { return e.readinessErr }

func computerBindingFixture(t *testing.T) (*ComputerUseRuntime, *bindingTestExecutor, *threadstore.Store, string) {
	t.Helper()
	registry := NewTargetRegistry()
	executor := &bindingTestExecutor{}
	for _, target := range []TargetDescriptor{
		{ID: "browser-main", Kind: "browser.managed"},
		{ID: "desktop-main", Kind: "desktop.screen"},
	} {
		if err := registry.Register(target); err != nil {
			t.Fatal(err)
		}
	}
	runtime := NewComputerUseRuntime(registry, map[string]TargetToolExecutor{"browser-main": executor, "desktop-main": executor}, t.TempDir())
	t.Cleanup(func() { _ = runtime.Close() })
	path := filepath.Join(t.TempDir(), "threads.sqlite")
	store, err := threadstore.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	runtime.bindings = store
	for _, id := range []string{"thread-first", "thread-second"} {
		if err := store.AdoptCanonicalRootSettings(t.Context(), threadstore.ThreadSettings{ThreadID: id, EndpointID: "env", NamespacePublicID: "ns", ModelID: "deepseek/vision", PermissionType: "full_access", WorkingDir: t.TempDir()}); err != nil {
			t.Fatal(err)
		}
	}

	return runtime, executor, store, path
}

func TestComputerTargetSwitchPersistsOnlyForExecutingThread(t *testing.T) {
	runtime, executor, _, _ := computerBindingFixture(t)
	first := &run{threadID: "thread-first", turnID: "turn-first", id: "run-first", targetResolver: runtime, targetToolExecutor: runtime}
	second := &run{threadID: "thread-second", targetResolver: runtime, targetToolExecutor: runtime}
	for _, step := range []struct {
		run         *run
		alias, want string
	}{
		{first, "current", "browser-main"},
		{first, "desktop.screen", "desktop-main"},
		{first, "current", "desktop-main"},
		{second, "current", "browser-main"},
	} {
		if _, err := step.run.execTargetTool(t.Context(), "call", "computer.screenshot", map[string]any{"target": step.alias}); err != nil {
			t.Fatal(err)
		}
		call := executor.calls[len(executor.calls)-1]
		if call.ThreadID != step.run.threadID || call.TurnID != step.run.turnID || call.RunID != step.run.id || call.ToolCallID != "call" {
			t.Fatalf("lost call provenance: %+v", call)
		}
		if got := executor.calls[len(executor.calls)-1].TargetID; got != step.want {
			t.Fatalf("thread %s target %s resolved to %s, want %s", step.run.threadID, step.alias, got, step.want)
		}
	}
}

func TestComputerTargetBindingRestoresWithoutRestoringReadiness(t *testing.T) {
	runtime, _, store, path := computerBindingFixture(t)
	run := &run{threadID: "thread-first", targetResolver: runtime, targetToolExecutor: runtime}
	if _, err := run.execTargetTool(t.Context(), "select", "computer.screenshot", map[string]any{"target": "desktop.screen"}); err != nil {
		t.Fatal(err)
	}
	if err := runtime.Close(); err != nil {
		t.Fatal(err)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := threadstore.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = reopened.Close() })
	registry := NewTargetRegistry()
	if err := registry.Register(TargetDescriptor{ID: "desktop-main", Kind: "desktop.screen", State: "stopped"}); err != nil {
		t.Fatal(err)
	}
	restored := NewComputerUseRuntime(registry, nil, t.TempDir())
	restored.bindings = reopened
	target, err := restored.ResolveTargetForThread(t.Context(), "thread-first", "current")
	if err != nil || target.ID != "desktop-main" || target.Ready {
		t.Fatalf("restored target=%+v err=%v", target, err)
	}
	if _, err := restored.ResolveTargetForThread(t.Context(), "thread-second", "current"); !errors.Is(err, errTargetNotRegistered) {
		t.Fatalf("another thread inherited desktop: %v", err)
	}
}

func TestComputerTargetRejectedSelectionDoesNotChangeBinding(t *testing.T) {
	for _, reason := range []string{"policy", "readiness", "takeover", "storage", "cancel"} {
		t.Run(reason, func(t *testing.T) {
			runtime, executor, store, _ := computerBindingFixture(t)
			r := &run{threadID: "thread-first", targetResolver: runtime, targetToolExecutor: runtime}
			if _, err := r.execTargetTool(t.Context(), "initial", "computer.screenshot", nil); err != nil {
				t.Fatal(err)
			}
			ctx := t.Context()
			switch reason {
			case "policy":
				r.toolTargetPolicy.AllowedTargetIDs = []string{"browser-main"}
			case "readiness":
				executor.readinessErr = &TargetStartupError{Code: "TARGET_PERMISSION_REQUIRED", Reason: "accessibility_required"}
			case "takeover":
				r.interactionSafetyGate = bindingTakeoverGate{}
			case "storage":
				if err := store.Close(); err != nil {
					t.Fatal(err)
				}
			case "cancel":
				var cancel context.CancelFunc
				ctx, cancel = context.WithCancel(ctx)
				cancel()
			}
			result, err := r.execTargetTool(ctx, "rejected", "computer.click", map[string]any{"target": "desktop.screen", "x": 10, "y": 10})
			if reason == "takeover" {
				paused, ok := result.(targetToolExecution)
				if err != nil || !ok || paused.inputRequired == nil {
					t.Fatalf("takeover did not request canonical input: %v", err)
				}
			} else if err == nil {
				t.Fatal("rejected target action did not fail")
			}
			if len(executor.calls) != 1 {
				t.Fatalf("rejection executed %d actions", len(executor.calls))
			}
			if reason != "storage" {
				target, err := store.GetComputerTarget(t.Context(), "thread-first")
				if err != nil || target != "browser-main" {
					t.Fatalf("rejection changed binding: %s %v", target, err)
				}
			}
		})
	}
}

type bindingTakeoverGate struct{}

func (bindingTakeoverGate) AssessInteraction(context.Context, TargetToolCall, TargetDescriptor) (InteractionSafetyDecision, error) {
	return InteractionSafetyDecision{Level: "takeover"}, ErrInteractionTakeoverRequired
}

func TestComputerTargetResolutionDoesNotPersistSelection(t *testing.T) {
	runtime, _, store, _ := computerBindingFixture(t)
	for _, alias := range []string{"", "current", "desktop.screen"} {
		if _, err := runtime.ResolveTargetForThread(t.Context(), "thread-first", alias); err != nil {
			t.Fatal(err)
		}
	}
	if target, err := store.GetComputerTarget(t.Context(), "thread-first"); err != nil || target != "" {
		t.Fatalf("resolution wrote target=%s err=%v", target, err)
	}
}

func TestComputerTargetForkStartsWithoutParentSelection(t *testing.T) {
	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	source, err := svc.CreateThread(t.Context(), meta, "Source", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	store := svc.snapshotThreadStore()
	if err := store.SetComputerTarget(t.Context(), source.ThreadID, "desktop-main"); err != nil {
		t.Fatal(err)
	}
	fork, err := svc.ForkThreadWithOptions(t.Context(), meta, source.ThreadID, ForkThreadRequest{ClientRequestID: "fork-computer-binding"})
	if err != nil {
		t.Fatal(err)
	}
	if target, err := store.GetComputerTarget(t.Context(), fork.ThreadID); err != nil || target != "" {
		t.Fatalf("fork inherited selection: %s %v", target, err)
	}
	if target, err := store.GetComputerTarget(t.Context(), source.ThreadID); err != nil || target != "desktop-main" {
		t.Fatalf("fork changed parent: %s %v", target, err)
	}
	if err := svc.DeleteThread(t.Context(), meta, fork.ThreadID, true); err != nil {
		t.Fatal(err)
	}
	if err := store.SetComputerTarget(t.Context(), fork.ThreadID, "desktop-main"); err == nil {
		t.Fatal("binding recreated a deleted thread")
	}
}
