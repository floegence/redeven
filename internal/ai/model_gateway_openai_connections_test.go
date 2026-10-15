package ai

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	flidentity "github.com/floegence/floret/v7/identity"
	flprovider "github.com/floegence/floret/v7/provider"
	"github.com/gorilla/websocket"
	"github.com/openai/openai-go/v3/option"
)

func testOpenAISocketProvider(t *testing.T, server *httptest.Server, pool *openAIResponsesPool) *openAIProvider {
	t.Helper()
	adapter, err := newProviderAdapter("openai", server.URL+"/v1", "test-only", nil)
	if err != nil {
		t.Fatal(err)
	}
	p := adapter.(*openAIProvider)
	p.chatGPT = true
	p.requireTerminal = true
	p.officialOpenAI = true
	p.responsesPool = pool
	p.transportIdentity = openAIConnectionIdentity{"profile", server.URL, "account"}
	p.chatGPTToken = func(context.Context) (string, error) { return "test-token", nil }
	return p
}
func testOpenAISocketRequest(scope string) ModelGatewayRequest {
	return ModelGatewayRequest{Model: "gpt-5.5", PromptScopeID: flidentity.PromptScopeID(scope), ReusePolicy: &flprovider.RequestReusePolicy{PromptCacheEnabled: true, PromptCacheNamespace: "stable-namespace", ProviderStateAllowed: true, PreferContinuation: true}, Messages: []Message{{Role: "user", Content: []ContentPart{{Type: "text", Text: "first input"}}}}}
}
func testOpenAICompleted(id string) map[string]any {
	return map[string]any{"type": "response.completed", "response": map[string]any{"id": id, "model": "gpt-5.5", "status": "completed", "output": []any{
		map[string]any{"type": "reasoning", "id": "reasoning_" + id, "summary": []any{}, "encrypted_content": "opaque_" + id},
		map[string]any{"type": "message", "id": "message_" + id, "phase": "final_answer", "role": "assistant", "status": "completed", "content": []any{map[string]any{"type": "output_text", "text": "answer", "annotations": []any{}}}},
	}, "usage": map[string]any{"input_tokens": 100, "output_tokens": 5, "input_tokens_details": map[string]any{"cached_tokens": 60, "cache_write_tokens": 10}}}}
}
func nextSocketRequest(req ModelGatewayRequest, result ModelGatewayResult) ModelGatewayRequest {
	req.PreviousState = result.ProviderState
	req.Messages = append(req.Messages, Message{Role: "assistant", Content: []ContentPart{{Type: "text", Text: result.Text}}}, Message{Role: "user", Content: []ContentPart{{Type: "text", Text: "next input"}}})
	return req
}
func TestOpenAIWebSocketContinuationUsesCompletePreparedHistory(t *testing.T) {
	pool := newOpenAIResponsesPool()
	defer pool.Close()
	var mu sync.Mutex
	var bodies []map[string]json.RawMessage
	var connections atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := (&websocket.Upgrader{}).Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()
		connections.Add(1)
		for {
			var body map[string]json.RawMessage
			if conn.ReadJSON(&body) != nil {
				return
			}
			mu.Lock()
			bodies = append(bodies, body)
			n := len(bodies)
			mu.Unlock()
			if conn.WriteJSON(testOpenAICompleted(fmt.Sprintf("response_%d", n))) != nil {
				return
			}
		}
	}))
	defer server.Close()
	req := testOpenAISocketRequest("scope")
	first, err := testOpenAISocketProvider(t, server, pool).StreamTurn(t.Context(), req, nil)
	if err != nil {
		t.Fatal(err)
	}
	req = nextSocketRequest(req, first)
	p := testOpenAISocketProvider(t, server, pool) // Adapter recreation retains the executor's connection.
	prepared, err := p.prepareTurn(t.Context(), req)
	if err != nil {
		t.Fatal(err)
	}
	defer prepared.Close()
	if !strings.Contains(string(prepared.(*preparedModelWire).payload), "first input") || !strings.Contains(string(prepared.(*preparedModelWire).payload), "opaque_response_1") {
		t.Fatal("prepared estimate lost complete native history")
	}
	if prepared.TokenEstimate().EstimatedInputTokens <= 0 {
		t.Fatal("full request was not estimated")
	}
	second, err := prepared.StreamTurn(t.Context(), nil)
	if err != nil {
		t.Fatal(err)
	}
	if second.Usage.InputTokens != 30 || second.Usage.CacheReadTokens != 60 || second.Usage.CacheWriteTokens != 10 {
		t.Fatalf("usage=%+v", second.Usage)
	}
	req = nextSocketRequest(req, second)
	req.Messages = append([]Message{{Role: "system", Content: []ContentPart{{Type: "text", Text: "changed settings"}}}}, req.Messages...)
	if _, err = p.StreamTurn(t.Context(), req, nil); err != nil {
		t.Fatal(err)
	}
	mu.Lock()
	defer mu.Unlock()
	if connections.Load() != 1 || len(bodies) != 3 {
		t.Fatalf("connections=%d requests=%d", connections.Load(), len(bodies))
	}
	if bodies[0]["previous_response_id"] != nil || string(bodies[1]["previous_response_id"]) != `"response_1"` || bodies[2]["previous_response_id"] != nil {
		t.Fatalf("invalid continuation: %+v", bodies)
	}
	var delta []json.RawMessage
	_ = json.Unmarshal(bodies[1]["input"], &delta)
	if len(delta) != 1 || !strings.Contains(string(delta[0]), "next input") {
		t.Fatalf("delta=%s", bodies[1]["input"])
	}
	full := string(bodies[2]["input"])
	for _, part := range []string{"opaque_response_1", "message_response_1", "final_answer", "first input"} {
		if !strings.Contains(full, part) {
			t.Fatalf("native history lost %s: %s", part, full)
		}
	}
	for _, body := range bodies {
		if body["stream"] != nil || body["background"] != nil || string(body["type"]) != `"response.create"` || string(body["store"]) != "false" {
			t.Fatalf("invalid socket body: %+v", body)
		}
	}
	if string(bodies[0]["prompt_cache_key"]) != string(bodies[2]["prompt_cache_key"]) {
		t.Fatal("cache key changed across turns")
	}
}

func TestOpenAIWebSocketUpgradeFallbackPreservesFailures(t *testing.T) {
	for _, status := range []int{404, 405, 426, 501, 401, 429, 400} {
		t.Run(fmt.Sprint(status), func(t *testing.T) {
			pool := newOpenAIResponsesPool()
			defer pool.Close()
			var posts atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method == "GET" {
					w.WriteHeader(status)
					fmt.Fprint(w, `{"error":{"code":"test_rejection"}}`)
					return
				}
				posts.Add(1)
				w.Header().Set("Content-Type", "text/event-stream")
				raw, _ := json.Marshal(testOpenAICompleted("http"))
				fmt.Fprintf(w, "data: %s\n\n", raw)
			}))
			defer server.Close()
			result, err := testOpenAISocketProvider(t, server, pool).StreamTurn(t.Context(), testOpenAISocketRequest("scope"), nil)
			fallback := status == 404 || status == 405 || status == 426 || status == 501
			if fallback {
				if err != nil || posts.Load() != 1 || result.RawProviderDiag["transport_fallback"] != "upgrade_unsupported" {
					t.Fatalf("fallback=%+v posts=%d err=%v", result, posts.Load(), err)
				}
			} else {
				if err == nil || posts.Load() != 0 {
					t.Fatalf("masked failure: %v", err)
				}
				var failure *providerFailure
				if !errors.As(err, &failure) || failure.diagnostic.Status != status {
					t.Fatalf("classification=%v", err)
				}
			}
		})
	}
}
func TestOpenAIWebSocketStaleResponseRetriesFullOnlyOnce(t *testing.T) {
	pool := newOpenAIResponsesPool()
	defer pool.Close()
	var commands atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := (&websocket.Upgrader{}).Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()
		for {
			var body map[string]json.RawMessage
			if conn.ReadJSON(&body) != nil {
				return
			}
			n := commands.Add(1)
			if n == 2 {
				if body["previous_response_id"] == nil {
					t.Error("continuation missing")
				}
				_ = conn.WriteJSON(map[string]any{"type": "error", "error": map[string]any{"code": "previous_response_not_found", "param": "previous_response_id"}})
				continue
			}
			if n == 3 && (body["previous_response_id"] != nil || !strings.Contains(string(body["input"]), "opaque_response_1")) {
				t.Error("recovery did not send full native history")
			}
			_ = conn.WriteJSON(testOpenAICompleted(fmt.Sprintf("response_%d", n)))
		}
	}))
	defer server.Close()
	p := testOpenAISocketProvider(t, server, pool)
	req := testOpenAISocketRequest("scope")
	first, err := p.StreamTurn(t.Context(), req, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = p.StreamTurn(t.Context(), nextSocketRequest(req, first), nil); err != nil {
		t.Fatal(err)
	}
	if commands.Load() != 3 {
		t.Fatalf("commands=%d", commands.Load())
	}
}
func TestOpenAIWebSocketDisconnectAndCancelDoNotReplay(t *testing.T) {
	for _, cancelRequest := range []bool{false, true} {
		t.Run(fmt.Sprint(cancelRequest), func(t *testing.T) {
			pool := newOpenAIResponsesPool()
			defer pool.Close()
			var commands atomic.Int32
			started := make(chan struct{})
			ended := make(chan struct{})
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				conn, err := (&websocket.Upgrader{}).Upgrade(w, r, nil)
				if err != nil {
					return
				}
				defer conn.Close()
				var body map[string]any
				if conn.ReadJSON(&body) != nil {
					return
				}
				n := commands.Add(1)
				if n == 1 {
					_ = conn.WriteJSON(map[string]any{"type": "response.output_text.delta", "delta": "partial"})
					close(started)
					if cancelRequest {
						_, _, _ = conn.ReadMessage()
					}
					close(ended)
					return
				}
				if body["previous_response_id"] != nil {
					t.Error("stale response reused")
				}
				_ = conn.WriteJSON(testOpenAICompleted("recovered"))
			}))
			defer server.Close()
			p := testOpenAISocketProvider(t, server, pool)
			ctx, cancel := context.WithCancel(t.Context())
			defer cancel()
			done := make(chan error, 1)
			go func() { _, err := p.StreamTurn(ctx, testOpenAISocketRequest("scope"), nil); done <- err }()
			<-started
			if cancelRequest {
				cancel()
			}
			select {
			case err := <-done:
				if err == nil {
					t.Fatal("partial disconnect succeeded")
				}
			case <-time.After(3 * time.Second):
				t.Fatal("cancel did not release socket")
			}
			<-ended
			if commands.Load() != 1 {
				t.Fatal("generation replayed")
			}
			if _, err := p.StreamTurn(t.Context(), testOpenAISocketRequest("scope"), nil); err != nil {
				t.Fatal(err)
			}
		})
	}
}
func TestOpenAIConnectionPoolBoundsWaitAndShutdown(t *testing.T) {
	pool := newOpenAIResponsesPool()
	pool.capacity = 1
	defer pool.Close()
	key := openAIConnectionKey{Model: "model", Scope: "scope"}
	first, err := pool.acquire(t.Context(), key, "token")
	if err != nil {
		t.Fatal(err)
	}
	other := key
	other.Scope = "other"
	if _, err = pool.acquire(t.Context(), other, "token"); !errors.Is(err, errOpenAIPoolFull) {
		t.Fatalf("capacity=%v", err)
	}
	ctx, cancel := context.WithTimeout(t.Context(), 10*time.Millisecond)
	defer cancel()
	if _, err = pool.acquire(ctx, key, "token"); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("wait=%v", err)
	}
	pool.Close()
	if first.ctx.Err() == nil {
		t.Fatal("close did not cancel active request")
	}
	first.finish(false)
	if _, err = pool.acquire(t.Context(), key, "token"); !errors.Is(err, errOpenAIPoolClosed) {
		t.Fatal(err)
	}
}
func TestOpenAICacheIdentityAndSupplementalIsolation(t *testing.T) {
	identity := openAIConnectionIdentity{"profile", "https://api.openai.com/v1", "account"}
	key := openAIPromptCacheKey("scope", identity)
	if len(key) > 128 || key != openAIPromptCacheKey("scope", identity) || strings.Contains(key, "account") {
		t.Fatal(key)
	}
	identity.Account = "other"
	if key == openAIPromptCacheKey("scope", identity) {
		t.Fatal("account keys collide")
	}
	pool := newOpenAIResponsesPool()
	defer pool.Close()
	var upgrades atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "GET" {
			upgrades.Add(1)
			t.Error("ephemeral request attempted upgrade")
			return
		}
		var body map[string]json.RawMessage
		_ = json.NewDecoder(r.Body).Decode(&body)
		if body["prompt_cache_key"] != nil || body["previous_response_id"] != nil {
			t.Error("ephemeral request enabled reuse")
		}
		w.Header().Set("Content-Type", "text/event-stream")
		raw, _ := json.Marshal(testOpenAICompleted("ephemeral"))
		fmt.Fprintf(w, "data: %s\n\n", raw)
	}))
	defer server.Close()
	p := testOpenAISocketProvider(t, server, pool)
	req := testOpenAISocketRequest("scope")
	req.ReusePolicy = &flprovider.RequestReusePolicy{}
	result, err := p.StreamTurn(t.Context(), req, nil)
	if err != nil || result.ProviderState != nil || upgrades.Load() != 0 {
		t.Fatalf("isolation=%+v %v", result.ProviderState, err)
	}
}

func TestOpenAIWebSocketPreservesToolResultOrder(t *testing.T) {
	pool := newOpenAIResponsesPool()
	defer pool.Close()
	bodies := make(chan map[string]json.RawMessage, 3)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := (&websocket.Upgrader{}).Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()
		for n := 1; ; n++ {
			var body map[string]json.RawMessage
			if conn.ReadJSON(&body) != nil {
				return
			}
			bodies <- body
			event := testOpenAICompleted(fmt.Sprintf("tool_%d", n))
			if n == 1 {
				response := event["response"].(map[string]any)
				output := response["output"].([]any)
				response["output"] = append(output, map[string]any{"type": "function_call", "id": "native_call", "call_id": "call", "name": "inspect", "namespace": "redeven", "arguments": "{}", "status": "completed"})
			}
			_ = conn.WriteJSON(event)
		}
	}))
	defer server.Close()
	p := testOpenAISocketProvider(t, server, pool)
	req := testOpenAISocketRequest("scope")
	req.Tools = []ToolDef{{Name: "inspect", InputSchema: json.RawMessage(`{"type":"object","properties":{},"additionalProperties":false}`)}}
	first, err := p.StreamTurn(t.Context(), req, nil)
	if err != nil {
		t.Fatal(err)
	}
	<-bodies
	if len(first.ToolCalls) != 1 || first.ToolCalls[0].ID != "call" {
		t.Fatal(first.ToolCalls)
	}
	req.PreviousState = first.ProviderState
	req.Messages = append(req.Messages, Message{Role: "assistant", Content: []ContentPart{{Type: "text", Text: first.Text}, {Type: "tool_call", ToolCallID: "call", ToolName: "inspect", ArgsJSON: "{}"}}}, Message{Role: "tool", Content: []ContentPart{{Type: "tool_result", ToolCallID: "call", ToolName: "inspect", Text: "result"}}})
	if _, err = p.StreamTurn(t.Context(), req, nil); err != nil {
		t.Fatal(err)
	}
	body := <-bodies
	var delta []map[string]any
	_ = json.Unmarshal(body["input"], &delta)
	if string(body["previous_response_id"]) != `"tool_1"` || len(delta) != 1 || delta[0]["type"] != "function_call_output" || delta[0]["call_id"] != "call" {
		t.Fatalf("tool delta=%s previous=%s", body["input"], body["previous_response_id"])
	}
	// A completed transport response is not enough: canonical state must agree.
	if _, err = p.StreamTurn(t.Context(), req, nil); err != nil {
		t.Fatal(err)
	}
	body = <-bodies
	if body["previous_response_id"] != nil || !strings.Contains(string(body["input"]), "native_call") {
		t.Fatal("uncommitted response became continuation authority")
	}
}
func TestOpenAIConnectionIdentityRotationAndLogout(t *testing.T) {
	pool := newOpenAIResponsesPool()
	defer pool.Close()
	var connections atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := (&websocket.Upgrader{}).Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()
		connections.Add(1)
		for {
			var body map[string]json.RawMessage
			if conn.ReadJSON(&body) != nil {
				return
			}
			_ = conn.WriteJSON(testOpenAICompleted("completed"))
		}
	}))
	defer server.Close()
	p := testOpenAISocketProvider(t, server, pool)
	var logout func(error)
	var stops atomic.Int32
	p.chatGPTWatch = func(_ context.Context, stop func(error)) (func(), error) {
		logout = stop
		return func() { stops.Add(1) }, nil
	}
	req := testOpenAISocketRequest("scope")
	if _, err := p.StreamTurn(t.Context(), req, nil); err != nil {
		t.Fatal(err)
	}
	logout(errors.New("signed out"))
	if _, err := p.StreamTurn(t.Context(), req, nil); err != nil {
		t.Fatal(err)
	}
	key := openAIConnectionKey{p.transportIdentity, req.Model, string(req.PromptScopeID)}
	pool.mu.Lock()
	pool.entries[key].opened = time.Now().Add(-55 * time.Minute)
	pool.mu.Unlock()
	if _, err := p.StreamTurn(t.Context(), req, nil); err != nil {
		t.Fatal(err)
	}
	req.PromptScopeID = "other-scope"
	if _, err := p.StreamTurn(t.Context(), req, nil); err != nil {
		t.Fatal(err)
	}
	p.transportIdentity.Account = "other-account"
	if _, err := p.StreamTurn(t.Context(), req, nil); err != nil {
		t.Fatal(err)
	}
	if connections.Load() != 5 || stops.Load() < 2 {
		t.Fatalf("connections=%d released watches=%d", connections.Load(), stops.Load())
	}
	pool.mu.Lock()
	pool.idle = 10 * time.Millisecond
	pool.mu.Unlock()
	if _, err := p.StreamTurn(t.Context(), req, nil); err != nil {
		t.Fatal(err)
	}
	deadline := time.NewTimer(time.Second)
	defer deadline.Stop()
	for {
		pool.mu.Lock()
		_, present := pool.entries[openAIConnectionKey{p.transportIdentity, req.Model, string(req.PromptScopeID)}]
		pool.mu.Unlock()
		if !present {
			break
		}
		select {
		case <-deadline.C:
			t.Fatal("idle connection leaked")
		case <-time.After(time.Millisecond):
		}
	}
}
func TestDesktopModelSourceDisconnectClosesExecutorConnections(t *testing.T) {
	executor := &desktopModelSourceExecutor{}
	pool := executor.openAIConnectionPool()
	lease, err := pool.acquire(t.Context(), openAIConnectionKey{Scope: "scope"}, "token")
	if err != nil {
		t.Fatal(err)
	}
	served := make(chan error, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := (&websocket.Upgrader{}).Upgrade(w, r, nil)
		if err != nil {
			served <- err
			return
		}
		defer conn.Close()
		served <- executor.serve(t.Context(), conn)
	}))
	defer server.Close()
	conn, _, err := websocket.DefaultDialer.Dial(strings.Replace(server.URL, "http://", "ws://", 1), nil)
	if err != nil {
		t.Fatal(err)
	}
	_ = conn.Close()
	select {
	case <-served:
	case <-time.After(time.Second):
		t.Fatal("RPC disconnect did not release executor")
	}
	if lease.ctx.Err() == nil {
		t.Fatal("executor request survived RPC disconnect")
	}
	next := executor.openAIConnectionPool()
	defer next.Close()
	if next == pool {
		t.Fatal("RPC reconnect retained closed pool")
	}
}

func TestOpenAIHTTPFallbackHappensBeforeWebSocketDispatch(t *testing.T) {
	for _, oversized := range []bool{false, true} {
		t.Run(fmt.Sprint(oversized), func(t *testing.T) {
			pool := newOpenAIResponsesPool()
			defer pool.Close()
			pool.capacity = 1
			if !oversized {
				lease, err := pool.acquire(t.Context(), openAIConnectionKey{Scope: "occupied"}, "token")
				if err != nil {
					t.Fatal(err)
				}
				defer lease.finish(false)
			}
			var posts atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method != "POST" {
					t.Error("fallback attempted upgrade")
					w.WriteHeader(400)
					return
				}
				posts.Add(1)
				w.Header().Set("Content-Type", "text/event-stream")
				raw, _ := json.Marshal(testOpenAICompleted("http"))
				fmt.Fprintf(w, "data: %s\n\n", raw)
			}))
			defer server.Close()
			p := testOpenAISocketProvider(t, server, pool)
			req := testOpenAISocketRequest("scope")
			text := "input"
			expected := "pool_capacity"
			if oversized {
				text = strings.Repeat("x", openAIWebSocketMaxMessageBytes)
				expected = "message_limit"
			}
			payload, _ := json.Marshal(map[string]any{"model": req.Model, "stream": true, "store": false, "input": []any{map[string]any{"role": "user", "content": text}}})
			var response *http.Response
			stream, lease, reason, err := p.responsesStream(t.Context(), req, "token", payload, &response, []option.RequestOption{option.WithRequestBody("application/json", payload)})
			if err != nil {
				t.Fatal(err)
			}
			defer stream.Close()
			if lease != nil || reason != expected || !stream.Next() || stream.Err() != nil || posts.Load() != 1 {
				t.Fatalf("fallback=%s lease=%v error=%v posts=%d", reason, lease, stream.Err(), posts.Load())
			}
		})
	}
}
func TestSupplementalRequestClosesExistingReusableConnection(t *testing.T) {
	pool := newOpenAIResponsesPool()
	defer pool.Close()
	closed := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "GET" {
			conn, err := (&websocket.Upgrader{}).Upgrade(w, r, nil)
			if err != nil {
				return
			}
			defer conn.Close()
			var body map[string]any
			if conn.ReadJSON(&body) != nil {
				return
			}
			_ = conn.WriteJSON(testOpenAICompleted("prior"))
			_, _, _ = conn.ReadMessage()
			close(closed)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		raw, _ := json.Marshal(testOpenAICompleted("secret"))
		fmt.Fprintf(w, "data: %s\n\n", raw)
	}))
	defer server.Close()
	p := testOpenAISocketProvider(t, server, pool)
	req := testOpenAISocketRequest("scope")
	if _, err := p.StreamTurn(t.Context(), req, nil); err != nil {
		t.Fatal(err)
	}
	req.ReusePolicy = &flprovider.RequestReusePolicy{}
	result, err := p.StreamTurn(t.Context(), req, nil)
	if err != nil || result.ProviderState != nil {
		t.Fatalf("supplemental state=%+v err=%v", result.ProviderState, err)
	}
	select {
	case <-closed:
	case <-time.After(time.Second):
		t.Fatal("supplemental input retained reusable socket")
	}
}
