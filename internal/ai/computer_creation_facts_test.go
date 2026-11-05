package ai

import (
	"bufio"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
)

func TestBrowserCreatedIdentitySurvivesSelectionFailure(t *testing.T) {
	for _, kind := range []string{"managed", "cdp"} {
		for _, phase := range []string{"unknown", "inventory", "selection"} {
			t.Run(kind+"/"+phase, func(t *testing.T) {
				rt, _, store, _ := computerBindingFixture(t)
				root := t.TempDir()
				tab := ComputerBrowserTab{ID: "created-tab", ProfileID: "profile"}
				if phase == "unknown" {
					tab.ID = ""
				}
				helper := filepath.Join(root, "redevenBrowserInventory.mjs")
				body, _ := json.Marshal(map[string]any{"protocol_version": 2, "tabs": []ComputerBrowserTab{tab}})
				if err := os.WriteFile(helper, []byte("printf '%s\\n' '"+string(body)+"'\n"), 0600); err != nil {
					t.Fatal(err)
				}
				rt.executors["browser-main"] = NewPlaywrightTargetExecutor("/bin/sh", helper, root)
				var inventories, selections atomic.Int32
				source, _ := browserHostFixture(t, func(w http.ResponseWriter, r *http.Request) {
					var req struct {
						ID, Method string
						Params     struct {
							ID      string
							Request playwrightTargetRequest
						}
					}
					if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
						t.Error(err)
						return
					}
					var result any = true
					switch req.Method {
					case "source.inventory":
						inventories.Add(1)
						if phase == "inventory" {
							w.WriteHeader(http.StatusServiceUnavailable)
							return
						}
						result = []ComputerBrowserTab{tab}
					case "source.admit":
						result = req.Params.ID
					case "source.tool":
						selections.Add(1)
						result = map[string]any{"id": req.Params.Request.ID, "target_id": req.Params.Request.TargetID, "error": "TARGET_CONNECTION_REQUIRED", "result": map[string]any{"action_executed": false}}
					case "source.ready", "source.remove":
					default:
						t.Error("unexpected helper command", req.Method)
					}
					_ = json.NewEncoder(w).Encode(map[string]any{"id": req.ID, "result": result})
				})
				rt.browserHost = source
				connection := ComputerBrowserConnection{CDPURL: "http://127.0.0.1:9222", ProfileID: "profile", NewTab: true}
				expected := rt.connectedBrowserTargetID(connection.CDPURL, tab)
				var creations atomic.Int32
				if kind == "managed" {
					local, peer := net.Pipe()
					done := make(chan struct{})
					profile := &managedBrowserProfile{input: local, output: local, reader: bufio.NewReader(local), done: done, endpoint: connection.CDPURL}
					rt.managedProfiles = map[string]*managedBrowserProfile{"browser-main": profile}
					t.Cleanup(func() { close(done); _ = peer.Close(); profile.close() })
					go func() {
						decoder := json.NewDecoder(peer)
						for {
							var request struct{ ID, Command string }
							if decoder.Decode(&request) != nil {
								return
							}
							if request.Command != "new_tab" {
								t.Error("unexpected command", request.Command)
							}
							creations.Add(1)
							_ = json.NewEncoder(peer).Encode(map[string]any{"id": request.ID, "tab": tab})
						}
					}()
					connection = ComputerBrowserConnection{ManagedProfileID: "browser-main", NewTab: true}
					expected = "managed-" + tab.ID
				}
				candidate, err := rt.rememberComputerCandidate("thread-first", ComputerCandidate{Kind: "browser." + map[string]string{"managed": "managed", "cdp": "connected"}[kind]}, &connection)
				if err != nil {
					t.Fatal(err)
				}
				owner := &run{threadID: "thread-first", targetResolver: rt, targetToolExecutor: rt}
				bindTargetTestRun(t, owner)
				value, failure := owner.execComputerManagement(computerAuthorizedTestContext(t, owner, "select", "computer.select_target"), "select", "computer.select_target", map[string]any{"candidate_ref": candidate.CandidateRef})
				output, ok := value.(toolExecutionOutput)
				var created *computerTabCreatedError
				if !ok || failure == nil || errors.As(failure, &created) != (phase != "unknown") {
					t.Fatalf("creation certainty lost: %#v %v", value, failure)
				}
				payload := output.Payload.(map[string]any)
				published, err := floretToolResultFromFlower(nil, ToolResult{ToolName: "computer.select_target", Status: toolResultStatusError, Data: payload})
				if err != nil {
					t.Fatal(err)
				}
				if phase != "unknown" {
					identity, ok := payload["created_target"].(map[string]any)
					if !ok || identity["target_id"] != expected || created.targetID != expected || inventories.Load() != 1 || !strings.Contains(published.Text, expected) {
						t.Fatalf("identity or dispatch mismatch: %+v calls=%d", payload, inventories.Load())
					}
				} else if !errors.Is(failure, errBrowserOutcomeUnknown) || payload["created_target"] != nil || inventories.Load() != 0 {
					t.Fatalf("unknown creation advanced selection: %v %+v", failure, payload)
				}
				if strings.Contains(published.Text, "127.0.0.1") {
					t.Fatal("endpoint exposed")
				}
				selected, _ := store.GetComputerTarget(t.Context(), "thread-first")
				if payload["selected"] != false || selected != "" || selections.Load() != map[string]int32{"selection": 1}[phase] || kind == "managed" && creations.Load() != 1 {
					t.Fatalf("selection/replay mismatch: %+v selected=%s selections=%d creations=%d", payload, selected, selections.Load(), creations.Load())
				}
			})
		}
	}
}
