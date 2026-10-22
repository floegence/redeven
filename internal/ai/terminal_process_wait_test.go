package ai

import (
	"errors"
	"sync"
	"testing"
	"time"
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
	result, err := r.toolTerminalReadWithWait(process.id, afterSeq, waitMS)
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
