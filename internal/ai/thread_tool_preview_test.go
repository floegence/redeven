package ai

import (
	"context"
	"encoding/json"
	"errors"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	flconfig "github.com/floegence/floret/v7/config"
	"github.com/floegence/floret/v7/florettest"
	flprovider "github.com/floegence/floret/v7/provider"
	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/floret/v7/storage"
	fltools "github.com/floegence/floret/v7/tools"
	"github.com/floegence/redeven/internal/ai/threadstore"
	"github.com/floegence/redeven/internal/config"
)

type previewTestRuntime struct {
	flruntime.ThreadService
	result flruntime.ThreadToolResult
	lookup flruntime.LookupToolResultInput
	calls  int
	found  bool
}

func (r *previewTestRuntime) LookupToolResult(_ context.Context, input flruntime.LookupToolResultInput) (flruntime.ThreadToolResult, bool, error) {
	r.lookup = input
	r.calls++
	return r.result, r.found, nil
}

func TestReadFlowerToolPreviewUsesHistoricalCanonicalResultAndCurrentAuthorization(t *testing.T) {
	svc := newTestService(t, &config.AIConfig{CurrentModelID: "openai/gpt-5-mini", Providers: []config.AIProvider{{ID: "openai", Name: "OpenAI", Type: "openai", Models: []config.AIProviderModel{{ModelName: "gpt-5-mini"}}}}})
	meta := testSendTurnMeta()
	meta.NamespacePublicID = "preview-namespace"
	thread, err := svc.CreateThread(t.Context(), meta, "Saved query", "", "", svc.agentHomeDir)
	if err != nil {
		t.Fatal(err)
	}
	runtime := &previewTestRuntime{found: true, result: flruntime.ThreadToolResult{ToolName: "threads.query", Arguments: `{"object":"messages","filter":{"text":{"contains":"release"}}}`, Status: "success", Content: `{"status":"success","data":{"records":[{"ref":"opaque","thread_id":"other-thread","title":"Release plan","snippet":"Ready to ship"}],"total":1}}`}}
	svc.threadRuntime = runtime
	request := FlowerToolPreviewRequest{ThreadID: thread.ThreadID, TurnID: "historical-turn", RunID: "historical-run", ToolCallID: "historical-call"}
	preview, err := svc.ReadFlowerToolPreview(t.Context(), meta, request)
	if err != nil || len(preview.Rows) != 1 || preview.Rows[0].Content != "Ready to ship" || preview.Total == nil || *preview.Total != 1 {
		t.Fatalf("preview=%+v err=%v", preview, err)
	}
	if runtime.lookup.ThreadID.String() != thread.ThreadID || runtime.lookup.TurnID.String() != request.TurnID || runtime.lookup.RunID.String() != request.RunID || runtime.lookup.ToolCallID != request.ToolCallID {
		t.Fatalf("incorrect identity: %+v", runtime.lookup)
	}
	raw, _ := json.Marshal(preview)
	for _, private := range []string{"opaque", "other-thread", "historical-call"} {
		if strings.Contains(string(raw), private) {
			t.Fatalf("private identity leaked: %s", raw)
		}
	}
	for _, mutate := range []func(){func() { meta.CanRead = false }, func() { meta.CanRead = true; meta.NamespacePublicID = "other" }, func() { meta.NamespacePublicID = "preview-namespace"; meta.EndpointID = "other" }} {
		mutate()
		calls := runtime.calls
		if _, err := svc.ReadFlowerToolPreview(t.Context(), meta, request); !errors.Is(err, ErrFlowerToolPreviewNotFound) {
			t.Fatalf("unauthorized err=%v", err)
		}
		if runtime.calls != calls {
			t.Fatal("unauthorized request reached canonical read")
		}
	}
}

func TestThreadToolPreviewPreservesReadableChunksAndPagination(t *testing.T) {
	result := flruntime.ThreadToolResult{ToolName: "threads.read", Status: "success", Content: `{"status":"success","data":{"record":{"ref":"hidden","title":"Plan"},"chunks":[{"field":"body","offset":0,"text":"  Hello\n"},{"field":"body","offset":8,"text":"世界  "},{"field":"body","offset":40,"text":"another fragment"},{"field":"context","text":"PRIVATE_CONTEXT"},{"field":"references","text":"PRIVATE_REFERENCE"}],"next_cursor":"opaque-cursor"}}`}
	preview, err := threadToolPreview(result)
	if err != nil || len(preview.Rows) != 2 || preview.Rows[0].Content != "  Hello\n世界  " || preview.Rows[1].Content != "another fragment" || !preview.HasMore {
		t.Fatalf("preview=%+v err=%v", preview, err)
	}
	raw, _ := json.Marshal(preview)
	if strings.Contains(string(raw), "PRIVATE") || strings.Contains(string(raw), "opaque-cursor") {
		t.Fatalf("leaked: %s", raw)
	}
}

func TestThreadToolPreviewEmptyAndAggregateResults(t *testing.T) {
	for _, name := range []string{"threads.query", "threads.aggregate"} {
		result := flruntime.ThreadToolResult{ToolName: name, Status: "success", Arguments: `{"object":"threads"}`, Content: `{"status":"success","data":{"records":[],"groups":[],"total":0}}`}
		preview, err := threadToolPreview(result)
		if err != nil || preview.Total == nil || *preview.Total != 0 || preview.Rows == nil || len(preview.Rows) != 0 {
			t.Fatalf("preview=%+v err=%v", preview, err)
		}
	}
	result := flruntime.ThreadToolResult{ToolName: "threads.aggregate", Status: "success", Arguments: `{"object":"messages","group_by":"role"}`, Content: `{"status":"success","data":{"groups":[{"key":"assistant","count":27}],"total":27}}`}
	preview, err := threadToolPreview(result)
	if err != nil || preview.Rows[0].Title != "assistant" || preview.Rows[0].Content != "27" || *preview.Total != 27 {
		t.Fatalf("preview=%+v err=%v", preview, err)
	}
	for _, invalid := range []flruntime.ThreadToolResult{{ToolName: "terminal.exec", Status: "success", Content: `{"status":"success","data":{}}`}, {ToolName: "threads.read", Status: "error", Content: `{"status":"error"}`}, {ToolName: "threads.query", Status: "success", Content: `broken`}} {
		if _, err := threadToolPreview(invalid); err == nil {
			t.Fatal("accepted invalid result")
		}
	}
}

func TestReadFlowerToolPreviewAfterRestartDoesNotDispatchOrChangeCanonicalView(t *testing.T) {
	svc := newTestService(t, &config.AIConfig{CurrentModelID: "openai/gpt-5-mini", Providers: []config.AIProvider{{ID: "openai", Type: "openai", Models: []config.AIProviderModel{{ModelName: "gpt-5-mini"}}}}})
	meta := testSendTurnMeta()
	meta.NamespacePublicID = "preview-restart"
	var dispatches atomic.Int32
	definition, err := floretToolDefinitionForSnapshot(builtInThreadQueryToolDefinitions()[0], buildPermissionSnapshot(FlowerPermissionFullAccess, builtInThreadQueryToolDefinitions(), nil))
	if err != nil {
		t.Fatal(err)
	}
	definition.Activity = func(inv fltools.Invocation[any]) (*fltools.ActivityPresentation, error) {
		return floretActivityForToolCall("threads.query", inv.Args.(map[string]any)), nil
	}
	tool := fltools.Define[map[string]any](definition, nil, nil, func(_ context.Context, inv fltools.Invocation[map[string]any]) (fltools.Result, error) {
		dispatches.Add(1)
		data := map[string]any{"records": []map[string]any{{"title": "Saved release", "snippet": "Historical result"}}, "total": 1}
		activity, err := floretActivityForToolResult(nil, ToolResult{ToolName: "threads.query", Status: "success", activityInput: inv.Args, Data: data})
		if err != nil {
			return fltools.Result{}, err
		}
		content, err := json.Marshal(map[string]any{"status": "success", "data": data})
		return fltools.Result{Text: string(content), Activity: activity}, err
	})
	gateway := florettest.NewScriptedGateway(flprovider.Identity{Provider: "test", Model: "preview", StateCompatibilityKey: "test:preview:v1"}, flprovider.Capabilities{Reasoning: flprovider.ReasoningUnsupported},
		florettest.Step{Events: []flprovider.Event{{Type: flprovider.EventToolCalls, ToolCalls: []flprovider.ToolCall{{ID: "saved-call", Name: "threads.query", Args: `{"object":"messages","description":"Find release discussions"}`}}}, {Type: flprovider.EventDone, Reason: "tool_calls"}}},
		florettest.Step{Events: []flprovider.Event{{Type: flprovider.EventDelta, Text: "Done"}, {Type: flprovider.EventDone, Reason: "stop"}}})
	agent, err := flruntime.NewAgent(flconfig.AgentConfig{Profile: flconfig.AgentProfile{ID: "preview", Name: "Preview"}, SystemPrompt: "Test saved previews.", Context: flconfig.ContextPolicy{ContextWindowTokens: flconfig.DefaultContextWindowTokens}}, gateway, flruntime.WithAgentTools(tool), flruntime.WithAgentEffectAuthorization(floretAllowTestEffect))
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "saved.sqlite")
	open := func() (*flruntime.Host, flruntime.ThreadService) {
		host, err := flruntime.Open(t.Context(), flruntime.Options{Storage: storage.SQLite(path)})
		if err != nil {
			t.Fatal(err)
		}
		service, err := host.ThreadService(flruntime.AgentFactoryFunc(func(context.Context, flruntime.AgentRequest) (*flruntime.Agent, error) { return agent, nil }))
		if err != nil {
			t.Fatal(err)
		}
		return host, service
	}
	host, service := open()
	created, err := service.Create(t.Context(), flruntime.CreateThreadInput{RequestKey: "create-preview"})
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.threadsDB.CreateThreadSettings(t.Context(), threadstore.ThreadSettings{ThreadID: created.ThreadID.String(), EndpointID: meta.EndpointID, NamespacePublicID: meta.NamespacePublicID, PermissionType: string(FlowerPermissionReadonly)}); err != nil {
		t.Fatal(err)
	}
	if _, err := service.Send(t.Context(), flruntime.SendInput{ThreadID: created.ThreadID, RequestKey: "send-preview", Input: flruntime.UserInput{Text: "Search"}}); err != nil {
		t.Fatal(err)
	}
	var view flruntime.ThreadView
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		view, err = service.View(t.Context(), created.ThreadID)
		if err == nil && view.Activity == flruntime.ThreadActivityIdle && dispatches.Load() == 1 {
			break
		}
		time.Sleep(5 * time.Millisecond)
	}
	if dispatches.Load() != 1 || view.Activity != flruntime.ThreadActivityIdle {
		raw, _ := json.Marshal(view)
		t.Fatalf("tool did not settle: %s dispatches=%d", raw, dispatches.Load())
	}
	if err := host.Shutdown(t.Context()); err != nil {
		t.Fatal(err)
	}
	host, service = open()
	defer func() { _ = host.Shutdown(context.Background()) }()
	svc.threadRuntime = service
	before, err := service.View(t.Context(), created.ThreadID)
	if err != nil {
		t.Fatal(err)
	}
	ordinary, _ := json.Marshal(before)
	if strings.Contains(string(ordinary), "Historical result") {
		t.Fatal("fixture unexpectedly stored the private result in ordinary Activity")
	}
	public, _ := json.Marshal(publicFloretThreadView(before))
	if !strings.Contains(string(public), "Find release discussions") {
		t.Fatal("canonical restart lost invocation intent")
	}
	request := FlowerToolPreviewRequest{ThreadID: created.ThreadID.String(), TurnID: before.Turns[0].TurnID.String(), RunID: before.Turns[0].RunID.String(), ToolCallID: "saved-call"}
	for range 2 {
		preview, err := svc.ReadFlowerToolPreview(t.Context(), meta, request)
		if err != nil || len(preview.Rows) != 1 || preview.Rows[0].Content != "Historical result" {
			t.Fatalf("preview=%+v err=%v", preview, err)
		}
	}
	after, err := service.View(t.Context(), created.ThreadID)
	if err != nil {
		t.Fatal(err)
	}
	a, _ := json.Marshal(before)
	b, _ := json.Marshal(after)
	if string(a) != string(b) || dispatches.Load() != 1 {
		t.Fatal("preview mutated canonical state or reran the tool")
	}
	request.RunID = "wrong-run"
	if _, err := svc.ReadFlowerToolPreview(t.Context(), meta, request); !errors.Is(err, ErrFlowerToolPreviewNotFound) {
		t.Fatalf("wrong identity err=%v", err)
	}
}

func TestThreadToolPreviewReadsToolContentWithoutDumpingEnvelopes(t *testing.T) {
	for _, field := range []string{"arguments", "result"} {
		content := `{"command":"printf ready","description":"Inspect setup","internal":"PRIVATE"}`
		if field == "result" {
			content = `{"status":"success","data":{"output":"ready","process_id":"PRIVATE"},"metadata":"PRIVATE"}`
		}
		rows := threadToolContentRows("terminal.exec", field, content)
		if len(rows) == 0 {
			t.Fatalf("missing %s preview", field)
		}
		raw, _ := json.Marshal(rows)
		if strings.Contains(string(raw), "PRIVATE") {
			t.Fatalf("raw metadata leaked: %s", raw)
		}
	}
}

func TestThreadToolPreviewBoundsAndEffectiveQueryParameters(t *testing.T) {
	records := make([]map[string]any, 30)
	for i := range records {
		records[i] = map[string]any{"title": strings.Repeat("界", 300), "snippet": strings.Repeat("界", 4000), "role": "assistant"}
	}
	content, _ := json.Marshal(map[string]any{"status": "success", "data": map[string]any{"records": records, "total": 30}})
	result := flruntime.ThreadToolResult{ToolName: "threads.query", Status: "success", Arguments: `{"object":"messages","filter":{"text":{"contains":"release"}},"sort":{"descending":false}}`, Content: string(content)}
	preview, err := threadToolPreview(result)
	if err != nil || len(preview.Rows) > 10 || !preview.HasMore || !preview.Rows[0].Truncated {
		t.Fatalf("unbounded preview: rows=%d more=%v err=%v", len(preview.Rows), preview.HasMore, err)
	}
	for _, row := range preview.Rows {
		if len([]rune(row.Content)) > 1200 || len([]rune(row.Title)) > 160 {
			t.Fatal("unbounded row")
		}
	}
	values := map[string]string{}
	for _, row := range preview.Inputs {
		values[row.Title] = row.Content
	}
	if values["limit"] != "50" || values["sort"] != "time ↑" {
		t.Fatalf("missing effective parameters: %v", values)
	}
	result.Arguments = `{"object":"threads"}`
	preview, err = threadToolPreview(result)
	if err != nil {
		t.Fatal(err)
	}
	for _, row := range preview.Inputs {
		values[row.Title] = row.Content
	}
	if values["sort"] != "updated ↓" {
		t.Fatalf("wrong default order: %v", values)
	}
}

func TestThreadReadPreviewBoundsUTF8Chunks(t *testing.T) {
	chunks := []map[string]any{{"field": "body", "offset": 0, "text": strings.Repeat("界", 4000)}, {"field": "body", "offset": 12000, "text": strings.Repeat("界", 4000)}}
	content, _ := json.Marshal(map[string]any{"status": "success", "data": map[string]any{"record": map[string]any{"object": "messages", "role": "assistant", "title": "Release"}, "chunks": chunks}})
	preview, err := threadToolPreview(flruntime.ThreadToolResult{ToolName: "threads.read", Status: "success", Content: string(content)})
	if err != nil || len(preview.Rows) != 1 || len([]rune(preview.Rows[0].Content)) > 1200 || !preview.Rows[0].Truncated || !preview.HasMore {
		t.Fatalf("unbounded read: rows=%d more=%v err=%v", len(preview.Rows), preview.HasMore, err)
	}
}
