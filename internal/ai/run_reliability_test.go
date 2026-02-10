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
	if strings.TrimSpace(view.LastMessagePreview) != "Assistant finished without a visible response." {
		t.Fatalf("last_message_preview=%q, want %q", view.LastMessagePreview, "Assistant finished without a visible response.")
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
	if strings.TrimSpace(view.LastMessagePreview) != "Assistant finished without a visible response." {
		t.Fatalf("last_message_preview=%q, want %q", view.LastMessagePreview, "Assistant finished without a visible response.")
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
	preview := strings.TrimSpace(view.LastMessagePreview)
	if preview == "" {
		t.Fatalf("last_message_preview should not be empty")
	}
	if !strings.Contains(strings.ToLower(preview), "tool workflow failed") {
		t.Fatalf("last_message_preview=%q, want contains tool workflow failed", view.LastMessagePreview)
	}
}

func TestRun_ToolSuccessWithoutAssistantText_UsesToolFallback(t *testing.T) {
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
    const workingDir = String(msg.params?.working_dir_abs || '').trim();
    if (!workingDir) {
      send('run.error', { run_id: runId, error: 'missing working_dir_abs' });
      return;
    }
    send('tool.call', {
      run_id: runId,
      tool_id: 'tool_pwd_1',
      tool_name: 'terminal.exec',
      args: { command: 'pwd', cwd: workingDir, timeout_ms: 5000 },
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
		ChannelID:         "ch_tool_success",
		UserPublicID:      "u_test",
		UserEmail:         "u_test@example.com",
		CanRead:           true,
		CanWrite:          true,
		CanExecute:        true,
		CanAdmin:          true,
	}

	svc := newTestService(t, script, func(o *Options) {
		o.ToolApprovalTimeout = 2 * time.Second
		o.RunIdleTimeout = 4 * time.Second
		o.RunMaxWallTime = 4 * time.Second
	})

	ctx := context.Background()
	th, err := svc.CreateThread(ctx, &meta, "hello", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	runID := "run_tool_success_fallback_1"
	done := make(chan error, 1)
	go func() {
		rr := httptest.NewRecorder()
		done <- svc.StartRun(ctx, &meta, runID, RunStartRequest{
			ThreadID: th.ThreadID,
			Model:    "openai/gpt-5-mini",
			Input:    RunInput{Text: "run pwd"},
			Options:  RunOptions{MaxSteps: 1},
		}, rr)
	}()

	approved := false
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		err := svc.ApproveTool(&meta, runID, "tool_pwd_1", true)
		if err == nil {
			approved = true
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if !approved {
		t.Fatalf("failed to approve tool call before deadline")
	}

	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("StartRun: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatalf("StartRun did not finish")
	}

	view, err := svc.GetThread(ctx, &meta, th.ThreadID)
	if err != nil {
		t.Fatalf("GetThread: %v", err)
	}
	if view == nil {
		t.Fatalf("thread missing after run")
	}
	if !strings.Contains(view.LastMessagePreview, "Command output:") {
		t.Fatalf("last_message_preview=%q, want tool fallback summary", view.LastMessagePreview)
	}
	if strings.Contains(view.LastMessagePreview, "Assistant finished without a visible response.") {
		t.Fatalf("last_message_preview unexpectedly fell back to No response: %q", view.LastMessagePreview)
	}
}

func TestRun_RecoveryAutoContinuesWhenAssistantOnlyPreamble(t *testing.T) {
	t.Parallel()

	script := writeTestSidecarScript(t, `
import { createInterface } from 'node:readline';

function send(method, params) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
}

let runId = '';
let phase = 0;
const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', (line) => {
  const msg = JSON.parse(String(line || '').trim() || '{}');
  const method = String(msg.method || '').trim();

  if (method === 'run.start') {
    runId = String(msg.params?.run_id || '').trim();
    const attempt = Number(msg.params?.recovery?.attempt_index || 0);
    const workingDir = String(msg.params?.working_dir_abs || '').trim();

    if (attempt === 0) {
      send('run.delta', { run_id: runId, delta: '我先快速扫一遍项目结构和关键配置，然后给你结论。' });
      send('run.end', { run_id: runId });
      return;
    }

    if (!workingDir) {
      send('run.error', { run_id: runId, error: 'missing working_dir_abs for recovery attempt' });
      return;
    }
    phase = 1;
    send('tool.call', {
      run_id: runId,
      tool_id: 'tool_ls_1',
      tool_name: 'fs.list_dir',
      args: { path: workingDir },
    });
    return;
  }

  if (method === 'tool.result' && phase === 1) {
    send('run.delta', { run_id: runId, delta: 'Listed working directory and finished analysis.' });
    send('run.end', { run_id: runId });
    process.exit(0);
  }
});

setInterval(() => {}, 1000);
`)

	meta := session.Meta{
		EndpointID:        "env_test",
		NamespacePublicID: "ns_test",
		ChannelID:         "ch_recovery_retry",
		UserPublicID:      "u_test",
		UserEmail:         "u_test@example.com",
		CanRead:           true,
		CanWrite:          true,
		CanExecute:        true,
		CanAdmin:          true,
	}

	svc := newTestService(t, script, func(o *Options) {
		o.RunIdleTimeout = 4 * time.Second
		o.RunMaxWallTime = 4 * time.Second
	})

	ctx := context.Background()
	th, err := svc.CreateThread(ctx, &meta, "hello", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	rr := httptest.NewRecorder()
	if err := svc.StartRun(ctx, &meta, "run_recovery_retry_1", RunStartRequest{
		ThreadID: th.ThreadID,
		Model:    "openai/gpt-5-mini",
		Input:    RunInput{Text: "帮我分析一下这个项目结构"},
		Options:  RunOptions{MaxSteps: 2},
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
	if !strings.Contains(view.LastMessagePreview, "Listed working directory") {
		t.Fatalf("last_message_preview=%q, want recovery completion text, stream=%q", view.LastMessagePreview, rr.Body.String())
	}
	if strings.Contains(view.LastMessagePreview, "Assistant finished without a visible response.") {
		t.Fatalf("last_message_preview unexpectedly fell back to no response: %q", view.LastMessagePreview)
	}
}

func TestRun_RunErrorAfterPreamble_PersistsAssistantMessage(t *testing.T) {
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
    send('run.delta', { run_id: runId, delta: 'I will inspect the repository first.' });
    send('run.error', { run_id: runId, error: 'mock sidecar failure' });
    process.exit(0);
  }
});

setInterval(() => {}, 1000);
`)

	meta := session.Meta{
		EndpointID:        "env_test",
		NamespacePublicID: "ns_test",
		ChannelID:         "ch_run_error",
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
	err = svc.StartRun(ctx, &meta, "run_error_persist_1", RunStartRequest{
		ThreadID: th.ThreadID,
		Model:    "openai/gpt-5-mini",
		Input:    RunInput{Text: "scan project"},
		Options:  RunOptions{MaxSteps: 1},
	}, rr)
	if err == nil {
		t.Fatalf("expected StartRun error when sidecar emits run.error")
	}

	view, getErr := svc.GetThread(ctx, &meta, th.ThreadID)
	if getErr != nil {
		t.Fatalf("GetThread: %v", getErr)
	}
	if view == nil {
		t.Fatalf("thread missing after run")
	}
	if strings.TrimSpace(view.LastMessagePreview) == "" {
		t.Fatalf("last_message_preview should not be empty after streamed preamble")
	}
	if !strings.Contains(view.LastMessagePreview, "inspect the repository") {
		t.Fatalf("last_message_preview=%q, want streamed preamble", view.LastMessagePreview)
	}

	msgs, listErr := svc.ListThreadMessages(ctx, &meta, th.ThreadID, 50, 0)
	if listErr != nil {
		t.Fatalf("ListThreadMessages: %v", listErr)
	}
	if msgs == nil || len(msgs.Messages) < 2 {
		t.Fatalf("expected persisted assistant message after run.error, got %+v", msgs)
	}
}

func TestRun_RecoveryContinuesAfterToolErrorUntilSuccess(t *testing.T) {
	t.Parallel()

	script := writeTestSidecarScript(t, `
import { createInterface } from 'node:readline';

function send(method, params) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
}

let runId = '';
let attempt = 0;
const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', (line) => {
  const msg = JSON.parse(String(line || '').trim() || '{}');
  const method = String(msg.method || '').trim();

  if (method === 'run.start') {
    runId = String(msg.params?.run_id || '').trim();
    attempt = Number(msg.params?.recovery?.attempt_index || 0);
    if (attempt === 0) {
      send('tool.call', {
        run_id: runId,
        tool_id: 'tool_stat_1',
        tool_name: 'fs.stat',
        args: { path: '/missing-target' },
      });
      return;
    }

    send('tool.call', {
      run_id: runId,
      tool_id: 'tool_stat_2',
      tool_name: 'fs.stat',
      args: { path: '/' },
    });
    return;
  }

  if (method === 'tool.result') {
    if (attempt === 0) {
      send('run.end', { run_id: runId });
      return;
    }

    if (String(msg.params?.status || '') === 'success') {
      send('run.delta', { run_id: runId, delta: 'Recovered after tool failure and continued successfully.' });
      send('run.end', { run_id: runId });
      process.exit(0);
      return;
    }

    send('run.error', { run_id: runId, error: 'expected success on recovery attempt' });
    process.exit(1);
  }
});

setInterval(() => {}, 1000);
`)

	meta := session.Meta{
		EndpointID:        "env_test",
		NamespacePublicID: "ns_test",
		ChannelID:         "ch_recovery_tool_error",
		UserPublicID:      "u_test",
		UserEmail:         "u_test@example.com",
		CanRead:           true,
		CanWrite:          true,
		CanExecute:        true,
		CanAdmin:          true,
	}

	svc := newTestService(t, script, func(o *Options) {
		o.RunIdleTimeout = 4 * time.Second
		o.RunMaxWallTime = 4 * time.Second
	})

	ctx := context.Background()
	th, err := svc.CreateThread(ctx, &meta, "hello", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	rr := httptest.NewRecorder()
	if err := svc.StartRun(ctx, &meta, "run_recovery_after_tool_error_1", RunStartRequest{
		ThreadID: th.ThreadID,
		Model:    "openai/gpt-5-mini",
		Input:    RunInput{Text: "Call fs.stat for '/' and report whether it is a directory."},
		Options:  RunOptions{MaxSteps: 2},
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
	if !strings.Contains(view.LastMessagePreview, "Recovered after tool failure") {
		t.Fatalf("last_message_preview=%q, want recovery completion text", view.LastMessagePreview)
	}
	if strings.Contains(view.LastMessagePreview, "Tool workflow failed") {
		t.Fatalf("last_message_preview unexpectedly ended at tool failure: %q", view.LastMessagePreview)
	}
}

func TestRun_FSStatAbsoluteRootReturnsDirectory(t *testing.T) {
	t.Parallel()

	script := writeTestSidecarScript(t, `
import { createInterface } from 'node:readline';

function send(method, params) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
}

let runId = '';
const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', (line) => {
  const msg = JSON.parse(String(line || '').trim() || '{}');
  const method = String(msg.method || '').trim();

  if (method === 'run.start') {
    runId = String(msg.params?.run_id || '').trim();
    send('tool.call', {
      run_id: runId,
      tool_id: 'tool_stat_root_1',
      tool_name: 'fs.stat',
      args: { path: '/' },
    });
    return;
  }

  if (method === 'tool.result') {
    if (String(msg.params?.status || '') !== 'success') {
      send('run.error', { run_id: runId, error: 'expected fs.stat absolute root success' });
      process.exit(1);
      return;
    }
    const isDir = Boolean(msg.params?.result?.is_dir);
    send('run.delta', { run_id: runId, delta: isDir ? 'It is a directory.' : 'It is not a directory.' });
    send('run.end', { run_id: runId });
    process.exit(0);
  }
});

setInterval(() => {}, 1000);
`)

	meta := session.Meta{
		EndpointID:        "env_test",
		NamespacePublicID: "ns_test",
		ChannelID:         "ch_stat_root",
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
	if err := svc.StartRun(ctx, &meta, "run_stat_root_slash_1", RunStartRequest{
		ThreadID: th.ThreadID,
		Model:    "openai/gpt-5-mini",
		Input:    RunInput{Text: "Call fs.stat for '/'. Then output whether it is directory."},
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
	if !strings.Contains(strings.ToLower(view.LastMessagePreview), "directory") {
		t.Fatalf("last_message_preview=%q, want directory conclusion", view.LastMessagePreview)
	}
	if strings.Contains(view.LastMessagePreview, "Tool workflow failed") {
		t.Fatalf("last_message_preview should not be tool failure: %q", view.LastMessagePreview)
	}
}

func TestRun_CompletionAutoContinuesAfterToolCallsWithoutSynthesis(t *testing.T) {
	t.Parallel()

	script := writeTestSidecarScript(t, `
import { createInterface } from 'node:readline';

function send(method, params) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
}

let runId = '';
let stage = 0;
const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', (line) => {
  const msg = JSON.parse(String(line || '').trim() || '{}');
  const method = String(msg.method || '').trim();

  if (method === 'run.start') {
    runId = String(msg.params?.run_id || '').trim();
    const attempt = Number(msg.params?.recovery?.attempt_index || 0);
    if (attempt === 0) {
      stage = 1;
      send('tool.call', {
        run_id: runId,
        tool_id: 'tool_stat_1',
        tool_name: 'fs.stat',
        args: { path: '/' },
      });
      return;
    }

    send('run.delta', { run_id: runId, delta: 'Final answer after synthesis. Root path is a directory.' });
    send('run.end', { run_id: runId });
    process.exit(0);
    return;
  }

  if (method === 'tool.result' && stage === 1) {
    stage = 2;
    send('run.end', { run_id: runId });
    return;
  }
});

setInterval(() => {}, 1000);
`)

	meta := session.Meta{
		EndpointID:        "env_test",
		NamespacePublicID: "ns_test",
		ChannelID:         "ch_completion_after_tool",
		UserPublicID:      "u_test",
		UserEmail:         "u_test@example.com",
		CanRead:           true,
		CanWrite:          true,
		CanExecute:        true,
		CanAdmin:          true,
	}

	svc := newTestService(t, script, func(o *Options) {
		o.RunIdleTimeout = 4 * time.Second
		o.RunMaxWallTime = 4 * time.Second
	})

	ctx := context.Background()
	th, err := svc.CreateThread(ctx, &meta, "hello", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	rr := httptest.NewRecorder()
	if err := svc.StartRun(ctx, &meta, "run_completion_after_tool_1", RunStartRequest{
		ThreadID: th.ThreadID,
		Model:    "openai/gpt-5-mini",
		Input:    RunInput{Text: "Call fs.stat for '/'. Then output whether it is directory."},
		Options:  RunOptions{MaxSteps: 2},
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
	if !strings.Contains(view.LastMessagePreview, "Final answer after synthesis") {
		t.Fatalf("last_message_preview=%q, want synthesized completion text", view.LastMessagePreview)
	}
	if strings.Contains(strings.ToLower(view.LastMessagePreview), "path metadata loaded") {
		t.Fatalf("last_message_preview unexpectedly used tool fallback text: %q", view.LastMessagePreview)
	}
}

func TestRun_CompletionAutoContinuesAfterToolCallsWithoutRequiresToolsHint(t *testing.T) {
	script := writeTestSidecarScript(t, `
import { createInterface } from 'node:readline';

function send(method, params) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
}

let runId = '';
let stage = 0;
const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', (line) => {
  const msg = JSON.parse(String(line || '').trim() || '{}');
  const method = String(msg.method || '').trim();

  if (method === 'run.start') {
    runId = String(msg.params?.run_id || '').trim();
    const attempt = Number(msg.params?.recovery?.attempt_index || 0);
    if (attempt === 0) {
      stage = 1;
      send('tool.call', {
        run_id: runId,
        tool_id: 'tool_stat_1',
        tool_name: 'fs.stat',
        args: { path: '/' },
      });
      return;
    }

    send('run.delta', { run_id: runId, delta: 'Synthesized answer after completion retry.' });
    send('run.end', { run_id: runId });
    process.exit(0);
    return;
  }

  if (method === 'tool.result' && stage === 1) {
    stage = 2;
    send('run.end', { run_id: runId });
    return;
  }
});

setInterval(() => {}, 1000);
`)

	meta := session.Meta{
		EndpointID:        "env_test",
		NamespacePublicID: "ns_test",
		ChannelID:         "ch_completion_without_requires_tools",
		UserPublicID:      "u_test",
		UserEmail:         "u_test@example.com",
		CanRead:           true,
		CanWrite:          true,
		CanExecute:        true,
		CanAdmin:          true,
	}

	svc := newTestService(t, script, func(o *Options) {
		o.RunIdleTimeout = 4 * time.Second
		o.RunMaxWallTime = 4 * time.Second
	})

	ctx := context.Background()
	th, err := svc.CreateThread(ctx, &meta, "hello", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	rr := httptest.NewRecorder()
	if err := svc.StartRun(ctx, &meta, "run_completion_without_requires_tools_1", RunStartRequest{
		ThreadID: th.ThreadID,
		Model:    "openai/gpt-5-mini",
		Input:    RunInput{Text: "continue"},
		Options:  RunOptions{MaxSteps: 2},
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
	if !strings.Contains(view.LastMessagePreview, "Synthesized answer after completion retry") {
		t.Fatalf("last_message_preview=%q, want synthesized completion text", view.LastMessagePreview)
	}
}

func TestRun_ContinueDerivesGoalFromHistoryAndToolMemory(t *testing.T) {
	script := writeTestSidecarScript(t, `
import { createInterface } from 'node:readline';

function send(method, params) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
}

let runId = '';
let stage = 0;
const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', (line) => {
  const msg = JSON.parse(String(line || '').trim() || '{}');
  const method = String(msg.method || '').trim();

  if (method === 'run.start') {
    runId = String(msg.params?.run_id || '').trim();
    const inputText = String(msg.params?.input?.text || '').trim();
    const openGoal = String(msg.params?.context_package?.open_goal || '').trim();
    const toolMemories = Array.isArray(msg.params?.context_package?.tool_memories)
      ? msg.params.context_package.tool_memories
      : [];

    if (inputText.includes('continue')) {
      if (!openGoal.includes('Remember this objective for later')) {
        send('run.error', { run_id: runId, error: 'missing open goal fallback from history' });
        return;
      }
      if (!toolMemories.some((it) => String(it?.tool_name || '').trim() === 'fs.stat')) {
        send('run.error', { run_id: runId, error: 'missing tool memory in context package' });
        return;
      }
      send('run.delta', { run_id: runId, delta: 'Continue resumed with remembered goal and tool memory.' });
      send('run.end', { run_id: runId });
      process.exit(0);
      return;
    }

    stage = 1;
    send('tool.call', {
      run_id: runId,
      tool_id: 'tool_stat_1',
      tool_name: 'fs.stat',
      args: { path: '/' },
    });
    return;
  }

  if (method === 'tool.result' && stage === 1) {
    stage = 2;
    send('run.delta', { run_id: runId, delta: 'Workspace stat captured successfully.\n- Root maps to workspace directory.\n- Objective recorded and this turn is complete.' });
    send('run.end', { run_id: runId });
    return;
  }
});

setInterval(() => {}, 1000);
`)

	meta := session.Meta{
		EndpointID:        "env_test",
		NamespacePublicID: "ns_test",
		ChannelID:         "ch_continue_goal_tool_memory",
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

	rr1 := httptest.NewRecorder()
	if err := svc.StartRun(ctx, &meta, "run_continue_goal_tool_memory_1", RunStartRequest{
		ThreadID: th.ThreadID,
		Model:    "openai/gpt-5-mini",
		Input:    RunInput{Text: "Remember this objective for later"},
		Options:  RunOptions{MaxSteps: 2},
	}, rr1); err != nil {
		t.Fatalf("StartRun first attempt: %v", err)
	}

	rr2 := httptest.NewRecorder()
	if err := svc.StartRun(ctx, &meta, "run_continue_goal_tool_memory_2", RunStartRequest{
		ThreadID: th.ThreadID,
		Model:    "openai/gpt-5-mini",
		Input:    RunInput{Text: "continue"},
		Options:  RunOptions{MaxSteps: 2},
	}, rr2); err != nil {
		t.Fatalf("StartRun continue: %v", err)
	}

	view, err := svc.GetThread(ctx, &meta, th.ThreadID)
	if err != nil {
		t.Fatalf("GetThread: %v", err)
	}
	if view == nil {
		t.Fatalf("thread missing after continue run")
	}
	if !strings.Contains(view.LastMessagePreview, "Continue resumed with remembered goal") {
		t.Fatalf("last_message_preview=%q, want resumed goal and tool memory text", view.LastMessagePreview)
	}
}

func TestRun_ContinueUsesOpenGoalState(t *testing.T) {
	t.Parallel()

	script := writeTestSidecarScript(t, `
import { createInterface } from 'node:readline';

function send(method, params) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', (line) => {
  const msg = JSON.parse(String(line || '').trim() || '{}');
  if (msg.method !== 'run.start') {
    return;
  }

  const runId = String(msg.params?.run_id || '').trim();
  const inputText = String(msg.params?.input?.text || '').trim();
  const openGoal = String(msg.params?.context_package?.open_goal || '').trim();

  if (inputText.includes('Open goal:')) {
    if (!openGoal.includes('帮我分析一下项目结构')) {
      send('run.error', { run_id: runId, error: 'missing open goal in context package' });
      return;
    }
    send('run.delta', { run_id: runId, delta: 'Resumed open goal and continued analysis successfully.' });
    send('run.end', { run_id: runId });
    process.exit(0);
    return;
  }

  send('run.error', { run_id: runId, error: 'mock first run failure' });
});

setInterval(() => {}, 1000);
`)

	meta := session.Meta{
		EndpointID:        "env_test",
		NamespacePublicID: "ns_test",
		ChannelID:         "ch_continue_goal",
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

	rr1 := httptest.NewRecorder()
	err = svc.StartRun(ctx, &meta, "run_continue_goal_1", RunStartRequest{
		ThreadID: th.ThreadID,
		Model:    "openai/gpt-5-mini",
		Input:    RunInput{Text: "帮我分析一下项目结构"},
		Options:  RunOptions{MaxSteps: 1},
	}, rr1)
	if err == nil {
		t.Fatalf("StartRun first attempt: want error, got nil")
	}

	rr2 := httptest.NewRecorder()
	if err := svc.StartRun(ctx, &meta, "run_continue_goal_2", RunStartRequest{
		ThreadID: th.ThreadID,
		Model:    "openai/gpt-5-mini",
		Input:    RunInput{Text: "continue"},
		Options:  RunOptions{MaxSteps: 1},
	}, rr2); err != nil {
		t.Fatalf("StartRun continue: %v", err)
	}

	view, err := svc.GetThread(ctx, &meta, th.ThreadID)
	if err != nil {
		t.Fatalf("GetThread: %v", err)
	}
	if view == nil {
		t.Fatalf("thread missing after continue run")
	}
	if !strings.Contains(view.LastMessagePreview, "Resumed open goal") {
		t.Fatalf("last_message_preview=%q, want resumed goal text", view.LastMessagePreview)
	}
}

func TestRun_TaskLoopAutoContinuesForProjectAnalysis(t *testing.T) {
	t.Parallel()

	script := writeTestSidecarScript(t, `
import { createInterface } from 'node:readline';

function send(method, params) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
}

let runId = '';
let attempt = 0;
const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', (line) => {
  const msg = JSON.parse(String(line || '').trim() || '{}');
  const method = String(msg.method || '').trim();

  if (method === 'run.start') {
    runId = String(msg.params?.run_id || '').trim();
    attempt = Number(msg.params?.recovery?.attempt_index || 0);
    const inputText = String(msg.params?.input?.text || '').trim();
    const workingDir = String(msg.params?.working_dir_abs || '').trim();

    if (attempt === 0) {
      send('tool.call', {
        run_id: runId,
        tool_id: 'tool_list_1',
        tool_name: 'fs.list_dir',
        args: { path: '/' },
      });
      return;
    }

    if (attempt === 1) {
      if (!inputText.includes('Collect concrete evidence')) {
        send('run.error', { run_id: runId, error: 'missing task evidence follow-up prompt' });
        return;
      }
      const toolMemories = Array.isArray(msg.params?.context_package?.tool_memories)
        ? msg.params.context_package.tool_memories
        : [];
      const hasListEvidence = toolMemories.some((it) =>
        String(it?.tool_name || '').trim() === 'fs.list_dir' &&
        String(it?.status || '').trim().toLowerCase() === 'success'
      );
      if (!hasListEvidence) {
        send('run.error', { run_id: runId, error: 'missing previous tool memory for follow-up attempt' });
        return;
      }
      if (!workingDir) {
        send('run.error', { run_id: runId, error: 'missing working_dir_abs for evidence attempt' });
        return;
      }
      const sep = workingDir.endsWith('/') ? '' : '/';
      send('tool.call', {
        run_id: runId,
        tool_id: 'tool_readme_1',
        tool_name: 'fs.read_file',
        args: { path: workingDir + sep + 'README.md', offset: 0, max_bytes: 4096 },
      });
      return;
    }

    send('run.error', { run_id: runId, error: 'unexpected extra attempt' });
    return;
  }

  if (method === 'tool.result') {
    if (attempt === 0) {
      send('run.delta', {
        run_id: runId,
        delta: 'This repository appears modular with multiple service directories and deployment assets. The structure indicates organized engineering practices across backend, frontend, and infrastructure concerns. This initial scan is useful, but it does not yet include file-level evidence.',
      });
      send('run.end', { run_id: runId });
      return;
    }

    if (attempt === 1) {
      if (String(msg.params?.status || '') !== 'success') {
        send('run.error', { run_id: runId, error: 'expected read_file success on evidence attempt' });
        return;
      }
      send('run.delta', {
        run_id: runId,
        delta: 'Findings:\n- The project is a Go-based agent with sidecar orchestration.\nEvidence:\n- README.md confirms setup and run commands.\nNext steps:\n- Inspect internal/ai and scripts for operational details.',
      });
      send('run.end', { run_id: runId });
      process.exit(0);
      return;
    }
  }
});

setInterval(() => {}, 1000);
`)

	fsRoot := t.TempDir()
	if err := os.WriteFile(filepath.Join(fsRoot, "README.md"), []byte("# test readme\n"), 0o600); err != nil {
		t.Fatalf("write README.md: %v", err)
	}

	meta := session.Meta{
		EndpointID:        "env_test",
		NamespacePublicID: "ns_test",
		ChannelID:         "ch_task_loop_analysis",
		UserPublicID:      "u_test",
		UserEmail:         "u_test@example.com",
		CanRead:           true,
		CanWrite:          true,
		CanExecute:        true,
		CanAdmin:          true,
	}

	svc := newTestService(t, script, func(o *Options) {
		o.FSRoot = fsRoot
		o.RunIdleTimeout = 4 * time.Second
		o.RunMaxWallTime = 6 * time.Second
	})

	ctx := context.Background()
	th, err := svc.CreateThread(ctx, &meta, "hello", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	rr := httptest.NewRecorder()
	if err := svc.StartRun(ctx, &meta, "run_task_loop_analysis_1", RunStartRequest{
		ThreadID: th.ThreadID,
		Model:    "openai/gpt-5-mini",
		Input:    RunInput{Text: "帮我分析一下~/Downloads/code/redeven这个项目"},
		Options:  RunOptions{MaxSteps: 2},
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
	if !strings.Contains(view.LastMessagePreview, "Evidence:") {
		t.Fatalf("last_message_preview=%q, want evidence-based final answer", view.LastMessagePreview)
	}
	if strings.Contains(strings.ToLower(view.LastMessagePreview), "loop budget") {
		t.Fatalf("last_message_preview unexpectedly leaked loop budget wording: %q", view.LastMessagePreview)
	}
	if strings.Contains(rr.Body.String(), `"block":{"type":"markdown","content":""}`) {
		t.Fatalf("stream unexpectedly rewrote markdown content during auto-continue: %q", rr.Body.String())
	}
}

func TestRun_RecoveryFallsBackAfterApprovalDeniedTool(t *testing.T) {
	t.Parallel()

	script := writeTestSidecarScript(t, `
import { createInterface } from 'node:readline';

function send(method, params) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
}

let runId = '';
let attempt = 0;
const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', (line) => {
  const msg = JSON.parse(String(line || '').trim() || '{}');
  const method = String(msg.method || '').trim();

  if (method === 'run.start') {
    runId = String(msg.params?.run_id || '').trim();
    attempt = Number(msg.params?.recovery?.attempt_index || 0);
    const workingDir = String(msg.params?.working_dir_abs || '').trim();

    if (attempt === 0) {
      send('tool.call', {
        run_id: runId,
        tool_id: 'tool_exec_1',
        tool_name: 'terminal.exec',
        args: { command: 'pwd', cwd: workingDir, timeout_ms: 2000 },
      });
      return;
    }

    const sep = workingDir.endsWith('/') ? '' : '/';
    send('tool.call', {
      run_id: runId,
      tool_id: 'tool_readme_1',
      tool_name: 'fs.read_file',
      args: { path: workingDir + sep + 'README.md', offset: 0, max_bytes: 2048 },
    });
    return;
  }

  if (method === 'tool.result') {
    if (attempt === 0) {
      if (String(msg.params?.status || '').trim().toLowerCase() !== 'error') {
        send('run.error', { run_id: runId, error: 'expected approval denied error on first attempt' });
        process.exit(1);
        return;
      }
      const code = String(msg.params?.error?.code || '').trim().toUpperCase();
      if (code !== 'TIMEOUT' && code !== 'PERMISSION_DENIED') {
        send('run.error', { run_id: runId, error: 'unexpected approval error code: ' + code });
        process.exit(1);
        return;
      }
      send('run.end', { run_id: runId });
      return;
    }

    if (String(msg.params?.status || '').trim().toLowerCase() !== 'success') {
      send('run.error', { run_id: runId, error: 'expected fs.read_file success on fallback attempt' });
      process.exit(1);
      return;
    }

    send('run.delta', {
      run_id: runId,
      delta: 'Recovered after approval denial by switching to fs.read_file evidence from README.md.',
    });
    send('run.end', { run_id: runId });
    process.exit(0);
  }
});

setInterval(() => {}, 1000);
`)

	fsRoot := t.TempDir()
	if err := os.WriteFile(filepath.Join(fsRoot, "README.md"), []byte("# fallback evidence\n"), 0o600); err != nil {
		t.Fatalf("write README.md: %v", err)
	}

	meta := session.Meta{
		EndpointID:        "env_test",
		NamespacePublicID: "ns_test",
		ChannelID:         "ch_recovery_approval_denied",
		UserPublicID:      "u_test",
		UserEmail:         "u_test@example.com",
		CanRead:           true,
		CanWrite:          true,
		CanExecute:        true,
		CanAdmin:          true,
	}

	svc := newTestService(t, script, func(o *Options) {
		o.FSRoot = fsRoot
		o.ToolApprovalTimeout = 80 * time.Millisecond
		o.RunIdleTimeout = 4 * time.Second
		o.RunMaxWallTime = 6 * time.Second
	})

	ctx := context.Background()
	th, err := svc.CreateThread(ctx, &meta, "hello", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	rr := httptest.NewRecorder()
	if err := svc.StartRun(ctx, &meta, "run_recovery_approval_denied_1", RunStartRequest{
		ThreadID: th.ThreadID,
		Model:    "openai/gpt-5-mini",
		Input:    RunInput{Text: "帮我分析一下~/Downloads/code/redeven这个项目"},
		Options:  RunOptions{MaxSteps: 3},
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
	if !strings.Contains(view.LastMessagePreview, "Recovered after approval denial") {
		t.Fatalf("last_message_preview=%q, want fallback recovery completion text", view.LastMessagePreview)
	}
	if strings.Contains(view.LastMessagePreview, "Tool workflow failed") {
		t.Fatalf("last_message_preview unexpectedly ended at tool failure: %q", view.LastMessagePreview)
	}
}
