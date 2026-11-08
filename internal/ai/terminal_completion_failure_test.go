package ai

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"strings"
	"testing"

	flruntime "github.com/floegence/floret/v7/runtime"
)

type terminalCompletionFailureService struct {
	flruntime.ThreadService
	flruntime.ThreadHostWorkService
	calls   int
	failure error
}

func (s *terminalCompletionFailureService) BindHostWork(context.Context, flruntime.BindHostWorkInput) error {
	return nil
}
func (s *terminalCompletionFailureService) CompleteHostWork(_ context.Context, input flruntime.CompleteHostWorkInput) error {
	s.calls++
	if err := input.Activity.Validate(); err != nil {
		return err
	}
	return s.failure
}
func TestTerminalCompletionPersistenceFailureIsImmediatelyObservable(t *testing.T) {
	failure := errors.New("fixture storage commit failed")
	service := &terminalCompletionFailureService{failure: failure}
	var logs bytes.Buffer
	r := &run{threadRuntime: service, log: slog.New(slog.NewJSONHandler(&logs, nil))}
	req := terminalProcessStartRequest{ThreadID: "thread", RunID: "run", TurnID: "turn", ToolID: "exec", ToolName: "terminal_exec", ProcessID: "process"}
	ctx := context.WithValue(t.Context(), floretToolExecutionAuthorizationContextKey{}, floretToolExecutionAuthorization{toolID: req.ToolID, toolName: req.ToolName, effectAttemptID: "effect"})
	if err := r.bindTerminalWork(ctx, &req); err != nil {
		t.Fatal(err)
	}
	p := newTerminalReadWaitTestProcess(0)
	p.initialResult = make(chan bool, 1)
	p.initialResult <- false
	p.status = terminalProcessStatusSuccess
	p.appendOutput([]byte(strings.Repeat("x", 9001)))
	if err := req.Complete(p); !errors.Is(err, failure) {
		t.Fatal(err)
	}
	if service.calls != 1 || !strings.Contains(logs.String(), "terminal completion persistence failed") || !strings.Contains(logs.String(), "fixture storage commit failed") {
		t.Fatalf("missing diagnostic or replay: calls=%d log=%s", service.calls, logs.String())
	}
	if strings.Contains(logs.String(), strings.Repeat("x", 100)) {
		t.Fatal("diagnostic leaked process output")
	}
}
