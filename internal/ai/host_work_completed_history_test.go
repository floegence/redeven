package ai

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/floegence/floret/v7/identity"
	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/redeven/internal/ai/threadstore"
	"github.com/floegence/redeven/internal/config"
)

func TestFlowerReleasedCompletedHostWorkHistory(t *testing.T) {
	root := filepath.Join("testdata", "host-work-completed-v7.106.2")
	raw, err := os.ReadFile(filepath.Join(root, "manifest.json"))
	if err != nil {
		t.Fatal(err)
	}
	var manifest struct {
		Files     map[string]string
		ThreadIDs []string `json:"thread_ids"`
	}
	if err := json.Unmarshal(raw, &manifest); err != nil {
		t.Fatal(err)
	}
	verify := func() {
		t.Helper()
		for name, want := range manifest.Files {
			raw, err := os.ReadFile(filepath.Join(root, name))
			if err != nil {
				t.Fatal(err)
			}
			sum := sha256.Sum256(raw)
			if hex.EncodeToString(sum[:]) != want {
				t.Fatalf("released completed host-work fixture changed: %s", name)
			}
		}
	}
	verify()
	defer verify()
	state := t.TempDir()
	if err := os.MkdirAll(filepath.Join(state, "ai"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := copyTargetThreadFile(filepath.Join(root, "history.sqlite"), filepath.Join(state, "ai", "floret_threads.sqlite")); err != nil {
		t.Fatal(err)
	}
	opts := fixtureMaintenanceOptions(t, state)
	var calls, executions atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		var request map[string]any
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Error(err)
			http.Error(w, "bad fixture request", http.StatusBadRequest)
			return
		}
		// Title requests have no tool surface. Only explicit conversation
		// executions must receive the complete released historical exchange.
		if len(extractOpenAIToolNames(request)) > 0 {
			executions.Add(1)
			raw, _ := json.Marshal(request["input"])
			for _, fact := range []string{"running work-1", "Command completed: 7319", "Completed host work retained: 7319."} {
				if !strings.Contains(string(raw), fact) {
					t.Errorf("lost released historical model context: %s", fact)
				}
			}
		}
		w.Header().Set("Content-Type", "text/event-stream")
		writeDeepSeekIntegrationTextResponse(w, w.(http.Flusher), "completed-history", "Historical completion retained.")
	}))
	t.Cleanup(server.Close)
	opts.Config = &config.AIConfig{CurrentModelID: "deepseek/deepseek-v4-flash", Providers: []config.AIProvider{{ID: "deepseek", Type: "deepseek", BaseURL: server.URL, Models: []config.AIProviderModel{{ModelName: "deepseek-v4-flash"}}}}}
	opts.ResolveProviderAPIKey = func(string) (string, bool, error) { return "fixture", true, nil }
	meta := fixtureProductMeta()
	settings, err := threadstore.Open(filepath.Join(state, "ai", "threads.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	for _, id := range manifest.ThreadIDs {
		if err := settings.CreateThreadSettings(t.Context(), threadstore.ThreadSettings{ThreadID: id, EndpointID: meta.EndpointID, NamespacePublicID: meta.NamespacePublicID, ModelID: "deepseek/deepseek-v4-flash", PermissionType: "full_access", WorkingDir: opts.AgentHomeDir}); err != nil {
			t.Fatal(err)
		}
	}
	if err := settings.Close(); err != nil {
		t.Fatal(err)
	}
	var forkIDs []string
	for restart := range 2 {
		previous := calls.Load()
		previousExecutions := executions.Load()
		svc, err := NewServiceContext(t.Context(), opts)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = svc.Close() })
		if err := svc.Activate(t.Context()); err != nil {
			t.Fatal(err)
		}
		if calls.Load() != previous {
			t.Fatal("startup replayed completed host work")
		}
		for _, id := range forkIDs {
			detail, err := svc.GetFlowerThreadHistory(t.Context(), meta, id, FlowerHistoryRequest{})
			if err != nil || len(detail.Current.Turns) < 3 || detail.Current.Turns[1].Kind != flruntime.TurnKindHostWorkContinuation {
				t.Fatalf("restart lost continued fork history: %s %v", id, err)
			}
		}
		for _, id := range manifest.ThreadIDs {
			detail, err := svc.GetFlowerThreadHistory(t.Context(), meta, id, FlowerHistoryRequest{})
			if err != nil {
				t.Fatal(err)
			}
			if len(detail.Current.Turns) < 2 || detail.Current.Turns[1].Kind != flruntime.TurnKindHostWorkContinuation || !detail.Current.Turns[1].FinalBoundaryComplete {
				t.Fatalf("lost completed continuation: %+v", detail.Current.Turns)
			}
			finals := map[string]string{}
			for _, item := range detail.Current.Items {
				finals[item.ID] = item.Text
			}
			for _, turn := range detail.Current.Turns[:2] {
				if len(turn.FinalItemIDs) != 1 || finals[turn.FinalItemIDs[0]] == "" {
					t.Fatal("lost historical final answer")
				}
			}
			output, err := svc.threadRuntime.(flruntime.ThreadHostWorkService).ReadHostWorkOutput(t.Context(), identity.ThreadID(id), "work-1")
			if err != nil || output != "sealed synthetic output 7319" {
				t.Fatalf("lost sealed historical output: %s %v", id, err)
			}
			if _, err := svc.RetryThreadContinuation(t.Context(), meta, id); !errors.Is(err, ErrThreadContinuationRetryUnavailable) {
				t.Fatalf("completed-turn Retry changed semantics: %v", err)
			}
			if executions.Load() != previousExecutions {
				t.Fatal("reading or rejecting Retry replayed completed host work")
			}
			target := id
			if restart == 0 {
				fork, err := svc.ForkThreadWithOptions(t.Context(), meta, id, ForkThreadRequest{ClientRequestID: "qualify-completed-fork-" + id, Title: "Completed host-work history"})
				if err != nil {
					t.Fatal(err)
				}
				target = fork.ThreadID
				forkIDs = append(forkIDs, target)
			}
			if _, err := svc.SendUserTurn(t.Context(), meta, SendUserTurnRequest{StorageGeneration: svc.StorageGeneration(), ClientRequestID: fmt.Sprintf("completed-history-%s-%d", id, restart), ThreadID: target, Input: RunInput{Text: "Explicitly continue the retained historical conversation."}}); err != nil {
				t.Fatal(err)
			}
			waitForAskUserIntegrationThread(t, svc, meta, target, func(view *ThreadView) bool { return view.RunStatus == "success" })
			after, err := svc.GetFlowerThreadHistory(t.Context(), meta, target, FlowerHistoryRequest{})
			if err != nil {
				t.Fatal(err)
			}
			if len(after.Current.Turns) < 3 || after.Current.Turns[1].Kind != flruntime.TurnKindHostWorkContinuation {
				t.Fatal("continuation or fork lost host-work turn")
			}
			if len(after.Current.Items) <= len(detail.Current.Items) {
				t.Fatal("explicit continuation did not extend history")
			}
			// Fork remaps canonical item identities. Compare the complete ordered
			// historical facts rather than assuming the original item IDs survive.
			for i, want := range detail.Current.Items {
				if got := after.Current.Items[i]; got.Kind != want.Kind || got.Text != want.Text {
					t.Fatalf("historical item lost or changed at %d", i)
				}
			}
			previousExecutions++
		}
		if executions.Load() != previousExecutions {
			t.Fatalf("unexpected provider execution count: %d, want %d", executions.Load(), previousExecutions)
		}
		if err := svc.Close(); err != nil {
			t.Fatal(err)
		}
	}
}
