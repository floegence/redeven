package gateway

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/floegence/redeven-agent/internal/config"
	"github.com/floegence/redeven-agent/internal/diagnostics"
	"github.com/floegence/redeven-agent/internal/session"
)

func TestGateway_Diagnostics_RequestTracing(t *testing.T) {
	t.Parallel()

	cfgPath := writeTestConfig(t)
	diagStore, err := diagnostics.New(diagnostics.Options{StateDir: filepath.Dir(cfgPath), Source: diagnostics.SourceAgent})
	if err != nil {
		t.Fatalf("diagnostics.New() error = %v", err)
	}
	channelID := "ch_diag_trace"
	gw, err := New(Options{
		Backend:            &stubBackend{},
		DistFS:             fstest.MapFS{"env/index.html": {Data: []byte("<html>env</html>")}},
		ConfigPath:         cfgPath,
		Diagnostics:        diagStore,
		ResolveSessionMeta: resolveMetaForTest(channelID, session.Meta{CanRead: true}),
	})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/_redeven_proxy/api/settings", nil)
	req.Header.Set("Origin", envOriginWithChannel(channelID))
	rr := httptest.NewRecorder()
	gw.serveHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rr.Code, http.StatusOK)
	}
	traceID := rr.Header().Get(diagnostics.TraceHeader)
	if traceID == "" {
		t.Fatalf("missing %s header", diagnostics.TraceHeader)
	}
	events, err := diagStore.List(10)
	if err != nil {
		t.Fatalf("diagStore.List() error = %v", err)
	}
	if len(events) == 0 {
		t.Fatalf("expected diagnostics event")
	}
	event := events[0]
	if event.Scope != diagnostics.ScopeGatewayAPI {
		t.Fatalf("event.Scope = %q, want %q", event.Scope, diagnostics.ScopeGatewayAPI)
	}
	if event.TraceID != traceID {
		t.Fatalf("event.TraceID = %q, want %q", event.TraceID, traceID)
	}
	if event.Path != "/_redeven_proxy/api/settings" {
		t.Fatalf("event.Path = %q, want /_redeven_proxy/api/settings", event.Path)
	}
}

func TestGateway_DiagnosticsAPI_AggregatesAgentAndDesktopEvents(t *testing.T) {
	t.Parallel()

	cfgPath := writeTestConfig(t)
	stateDir := filepath.Dir(cfgPath)
	agentStore, err := diagnostics.New(diagnostics.Options{StateDir: stateDir, Source: diagnostics.SourceAgent})
	if err != nil {
		t.Fatalf("diagnostics.New(agent) error = %v", err)
	}
	desktopStore, err := diagnostics.New(diagnostics.Options{StateDir: stateDir, Source: diagnostics.SourceDesktop})
	if err != nil {
		t.Fatalf("diagnostics.New(desktop) error = %v", err)
	}
	agentStore.Append(diagnostics.Event{Scope: diagnostics.ScopeGatewayAPI, Kind: "request", TraceID: "trace-shared", Method: http.MethodGet, Path: "/_redeven_proxy/api/settings", StatusCode: 200, DurationMs: 1400})
	desktopStore.Append(diagnostics.Event{Scope: diagnostics.ScopeDesktopHTTP, Kind: "completed", TraceID: "trace-shared", Method: http.MethodGet, Path: "/api/local/runtime", StatusCode: 200, DurationMs: 1600})

	channelID := "ch_diag_api"
	gw, err := New(Options{
		Backend:            &stubBackend{},
		DistFS:             fstest.MapFS{"env/index.html": {Data: []byte("<html>env</html>")}},
		ConfigPath:         cfgPath,
		Diagnostics:        agentStore,
		ResolveSessionMeta: resolveMetaForTest(channelID, session.Meta{CanAdmin: true}),
	})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/_redeven_proxy/api/debug/diagnostics", nil)
	req.Header.Set("Origin", envOriginWithChannel(channelID))
	rr := httptest.NewRecorder()
	gw.serveHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rr.Code, http.StatusOK)
	}
	var summary struct {
		OK   bool            `json:"ok"`
		Data diagnosticsView `json:"data"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &summary); err != nil {
		t.Fatalf("json.Unmarshal(summary) error = %v", err)
	}
	if !summary.Data.Enabled {
		t.Fatalf("summary.Data.Enabled = false, want true")
	}
	if summary.Data.Stats.AgentEvents != 1 || summary.Data.Stats.DesktopEvents != 1 {
		t.Fatalf("unexpected stats = %#v", summary.Data.Stats)
	}
	if len(summary.Data.SlowSummary) == 0 {
		t.Fatalf("expected slow summary entries")
	}

	exportReq := httptest.NewRequest(http.MethodGet, "/_redeven_proxy/api/debug/diagnostics/export", nil)
	exportReq.Header.Set("Origin", envOriginWithChannel(channelID))
	exportRes := httptest.NewRecorder()
	gw.serveHTTP(exportRes, exportReq)
	if exportRes.Code != http.StatusOK {
		t.Fatalf("export status = %d, want %d", exportRes.Code, http.StatusOK)
	}
	var exportBody struct {
		OK   bool                  `json:"ok"`
		Data diagnosticsExportView `json:"data"`
	}
	if err := json.Unmarshal(exportRes.Body.Bytes(), &exportBody); err != nil {
		t.Fatalf("json.Unmarshal(export) error = %v", err)
	}
	if len(exportBody.Data.AgentEvents) != 1 || len(exportBody.Data.DesktopEvents) != 1 {
		t.Fatalf("unexpected export counts = agent:%d desktop:%d", len(exportBody.Data.AgentEvents), len(exportBody.Data.DesktopEvents))
	}
}

func TestGateway_DebugConsoleSettingsToggleUpdatesRuntimeAndHeaders(t *testing.T) {
	t.Parallel()

	cfgPath := writeTestConfig(t)
	stateDir := filepath.Dir(cfgPath)
	diagStore, err := diagnostics.New(diagnostics.Options{
		StateDir: stateDir,
		Source:   diagnostics.SourceAgent,
		Disabled: true,
	})
	if err != nil {
		t.Fatalf("diagnostics.New() error = %v", err)
	}
	channelID := "ch_diag_toggle"
	gw, err := New(Options{
		Backend:            &stubBackend{},
		DistFS:             fstest.MapFS{"env/index.html": {Data: []byte("<html>env</html>")}},
		ConfigPath:         cfgPath,
		Diagnostics:        diagStore,
		ResolveSessionMeta: resolveMetaForTest(channelID, session.Meta{CanRead: true, CanAdmin: true}),
	})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	getReq := httptest.NewRequest(http.MethodGet, "/_redeven_proxy/api/settings", nil)
	getReq.Header.Set("Origin", envOriginWithChannel(channelID))
	getRes := httptest.NewRecorder()
	gw.serveHTTP(getRes, getReq)
	if got := getRes.Header().Get(diagnostics.EnabledHeader); got != "false" {
		t.Fatalf("initial %s = %q, want false", diagnostics.EnabledHeader, got)
	}

	updateReq := httptest.NewRequest(http.MethodPut, "/_redeven_proxy/api/settings", bytes.NewBufferString(`{
  "debug_console": {
    "enabled": true,
    "collect_ui_metrics": true
  }
}`))
	updateReq.Header.Set("Origin", envOriginWithChannel(channelID))
	updateRes := httptest.NewRecorder()
	gw.serveHTTP(updateRes, updateReq)
	if updateRes.Code != http.StatusOK {
		t.Fatalf("update status = %d, want %d body=%s", updateRes.Code, http.StatusOK, updateRes.Body.String())
	}
	if diagStore.Enabled() != true {
		t.Fatalf("diagStore.Enabled() = false, want true after settings update")
	}

	var updateBody struct {
		OK   bool               `json:"ok"`
		Data settingsUpdateView `json:"data"`
	}
	if err := json.Unmarshal(updateRes.Body.Bytes(), &updateBody); err != nil {
		t.Fatalf("json.Unmarshal(update) error = %v", err)
	}
	if !updateBody.Data.Settings.DebugConsole.Enabled || !updateBody.Data.Settings.DebugConsole.CollectUIMetrics {
		t.Fatalf("debug_console view = %#v, want enabled + collect_ui_metrics", updateBody.Data.Settings.DebugConsole)
	}

	cfg, err := config.Load(cfgPath)
	if err != nil {
		t.Fatalf("config.Load() error = %v", err)
	}
	if cfg.DebugConsole == nil || !cfg.DebugConsole.Enabled || !cfg.DebugConsole.CollectUIMetrics {
		t.Fatalf("saved config debug_console = %#v", cfg.DebugConsole)
	}

	postReq := httptest.NewRequest(http.MethodGet, "/_redeven_proxy/api/settings", nil)
	postReq.Header.Set("Origin", envOriginWithChannel(channelID))
	postRes := httptest.NewRecorder()
	gw.serveHTTP(postRes, postReq)
	if got := postRes.Header().Get(diagnostics.EnabledHeader); got != "true" {
		t.Fatalf("post-toggle %s = %q, want true", diagnostics.EnabledHeader, got)
	}
}

func TestGateway_DiagnosticsStreamEmitsNewEvents(t *testing.T) {
	cfgPath := writeTestConfig(t)
	stateDir := filepath.Dir(cfgPath)
	diagStore, err := diagnostics.New(diagnostics.Options{StateDir: stateDir, Source: diagnostics.SourceAgent})
	if err != nil {
		t.Fatalf("diagnostics.New() error = %v", err)
	}
	channelID := "ch_diag_stream"
	gw, err := New(Options{
		Backend:            &stubBackend{},
		DistFS:             fstest.MapFS{"env/index.html": {Data: []byte("<html>env</html>")}},
		ConfigPath:         cfgPath,
		Diagnostics:        diagStore,
		ResolveSessionMeta: resolveMetaForTest(channelID, session.Meta{CanAdmin: true}),
	})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	prevInterval := diagnosticsStreamPollInterval
	diagnosticsStreamPollInterval = 10 * time.Millisecond
	defer func() { diagnosticsStreamPollInterval = prevInterval }()

	server := httptest.NewServer(http.HandlerFunc(gw.serveHTTP))
	defer server.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, server.URL+"/_redeven_proxy/api/debug/diagnostics/stream?limit=20", nil)
	if err != nil {
		t.Fatalf("http.NewRequestWithContext() error = %v", err)
	}
	req.Header.Set("Origin", envOriginWithChannel(channelID))

	type responseResult struct {
		resp *http.Response
		err  error
	}
	respCh := make(chan responseResult, 1)
	go func() {
		resp, err := server.Client().Do(req)
		respCh <- responseResult{resp: resp, err: err}
	}()

	time.Sleep(40 * time.Millisecond)
	diagStore.Append(diagnostics.Event{
		Scope:      diagnostics.ScopeGatewayAPI,
		Kind:       "request",
		TraceID:    "trace-stream-1",
		Method:     http.MethodGet,
		Path:       "/_redeven_proxy/api/settings",
		StatusCode: http.StatusOK,
		DurationMs: 42,
	})

	result := <-respCh
	if result.err != nil {
		t.Fatalf("stream request error = %v", result.err)
	}
	resp := result.resp
	defer resp.Body.Close()
	if got := resp.Header.Get("Content-Type"); !strings.Contains(got, "text/event-stream") {
		t.Fatalf("Content-Type = %q, want text/event-stream", got)
	}

	type streamResult struct {
		Key   string            `json:"key"`
		Event diagnostics.Event `json:"event"`
	}
	resultCh := make(chan streamResult, 1)
	errCh := make(chan error, 1)
	go func() {
		reader := bufio.NewReader(resp.Body)
		var dataLines []string
		for {
			line, err := reader.ReadString('\n')
			if err != nil {
				errCh <- err
				return
			}
			trimmed := strings.TrimRight(line, "\r\n")
			if strings.HasPrefix(trimmed, "data: ") {
				dataLines = append(dataLines, strings.TrimPrefix(trimmed, "data: "))
				continue
			}
			if trimmed != "" {
				continue
			}
			if len(dataLines) == 0 {
				continue
			}
			var payload streamResult
			if err := json.Unmarshal([]byte(strings.Join(dataLines, "\n")), &payload); err != nil {
				errCh <- err
				return
			}
			resultCh <- payload
			return
		}
	}()

	select {
	case payload := <-resultCh:
		if payload.Key == "" {
			t.Fatalf("stream key = empty, want value")
		}
		if payload.Event.TraceID != "trace-stream-1" {
			t.Fatalf("payload.Event.TraceID = %q, want trace-stream-1", payload.Event.TraceID)
		}
	case err := <-errCh:
		if err != nil && err != io.EOF {
			t.Fatalf("stream read error = %v", err)
		}
	case <-ctx.Done():
		t.Fatalf("timed out waiting for diagnostics stream event")
	}
}
