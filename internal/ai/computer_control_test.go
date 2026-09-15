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
