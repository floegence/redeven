package gateway

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/floegence/redeven-agent/internal/ai"
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

func TestGateway_AI_ThreadDeleteForceStopsActiveRun(t *testing.T) {
	t.Parallel()

	// Sidecar emits nothing so the run blocks in recv().
	script := writeTestSidecarScript(t, `
import { createInterface } from 'node:readline';
const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', () => {});
setInterval(() => {}, 1000);
`)

	logger := slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{Level: slog.LevelInfo}))
	stateDir := t.TempDir()
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

	channelID := "ch_test_ai_1"
	envOrigin := envOriginWithChannel(channelID)
	meta := session.Meta{
		EndpointID:        "env_123",
		NamespacePublicID: "ns_test",
		UserPublicID:      "u_test",
		UserEmail:         "u_test@example.com",
		CanRead:           true,
		CanWrite:          true,
		CanExecute:        true,
		CanAdmin:          true,
	}
	resolveMeta := resolveMetaForTest(channelID, meta)

	aiSvc, err := ai.NewService(ai.Options{
		Logger:            logger,
		StateDir:          stateDir,
		FSRoot:            stateDir,
		Shell:             "bash",
		Config:            cfg,
		SidecarScriptPath: script,
		RunMaxWallTime:    5 * time.Second,
		RunIdleTimeout:    5 * time.Second,
		ResolveProviderAPIKey: func(string) (string, bool, error) {
			return "sk-test", true, nil
		},
	})
	if err != nil {
		t.Fatalf("ai.NewService: %v", err)
	}
	t.Cleanup(func() { _ = aiSvc.Close() })

	dist := fstest.MapFS{
		"env/index.html": {Data: []byte("<html>env</html>")},
		"inject.js":      {Data: []byte("console.log('inject');")},
	}
	gw, err := New(Options{
		Logger:             logger,
		Backend:            &stubBackend{},
		DistFS:             dist,
		ListenAddr:         "127.0.0.1:0",
		ConfigPath:         writeTestConfigWithAI(t),
		ResolveSessionMeta: resolveMeta,
		AI:                 aiSvc,
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	// Create thread.
	var threadID string
	{
		req := httptest.NewRequest(http.MethodPost, "/_redeven_proxy/api/ai/threads", bytes.NewBufferString(`{"title":"hello"}`))
		req.Header.Set("Origin", envOrigin)
		rr := httptest.NewRecorder()
		gw.serveHTTP(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("create thread status=%d body=%s", rr.Code, rr.Body.String())
		}
		var resp struct {
			OK   bool `json:"ok"`
			Data struct {
				Thread struct {
					ThreadID string `json:"thread_id"`
				} `json:"thread"`
			} `json:"data"`
		}
		if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
			t.Fatalf("unmarshal: %v", err)
		}
		threadID = strings.TrimSpace(resp.Data.Thread.ThreadID)
		if !resp.OK || threadID == "" {
			t.Fatalf("unexpected response: %s", rr.Body.String())
		}
	}

	// Start run (blocks).
	runDone := make(chan struct{})
	go func() {
		defer close(runDone)
		body := map[string]any{
			"thread_id": threadID,
			"model":     "openai/gpt-5-mini",
			"input":     map[string]any{"text": "hi", "attachments": []any{}},
			"options":   map[string]any{"max_steps": 1},
		}
		b, _ := json.Marshal(body)
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		req := httptest.NewRequest(http.MethodPost, "/_redeven_proxy/api/ai/runs", bytes.NewBuffer(b)).WithContext(ctx)
		req.Header.Set("Origin", envOrigin)
		rr := httptest.NewRecorder()
		gw.serveHTTP(rr, req)
	}()

	deadline := time.Now().Add(800 * time.Millisecond)
	for time.Now().Before(deadline) {
		if aiSvc.HasActiveThreadForEndpoint(meta.EndpointID, threadID) {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if !aiSvc.HasActiveThreadForEndpoint(meta.EndpointID, threadID) {
		t.Fatalf("expected thread to be busy")
	}

	// Delete without force should be rejected (busy).
	{
		req := httptest.NewRequest(http.MethodDelete, "/_redeven_proxy/api/ai/threads/"+threadID, nil)
		req.Header.Set("Origin", envOrigin)
		rr := httptest.NewRecorder()
		gw.serveHTTP(rr, req)
		if rr.Code != http.StatusConflict {
			t.Fatalf("delete status=%d, want=%d body=%s", rr.Code, http.StatusConflict, rr.Body.String())
		}
	}

	// Force delete should stop the run and delete the thread.
	{
		req := httptest.NewRequest(http.MethodDelete, "/_redeven_proxy/api/ai/threads/"+threadID+"?force=true", nil)
		req.Header.Set("Origin", envOrigin)
		rr := httptest.NewRecorder()
		gw.serveHTTP(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("force delete status=%d body=%s", rr.Code, rr.Body.String())
		}
	}

	select {
	case <-runDone:
	case <-time.After(2 * time.Second):
		t.Fatalf("run did not exit after force delete")
	}

	// Thread should be gone.
	{
		req := httptest.NewRequest(http.MethodGet, "/_redeven_proxy/api/ai/threads/"+threadID, nil)
		req.Header.Set("Origin", envOrigin)
		rr := httptest.NewRecorder()
		gw.serveHTTP(rr, req)
		if rr.Code != http.StatusNotFound {
			t.Fatalf("get thread status=%d, want=%d body=%s", rr.Code, http.StatusNotFound, rr.Body.String())
		}
	}
}

func TestGateway_AI_Run_LocalUI_ToolCallUsesRunSessionMeta(t *testing.T) {
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
      tool_id: 'tool_local_1',
      tool_name: 'fs.read_file',
      args: { path: '/note.txt', offset: 0, max_bytes: 1024 },
    });
    return;
  }
  if (method === 'tool.result') {
    const ok = Boolean(msg.params?.ok);
    if (ok) {
      const content = String(msg.params?.result?.content_utf8 || '').trim();
      send('run.delta', { run_id: runId, delta: 'Tool read: ' + content });
    } else {
      send('run.delta', { run_id: runId, delta: 'Tool failed: ' + String(msg.params?.error || '') });
    }
    send('run.end', { run_id: runId });
    process.exit(0);
  }
});

setInterval(() => {}, 1000);
`)

	logger := slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{Level: slog.LevelInfo}))
	stateDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(stateDir, "note.txt"), []byte("hello-local-ui"), 0o600); err != nil {
		t.Fatalf("write note file: %v", err)
	}
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

	aiSvc, err := ai.NewService(ai.Options{
		Logger:            logger,
		StateDir:          stateDir,
		FSRoot:            stateDir,
		Shell:             "bash",
		Config:            cfg,
		SidecarScriptPath: script,
		RunMaxWallTime:    5 * time.Second,
		RunIdleTimeout:    5 * time.Second,
		ResolveProviderAPIKey: func(string) (string, bool, error) {
			return "sk-test", true, nil
		},
	})
	if err != nil {
		t.Fatalf("ai.NewService: %v", err)
	}
	t.Cleanup(func() { _ = aiSvc.Close() })

	dist := fstest.MapFS{
		"env/index.html": {Data: []byte("<html>env</html>")},
		"inject.js":      {Data: []byte("console.log('inject');")},
	}
	localOrigin := "http://127.0.0.1:4310"
	gw, err := New(Options{
		Logger:     logger,
		Backend:    &stubBackend{},
		DistFS:     dist,
		ListenAddr: "127.0.0.1:0",
		ConfigPath: writeTestConfigWithAI(t),
		AI:         aiSvc,
		ResolveSessionMeta: func(string) (*session.Meta, bool) {
			return nil, false
		},
		LocalUIAllowedOrigins: []string{localOrigin},
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	var threadID string
	{
		req := httptest.NewRequest(http.MethodPost, "/_redeven_proxy/api/ai/threads", bytes.NewBufferString(`{"title":"hello"}`))
		req.Header.Set("Origin", localOrigin)
		rr := httptest.NewRecorder()
		gw.serveHTTP(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("create thread status=%d body=%s", rr.Code, rr.Body.String())
		}
		var resp struct {
			OK   bool `json:"ok"`
			Data struct {
				Thread struct {
					ThreadID string `json:"thread_id"`
				} `json:"thread"`
			} `json:"data"`
		}
		if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
			t.Fatalf("unmarshal create thread: %v", err)
		}
		threadID = strings.TrimSpace(resp.Data.Thread.ThreadID)
		if !resp.OK || threadID == "" {
			t.Fatalf("unexpected create thread response: %s", rr.Body.String())
		}
	}

	{
		body := map[string]any{
			"thread_id": threadID,
			"model":     "openai/gpt-5-mini",
			"input":     map[string]any{"text": "read local file", "attachments": []any{}},
			"options":   map[string]any{"max_steps": 1},
		}
		b, _ := json.Marshal(body)
		req := httptest.NewRequest(http.MethodPost, "/_redeven_proxy/api/ai/runs", bytes.NewBuffer(b))
		req.Header.Set("Origin", localOrigin)
		rr := httptest.NewRecorder()
		gw.serveHTTP(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("run status=%d body=%s", rr.Code, rr.Body.String())
		}
		stream := rr.Body.String()
		if !strings.Contains(stream, `"toolName":"fs.read_file"`) {
			t.Fatalf("stream missing fs.read_file tool call, body=%q", stream)
		}
		if !strings.Contains(stream, `"status":"success"`) {
			t.Fatalf("stream missing successful tool status, body=%q", stream)
		}
		if !strings.Contains(stream, "Tool read: hello-local-ui") {
			t.Fatalf("stream missing tool output text, body=%q", stream)
		}
		if strings.Contains(stream, "missing session metadata") || strings.Contains(stream, "missing session resolver") {
			t.Fatalf("stream still contains resolver error, body=%q", stream)
		}
		if strings.Contains(stream, "No response.") {
			t.Fatalf("stream unexpectedly fell back to no response, body=%q", stream)
		}
	}
}
