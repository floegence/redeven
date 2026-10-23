package ai

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"testing/synctest"
	"time"

	fltools "github.com/floegence/floret/v7/tools"
)

func TestTerminalExecYieldWaitDefaultsAndLimits(t *testing.T) {
	tests := []struct {
		name      string
		args      map[string]any
		wantYield int64
	}{
		{name: "omitted uses default", args: map[string]any{"command": "true"}, wantYield: 5_000},
		{name: "zero uses default", args: map[string]any{"command": "true", "yield_ms": 0}, wantYield: 5_000},
		{name: "positive value is respected", args: map[string]any{"command": "true", "yield_ms": 725}, wantYield: 725},
		{name: "value over maximum is clamped", args: map[string]any{"command": "true", "yield_ms": 30_001}, wantYield: 30_000},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			args := normalizeTerminalExecArgs(test.args)
			yieldMS := int64(parseIntRaw(args["yield_ms"], 0))
			if got := effectiveTerminalProcessYieldMS(yieldMS); got != test.wantYield {
				t.Fatalf("effective yield=%dms, want %dms", got, test.wantYield)
			}
		})
	}
}

func TestTerminalReadReturnsOnOutputOrProcessExit(t *testing.T) {
	t.Run("new output", func(t *testing.T) {
		process := newTerminalReadWaitTestProcess(4)
		timer := time.AfterFunc(15*time.Millisecond, func() {
			process.mu.Lock()
			process.lastSeq = 5
			process.total += int64(len("new output\n"))
			process.outputChunks = append(process.outputChunks, terminalProcessOutputChunk{seq: 5, data: []byte("new output\n")})
			process.cond.Broadcast()
			process.mu.Unlock()
		})
		defer timer.Stop()

		start := time.Now()
		payload := readTerminalProcessForTest(t, process, 4, 1_000)
		if elapsed := time.Since(start); elapsed >= 500*time.Millisecond {
			t.Fatalf("terminal.read waited %s despite new output", elapsed)
		}
		if payload["status"] != terminalProcessStatusRunning || payload["process_id"] != process.id || payload["output"] != "new output\n" {
			t.Fatalf("terminal.read output result mismatch: %#v", payload)
		}
		if payload["first_seq"] != int64(5) || payload["last_seq"] != int64(5) || payload["latest_seq"] != int64(5) || payload["has_more"] != false {
			t.Fatalf("terminal.read cursor changed unexpectedly: %#v", payload)
		}
		assertTerminalReadHasNoBoundedWait(t, payload)
	})

	t.Run("process exit", func(t *testing.T) {
		process := newTerminalReadWaitTestProcess(4)
		timer := time.AfterFunc(15*time.Millisecond, func() {
			process.mu.Lock()
			process.status = terminalProcessStatusSuccess
			process.endedAt = time.Now()
			process.cond.Broadcast()
			process.mu.Unlock()
		})
		defer timer.Stop()

		start := time.Now()
		payload := readTerminalProcessForTest(t, process, 4, 1_000)
		if elapsed := time.Since(start); elapsed >= 500*time.Millisecond {
			t.Fatalf("terminal.read waited %s despite process exit", elapsed)
		}
		if payload["status"] != terminalProcessStatusSuccess || payload["process_id"] != process.id || payload["completed"] != true {
			t.Fatalf("terminal.read did not return completed process: %#v", payload)
		}
		if payload["output"] != "" || payload["last_seq"] != int64(4) || payload["latest_seq"] != int64(4) {
			t.Fatalf("terminal.read changed cursor without output: %#v", payload)
		}
		assertTerminalReadHasNoBoundedWait(t, payload)
	})
}

func TestTerminalReadTimeoutKeepsRunningCursor(t *testing.T) {
	process := newTerminalReadWaitTestProcess(4)
	waitMS := int64(25)
	start := time.Now()
	payload := readTerminalProcessForTest(t, process, 4, waitMS)
	elapsed := time.Since(start)
	if elapsed < time.Duration(waitMS-10)*time.Millisecond || elapsed > time.Second {
		t.Fatalf("terminal.read wait=%s, expected approximately %dms", elapsed, waitMS)
	}
	if payload["status"] != terminalProcessStatusRunning || payload["process_id"] != process.id || payload["completed"] != false {
		t.Fatalf("terminal.read timeout did not preserve running process: %#v", payload)
	}
	if payload["output"] != "" || payload["first_seq"] != int64(0) || payload["last_seq"] != int64(4) || payload["latest_seq"] != int64(4) {
		t.Fatalf("terminal.read timeout changed cursor: %#v", payload)
	}
}

func TestTerminalReadQuietWaitReachesFloretRepeatGuard(t *testing.T) {
	process := newTerminalReadWaitTestProcess(4)
	const waitMS = int64(10)
	payload := readTerminalProcessForTest(t, process, 4, waitMS)
	result, err := floretToolResultFromFlower(nil, ToolResult{
		ToolID: "quiet-read", ToolName: "terminal.read",
		Status: toolResultStatusSuccess, Data: payload,
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.BoundedWait == nil || !result.BoundedWait.TimedOut || result.BoundedWait.Timeout != time.Duration(waitMS)*time.Millisecond {
		t.Fatalf("quiet terminal read lost its completed wait: %#v", result.BoundedWait)
	}
	if payload["timed_out"] != false {
		t.Fatalf("read deadline became a command timeout: %#v", payload)
	}
}

func TestTerminalReadCancellationDoesNotStopProcess(t *testing.T) {
	for _, beforeRead := range []bool{false, true} {
		t.Run(map[bool]string{false: "during wait", true: "before read"}[beforeRead], func(t *testing.T) {
			synctest.Test(t, func(t *testing.T) {
				process := newTerminalReadWaitTestProcess(4)
				ctx, cancel := context.WithCancel(t.Context())
				defer cancel()
				if beforeRead {
					cancel()
				} else {
					go func() { time.Sleep(time.Second); cancel() }()
				}
				start := time.Now()
				snapshot, err := process.ReadAfter(ctx, terminalProcessReadRequest{AfterSeq: 4, WaitMS: 60_000, MaxBytes: terminalProcessModelReadBytes})
				if !errors.Is(err, context.Canceled) || snapshot.readWaitExpired || time.Since(start) > time.Second {
					t.Fatalf("cancellation waited for deadline: snapshot=%+v err=%v elapsed=%v", snapshot, err, time.Since(start))
				}
				if state := process.Snapshot(); state.Status != terminalProcessStatusRunning || state.LastSeq != 4 {
					t.Fatalf("canceling observation changed process: %+v", state)
				}
			})
		})
	}
}

func TestTerminalReadDeadlineAndConcurrentReaders(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		process := newTerminalReadWaitTestProcess(4)
		canceled, cancel := context.WithCancel(t.Context())
		defer cancel()
		type observation struct {
			snapshot terminalProcessSnapshot
			err      error
		}
		first, second := make(chan observation, 1), make(chan observation, 1)
		read := func(ctx context.Context, out chan observation) {
			snapshot, err := process.ReadAfter(ctx, terminalProcessReadRequest{AfterSeq: 4, WaitMS: 60_000, MaxBytes: terminalProcessModelReadBytes})
			out <- observation{snapshot, err}
		}
		go read(canceled, first)
		go read(t.Context(), second)
		synctest.Wait()
		cancel()
		synctest.Wait()
		if got := <-first; !errors.Is(got.err, context.Canceled) {
			t.Fatalf("first reader: %+v", got)
		}
		select {
		case got := <-second:
			t.Fatalf("another reader's cancellation ended this read: %+v", got)
		default:
		}
		process.mu.Lock()
		process.status = terminalProcessStatusSuccess
		process.endedAt = time.Now()
		process.cond.Broadcast()
		process.mu.Unlock()
		if got := <-second; got.err != nil || got.snapshot.Status != terminalProcessStatusSuccess || got.snapshot.readWaitExpired {
			t.Fatalf("exit observation: %+v", got)
		}
	})
	synctest.Test(t, func(t *testing.T) {
		process := newTerminalReadWaitTestProcess(4)
		ctx, cancel := context.WithTimeout(t.Context(), time.Second)
		defer cancel()
		snapshot, err := process.ReadAfter(ctx, terminalProcessReadRequest{AfterSeq: 4, WaitMS: 60_000, MaxBytes: terminalProcessModelReadBytes})
		if !errors.Is(err, context.DeadlineExceeded) || snapshot.readWaitExpired {
			t.Fatalf("caller deadline became successful wait: %+v, %v", snapshot, err)
		}
	})
}

func TestTerminalReadImmediateObservationDoesNotQualifyAsWait(t *testing.T) {
	process := newTerminalReadWaitTestProcess(4)
	assertTerminalReadHasNoBoundedWait(t, readTerminalProcessForTest(t, process, 4, 0))
	assertTerminalReadHasNoBoundedWait(t, readTerminalProcessForTest(t, process, 0, 60_000))
}

func TestTerminalReadHandlerCancellationPreservesProcess(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		process := newTerminalReadWaitTestProcess(4)
		r := &run{host: runHostCapabilities{terminal: terminalReadWaitTestHost{process: process}}, endpointID: process.endpointID, threadID: process.threadID, sessionMeta: testSendTurnMeta()}
		snapshot := buildPermissionSnapshot(FlowerPermissionFullAccess, builtInToolDefinitions(), nil)
		snapshot.SnapshotID = "terminal-cancellation"
		ctx := contextWithToolAuthorizationSnapshot(t.Context(), snapshot)
		ctx = contextWithFloretToolExecutionAuthorization(ctx, "read", "terminal.read", "read-attempt", snapshot, ApprovalDecisionAllow, true, nil)
		ctx, cancel := context.WithCancel(ctx)
		defer cancel()
		go func() { time.Sleep(time.Second); cancel() }()
		start := time.Now()
		handler := &builtInToolHandler{r: r, toolName: "terminal.read"}
		result, err := handler.Execute(ctx, ToolCall{ID: "read", Name: "terminal.read", Args: map[string]any{"process_id": process.id, "after_seq": 4, "description": "Wait for existing command"}})
		if err != nil {
			t.Fatal(err)
		}
		adapted, err := floretToolResultFromFlower(r, result)
		if err != nil || adapted.DispatchErr != nil || adapted.Structured["outcome"] != fltools.ResultOutcomeCanceled || adapted.BoundedWait != nil || time.Since(start) != time.Second {
			t.Fatalf("handler cancellation lost: result=%+v err=%v elapsed=%s", adapted, err, time.Since(start))
		}
		if process.Snapshot().Status != terminalProcessStatusRunning {
			t.Fatal("canceling read terminated its process")
		}
	})
}

func assertTerminalReadHasNoBoundedWait(t *testing.T, payload map[string]any) {
	t.Helper()
	result, err := floretToolResultFromFlower(nil, ToolResult{ToolID: "read", ToolName: "terminal.read", Status: toolResultStatusSuccess, Data: payload})
	if err != nil || result.BoundedWait != nil || payload["wait_expired"] != false {
		t.Fatalf("early read qualified as a full wait: %#v, %v", result, err)
	}
}

func TestTerminalReadModelOutputIsIncrementalAndActivityKeepsCommand(t *testing.T) {
	process := newTerminalReadWaitTestProcess(4)
	process.command = "printf " + strings.Repeat("long-command-", 300)
	process.cwd = "/task/workspace"
	payload := readTerminalProcessForTest(t, process, 4, 0)
	result, err := floretToolResultFromFlower(nil, ToolResult{ToolID: "read", ToolName: "terminal.read", Status: toolResultStatusSuccess, Data: payload})
	if err != nil {
		t.Fatal(err)
	}
	data, _ := result.Structured["data"].(map[string]any)
	for _, key := range []string{"command", "cwd", "execution_location", "started_at_ms", "duration_ms"} {
		if _, exists := data[key]; exists {
			t.Fatalf("model read repeats %s: %s", key, result.Text)
		}
	}
	if len(result.Text) > 1000 || payload["command"] != process.command {
		t.Fatalf("model projection changed source or repeats command: %s", result.Text)
	}
	if result.Activity == nil {
		t.Fatal("missing terminal activity")
	}
	activity, ok := result.Activity.Payload.(fltools.TerminalActivityPayload)
	if !ok || !strings.HasPrefix(activity.Command, "printf") {
		t.Fatalf("activity lost command: %#v", result.Activity)
	}
}

type terminalReadWaitTestHost struct {
	process *terminalProcess
}

func (h terminalReadWaitTestHost) Start(terminalProcessStartRequest) (*terminalProcess, error) {
	return nil, errors.New("unexpected terminal process start")
}

func (h terminalReadWaitTestHost) Get(processID string) (*terminalProcess, error) {
	if h.process == nil || h.process.id != processID {
		return nil, errors.New("terminal process not found")
	}
	return h.process, nil
}

func (h terminalReadWaitTestHost) ProcessesForRun(string) []*terminalProcess {
	if h.process == nil {
		return nil
	}
	return []*terminalProcess{h.process}
}

func newTerminalReadWaitTestProcess(lastSeq int64) *terminalProcess {
	process := &terminalProcess{
		id:         "terminal-read-test",
		endpointID: "endpoint-test",
		threadID:   "thread-test",
		startedAt:  time.Now(),
		status:     terminalProcessStatusRunning,
		lastSeq:    lastSeq,
	}
	if lastSeq > 0 {
		process.outputChunks = []terminalProcessOutputChunk{{seq: lastSeq, data: []byte("previous output\n")}}
	}
	process.cond = sync.NewCond(&process.mu)
	return process
}

func readTerminalProcessForTest(t *testing.T, process *terminalProcess, afterSeq int64, waitMS int64) map[string]any {
	t.Helper()
	r := &run{
		host:       runHostCapabilities{terminal: terminalReadWaitTestHost{process: process}},
		endpointID: process.endpointID,
		threadID:   process.threadID,
	}
	result, err := r.toolTerminalReadWithWait(t.Context(), process.id, afterSeq, waitMS)
	if err != nil {
		t.Fatalf("terminal.read: %v", err)
	}
	payload, ok := result.(map[string]any)
	if !ok {
		t.Fatalf("terminal.read returned %T, want map payload", result)
	}
	if payload["operation"] != "read" {
		t.Fatalf("terminal.read operation=%v, want read", payload["operation"])
	}
	return payload
}
