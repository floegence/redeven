package ai

import (
	"context"
	"testing"
	"time"
)

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
	if err := runtime.ReobserveComputerTarget(t.Context(), owner); err != nil {
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
	runtime.releaseComputerControl("owner", "run")
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
	if err := runtime.ReobserveComputerTarget(t.Context(), owner); err != nil {
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
