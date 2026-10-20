package ai

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
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

// Published writer bytes stay immutable. Only product-owned settings are seeded;
// all historical Floret records are copied and opened through public APIs.
func TestFlowerReleasedCorrectionFailuresUpgradeAndRecover(t *testing.T) {
	root := filepath.Join("testdata", "tool-correction-v7.69.1")
	raw, err := os.ReadFile(filepath.Join(root, "manifest.json"))
	if err != nil {
		t.Fatal(err)
	}
	var manifest struct{ Files map[string]string }
	if err := json.Unmarshal(raw, &manifest); err != nil {
		t.Fatal(err)
	}
	for name, want := range manifest.Files {
		data, err := os.ReadFile(filepath.Join(root, name))
		if err != nil {
			t.Fatal(err)
		}
		sum := sha256.Sum256(data)
		if hex.EncodeToString(sum[:]) != want {
			t.Fatalf("released writer changed: %s", name)
		}
	}
	for _, action := range []string{"retry", "send", "fork"} {
		t.Run(action, func(t *testing.T) {
			state := t.TempDir()
			if err := os.MkdirAll(filepath.Join(state, "ai"), 0700); err != nil {
				t.Fatal(err)
			}
			if err := copyTargetThreadFile(filepath.Join(root, "history.sqlite"), filepath.Join(state, "ai", "floret_threads.sqlite")); err != nil {
				t.Fatal(err)
			}
			opts := fixtureMaintenanceOptions(t, state)
			var calls atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var request map[string]any
				if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
					t.Error(err)
					http.Error(w, "bad fixture request", 400)
					return
				}
				w.Header().Set("Content-Type", "text/event-stream")
				if len(extractOpenAIToolNames(request)) > 0 {
					calls.Add(1)
					raw, _ := json.Marshal(request["input"])
					if !strings.Contains(string(raw), "CONFIRMED_RELEASED_RESULT") {
						t.Error("confirmed historical result lost")
					}
					pairs := map[string]int{}
					input, _ := request["input"].([]any)
					for _, value := range input {
						item, _ := value.(map[string]any)
						id, _ := item["call_id"].(string)
						switch item["type"] {
						case "function_call":
							pairs[id]++
						case "function_call_output":
							pairs[id]--
						}
					}
					for id, balance := range pairs {
						if balance != 0 {
							t.Errorf("unpaired historical exchange: %s %d", id, balance)
						}
					}
				}
				writeDeepSeekIntegrationTextResponse(w, w.(http.Flusher), "history-recovery", "Confirmed history retained.")
			}))
			t.Cleanup(server.Close)
			opts.Config = &config.AIConfig{CurrentModelID: "deepseek/deepseek-v4-flash", Providers: []config.AIProvider{{ID: "deepseek", Type: "deepseek", BaseURL: server.URL, Models: []config.AIProviderModel{{ModelName: "deepseek-v4-flash"}}}}}
			opts.ResolveProviderAPIKey = func(string) (string, bool, error) { return "fixture", true, nil }
			meta := fixtureProductMeta()
			settings, err := threadstore.Open(filepath.Join(state, "ai", "threads.sqlite"))
			if err != nil {
				t.Fatal(err)
			}
			ids := []string{"ordinary", "control", "fork", "nested"}
			for _, id := range ids {
				if err := settings.CreateThreadSettings(t.Context(), threadstore.ThreadSettings{ThreadID: id, EndpointID: meta.EndpointID, NamespacePublicID: meta.NamespacePublicID, ModelID: "deepseek/deepseek-v4-flash", PermissionType: "full_access", WorkingDir: opts.AgentHomeDir}); err != nil {
					t.Fatal(err)
				}
			}
			if err := settings.Close(); err != nil {
				t.Fatal(err)
			}
			for restart := 0; restart < 2; restart++ {
				previous := calls.Load()
				svc, err := NewServiceContext(t.Context(), opts)
				if err != nil {
					t.Fatal(err)
				}
				t.Cleanup(func() { _ = svc.Close() })
				if err := svc.Activate(t.Context()); err != nil {
					t.Fatal(err)
				}
				if calls.Load() != previous {
					t.Fatal("startup replayed historical execution")
				}
				summaries, err := svc.ListThreads(t.Context(), meta, 100, "")
				if err != nil {
					t.Fatal(err)
				}
				if restart == 0 {
					for _, summary := range summaries.Threads {
						if summary.RunErrorCode != runErrorCodeToolArgumentCorrection {
							t.Fatalf("historical list reason: %+v", summary)
						}
					}
				}
				for _, id := range ids {
					before, err := svc.threadRuntime.View(t.Context(), identity.ThreadID(id))
					if err != nil {
						t.Fatal(err)
					}
					if len(before.Items) == 0 || len(before.Interactions) != 0 {
						t.Fatalf("lost history or orphan interaction: %s", id)
					}
					if restart == 0 {
						detail, err := svc.GetFlowerThreadDetail(t.Context(), meta, id)
						if err != nil {
							t.Fatal(err)
						}
						if detail.Thread.RunErrorCode != runErrorCodeToolArgumentCorrection || detail.Current.Failure == nil || detail.Current.Failure.Reason != flruntime.ThreadTurnFailureToolArgumentCorrectionExhausted {
							t.Fatalf("historical detail reason: %+v", detail)
						}
						data, err := json.Marshal(detail)
						if err != nil {
							t.Fatal(err)
						}
						if strings.Contains(string(data), "yield_time_ms") || strings.Contains(string(data), "tool argument correction exhausted") {
							t.Fatal("raw historical failure leaked")
						}
						live, err := json.Marshal(FlowerLiveStreamEnvelope{SchemaVersion: FlowerLiveSchemaVersion, Kind: FlowerLiveStreamThreadBatch, ThreadID: id, Current: &before})
						if err != nil || !strings.Contains(string(live), runErrorCodeToolArgumentCorrection) || strings.Contains(string(live), "yield_time_ms") || strings.Contains(string(live), "tool argument correction exhausted") {
							t.Fatalf("historical live classification or privacy failed: %v", err)
						}
						if err := svc.threadsDB.PutExecutionAuthority(t.Context(), threadstore.ExecutionAuthority{RequestKey: "history-" + id, ThreadID: id, TurnID: before.TurnID.String(), EndpointID: meta.EndpointID, NamespacePublicID: meta.NamespacePublicID, ChannelID: meta.ChannelID, UserPublicID: meta.UserPublicID, PermissionType: "full_access"}); err != nil {
							t.Fatal(err)
						}
					}
					target := id
					if action == "fork" && restart == 0 {
						fork, err := svc.ForkThreadWithOptions(t.Context(), meta, id, ForkThreadRequest{ClientRequestID: "qualify-fork-" + id, Title: "Retained correction history"})
						if err != nil {
							t.Fatal(err)
						}
						target = fork.ThreadID
					}
					if action == "retry" && restart == 0 {
						_, err = svc.RetryThreadContinuation(t.Context(), meta, target)
					} else {
						_, err = svc.SendUserTurn(t.Context(), meta, SendUserTurnRequest{StorageGeneration: svc.StorageGeneration(), ClientRequestID: fmt.Sprintf("qualify-%s-%s-%d", action, id, restart), ThreadID: target, Input: RunInput{Text: "Explicitly continue using confirmed historical results."}})
					}
					if err != nil {
						t.Fatal(err)
					}
					waitForAskUserIntegrationThread(t, svc, meta, target, func(view *ThreadView) bool { return view.RunStatus == "success" })
					after, err := svc.GetFlowerThreadDetail(t.Context(), meta, target)
					if err != nil || after.Current.Failure != nil || after.Thread.RunErrorCode != "" {
						t.Fatalf("recovery retained failure: %s %v", target, err)
					}
				}
				if calls.Load()-previous != 4 {
					t.Fatalf("implicit or missing work: calls=%d", calls.Load()-previous)
				}
				if err := svc.Close(); err != nil {
					t.Fatal(err)
				}
			}
		})
	}
}
