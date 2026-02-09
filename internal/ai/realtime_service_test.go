package ai

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/floegence/redeven-agent/internal/session"
)

func TestStartRunDetached_ImmediateCancelStillStopsRun(t *testing.T) {
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
  if (msg.method === 'run.start') {
    runId = String(msg.params?.run_id || '').trim();
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
		UserPublicID:      "u_a",
		UserEmail:         "u_a@example.com",
		CanRead:           true,
		CanWrite:          true,
		CanExecute:        true,
		CanAdmin:          true,
	}
	svc := newTestService(t, script, map[string]session.Meta{"ch_a": meta})

	ctx := context.Background()
	th, err := svc.CreateThread(ctx, &meta, "hello", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	runID := "run_detached_cancel_1"
	if err := svc.StartRunDetached(&meta, runID, RunStartRequest{
		ThreadID: th.ThreadID,
		Model:    "openai/gpt-5-mini",
		Input:    RunInput{Text: "hi"},
		Options:  RunOptions{MaxSteps: 1},
	}); err != nil {
		t.Fatalf("StartRunDetached: %v", err)
	}

	if err := svc.CancelRun(&meta, runID); err != nil {
		t.Fatalf("CancelRun: %v", err)
	}

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if !svc.HasActiveThreadForEndpoint(meta.EndpointID, th.ThreadID) {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if svc.HasActiveThreadForEndpoint(meta.EndpointID, th.ThreadID) {
		t.Fatalf("run still active after cancel")
	}

	view, err := svc.GetThread(ctx, &meta, th.ThreadID)
	if err != nil {
		t.Fatalf("GetThread: %v", err)
	}
	if view == nil {
		t.Fatalf("thread missing")
	}
	if strings.TrimSpace(view.RunStatus) != "canceled" {
		t.Fatalf("run_status=%q, want canceled", view.RunStatus)
	}
	if strings.TrimSpace(view.LastMessagePreview) != "Canceled." {
		t.Fatalf("last_message_preview=%q, want %q", view.LastMessagePreview, "Canceled.")
	}
}

func TestListActiveThreadRuns_ReturnsDetachedRunSnapshot(t *testing.T) {
	t.Parallel()

	script := writeTestSidecarScript(t, `
import { createInterface } from 'node:readline';
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
	svc := newTestService(t, script, map[string]session.Meta{"ch_a": meta})

	ctx := context.Background()
	th, err := svc.CreateThread(ctx, &meta, "hello", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	runID := "run_detached_snapshot_1"
	if err := svc.StartRunDetached(&meta, runID, RunStartRequest{
		ThreadID: th.ThreadID,
		Model:    "openai/gpt-5-mini",
		Input:    RunInput{Text: "hi"},
		Options:  RunOptions{MaxSteps: 1},
	}); err != nil {
		t.Fatalf("StartRunDetached: %v", err)
	}

	deadline := time.Now().Add(1 * time.Second)
	for time.Now().Before(deadline) {
		if svc.HasActiveThreadForEndpoint(meta.EndpointID, th.ThreadID) {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if !svc.HasActiveThreadForEndpoint(meta.EndpointID, th.ThreadID) {
		t.Fatalf("expected active run")
	}

	runs := svc.ListActiveThreadRuns(meta.EndpointID)
	if len(runs) != 1 {
		t.Fatalf("active run count=%d, want=1", len(runs))
	}
	if runs[0].ThreadID != th.ThreadID {
		t.Fatalf("thread_id=%q, want=%q", runs[0].ThreadID, th.ThreadID)
	}
	if runs[0].RunID != runID {
		t.Fatalf("run_id=%q, want=%q", runs[0].RunID, runID)
	}

	if err := svc.CancelRun(&meta, runID); err != nil {
		t.Fatalf("CancelRun: %v", err)
	}

	deadline = time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if !svc.HasActiveThreadForEndpoint(meta.EndpointID, th.ThreadID) {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("run still active after cancel")
}
