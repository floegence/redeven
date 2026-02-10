package ai

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/floegence/redeven-agent/internal/config"
	"github.com/floegence/redeven-agent/internal/session"
)

func writeTestSidecarScript(t *testing.T, js string) string {
	t.Helper()

	dir := t.TempDir()
	p := filepath.Join(dir, "sidecar.mjs")
	if err := os.WriteFile(p, []byte(js), 0o600); err != nil {
		t.Fatalf("write sidecar script: %v", err)
	}
	return p
}

func newTestService(t *testing.T, scriptPath string, opts ...func(*Options)) *Service {
	t.Helper()

	stateDir := t.TempDir()
	fsRoot := t.TempDir()

	cfg := &config.AIConfig{
		Providers: []config.AIProvider{
			{
				ID:      "openai",
				Name:    "OpenAI",
				Type:    "openai",
				BaseURL: "https://api.openai.com/v1",
				Models:  []config.AIProviderModel{{ModelName: "gpt-5-mini", Label: "GPT-5 Mini", IsDefault: true}},
			},
		},
	}

	logger := slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{Level: slog.LevelInfo}))

	o := Options{
		Logger:            logger,
		StateDir:          stateDir,
		FSRoot:            fsRoot,
		Shell:             "bash",
		Config:            cfg,
		SidecarScriptPath: strings.TrimSpace(scriptPath),
		ResolveProviderAPIKey: func(providerID string) (string, bool, error) {
			// Tests must never use real keys; the sidecar scripts are fully offline.
			return "sk-test", true, nil
		},
	}
	for _, apply := range opts {
		if apply != nil {
			apply(&o)
		}
	}

	svc, err := NewService(o)
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}
	t.Cleanup(func() { _ = svc.Close() })
	return svc
}

func TestRun_EmptySuccess_InsertsNoResponse(t *testing.T) {
	t.Parallel()

	script := writeTestSidecarScript(t, `
import { createInterface } from 'node:readline';

function send(method, params) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', (line) => {
  const msg = JSON.parse(String(line || '').trim() || '{}');
  if (msg.method === 'run.start') {
    const runId = String(msg.params?.run_id || '').trim();
    send('run.end', { run_id: runId });
    process.exit(0);
  }
});

setInterval(() => {}, 1000);
`)

	meta := session.Meta{
		EndpointID:        "env_test",
		NamespacePublicID: "ns_test",
		ChannelID:         "ch_a",
		UserPublicID:      "u_test",
		UserEmail:         "u_test@example.com",
		CanRead:           true,
		CanWrite:          true,
		CanExecute:        true,
		CanAdmin:          true,
	}
	svc := newTestService(t, script)

	ctx := context.Background()
	th, err := svc.CreateThread(ctx, &meta, "hello", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	rr := httptest.NewRecorder()
	if err := svc.StartRun(ctx, &meta, "run_test_1", RunStartRequest{
		ThreadID: th.ThreadID,
		Model:    "openai/gpt-5-mini",
		Input:    RunInput{Text: "hi"},
		Options:  RunOptions{MaxSteps: 1},
	}, rr); err != nil {
		t.Fatalf("StartRun: %v", err)
	}

	view, err := svc.GetThread(ctx, &meta, th.ThreadID)
	if err != nil {
		t.Fatalf("GetThread: %v", err)
	}
	if view == nil {
		t.Fatalf("thread missing after run")
	}
	if strings.TrimSpace(view.LastMessagePreview) != "No response." {
		t.Fatalf("last_message_preview=%q, want %q", view.LastMessagePreview, "No response.")
	}
}

func TestRun_PersistOpTimeout_DoesNotExpireAcrossRun(t *testing.T) {
	t.Parallel()

	// The sidecar delays completion to ensure the run lasts longer than the per-op persistence timeout.
	// Persist operations must still succeed because they use fresh contexts per DB call.
	script := writeTestSidecarScript(t, `
import { createInterface } from 'node:readline';

function send(method, params) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', (line) => {
  const msg = JSON.parse(String(line || '').trim() || '{}');
  if (msg.method === 'run.start') {
    const runId = String(msg.params?.run_id || '').trim();
    setTimeout(() => {
      send('run.end', { run_id: runId });
      process.exit(0);
    }, 200);
  }
});

setInterval(() => {}, 1000);
`)

	meta := session.Meta{
		EndpointID:        "env_test",
		NamespacePublicID: "ns_test",
		ChannelID:         "ch_a",
		UserPublicID:      "u_test",
		UserEmail:         "u_test@example.com",
		CanRead:           true,
		CanWrite:          true,
		CanExecute:        true,
		CanAdmin:          true,
	}
	svc := newTestService(t, script, func(o *Options) {
		o.PersistOpTimeout = 50 * time.Millisecond
		o.RunIdleTimeout = 2 * time.Second
		o.RunMaxWallTime = 2 * time.Second
	})

	ctx := context.Background()
	th, err := svc.CreateThread(ctx, &meta, "hello", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	rr := httptest.NewRecorder()
	if err := svc.StartRun(ctx, &meta, "run_test_persist_1", RunStartRequest{
		ThreadID: th.ThreadID,
		Model:    "openai/gpt-5-mini",
		Input:    RunInput{Text: "hi"},
		Options:  RunOptions{MaxSteps: 1},
	}, rr); err != nil {
		t.Fatalf("StartRun: %v", err)
	}

	view, err := svc.GetThread(ctx, &meta, th.ThreadID)
	if err != nil {
		t.Fatalf("GetThread: %v", err)
	}
	if view == nil {
		t.Fatalf("thread missing after run")
	}
	if strings.TrimSpace(view.LastMessagePreview) != "No response." {
		t.Fatalf("last_message_preview=%q, want %q", view.LastMessagePreview, "No response.")
	}
}

func TestRun_CancelRun_ByDifferentChannel_SucceedsAndReleasesLock(t *testing.T) {
	t.Parallel()

	script := writeTestSidecarScript(t, `
import { createInterface } from 'node:readline';
// Intentionally produce no stdout events. The Go side must still be able to cancel and exit.
const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', () => {});
setInterval(() => {}, 1000);
`)

	metaA := session.Meta{
		EndpointID:        "env_test",
		NamespacePublicID: "ns_test",
		ChannelID:         "ch_a",
		UserPublicID:      "u_a",
		UserEmail:         "u_a@example.com",
		CanRead:           true,
		CanWrite:          true,
		CanExecute:        true,
		CanAdmin:          true,
	}
	metaB := session.Meta{
		EndpointID:        "env_test",
		NamespacePublicID: "ns_test",
		ChannelID:         "ch_b",
		UserPublicID:      "u_b",
		UserEmail:         "u_b@example.com",
		CanRead:           true,
	}
	svc := newTestService(t, script)

	ctx := context.Background()
	th, err := svc.CreateThread(ctx, &metaA, "hello", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	runID := "run_test_2"
	runCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()

	done := make(chan error, 1)
	go func() {
		rr := httptest.NewRecorder()
		done <- svc.StartRun(runCtx, &metaA, runID, RunStartRequest{
			ThreadID: th.ThreadID,
			Model:    "openai/gpt-5-mini",
			Input:    RunInput{Text: "hi"},
			Options:  RunOptions{MaxSteps: 1},
		}, rr)
	}()

	deadline := time.Now().Add(500 * time.Millisecond)
	for time.Now().Before(deadline) {
		if svc.HasActiveThreadForEndpoint(metaA.EndpointID, th.ThreadID) {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if !svc.HasActiveThreadForEndpoint(metaA.EndpointID, th.ThreadID) {
		t.Fatalf("expected thread to be busy")
	}

	if err := svc.CancelRun(&metaB, runID); err != nil {
		t.Fatalf("CancelRun: %v", err)
	}

	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("StartRun err: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatalf("StartRun did not exit after cancel")
	}

	if svc.HasActiveThreadForEndpoint(metaA.EndpointID, th.ThreadID) {
		t.Fatalf("thread still busy after cancel")
	}

	view, err := svc.GetThread(ctx, &metaA, th.ThreadID)
	if err != nil {
		t.Fatalf("GetThread: %v", err)
	}
	if view == nil {
		t.Fatalf("thread missing after cancel")
	}
	if strings.TrimSpace(view.LastMessagePreview) != "Canceled." {
		t.Fatalf("last_message_preview=%q, want %q", view.LastMessagePreview, "Canceled.")
	}
}

func TestThread_DeleteForce_CancelsAndDeletes(t *testing.T) {
	t.Parallel()

	script := writeTestSidecarScript(t, `
import { createInterface } from 'node:readline';
// Intentionally produce no stdout events. The Go side must force-cancel and exit.
const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', () => {});
setInterval(() => {}, 1000);
`)

	meta := session.Meta{
		EndpointID:        "env_test",
		NamespacePublicID: "ns_test",
		ChannelID:         "ch_a",
		UserPublicID:      "u_a",
		UserEmail:         "u_a@example.com",
		CanRead:           true,
		CanWrite:          true,
		CanExecute:        true,
		CanAdmin:          true,
	}
	svc := newTestService(t, script)

	ctx := context.Background()
	th, err := svc.CreateThread(ctx, &meta, "hello", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	runID := "run_test_3"
	runCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	done := make(chan error, 1)
	go func() {
		rr := httptest.NewRecorder()
		done <- svc.StartRun(runCtx, &meta, runID, RunStartRequest{
			ThreadID: th.ThreadID,
			Model:    "openai/gpt-5-mini",
			Input:    RunInput{Text: "hi"},
			Options:  RunOptions{MaxSteps: 1},
		}, rr)
	}()

	deadline := time.Now().Add(500 * time.Millisecond)
	for time.Now().Before(deadline) {
		if svc.HasActiveThreadForEndpoint(meta.EndpointID, th.ThreadID) {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if !svc.HasActiveThreadForEndpoint(meta.EndpointID, th.ThreadID) {
		t.Fatalf("expected thread to be busy")
	}

	delCtx, cancelDel := context.WithTimeout(ctx, 2*time.Second)
	defer cancelDel()
	if err := svc.DeleteThread(delCtx, &meta, th.ThreadID, true); err != nil {
		t.Fatalf("DeleteThread(force=true): %v", err)
	}

	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("StartRun err: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatalf("StartRun did not exit after force delete")
	}

	view, err := svc.GetThread(ctx, &meta, th.ThreadID)
	if err != nil {
		t.Fatalf("GetThread: %v", err)
	}
	if view != nil {
		t.Fatalf("thread still exists after force delete: %+v", view)
	}
}

func TestRun_ToolApprovalTimeout_DoesNotHang(t *testing.T) {
	t.Parallel()

	script := writeTestSidecarScript(t, `
import { createInterface } from 'node:readline';

function send(method, params) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
let runId = '';
rl.on('line', (line) => {
  const msg = JSON.parse(String(line || '').trim() || '{}');
  const method = String(msg.method || '').trim();
  if (method === 'run.start') {
    runId = String(msg.params?.run_id || '').trim();
    send('tool.call', {
      run_id: runId,
      tool_id: 'tool_1',
      tool_name: 'fs.write_file',
      args: { path: 'a.txt', content_utf8: 'x', create: true, if_match_sha256: '' },
    });
    return;
  }
  if (method === 'tool.result') {
    send('run.end', { run_id: runId });
    process.exit(0);
  }
});

setInterval(() => {}, 1000);
`)

	meta := session.Meta{
		EndpointID:        "env_test",
		NamespacePublicID: "ns_test",
		ChannelID:         "ch_a",
		UserPublicID:      "u_a",
		UserEmail:         "u_a@example.com",
		CanRead:           true,
		CanWrite:          true,
		CanExecute:        true,
		CanAdmin:          true,
	}
	svc := newTestService(t, script, func(o *Options) {
		o.ToolApprovalTimeout = 80 * time.Millisecond
		o.RunIdleTimeout = 2 * time.Second
		o.RunMaxWallTime = 2 * time.Second
	})

	ctx := context.Background()
	th, err := svc.CreateThread(ctx, &meta, "hello", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	rr := httptest.NewRecorder()
	if err := svc.StartRun(ctx, &meta, "run_test_4", RunStartRequest{
		ThreadID: th.ThreadID,
		Model:    "openai/gpt-5-mini",
		Input:    RunInput{Text: "hi"},
		Options:  RunOptions{MaxSteps: 1},
	}, rr); err != nil {
		t.Fatalf("StartRun: %v", err)
	}

	msgs, err := svc.ListThreadMessages(ctx, &meta, th.ThreadID, 50, 0)
	if err != nil {
		t.Fatalf("ListThreadMessages: %v", err)
	}
	if msgs == nil || len(msgs.Messages) < 2 {
		t.Fatalf("unexpected messages: %+v", msgs)
	}
	raw, ok := msgs.Messages[len(msgs.Messages)-1].(json.RawMessage)
	if !ok || len(raw) == 0 {
		t.Fatalf("unexpected last message type: %T", msgs.Messages[len(msgs.Messages)-1])
	}
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatalf("unmarshal assistant message: %v", err)
	}
	blocks, _ := m["blocks"].([]any)
	found := false
	for _, b := range blocks {
		bm, _ := b.(map[string]any)
		typ, _ := bm["type"].(string)
		if strings.TrimSpace(typ) != "tool-call" {
			continue
		}
		errMsg, _ := bm["error"].(string)
		if strings.TrimSpace(errMsg) == "Approval timed out" {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("missing tool-call error block in assistant message: %s", string(raw))
	}

	view, err := svc.GetThread(ctx, &meta, th.ThreadID)
	if err != nil {
		t.Fatalf("GetThread: %v", err)
	}
	if view == nil {
		t.Fatalf("thread missing after run")
	}
	if strings.TrimSpace(view.LastMessagePreview) != "Tool call failed." {
		t.Fatalf("last_message_preview=%q, want %q", view.LastMessagePreview, "Tool call failed.")
	}
}
