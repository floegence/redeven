package ai

import (
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"

	flconfig "github.com/floegence/floret/v7/config"
	"github.com/floegence/floret/v7/identity"
	flprovider "github.com/floegence/floret/v7/provider"
	flruntime "github.com/floegence/floret/v7/runtime"
	flstorage "github.com/floegence/floret/v7/storage"
)

// The database was written through the pre-fix Redeven adapter and published
// Floret v7.98.0. Its upstream records stay opaque to the product and this test.
func TestResponsesPublishedSplitBindingSurvivesUpgradeRestartAndFork(t *testing.T) {
	root := "testdata/responses-history-v7.98.0"
	raw, err := os.ReadFile(filepath.Join(root, "manifest.json"))
	if err != nil {
		t.Fatal(err)
	}
	var manifest struct {
		WriterVersion string            `json:"writer_version"`
		ThreadID      identity.ThreadID `json:"thread_id"`
		SHA256        map[string]string
	}
	if err = json.Unmarshal(raw, &manifest); err != nil {
		t.Fatal(err)
	}
	if manifest.WriterVersion != "v7.98.0" {
		t.Fatal("wrong writer version")
	}
	verify := func() {
		for name, want := range manifest.SHA256 {
			data, err := os.ReadFile(filepath.Join(root, name))
			if err != nil {
				t.Fatal(err)
			}
			if fmt.Sprintf("%x", sha256.Sum256(data)) != want {
				t.Fatalf("fixture changed: %s", name)
			}
		}
	}
	verify()
	source, err := os.Open(filepath.Join(root, "history.sqlite.gz"))
	if err != nil {
		t.Fatal(err)
	}
	defer source.Close()
	compressed, err := gzip.NewReader(source)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "history.sqlite")
	dest, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = io.Copy(dest, compressed); err != nil {
		t.Fatal(err)
	}
	if err = dest.Close(); err != nil {
		t.Fatal(err)
	}
	if err = compressed.Close(); err != nil {
		t.Fatal(err)
	}
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := calls.Add(1)
		var body map[string]json.RawMessage
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		for _, want := range []string{"I will verify the sources.", "Verified answer."} {
			if !strings.Contains(string(body["input"]), want) {
				t.Errorf("request %d lost %s", n, want)
			}
		}
		for _, want := range []string{"search1", "search2", "synthetic-reasoning"} {
			present := strings.Contains(string(body["input"]), want)
			if present != (n < 3) {
				t.Errorf("request %d wrong native reuse: %s present=%t", n, want, present)
			}
		}
		if body["previous_response_id"] != nil {
			t.Error("unexpected server continuation")
		}
		w.Header().Set("Content-Type", "text/event-stream")
		output := []any{map[string]any{"type": "message", "role": "assistant", "content": []any{map[string]any{"type": "output_text", "text": "Continued."}}}}
		event, _ := json.Marshal(map[string]any{"type": "response.completed", "response": map[string]any{"id": fmt.Sprintf("continued%d", n), "status": "completed", "output": output}})
		fmt.Fprintf(w, "data: %s\n\n", event)
	}))
	defer server.Close()
	open := func() (*flruntime.Host, flruntime.ThreadService) {
		base, err := newProviderAdapter("openai", server.URL, "fixture", nil)
		if err != nil {
			t.Fatal(err)
		}
		gateway := newFloretProviderAdapter(base, "openai", "fixture-model", ProviderControls{}, TurnBudgets{}, providerWebSearchModeOpenAIResponsesBuiltin)
		gateway.identity, err = redevenFloretGatewayIdentity("openai", "openai", "https://history-fixture.invalid", "fixture-model", "responses", "api_key", "fixture")
		if err != nil {
			t.Fatal(err)
		}
		agent, err := flruntime.NewAgent(flconfig.AgentConfig{Profile: flconfig.AgentProfile{ID: "history-fixture", Name: "History fixture"}, SystemPrompt: "Answer the question.", Context: flconfig.ContextPolicy{ContextWindowTokens: 128000}}, gateway, flruntime.WithAgentHostedTools(flprovider.HostedToolDefinition{Name: "web_search", Type: "web_search"}), flruntime.WithAgentProviderRetryPolicy(flruntime.ProviderRetryPolicy{Disabled: true}))
		if err != nil {
			t.Fatal(err)
		}
		host, err := flruntime.Open(t.Context(), flruntime.Options{Storage: flstorage.SQLite(path)})
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
	defer func() { _ = host.Shutdown(context.Background()) }()
	for n := 0; n < 2; n++ {
		if _, err = service.Send(t.Context(), flruntime.SendInput{ThreadID: manifest.ThreadID, RequestKey: flruntime.RequestKey(fmt.Sprintf("continue-%d", n)), Input: flruntime.UserInput{Text: "Continue."}}); err != nil {
			t.Fatal(err)
		}
		view := waitDesktopContinuation(t, service, manifest.ThreadID)
		if view.Failure != nil || calls.Load() != int32(n+1) {
			t.Fatalf("upgrade failed: %+v requests=%d", view.Failure, calls.Load())
		}
		if err = host.Shutdown(context.Background()); err != nil {
			t.Fatal(err)
		}
		host, service = open()
	}
	fork, err := service.Fork(t.Context(), flruntime.ForkThreadInput{SourceThreadID: manifest.ThreadID, RequestKey: "fork"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = service.Send(t.Context(), flruntime.SendInput{ThreadID: fork.ThreadID, RequestKey: "fork-continue", Input: flruntime.UserInput{Text: "Continue."}}); err != nil {
		t.Fatal(err)
	}
	view := waitDesktopContinuation(t, service, fork.ThreadID)
	if view.Failure != nil || calls.Load() != 3 {
		t.Fatalf("fork failed: %+v requests=%d", view.Failure, calls.Load())
	}
	verify()
}
