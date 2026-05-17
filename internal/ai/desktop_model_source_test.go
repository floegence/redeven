package ai

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/runtimeservice"
	"github.com/floegence/redeven/internal/settings"
	"github.com/gorilla/websocket"
)

func TestDesktopModelSourceModelSnapshotFiltersMissingKeysAndUsesOpaqueIDs(t *testing.T) {
	t.Parallel()

	secretStore := settings.NewSecretsStore(filepath.Join(t.TempDir(), "secrets.json"))
	if err := secretStore.SetAIProviderAPIKey("openai", "sk-local"); err != nil {
		t.Fatalf("SetAIProviderAPIKey: %v", err)
	}
	snapshot, registry, err := buildDesktopModelSourceModelSnapshot(&config.AIConfig{
		CurrentModelID: "openai/gpt-5-mini",
		Providers: []config.AIProvider{
			{
				ID:      "openai",
				Name:    "OpenAI",
				Type:    "openai",
				BaseURL: "https://api.openai.com/v1",
				Models:  []config.AIProviderModel{{ModelName: "gpt-5-mini"}},
			},
			{
				ID:      "anthropic",
				Name:    "Anthropic",
				Type:    "anthropic",
				BaseURL: "https://api.anthropic.com",
				Models:  []config.AIProviderModel{{ModelName: "claude-sonnet-4-5"}},
			},
		},
	}, secretStore)
	if err != nil {
		t.Fatalf("buildDesktopModelSourceModelSnapshot: %v", err)
	}
	if snapshot == nil {
		t.Fatalf("snapshot is nil")
	}
	if got, want := len(snapshot.Models), 1; got != want {
		t.Fatalf("len(Models)=%d, want %d", got, want)
	}
	modelID := snapshot.Models[0].ID
	if !strings.HasPrefix(modelID, "desktop:model_") {
		t.Fatalf("model ID=%q, want desktop:model_ prefix", modelID)
	}
	if strings.Contains(modelID, "openai") || strings.Contains(modelID, "gpt-5-mini") {
		t.Fatalf("model ID leaks provider details: %q", modelID)
	}
	if snapshot.CurrentModel != modelID {
		t.Fatalf("CurrentModel=%q, want %q", snapshot.CurrentModel, modelID)
	}
	if !reflect.DeepEqual(snapshot.MissingKeyProviderIDs, []string{"anthropic"}) {
		t.Fatalf("MissingKeyProviderIDs=%v", snapshot.MissingKeyProviderIDs)
	}
	entry, ok := registry[modelID]
	if !ok {
		t.Fatalf("registry missing model %q", modelID)
	}
	if entry.ProviderID != "openai" || entry.ModelName != "gpt-5-mini" {
		t.Fatalf("registry entry=%#v", entry)
	}
}

func TestServiceListModelsUsesDesktopModelSourceWithoutRemoteConfig(t *testing.T) {
	t.Parallel()

	modelID := "desktop:model_test"
	modelSource, cleanup := startTestDesktopModelSource(t, func(frame DesktopModelSourceRPCFrame) DesktopModelSourceRPCFrame {
		switch frame.Method {
		case "ai.status.get":
			return testDesktopModelSourceResult(t, frame.ID, DesktopModelSourceStatus{
				BindingState:    string(runtimeservice.BindingStateBound),
				Connected:       true,
				Available:       true,
				ModelSource:     DesktopModelSourceDefaultSource,
				SessionID:       "desktop-session",
				ModelCount:      1,
				ExpiresAtUnixMS: time.Now().Add(time.Hour).UnixMilli(),
			})
		case "ai.models.list":
			return testDesktopModelSourceResult(t, frame.ID, DesktopModelSourceModelSnapshot{
				Configured:   true,
				CurrentModel: modelID,
				Models: []DesktopModelSourceModel{{
					ID:       modelID,
					Label:    "OpenAI / gpt-5-mini",
					Provider: "OpenAI",
				}},
			})
		default:
			return testDesktopModelSourceError(frame.ID, "METHOD_NOT_FOUND", "unexpected method")
		}
	})
	defer cleanup()

	svc := &Service{desktopModelSource: modelSource}
	if !svc.Enabled() {
		t.Fatalf("Enabled=false, want true")
	}
	out, err := svc.ListModels()
	if err != nil {
		t.Fatalf("ListModels: %v", err)
	}
	if out.CurrentModel != modelID {
		t.Fatalf("CurrentModel=%q", out.CurrentModel)
	}
	if got, want := len(out.Models), 1; got != want {
		t.Fatalf("len(Models)=%d, want %d", got, want)
	}
	model := out.Models[0]
	if model.ID != modelID {
		t.Fatalf("model.ID=%q", model.ID)
	}
	if model.Source != "desktop_model_source" || model.SourceLabel != "Desktop" {
		t.Fatalf("model source=(%q,%q), want desktop model source", model.Source, model.SourceLabel)
	}
	if out.Runtime == nil || out.Runtime.RemoteConfigured {
		t.Fatalf("Runtime=%#v, want model-source-only runtime status", out.Runtime)
	}
	if out.Runtime.DesktopModelSource == nil || !out.Runtime.DesktopModelSource.Connected {
		t.Fatalf("DesktopModelSource=%#v, want connected", out.Runtime.DesktopModelSource)
	}
}

func TestServicePrepareDesktopModelSourceReportsRuntimeBinding(t *testing.T) {
	t.Parallel()

	svc, err := NewService(Options{
		StateDir:     t.TempDir(),
		AgentHomeDir: t.TempDir(),
		Shell:        "/bin/sh",
	})
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}
	t.Cleanup(func() {
		_ = svc.Close()
	})

	expiresAt := time.Now().Add(time.Hour).UnixMilli()
	status, err := svc.PrepareDesktopModelSource(DesktopModelSourceSession{
		SessionID:       "desktop-session",
		Source:          DesktopModelSourceDefaultSource,
		ProtocolVersion: DesktopModelSourceProtocolVersion,
		ExpiresAtUnixMS: expiresAt,
	})
	if err != nil {
		t.Fatalf("PrepareDesktopModelSource: %v", err)
	}
	if status.DesktopModelSource == nil || status.DesktopModelSource.BindingState != string(runtimeservice.BindingStateConnecting) {
		t.Fatalf("DesktopModelSource status=%#v, want connecting", status.DesktopModelSource)
	}
	binding := svc.DesktopModelSourceBindingStatus(context.Background())
	if binding.State != runtimeservice.BindingStateConnecting {
		t.Fatalf("binding.State=%q, want %q", binding.State, runtimeservice.BindingStateConnecting)
	}
	if binding.SessionID != "desktop-session" || binding.ExpiresAtUnixMS != expiresAt {
		t.Fatalf("binding identity not propagated: %#v", binding)
	}
	raw, err := json.Marshal(status)
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}
	if strings.Contains(string(raw), "runtime-control-token") {
		t.Fatalf("runtime status leaked connector secrets: %s", raw)
	}
}

func TestDesktopModelSourceProviderStreamsAndMapsErrors(t *testing.T) {
	t.Parallel()

	modelID := "desktop:model_test"
	requests := 0
	modelSource, cleanup := startTestDesktopModelSource(t, func(frame DesktopModelSourceRPCFrame) DesktopModelSourceRPCFrame {
		switch frame.Method {
		case "ai.turn.stream":
			requests++
			var body desktopModelSourceStreamRequest
			if err := json.Unmarshal(frame.Params, &body); err != nil {
				return testDesktopModelSourceError(frame.ID, "DECODE_FAILED", err.Error())
			}
			if body.Request.Model != modelID {
				return testDesktopModelSourceError(frame.ID, "MODEL_MISMATCH", "unexpected model")
			}
			return testDesktopModelSourceResult(t, frame.ID, TurnResult{FinishReason: "stop", Text: "hi"})
		default:
			return testDesktopModelSourceError(frame.ID, "METHOD_NOT_FOUND", "unexpected method")
		}
	})
	defer cleanup()

	provider := modelSource.Provider(modelID)
	var events []StreamEvent
	result, err := provider.StreamTurn(context.Background(), TurnRequest{
		Model: modelID,
	}, func(ev StreamEvent) {
		events = append(events, ev)
	})
	if err != nil {
		t.Fatalf("StreamTurn: %v", err)
	}
	if requests != 1 {
		t.Fatalf("requests=%d, want 1", requests)
	}
	if result.Text != "hi" || result.FinishReason != "stop" {
		t.Fatalf("result=%#v", result)
	}
	if len(events) != 1 || events[0].Text != "hi" {
		t.Fatalf("events=%#v", events)
	}
}

func startTestDesktopModelSource(t *testing.T, handle func(DesktopModelSourceRPCFrame) DesktopModelSourceRPCFrame) (*desktopModelSourceClient, func()) {
	t.Helper()

	ctx, cancel := context.WithCancel(context.Background())
	client := newDesktopModelSourceClient(nil)
	session := DesktopModelSourceSession{
		SessionID:       "desktop-session",
		Source:          DesktopModelSourceDefaultSource,
		ProtocolVersion: DesktopModelSourceProtocolVersion,
		ExpiresAtUnixMS: time.Now().Add(time.Hour).UnixMilli(),
	}
	if _, err := client.Prepare(session); err != nil {
		t.Fatalf("Prepare: %v", err)
	}
	upgrader := websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		_ = client.ServeRPC(ctx, session, conn, nil)
	}))

	u, err := url.Parse(server.URL)
	if err != nil {
		t.Fatalf("Parse server URL: %v", err)
	}
	u.Scheme = "ws"
	ws, _, err := websocket.DefaultDialer.DialContext(ctx, u.String(), nil)
	if err != nil {
		t.Fatalf("DialContext: %v", err)
	}
	go func() {
		for {
			var frame DesktopModelSourceRPCFrame
			if err := ws.ReadJSON(&frame); err != nil {
				return
			}
			if strings.TrimSpace(frame.Type) == "request" && strings.TrimSpace(frame.Method) == "ai.turn.stream" {
				_ = ws.WriteJSON(DesktopModelSourceRPCFrame{
					ProtocolVersion: DesktopModelSourceProtocolVersion,
					Type:            "event",
					ID:              frame.ID,
					Event:           &StreamEvent{Type: StreamEventTextDelta, Text: "hi"},
				})
			}
			response := handle(frame)
			response.ProtocolVersion = DesktopModelSourceProtocolVersion
			_ = ws.WriteJSON(response)
		}
	}()

	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if client.isConnected() {
			return client, func() {
				cancel()
				_ = ws.Close()
				server.Close()
			}
		}
		time.Sleep(10 * time.Millisecond)
	}
	cancel()
	_ = ws.Close()
	server.Close()
	t.Fatalf("desktop model source did not connect")
	return nil, nil
}

func testDesktopModelSourceResult(t *testing.T, id string, v any) DesktopModelSourceRPCFrame {
	t.Helper()
	raw, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}
	return DesktopModelSourceRPCFrame{
		Type:   "result",
		ID:     id,
		Result: raw,
	}
}

func testDesktopModelSourceError(id string, code string, message string) DesktopModelSourceRPCFrame {
	return DesktopModelSourceRPCFrame{
		Type:  "error",
		ID:    id,
		Error: &DesktopModelSourceRPCError{Code: code, Message: message},
	}
}
