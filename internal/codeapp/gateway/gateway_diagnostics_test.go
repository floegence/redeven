package gateway

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"testing/fstest"

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
