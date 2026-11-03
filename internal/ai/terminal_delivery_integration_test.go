package ai

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/floegence/floret/v7/identity"
	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/floret/v7/tools"
	"github.com/floegence/redeven/internal/config"
)

func TestTerminalCompletionAutomaticallyContinuesAndRetainsOutput(t *testing.T) {
	for _, mode := range []string{"automatic", "read", "shutdown", "large", "large_sync"} {
		t.Run(mode, func(t *testing.T) { testTerminalCompletionDelivery(t, mode) })
	}
}
func testTerminalCompletionDelivery(t *testing.T, mode string) {
	var calls atomic.Int32
	var firstTools string
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
			t.Error(err)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		if defs, _ := body["tools"].([]any); len(defs) > 0 {
			n := calls.Add(1)
			if n == 1 {
				raw, _ := json.Marshal(defs)
				firstTools = string(raw)
				command := "sleep 0.5; printf 'COMPLETE_7319 中文'"
				if strings.HasPrefix(mode, "large") {
					command = "printf '%09001d' 0; printf '中文🌸'"
					if mode == "large" {
						command = "sleep 0.5; " + command
					}
				}
				if mode == "shutdown" {
					command = "sleep 30; printf 'COMPLETE_7319 中文'"
				}
				args, _ := json.Marshal(map[string]any{"command": command, "description": "Run terminal fixture", "yield_ms": 100})
				writeEncodingIntegrationCall(w, "terminal_exec", "exec-one", string(args))
				return
			}
			if n == 2 {
				if mode == "read" {
					raw, _ := json.Marshal(body["input"])
					start := strings.Index(string(raw), "tp_")
					if start < 0 || start+27 > len(raw) {
						t.Errorf("process id missing")
						return
					}
					args, _ := json.Marshal(map[string]any{"process_id": string(raw[start : start+27]), "after_seq": 0})
					writeEncodingIntegrationCall(w, "terminal_read", "read-one", string(args))
					return
				}
				writeAskUserIntegrationTextResponse(w, w.(http.Flusher), "running", "Command is running.")
				return
			}
			raw, _ := json.Marshal(body["input"])
			if mode == "shutdown" && !strings.Contains(string(raw), "finished: status=") || !strings.HasPrefix(mode, "large") && mode != "shutdown" && !strings.Contains(string(raw), "COMPLETE_7319") {
				t.Errorf("completion not admitted: %s", raw)
			}
			toolsRaw, _ := json.Marshal(defs)
			if string(toolsRaw) != firstTools {
				t.Errorf("continuation tool definitions changed")
			}
			if n > 3 {
				t.Errorf("duplicate continuation: %d", n)
			}
		}
		writeAskUserIntegrationTextResponse(w, w.(http.Flusher), "done", "COMPLETE_7319 received.")
	}))
	defer provider.Close()
	opts := encodingIntegrationOptions(t, provider.URL, &encodingComputerExecutor{})
	svc, err := NewService(opts)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = svc.Close() }()
	meta := testSendTurnMeta()
	ctx, cancel := context.WithTimeout(t.Context(), 15*time.Second)
	defer cancel()
	thread, err := svc.CreateThread(ctx, meta, "terminal completion", "openai/gpt-5-mini", config.AIPermissionFullAccess, opts.AgentHomeDir)
	if err != nil {
		t.Fatal(err)
	}
	_, err = svc.SendUserTurn(ctx, meta, SendUserTurnRequest{ThreadID: thread.ThreadID, ClientRequestID: "terminal-auto", Input: RunInput{Text: "Run the command and report its completion."}, Options: RunOptions{ToolAllowlist: []string{"terminal.exec", "terminal.read", "terminal.write", "terminal.terminate"}, PermissionType: config.AIPermissionFullAccess, MaxOutputTokens: 8192}})
	if err != nil {
		t.Fatal(err)
	}
	for {
		v, e := svc.threadRuntime.View(ctx, identity.ThreadID(thread.ThreadID))
		if e != nil {
			t.Fatal(e)
		}
		if v.Failure != nil {
			t.Fatalf("continuation failed: %+v", v.Failure)
		}
		if mode == "shutdown" && calls.Load() == 2 && v.Activity == flruntime.ThreadActivityIdle {
			break
		}
		works, workErr := svc.threadRuntime.(flruntime.ThreadHostWorkService).ListHostWork(ctx, identity.ThreadID(thread.ThreadID))
		if workErr != nil {
			t.Fatal(workErr)
		}
		if (calls.Load() == 3 || mode == "large_sync" && calls.Load() == 2) && v.Activity == flruntime.ThreadActivityIdle && len(works) == 1 && works[0].State == "completed" {
			break
		}
		select {
		case <-ctx.Done():
			t.Fatalf("completion timed out, calls=%d", calls.Load())
		case <-time.After(10 * time.Millisecond):
		}
	}
	if mode == "shutdown" {
		if err := svc.Close(); err != nil {
			t.Fatal(err)
		}
		svc, err = NewService(opts)
		if err != nil {
			t.Fatal(err)
		}
	}
	work := svc.threadRuntime.(flruntime.ThreadHostWorkService)
	works, err := work.ListHostWork(ctx, identity.ThreadID(thread.ThreadID))
	if err != nil || len(works) != 1 || works[0].State != "completed" {
		t.Fatalf("work=%+v %v", works, err)
	}
	id := works[0].WorkID
	if err := svc.Close(); err != nil {
		t.Fatal(err)
	}
	svc, err = NewService(opts)
	if err != nil {
		t.Fatal(err)
	}
	snapshot, err := readSealedTerminal(ctx, svc.threadRuntime, identity.ThreadID(thread.ThreadID), id, 0, terminalProcessModelReadBytes)
	if err != nil || (!strings.HasPrefix(mode, "large") && mode != "shutdown" && (snapshot.Status != terminalProcessStatusSuccess || snapshot.Output != "COMPLETE_7319 中文")) || snapshot.Observation != "unavailable" {
		t.Fatalf("retained=%+v %v", snapshot, err)
	}
	if strings.HasPrefix(mode, "large") {
		var output strings.Builder
		for {
			if snapshot.Status != terminalProcessStatusSuccess || snapshot.OutputAvailability != "retained" || snapshot.Truncated {
				t.Fatalf("lost completion/output: %+v", snapshot)
			}
			output.WriteString(snapshot.Output)
			if !snapshot.HasMore {
				break
			}
			snapshot, err = readSealedTerminal(ctx, svc.threadRuntime, identity.ThreadID(thread.ThreadID), id, snapshot.LastSeq, terminalProcessModelReadBytes)
			if err != nil {
				t.Fatal(err)
			}
		}
		if output.String() != strings.Repeat("0", 9001)+"中文🌸" {
			t.Fatalf("retained output differs: %d bytes", output.Len())
		}
	}
	view, err := svc.threadRuntime.View(ctx, identity.ThreadID(thread.ThreadID))
	if err != nil {
		t.Fatal(err)
	}
	finalActivity := false
	for _, item := range view.Items {
		if item.Activity != nil && item.Activity.ToolID == "exec-one" {
			status, _ := tools.ActivityStatus(item.Activity.Presentation)
			if status == "running" || status == "pending" {
				t.Fatalf("stale activity after restart: %+v", item.Activity)
			}
			finalActivity = true
			if err := item.Activity.Presentation.Validate(); err != nil {
				t.Fatal(err)
			}
			if strings.HasPrefix(mode, "large") {
				payload := item.Activity.Presentation.Payload.(tools.TerminalActivityPayload)
				if len(payload.Output) > activityPayloadStringLimit || !payload.Truncated || payload.FirstSeq <= 1 || payload.LastSeq != payload.LatestSeq {
					t.Fatalf("invalid preview bounds: %+v", payload)
				}
			}
		}
	}
	if !finalActivity {
		t.Fatal("original terminal activity was lost")
	}
	expectedCalls := int32(3)
	if mode == "large_sync" {
		expectedCalls = 2
	}
	if mode == "shutdown" {
		expectedCalls = 2
	}
	if calls.Load() != expectedCalls {
		t.Fatalf("restart replayed work: %d", calls.Load())
	}
	if mode == "shutdown" {
		_, err := svc.SendUserTurn(ctx, meta, SendUserTurnRequest{ThreadID: thread.ThreadID, ClientRequestID: "after-restart", Input: RunInput{Text: "Report retained command state."}, Options: RunOptions{ToolAllowlist: []string{"terminal.exec", "terminal.read", "terminal.write", "terminal.terminate"}, PermissionType: config.AIPermissionFullAccess, MaxOutputTokens: 8192}})
		if err != nil {
			t.Fatal(err)
		}
		for calls.Load() < 3 {
			select {
			case <-ctx.Done():
				t.Fatal(ctx.Err())
			case <-time.After(10 * time.Millisecond):
			}
		}
	}
}

// The worker is an actual service process. The parent kills it without Close;
// recovery must not infer child exit or replay the admitted shell effect.
func TestTerminalAbnormalExitWorker(t *testing.T) {
	root := os.Getenv("FLOWER_TERMINAL_KILL_WORKER")
	if root == "" {
		t.Skip("subprocess fixture only")
	}
	opts := encodingIntegrationOptions(t, os.Getenv("FLOWER_TERMINAL_KILL_PROVIDER"), &encodingComputerExecutor{})
	opts.StateDir, opts.AgentHomeDir = filepath.Join(root, "state"), root
	svc, err := NewService(opts)
	if err != nil {
		t.Fatal(err)
	}
	meta := testSendTurnMeta()
	thread, err := svc.CreateThread(t.Context(), meta, "kill fixture", "openai/gpt-5-mini", config.AIPermissionFullAccess, root)
	if err != nil {
		t.Fatal(err)
	}
	_, err = svc.SendUserTurn(t.Context(), meta, SendUserTurnRequest{ThreadID: thread.ThreadID, ClientRequestID: "kill-test", Input: RunInput{Text: "Start fixture once."}, Options: RunOptions{ToolAllowlist: []string{"terminal.exec", "terminal.read"}, PermissionType: config.AIPermissionFullAccess}})
	if err != nil {
		t.Fatal(err)
	}
	for {
		view, err := svc.threadRuntime.View(t.Context(), identity.ThreadID(thread.ThreadID))
		if err != nil {
			t.Fatal(err)
		}
		works, err := svc.threadRuntime.(flruntime.ThreadHostWorkService).ListHostWork(t.Context(), view.ThreadID)
		if err != nil {
			t.Fatal(err)
		}
		if len(works) == 1 && view.Activity == flruntime.ThreadActivityIdle {
			raw, _ := json.Marshal(map[string]string{"thread_id": thread.ThreadID, "work_id": works[0].WorkID})
			if err := os.WriteFile(filepath.Join(root, "ready.json"), raw, 0600); err != nil {
				t.Fatal(err)
			}
			select {}
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func TestTerminalSIGKILLPreservesUnknownWithoutReplay(t *testing.T) {
	var calls atomic.Int32
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		if defs, _ := body["tools"].([]any); len(defs) > 0 && calls.Add(1) == 1 {
			writeEncodingIntegrationCall(w, "terminal_exec", "kill-exec", `{"command":"printf once >> executions; printf started; sleep 3; printf finished > finished","description":"Run crash fixture","yield_ms":100}`)
			return
		}
		writeAskUserIntegrationTextResponse(w, w.(http.Flusher), "running", "Command is running.")
	}))
	defer provider.Close()
	root := t.TempDir()
	worker := exec.Command(os.Args[0], "-test.run=^TestTerminalAbnormalExitWorker$", "-test.timeout=20s")
	worker.Env = append(os.Environ(), "FLOWER_TERMINAL_KILL_WORKER="+root, "FLOWER_TERMINAL_KILL_PROVIDER="+provider.URL)
	log, err := os.Create(filepath.Join(root, "worker.log"))
	if err != nil {
		t.Fatal(err)
	}
	defer log.Close()
	worker.Stdout, worker.Stderr = log, log
	if err := worker.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() { _ = worker.Process.Kill(); _ = worker.Wait() }()
	var ready map[string]string
	deadline := time.Now().Add(12 * time.Second)
	for time.Now().Before(deadline) {
		raw, err := os.ReadFile(filepath.Join(root, "ready.json"))
		if err == nil && json.Unmarshal(raw, &ready) == nil {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if len(ready) == 0 {
		raw, _ := os.ReadFile(filepath.Join(root, "worker.log"))
		t.Fatalf("worker not ready: %s", raw)
	}
	if err := worker.Process.Kill(); err != nil {
		t.Fatal(err)
	}
	_ = worker.Wait()
	opts := encodingIntegrationOptions(t, provider.URL, &encodingComputerExecutor{})
	opts.StateDir, opts.AgentHomeDir = filepath.Join(root, "state"), root
	for restart := 0; restart < 2; restart++ {
		svc, err := NewService(opts)
		if err != nil {
			t.Fatal(err)
		}
		id := identity.ThreadID(ready["thread_id"])
		snapshot, err := readSealedTerminal(t.Context(), svc.threadRuntime, id, ready["work_id"], 0, terminalProcessModelReadBytes)
		if err != nil || snapshot.Status != "unknown" || snapshot.Observation != "unavailable" || snapshot.OutputAvailability != "unavailable" {
			t.Fatalf("crash recovery=%+v %v", snapshot, err)
		}
		if _, err := svc.ReadTerminalProcess(t.Context(), testSendTurnMeta(), snapshot.RunID, ready["work_id"], 0, ready["thread_id"]); err != nil {
			t.Fatalf("authorized UI recovery failed: %v", err)
		}
		if _, known := terminalProcessResultPayload(snapshot)["exit_code"]; known {
			t.Fatal("unknown exit was invented")
		}
		if err := svc.Close(); err != nil {
			t.Fatal(err)
		}
	}
	if calls.Load() != 2 {
		t.Fatalf("recovery woke provider: %d", calls.Load())
	}
	// The orphan fixture is bounded; allow it to exit before removing its directory.
	time.Sleep(3 * time.Second)
	raw, err := os.ReadFile(filepath.Join(root, "executions"))
	if err != nil || string(raw) != "once" {
		t.Fatalf("effect replayed: %q %v", raw, err)
	}
}
