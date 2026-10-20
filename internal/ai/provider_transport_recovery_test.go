package ai

import (
	"context"
	"encoding/json"
	"fmt"
	openai "github.com/openai/openai-go/v3"
	"github.com/openai/openai-go/v3/option"
	"io"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"testing/synctest"
	"time"

	flprovider "github.com/floegence/floret/v7/provider"
	"github.com/gorilla/websocket"
)

func TestOpenAITransportSelectionLifecycle(t *testing.T) {
	var gets, posts atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			gets.Add(1)
			w.WriteHeader(http.StatusUpgradeRequired)
			return
		}
		posts.Add(1)
		var body map[string]json.RawMessage
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
			return
		}
		if body["previous_response_id"] != nil {
			t.Error("HTTP inherited socket state")
		}
		w.Header().Set("Content-Type", "text/event-stream")
		raw, _ := json.Marshal(testOpenAICompleted("complete"))
		fmt.Fprintf(w, "data: %s\n\n", raw)
	}))
	defer server.Close()
	pool := newOpenAIResponsesPool()
	defer pool.Close()
	p := testOpenAISocketProvider(t, server, pool)
	req := testOpenAISocketRequest("thread")
	if _, err := p.StreamTurn(t.Context(), req, nil); err == nil {
		t.Fatal("upgrade must return to Engine")
	}
	p = testOpenAISocketProvider(t, server, pool)
	req.Model = "another-model"
	p.chatGPTToken = func(context.Context) (string, error) { return "rotated-token", nil }
	pool.closeConnections()
	for range 3 {
		if _, err := p.StreamTurn(t.Context(), req, nil); err != nil {
			t.Fatal(err)
		}
	}
	if gets.Load() != 1 || posts.Load() != 3 {
		t.Fatalf("gets=%d posts=%d", gets.Load(), posts.Load())
	}
	for _, route := range []string{"new-thread", "fork-thread"} {
		if _, err := p.StreamTurn(t.Context(), testOpenAISocketRequest(route), nil); err == nil {
			t.Fatal("new identity did not try WS")
		}
	}
	p.transportIdentity.Account = "other-account"
	if _, err := p.StreamTurn(t.Context(), req, nil); err == nil {
		t.Fatal("account shared selection")
	}
	p.transportIdentity.Endpoint = server.URL + "/other"
	if _, err := p.StreamTurn(t.Context(), req, nil); err == nil {
		t.Fatal("endpoint shared selection")
	}
	old := pool.routeSelection(t.Context(), openAIRequestRoute(p.transportIdentity, req))
	pool.releaseThread("thread")
	pool.releaseThread("thread")
	if got := pool.selectSSE(openAIRequestRoute(p.transportIdentity, req), old, "late_failure"); got != "" {
		t.Fatal("deleted thread resurrected")
	}
	fresh := newOpenAIResponsesPool()
	defer fresh.Close()
	p.responsesPool = fresh
	if _, err := p.StreamTurn(t.Context(), req, nil); err == nil {
		t.Fatal("restart did not reset selection")
	}
}

func TestOpenAITransportBusinessAndCancellationBoundaries(t *testing.T) {
	for _, status := range []int{400, 401, 403, 429, 503} {
		t.Run(fmt.Sprint(status), func(t *testing.T) {
			pool := newOpenAIResponsesPool()
			defer pool.Close()
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Retry-After", "3")
				w.WriteHeader(status)
				fmt.Fprint(w, "{}")
			}))
			defer server.Close()
			p := testOpenAISocketProvider(t, server, pool)
			req := testOpenAISocketRequest("thread")
			_, err := p.StreamTurn(t.Context(), req, nil)
			if err == nil || pool.selection(openAIRequestRoute(p.transportIdentity, req)) != "" {
				t.Fatalf("business status downgraded: %v", err)
			}
		})
	}
	for _, err := range []error{context.Canceled, flprovider.WithRetryAdvice(io.EOF, flprovider.RetryAdvice{Forbidden: true}), flprovider.WithRetryAdvice(io.EOF, flprovider.RetryAdvice{Category: flprovider.RetryPermanent})} {
		if recoverableWebSocketTransport(err) {
			t.Fatalf("nonrecoverable error: %v", err)
		}
	}
}

func TestOpenAITransportCompletionDoesNotDowngrade(t *testing.T) {
	pool := newOpenAIResponsesPool()
	defer pool.Close()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := (&websocket.Upgrader{}).Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()
		var body any
		if conn.ReadJSON(&body) != nil {
			return
		}
		_ = conn.WriteJSON(testOpenAICompleted("terminal"))
	}))
	defer server.Close()
	p := testOpenAISocketProvider(t, server, pool)
	req := testOpenAISocketRequest("thread")
	if _, err := p.StreamTurn(t.Context(), req, nil); err != nil {
		t.Fatal(err)
	}
	if pool.selection(openAIRequestRoute(p.transportIdentity, req)) != "" {
		t.Fatal("EOF after completion downgraded")
	}
}

func TestPreparedReplayRebindsPhysicalAttemptIdentity(t *testing.T) {
	req := testOpenAISocketRequest("thread")
	req.AttemptID = "attempt:1"
	req.AttemptEpoch = 1
	var actual ModelGatewayRequest
	prepared, err := newPreparedModelWire("openai", "gpt-5.5", flprovider.RequestFormatOpenAIResponses, map[string]any{"model": "gpt-5.5", "input": []any{}}, req, providerToolAliases{}, func(_ context.Context, req ModelGatewayRequest, _ []byte, _ func(StreamEvent)) (ModelGatewayResult, error) {
		actual = req
		return ModelGatewayResult{}, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	prepared.measurementIdentity = "socket:old"
	prepared.measurementForRequest = func(req ModelGatewayRequest) string {
		if req.AttemptID != "attempt:2" {
			t.Fatal("measurement saw stale attempt")
		}
		return "http:new"
	}
	frozen := string(prepared.payload)
	estimate := prepared.TokenEstimate()
	fingerprint := prepared.RenderedPayloadFingerprint()
	replay, err := prepared.replay(t.Context(), flprovider.Request{AttemptID: "attempt:2", AttemptEpoch: 2})
	if err != nil {
		t.Fatal(err)
	}
	defer replay.Close()
	if _, err = replay.StreamTurn(t.Context(), nil); err != nil {
		t.Fatal(err)
	}
	wire := replay.(*preparedModelWire)
	if actual.AttemptID != "attempt:2" || actual.AttemptEpoch != 2 || wire.measurementIdentity != "http:new" || string(wire.payload) != frozen || wire.RenderedPayloadFingerprint() != fingerprint || wire.TokenEstimate().EstimatedInputTokens != estimate.EstimatedInputTokens {
		t.Fatalf("replay identity/input drift: %+v", actual)
	}
}

func TestProviderAttemptDiagnosticSanitizationAndHistoricalEnvelope(t *testing.T) {
	negative := int64(-1)
	d := (&providerAttemptDiagnostic{Transport: "bad", Phase: "bad", RequestID: "secret", SwitchReason: "raw peer prose", WSCloseCode: 99, ConnectMS: &negative, FirstEventMS: &negative, ThreadID: "bearer token", PayloadHash: "request body"}).sanitized()
	raw, err := json.Marshal(d)
	if err != nil {
		t.Fatal(err)
	}
	for _, field := range []string{"connect_ms", "request_id", "switch_reason", "first_event_ms", "ws_close_code", "thread_id"} {
		var body map[string]any
		_ = json.Unmarshal(raw, &body)
		if _, ok := body[field]; ok {
			t.Fatalf("untrusted field survived: %s", raw)
		}
	}
	old := providerFailurePrefix + "{\"provider\":\"chatgpt\",\"response_shape\":\"transport_error\"}"
	if parsed, ok := parseProviderFailure(old); !ok || parsed.Attempt != nil {
		t.Fatal("historical envelope no longer readable")
	}
	pool := newOpenAIResponsesPool()
	defer pool.Close()
	p := &openAIProvider{chatGPT: true, officialOpenAI: true, responsesPool: pool}
	req := testOpenAISocketRequest("thread")
	diag := newProviderAttemptDiagnostic(t.Context(), req, []byte("frozen"), p, nil)
	diag.observe(flprovider.TransportWebSocket, flprovider.TransportReceiving, "", "")
	result := ModelGatewayResult{}
	failure := diag.finish(t.Context(), nil, &result, providerTransportFailure(io.ErrUnexpectedEOF, "chatgpt"), "chatgpt")
	parsed, ok := parseProviderFailure(failure.Error())
	if !ok || parsed.Attempt == nil || parsed.Attempt.SwitchReason != "connection_lost" || parsed.Attempt.Transport != "websocket" {
		t.Fatalf("diagnostic missing: %v", failure)
	}
}

type transportDeadlineRoundTripper func(*http.Request) (*http.Response, error)

func (f transportDeadlineRoundTripper) RoundTrip(r *http.Request) (*http.Response, error) {
	return f(r)
}

func TestOpenAIConnectDeadlineAndStop(t *testing.T) {
	for _, kind := range []string{"connect_limit", "parent_deadline", "stop"} {
		t.Run(kind, func(t *testing.T) {
			synctest.Test(t, func(t *testing.T) {
				pool := newOpenAIResponsesPool()
				defer pool.Close()
				var calls atomic.Int32
				adapter, err := newProviderAdapter("openai", "https://api.openai.com/v1", "fixture", nil)
				if err != nil {
					t.Fatal(err)
				}
				p := adapter.(*openAIProvider)
				p.chatGPT = true
				p.officialOpenAI = true
				p.responsesPool = pool
				p.transportIdentity = openAIConnectionIdentity{"provider", "https://api.openai.com/v1", "chatgpt:account"}
				p.chatGPTToken = func(context.Context) (string, error) { return "fixture", nil }
				ctx := t.Context()
				cancel := func() {}
				expected := 15 * time.Second
				if kind == "parent_deadline" {
					ctx, cancel = context.WithTimeout(ctx, 2*time.Second)
					expected = 2 * time.Second
				}
				if kind == "stop" {
					ctx, cancel = context.WithCancel(ctx)
					expected = time.Second
					time.AfterFunc(time.Second, cancel)
				}
				defer cancel()
				p.client = openai.NewClient(option.WithBaseURL("https://api.openai.com/v1/"), option.WithMaxRetries(0), option.WithHTTPClient(&http.Client{Transport: transportDeadlineRoundTripper(func(r *http.Request) (*http.Response, error) {
					calls.Add(1)
					<-r.Context().Done()
					return nil, r.Context().Err()
				})}))
				req := testOpenAISocketRequest("thread")
				payload, _ := json.Marshal(map[string]any{"model": req.Model, "input": []any{}, "stream": true})
				var response *http.Response
				started := time.Now()
				_, _, _, err = p.responsesStream(ctx, req, "fixture", payload, &response, nil, newProviderAttemptDiagnostic(t.Context(), req, payload, p, nil))
				if err == nil || time.Since(started) != expected || calls.Load() != 1 {
					t.Fatalf("elapsed=%v calls=%d err=%v", time.Since(started), calls.Load(), err)
				}
				pinned := pool.selection(openAIRequestRoute(p.transportIdentity, req))
				if (pinned != "") != (kind == "connect_limit") {
					t.Fatalf("selection=%q kind=%s", pinned, kind)
				}
				if kind == "connect_limit" && flprovider.RetryAdviceForError(err).Category != flprovider.RetryTimeout {
					t.Fatalf("advice=%+v", flprovider.RetryAdviceForError(err))
				}
			})
		})
	}
}

func TestOpenAIConcurrentSwitchStopsNewWebSocketSend(t *testing.T) {
	pool := newOpenAIResponsesPool()
	defer pool.Close()
	var gets, posts atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "GET" {
			gets.Add(1)
			conn, err := (&websocket.Upgrader{}).Upgrade(w, r, nil)
			if err != nil {
				return
			}
			defer conn.Close()
			_, _, _ = conn.ReadMessage()
			return
		}
		posts.Add(1)
		w.Header().Set("Content-Type", "text/event-stream")
		raw, _ := json.Marshal(testOpenAICompleted("sse"))
		fmt.Fprintf(w, "data: %s\n\n", raw)
	}))
	defer server.Close()
	p := testOpenAISocketProvider(t, server, pool)
	req := testOpenAISocketRequest("thread")
	switched := false
	_, err := p.StreamTurn(t.Context(), req, func(event StreamEvent) {
		if event.Transport != nil && event.Transport.Transport == flprovider.TransportWebSocket && event.Transport.Phase == flprovider.TransportSending {
			route := openAIRequestRoute(p.transportIdentity, req)
			pool.selectSSE(route, pool.routeSelection(t.Context(), route), "concurrent_failure")
			switched = true
		}
	})
	if err != nil || !switched || gets.Load() != 1 || posts.Load() != 1 {
		t.Fatalf("switch=%v gets=%d posts=%d err=%v", switched, gets.Load(), posts.Load(), err)
	}
	route := openAIRequestRoute(p.transportIdentity, req)
	selection := pool.routeSelection(t.Context(), route)
	if pool.selectSSE(route, selection, "late_success") != "concurrent_failure" {
		t.Fatal("first reason changed")
	}
}

func TestDesktopTransportReleaseIsIdempotentAndMemoryOnly(t *testing.T) {
	executor := &desktopModelSourceExecutor{}
	pool := executor.openAIConnectionPool()
	defer pool.Close()
	route := openAIThreadRoute{ThreadID: "thread"}
	pool.selectSSE(route, pool.routeSelection(t.Context(), route), "connect_failed")
	raw, _ := json.Marshal(map[string]string{"thread_id": "thread"})
	for range 2 {
		var result DesktopModelSourceRPCFrame
		executor.handleRequest(t.Context(), DesktopModelSourceRPCFrame{Method: "ai.thread.transport.release", Params: raw}, func(frame DesktopModelSourceRPCFrame) error { result = frame; return nil })
		if result.Type != "result" {
			t.Fatalf("release: %+v", result)
		}
	}
	pool.mu.Lock()
	count := len(pool.selections)
	pool.mu.Unlock()
	if count != 0 {
		t.Fatal("release retained route")
	}
	(&desktopModelSourceClient{}).releaseThreadTransport(t.Context(), "thread")
}

func TestOpenAIEndpointNormalizationPreservesRouteIdentity(t *testing.T) {
	for endpoint, want := range map[string]string{
		" HTTPS://API.OPENAI.COM:443/v1/ ": "https://api.openai.com/v1",
		"https://[::1]:443/v1/":            "https://[::1]/v1",
		"http://[::1]:80/v1/":              "http://[::1]/v1",
		"https://[::1]:8443/v1/":           "https://[::1]:8443/v1",
	} {
		if got := normalizedOpenAIEndpoint(endpoint); got != want {
			t.Fatalf("endpoint=%q got=%q want=%q", endpoint, got, want)
		}
	}
}

func TestCanceledAttemptCannotRecreateDeletedTransportResources(t *testing.T) {
	pool := newOpenAIResponsesPool()
	defer pool.Close()
	p := &openAIProvider{chatGPT: true, officialOpenAI: true, responsesPool: pool}
	req := testOpenAISocketRequest("thread")
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	pool.releaseThread("thread")
	diag := newProviderAttemptDiagnostic(ctx, req, nil, p, nil)
	if diag.selection != nil {
		t.Fatal("late cancelled attempt recreated transport selection")
	}
	if _, err := pool.acquire(ctx, openAIConnectionKey{Scope: "thread"}, "token", "thread"); err != context.Canceled {
		t.Fatalf("late socket acquisition: %v", err)
	}
	pool.mu.Lock()
	defer pool.mu.Unlock()
	if len(pool.entries) != 0 || len(pool.selections) != 0 {
		t.Fatal("deleted transport resources were recreated")
	}
}

func TestCompletedLeaseRejectsLateCancellationCleanup(t *testing.T) {
	pool := newOpenAIResponsesPool()
	defer pool.Close()
	key := openAIConnectionKey{Scope: "scope"}
	lease, err := pool.acquire(t.Context(), key, "token", "thread")
	if err != nil {
		t.Fatal(err)
	}
	lease.finish(true)
	pool.mu.Lock()
	lease.retireLocked()
	retained := pool.entries[key] == lease.entry && !lease.entry.busy
	pool.mu.Unlock()
	if !retained {
		t.Fatal("late cancellation retired a completed reusable socket")
	}
}
