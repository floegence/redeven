package ai

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
)

func TestComputerRecoveryRejectsWritesUntilFreshObservation(t *testing.T) {
	executor := &recordingTargetExecutor{}
	continuation := &TargetToolCall{ThreadID: "thread", TurnID: "turn", RunID: "waiting-run", TargetID: "target", interactionID: "tool-input:resolved"}
	r := &run{
		threadID: "thread", turnID: "turn", id: "recovery-run",
		targetResolver:     staticTargetResolver{target: TargetDescriptor{ID: "target", Kind: "browser.managed", State: "ready", Ready: true}},
		targetToolExecutor: executor, computerContinuation: continuation,
		floretEventIdentity: floretRuntimeEventIdentity{configured: true, checkRunID: true, runID: "recovery-run", threadID: "thread", turnID: "turn"},
	}
	_, err := r.execTargetTool(t.Context(), "write", "computer.click", map[string]any{"target": "target"})
	var policy *targetToolPolicyError
	if !errors.As(err, &policy) || policy.code != "recovery_observation_required" {
		t.Fatalf("write before observation returned %v", err)
	}
	for _, instruction := range []string{"fresh observation", "computer.targets", "computer.select_target", "Do not repeat completed actions"} {
		if !strings.Contains(err.Error(), instruction) {
			t.Fatalf("model feedback omitted %q: %v", instruction, err)
		}
	}
	if len(executor.calls) != 0 {
		t.Fatalf("write reached target before observation: %+v", executor.calls)
	}
}

func TestComputerRecoverySelectionRequiresCanonicalInteraction(t *testing.T) {
	for _, test := range []struct {
		name          string
		turnID        string
		runID         string
		interactionID string
		allowed       bool
	}{
		{name: "exact response", turnID: "recovery-turn", runID: "recovery-run", interactionID: "tool-input:resolved", allowed: true},
		{name: "wrong interaction", turnID: "recovery-turn", runID: "recovery-run", interactionID: "tool-input:other"},
		{name: "old run", turnID: "recovery-turn", runID: "waiting-run", interactionID: "tool-input:resolved"},
		{name: "old turn", turnID: "waiting-turn", runID: "recovery-run", interactionID: "tool-input:resolved"},
		{name: "missing interaction", turnID: "recovery-turn", runID: "recovery-run"},
	} {
		t.Run(test.name, func(t *testing.T) {
			host, _, _, _ := computerBindingFixture(t)
			control := host.controlForTarget("browser-main")
			control.threadID, control.turnID, control.runID = "thread-first", "recovery-turn", "recovery-run"
			control.pause = &InteractionSafetyDecision{Level: "takeover", ReasonCodes: []string{"user_control"}}
			control.recheckInteractionID = "tool-input:resolved"
			call := TargetToolCall{ThreadID: "thread-first", TurnID: test.turnID, RunID: test.runID, interactionID: test.interactionID, recoverySelection: true, ToolName: "computer.targets"}
			err := host.requireComputerSelectionOpen(call)
			if test.allowed && err != nil {
				t.Fatalf("canonical recovery could not inspect targets: %v", err)
			}
			if !test.allowed && err == nil {
				t.Fatal("target selection bypassed the exact canonical interaction")
			}
		})
	}
}

func TestComputerRecoveryCanSelectDiscoveredReplacement(t *testing.T) {
	host, _, store, _ := computerBindingFixture(t)
	if err := store.SetComputerTarget(t.Context(), "thread-first", "browser-main"); err != nil {
		t.Fatal(err)
	}
	if err := host.registry.Update(TargetDescriptor{ID: "desktop-main", Kind: "desktop.screen", DisplayName: "Desktop", State: "ready", Ready: true}); err != nil {
		t.Fatal(err)
	}
	control := host.controlForTarget("browser-main")
	control.threadID, control.turnID, control.runID = "thread-first", "recovery-turn", "recovery-run"
	control.pause = &InteractionSafetyDecision{Level: "takeover", ReasonCodes: []string{"user_control"}}
	control.recheckInteractionID = "tool-input:resolved"
	host.registry.remove("browser-main")
	host.registry.remove("browser-main")
	continuation := TargetToolCall{ThreadID: "thread-first", TurnID: "recovery-turn", RunID: "waiting-run", TargetID: "browser-main", interactionID: "tool-input:resolved"}
	r := &run{
		threadID: "thread-first", turnID: "recovery-turn", id: "recovery-run",
		targetResolver: host, targetToolExecutor: host, computerContinuation: &continuation,
		floretEventIdentity: floretRuntimeEventIdentity{configured: true, checkRunID: true, runID: "recovery-run", threadID: "thread-first", turnID: "recovery-turn"},
	}
	inventoryValue, err := r.execComputerManagement(computerAuthorizedTestContext(t, r, "discover", "computer.targets"), "discover", "computer.targets", map[string]any{})
	if err != nil {
		t.Fatal(err)
	}
	inventory, ok := inventoryValue.(ComputerTargetInventory)
	if !ok {
		t.Fatalf("target discovery returned %T", inventoryValue)
	}
	var candidate string
	for _, item := range inventory.Candidates {
		if item.TargetID == "desktop-main" {
			candidate = item.CandidateRef
		}
	}
	if candidate == "" {
		t.Fatalf("replacement was not discovered: %+v", inventory)
	}
	if _, err := r.execComputerManagement(computerAuthorizedTestContext(t, r, "select", "computer.select_target"), "select", "computer.select_target", map[string]any{"candidate_ref": candidate}); err != nil {
		t.Fatalf("Flower could not select discovered replacement: %v", err)
	}
	selected, err := store.GetComputerTarget(t.Context(), "thread-first")
	if err != nil || selected != "desktop-main" {
		t.Fatalf("selected target=%q err=%v", selected, err)
	}
}

func TestComputerControlRejectsOtherThreadsAndRequiresExplicitReturn(t *testing.T) {
	body, attachment := computerFrameFixture(t)
	executor := &takeoverObservationExecutor{body: body, attachment: attachment}
	runtime := NewComputerUseRuntime(NewTargetRegistry(), map[string]TargetToolExecutor{"target": executor}, t.TempDir())
	t.Cleanup(func() { _ = runtime.Close() })
	owner := TargetToolCall{ThreadID: "owner", TurnID: "turn", RunID: "run", TargetID: "target", ToolName: "browser.navigate"}
	if _, err := runtime.ExecuteTargetTool(t.Context(), owner); err != nil {
		t.Fatal(err)
	}
	executor.safe.Store(true)
	for _, caller := range []string{"other", "owner"} {
		call := owner
		call.ThreadID = caller
		call.ToolName = "computer.screenshot"
		if _, err := runtime.ExecuteTargetTool(t.Context(), call); err == nil {
			t.Fatal("capture proceeded during user takeover")
		}
	}
	if executor.observations.Load() != 0 {
		t.Fatal("unauthorized observation reached adapter")
	}
	owner.interactionID = "resolved-input"
	runtime.resumeComputerControl(owner, "resumed")
	owner.RunID, owner.ToolName = "resumed", "computer.screenshot"
	if _, err := runtime.ExecuteTargetTool(t.Context(), owner); err != nil {
		t.Fatal(err)
	}
	if executor.observations.Load() != 1 {
		t.Fatal("return did not observe")
	}
	owner.ToolName = "computer.screenshot"
	if _, err := runtime.ExecuteTargetTool(t.Context(), owner); err != nil {
		t.Fatal(err)
	}
	other := owner
	other.ThreadID = "other"
	if _, err := runtime.ExecuteTargetTool(t.Context(), other); err == nil {
		t.Fatal("another thread captured owner target")
	}

	runtime.releaseComputerControl("owner", "stale-run")
	if _, err := runtime.ExecuteTargetTool(t.Context(), other); err == nil {
		t.Fatal("stale release stole current target")
	}
	runtime.releaseComputerControl("owner", "resumed")
	if _, err := runtime.ExecuteTargetTool(t.Context(), other); err != nil {
		t.Fatal(err)
	}
}

type serialComputerExecutor struct {
	entered chan struct{}
	leave   chan struct{}
}

func (e *serialComputerExecutor) ExecuteTargetTool(ctx context.Context, _ TargetToolCall) (TargetToolResult, error) {
	e.entered <- struct{}{}
	select {
	case <-ctx.Done():
		return TargetToolResult{}, ctx.Err()
	case <-e.leave:
		return TargetToolResult{}, nil
	}
}
func TestComputerControlSerializesAndCancelsBeforeDispatch(t *testing.T) {
	executor := &serialComputerExecutor{entered: make(chan struct{}, 2), leave: make(chan struct{})}
	runtime := NewComputerUseRuntime(NewTargetRegistry(), map[string]TargetToolExecutor{"target": executor}, t.TempDir())
	t.Cleanup(func() { _ = runtime.Close() })
	call := TargetToolCall{ThreadID: "owner", RunID: "run", TargetID: "target", ToolName: "computer.click"}
	first := make(chan error, 1)
	go func() { _, err := runtime.ExecuteTargetTool(t.Context(), call); first <- err }()
	<-executor.entered
	ctx, cancel := context.WithTimeout(t.Context(), 30*time.Millisecond)
	defer cancel()
	_, err := runtime.ExecuteTargetTool(ctx, call)
	close(executor.leave)
	if err != context.DeadlineExceeded {
		t.Fatalf("waiting cancellation: %v", err)
	}
	if err := <-first; err != nil {
		t.Fatal(err)
	}
	select {
	case <-executor.entered:
		t.Fatal("canceled waiting action reached adapter")
	default:
	}
}

func TestComputerControlContinuationKeepsTurnAndUserBoundaries(t *testing.T) {
	body, attachment := computerFrameFixture(t)
	executor := &takeoverObservationExecutor{body: body, attachment: attachment}
	runtime := NewComputerUseRuntime(NewTargetRegistry(), map[string]TargetToolExecutor{"target": executor}, t.TempDir())
	t.Cleanup(func() { _ = runtime.Close() })
	owner := TargetToolCall{ThreadID: "owner", TurnID: "turn", RunID: "waiting", TargetID: "target", ToolName: "browser.navigate"}
	if _, err := runtime.ExecuteTargetTool(t.Context(), owner); err != nil {
		t.Fatal(err)
	}
	resumed := owner
	resumed.RunID, resumed.ToolName = "resumed", "computer.screenshot"
	runtime.continueComputerControl(owner.ThreadID, owner.TurnID, resumed.RunID)
	if _, err := runtime.ExecuteTargetTool(t.Context(), resumed); err == nil {
		t.Fatal("continuation returned user control without handback")
	}
	executor.safe.Store(true)
	owner.interactionID = "resolved-input"
	runtime.resumeComputerControl(owner, owner.RunID)
	observation := owner
	observation.ToolName = "computer.screenshot"
	if _, err := runtime.ExecuteTargetTool(t.Context(), observation); err != nil {
		t.Fatal(err)
	}
	for _, identity := range [][3]string{{"other", "turn", "resumed"}, {"owner", "other-turn", "resumed"}, {"owner", "", "resumed"}} {
		runtime.continueComputerControl(identity[0], identity[1], identity[2])
		if _, err := runtime.ExecuteTargetTool(t.Context(), resumed); err == nil {
			t.Fatal("unrelated canonical identity advanced the target lease")
		}
	}
	runtime.continueComputerControl(owner.ThreadID, owner.TurnID, resumed.RunID)
	if _, err := runtime.ExecuteTargetTool(t.Context(), resumed); err != nil {
		t.Fatal(err)
	}
	runtime.releaseComputerControl(owner.ThreadID, owner.RunID)
	other := resumed
	other.ThreadID = "other"
	if _, err := runtime.ExecuteTargetTool(t.Context(), other); err == nil {
		t.Fatal("old terminal notification released the resumed target")
	}
	// A further text-only continuation must also retire its resource on terminal.
	runtime.continueComputerControl(owner.ThreadID, owner.TurnID, "text-only")
	runtime.releaseComputerControl(owner.ThreadID, "text-only")
	if _, err := runtime.ExecuteTargetTool(t.Context(), other); err != nil {
		t.Fatal(err)
	}
}

func TestComputerLiveCaptureCannotClaimOrReuseReleasedTarget(t *testing.T) {
	body, attachment := computerFrameFixture(t)
	executor := &takeoverObservationExecutor{body: body, attachment: attachment}
	executor.safe.Store(true)
	runtime := NewComputerUseRuntime(NewTargetRegistry(), map[string]TargetToolExecutor{"target": executor}, t.TempDir())
	t.Cleanup(func() { _ = runtime.Close() })
	owner := TargetToolCall{ThreadID: "owner", RunID: "run", TargetID: "target", ToolName: "computer.screenshot"}
	live := owner
	live.liveFrame = true
	for _, phase := range []string{"before_action", "after_release"} {
		if phase == "after_release" {
			if _, err := runtime.ExecuteTargetTool(t.Context(), owner); err != nil {
				t.Fatal(err)
			}
			if _, err := runtime.ExecuteTargetTool(t.Context(), live); err != nil {
				t.Fatal(err)
			}
			runtime.releaseComputerControl(owner.ThreadID, owner.RunID)
		}
		before := executor.observations.Load()
		if _, err := runtime.ExecuteTargetTool(t.Context(), live); err == nil {
			t.Fatalf("%s: historical viewer acquired unowned target", phase)
		}
		if executor.observations.Load() != before {
			t.Fatal("unauthorized live capture reached adapter")
		}
	}
}
