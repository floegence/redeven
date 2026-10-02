package ai

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	flprovider "github.com/floegence/floret/v7/provider"
	"github.com/floegence/redeven/internal/session"
)

func TestPlatformAuxiliaryIdentityIsStableAndRequestScoped(t *testing.T) {
	p := newFloretProviderAdapter(nil, platformGatewayProviderType, "model", ProviderControls{}, TurnBudgets{MaxOutputToken: 512}, providerWebSearchModeDisabled)
	req := flprovider.Request{ThreadID: "thread", RunID: "operation", TurnID: "turn", PromptScopeID: "scope", Messages: []flprovider.Message{{Role: flprovider.RoleUser, Text: "summarize"}}}
	a, err := p.turnRequest(t.Context(), req)
	if err != nil {
		t.Fatal(err)
	}
	b, err := p.turnRequest(t.Context(), req)
	if err != nil || a.AttemptID == "" || a.AttemptID != b.AttemptID || a.LogicalRequestID != b.LogicalRequestID || a.AttemptEpoch != 1 {
		t.Fatalf("unstable auxiliary identity: %v", err)
	}
	req.Messages[0].Text = "different checkpoint"
	c, err := p.turnRequest(t.Context(), req)
	if err != nil || c.AttemptID == a.AttemptID {
		t.Fatalf("different request reused identity: %v", err)
	}
	req.LogicalRequestID, req.AttemptID, req.AttemptEpoch = "floret-logical", "floret-attempt", 3
	d, err := p.turnRequest(t.Context(), req)
	if err != nil || d.AttemptID != req.AttemptID || d.LogicalRequestID != req.LogicalRequestID || d.AttemptEpoch != 3 {
		t.Fatalf("overrode Floret identity: %v", err)
	}
	req.MaxOutputTokens = 4096
	bounded, err := p.turnRequest(t.Context(), req)
	if err != nil || bounded.Budgets.MaxOutputToken != 512 {
		t.Fatalf("platform output exceeded published bound: %d, %v", bounded.Budgets.MaxOutputToken, err)
	}
}

func TestPlatformAutomaticTitleAndManualCompaction(t *testing.T) {
	var mu sync.Mutex
	requests := map[string]string{}
	titleDone := make(chan struct{})
	var titleOnce sync.Once
	edge := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/ai/v1/leases/renew":
			_ = json.NewEncoder(w).Encode(platformGatewayLease{Token: "lease", RenewalToken: "renewal", ExpiresAtUnix: time.Now().Add(time.Minute).Unix(), EntitlementVersion: 1})
		case "/api/ai/v1/catalog":
			_, _ = w.Write([]byte(`{"models":[{"model_id":"test-model","available":true,"capabilities":["text","tools","responses"],"context_window":256000,"max_output_tokens":2048}]}`))
		case "/api/ai/v1/requests":
			var in platformGatewayRunRequest
			if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
				t.Error(err)
				return
			}
			if in.AttemptID == "" || in.LogicalRequestID == "" || in.RunID == "" {
				t.Error("missing operation identity")
			}
			mu.Lock()
			if _, seen := requests[in.AttemptID]; seen {
				t.Error("replayed provider attempt")
			}
			requests[in.AttemptID] = string(in.Payload)
			mu.Unlock()
			answer := "The task is complete."
			if strings.Contains(string(in.Payload), "You generate concise thread titles") {
				answer = "Platform context test"
				defer titleOnce.Do(func() { close(titleDone) })
			}
			writeOpenAIResponsesSSE(w, r, "test-model", "resp_rd_test", answer)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer edge.Close()
	dir := t.TempDir()
	svc, err := NewService(Options{Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), StateDir: dir, AgentHomeDir: dir, Shell: "/bin/sh", RunMaxWallTime: 15 * time.Second, RunIdleTimeout: 5 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	defer svc.Close()
	meta := &session.Meta{EndpointID: "env", ChannelID: "channel", UserPublicID: "user", NamespacePublicID: "namespace", CanRead: true, CanWrite: true, CanExecute: true, PlatformAIGrant: "lease", PlatformAIGatewayURL: edge.URL, PlatformAIEntitlementVersion: 1}
	thread, err := svc.CreateThread(t.Context(), meta, "", "platform/test-model", "", "")
	if err != nil {
		t.Fatal(err)
	}
	for i, text := range []string{strings.Repeat("context to preserve and summarize. ", 1400), strings.Repeat("More prior context to retain. ", 1400), strings.Repeat("another block of context. ", 1900), strings.Repeat("last context to retain. ", 1900), "/compact"} {
		_, err = runTypedTurnForTest(t, t.Context(), svc, meta, []string{"first", "second", "third", "fourth", "compact"}[i], RunStartRequest{ThreadID: thread.ThreadID, Model: "platform/test-model", Input: RunInput{Text: text}})
		if err != nil {
			t.Fatal(err)
		}
		if i == 0 {
			select {
			case <-titleDone:
			case <-time.After(5 * time.Second):
				t.Fatal("automatic title never dispatched")
			}
		}
	}
	mu.Lock()
	defer mu.Unlock()
	auxiliary := 0
	for id := range requests {
		if strings.HasPrefix(id, "aux_") {
			auxiliary++
		}
	}
	if auxiliary < 2 {
		detail, err := svc.GetFlowerThreadDetail(t.Context(), meta, thread.ThreadID)
		if err != nil {
			t.Fatal(err)
		}
		t.Fatalf("title and compaction must dispatch distinct operations, got %d, compactions=%+v", auxiliary, detail.Thread.ContextCompactions)
	}
}
