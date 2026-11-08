package ai

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
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
	"time"

	flconfig "github.com/floegence/floret/v7/config"
	"github.com/floegence/floret/v7/florettest"
	"github.com/floegence/floret/v7/identity"
	flprovider "github.com/floegence/floret/v7/provider"
	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/floret/v7/storage"
	fltools "github.com/floegence/floret/v7/tools"
)

// Exercise the published owner API: no host reads or edits opaque journal bytes.
func TestToolNamesUpgradeContinuesOldInputAndToolHistory(t *testing.T) {
	gateway := florettest.NewScriptedGateway(flprovider.Identity{Provider: "test", Model: "test", StateCompatibilityKey: "test"}, flprovider.Capabilities{Reasoning: flprovider.ReasoningUnsupported},
		florettest.Step{Events: []flprovider.Event{{Type: flprovider.EventToolCalls, ToolCalls: []flprovider.ToolCall{{ID: "old-read", Name: "read_file", Args: "{}"}}}, {Type: flprovider.EventDone, Reason: "tool_calls"}}},
		florettest.Step{Events: []flprovider.Event{{Type: flprovider.EventToolCalls, ToolCalls: []flprovider.ToolCall{{ID: "old-ask", Name: "ask_user", Args: `{"reason_code":"missing_external_input","required_from_user":["q"],"evidence_refs":[],"questions":[{"id":"q","header":"Question","question":"Continue?","response_mode":"write","is_secret":false}]}`}}}, {Type: flprovider.EventDone, Reason: "tool_calls"}}},
		florettest.Step{Events: []flprovider.Event{{Type: flprovider.EventToolCalls, ToolCalls: []flprovider.ToolCall{{ID: "new-read", Name: "file_read", Args: "{}"}}}, {Type: flprovider.EventDone, Reason: "tool_calls"}}},
		florettest.Step{Events: []flprovider.Event{{Type: flprovider.EventDelta, Text: "finished"}, {Type: flprovider.EventDone, Reason: "stop"}}},
		florettest.Step{Events: []flprovider.Event{{Type: flprovider.EventDelta, Text: "fork continued"}, {Type: flprovider.EventDone, Reason: "stop"}}},
		florettest.Step{Events: []flprovider.Event{{Type: flprovider.EventDelta, Text: "retry continued"}, {Type: flprovider.EventDone, Reason: "stop"}}},
	)
	var effects atomic.Int32
	path := t.TempDir() + "/history.sqlite"
	open := func(upgraded bool) (*flruntime.Host, flruntime.ThreadService) {
		t.Helper()
		host, err := flruntime.Open(t.Context(), flruntime.Options{Storage: storage.SQLite(path)})
		if err != nil {
			t.Fatal(err)
		}
		svc, err := host.ThreadService(flruntime.AgentFactoryFunc(func(context.Context, flruntime.AgentRequest) (*flruntime.Agent, error) {
			name := "read_file"
			if upgraded {
				name = "file_read"
			}
			tool := fltools.Define[map[string]any](fltools.Definition{Name: name, ReadOnly: true, InputSchema: fltools.StrictObject(nil, nil), Permission: fltools.PermissionSpec{Mode: fltools.PermissionAllow}}, nil, nil, func(context.Context, fltools.Invocation[map[string]any]) (fltools.Result, error) {
				effects.Add(1)
				return fltools.Result{Text: "retained file fact"}, nil
			})
			opts := []flruntime.AgentOption{flruntime.WithAgentTools(tool), flruntime.WithAgentEffectAuthorization(flruntime.EffectAuthorizationGateFunc(func(ctx context.Context, r flruntime.EffectAuthorizationRequest, e flruntime.AuthorizedEffect) (flruntime.EffectDispatchResult, error) {
				return e(ctx, flruntime.EffectAuthorizationProof{EffectAttemptID: r.EffectAttemptID, RequestFingerprint: r.RequestFingerprint, ThreadID: r.ThreadID, TurnID: r.TurnID, RunID: r.RunID, ToolCallID: r.ToolCallID, PolicyRevision: "test", AuditReference: "test", AuditHash: "test", AuthorizedAt: time.Now()})
			}))}
			if upgraded {
				opts = append(opts, flruntime.WithAgentBuiltinToolNames(flruntime.BuiltinToolNames{AskUser: "user_ask", Goal: "goal_manage"}), flruntime.WithAgentDynamicToolSurface(func(context.Context, flruntime.ToolSurfaceRequest) (flruntime.ToolSurface, error) {
					return flruntime.ToolSurface{RefreshProviderSurface: true, Tools: fltools.NewRegistry(tool)}, nil
				}))
			}
			return flruntime.NewAgent(flconfig.AgentConfig{Profile: flconfig.AgentProfile{ID: "test", Name: "Test"}, SystemPrompt: "Complete the task.", Context: flconfig.ContextPolicy{ContextWindowTokens: 128000}}, gateway, opts...)
		}))
		if err != nil {
			t.Fatal(err)
		}
		return host, svc
	}
	host, svc := open(false)
	defer func() { _ = host.Shutdown(context.Background()) }()
	thread, err := svc.Create(t.Context(), flruntime.CreateThreadInput{RequestKey: "create"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = svc.Send(t.Context(), flruntime.SendInput{ThreadID: thread.ThreadID, RequestKey: "initial", Input: flruntime.UserInput{Text: "read then ask"}}); err != nil {
		t.Fatal(err)
	}
	wait := func(input bool) flruntime.ThreadView {
		t.Helper()
		deadline := time.Now().Add(10 * time.Second)
		for time.Now().Before(deadline) {
			v, e := svc.View(t.Context(), thread.ThreadID)
			if e != nil {
				t.Fatal(e)
			}
			if input && v.Attention.InputCount == 1 || !input && v.Activity == flruntime.ThreadActivityIdle && v.LastOutcome != nil {
				return v
			}
			time.Sleep(5 * time.Millisecond)
		}
		t.Fatal("thread did not settle")
		return flruntime.ThreadView{}
	}
	waiting := wait(true)
	if err = host.Shutdown(t.Context()); err != nil {
		t.Fatal(err)
	}
	host, svc = open(true)
	if _, err = svc.Respond(t.Context(), flruntime.RespondInput{ThreadID: thread.ThreadID, InteractionID: waiting.Interactions[0].ID, RequestKey: "answer", Answers: []flruntime.InteractionAnswer{{Input: map[string]string{"q": "yes"}}}}); err != nil {
		t.Fatal(err)
	}
	final := wait(false)
	if final.Failure != nil {
		t.Fatal(final.Failure)
	}
	fork, err := svc.Fork(t.Context(), flruntime.ForkThreadInput{SourceThreadID: thread.ThreadID, RequestKey: "fork"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = svc.Send(t.Context(), flruntime.SendInput{ThreadID: fork.ThreadID, RequestKey: "fork-send", Input: flruntime.UserInput{Text: "continue"}}); err != nil {
		t.Fatal(err)
	}
	if _, err = svc.(flruntime.ThreadWaiter).WaitThreads(t.Context(), flruntime.WaitThreadsInput{ThreadIDs: []identity.ThreadID{fork.ThreadID}, Timeout: 10 * time.Second}); err != nil {
		t.Fatal(err)
	}
	if _, err = svc.Retry(t.Context(), flruntime.RetryInput{ThreadID: thread.ThreadID, SourceTurnID: final.TurnID, RequestKey: "retry"}); err != nil {
		t.Fatal(err)
	}
	wait(false)
	if effects.Load() != 2 {
		t.Fatalf("historical effects replayed: %d", effects.Load())
	}
	requests := gateway.Requests()
	if len(requests) != 6 {
		t.Fatalf("requests=%d", len(requests))
	}
	for index, req := range requests[2:] {
		for _, d := range req.Tools {
			if d.Name == "ask_user" || d.Name == "read_file" {
				t.Fatal("legacy name re-advertised")
			}
		}
		oldCall, oldResult, answer := false, false, false
		for _, m := range req.Messages {
			for _, c := range m.ToolCalls {
				oldCall = oldCall || c.ID == "old-read" && c.Name == "read_file"
			}
			if m.ToolResult != nil {
				oldResult = oldResult || m.ToolResult.CallID == "old-read"
				answer = answer || m.ToolResult.CallID == "old-ask"
			}
		}
		// Retry of a completed turn starts from its user input; continuation and
		// Fork retain the completed exchanges. Neither replays host effects.
		if index < 3 && (!oldCall || !oldResult || !answer) {
			t.Fatalf("request %d history call=%v result=%v answer=%v messages=%+v", index+2, oldCall, oldResult, answer, req.Messages)
		}
	}
}

func TestAnthropicHistoricalNamesPreserveSignedNativeHistory(t *testing.T) {
	var bodies [][]byte
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		bodies = append(bodies, raw)
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"id":"msg","content":[{"type":"thinking","thinking":"reason","signature":"signed-old-tool"},{"type":"tool_use","id":"old","name":"terminal.exec","input":{}}],"stop_reason":"tool_use","usage":{"input_tokens":1,"output_tokens":1}}`)
	}))
	defer server.Close()
	adapter, err := newProviderAdapter("anthropic", server.URL, "key", nil)
	if err != nil {
		t.Fatal(err)
	}
	req := ModelGatewayRequest{RunID: "run", PromptScopeID: "scope", Model: "fixture", ReusePolicy: &flprovider.RequestReusePolicy{ProviderStateAllowed: true}, Messages: []Message{{Role: "user", Content: []ContentPart{{Type: "text", Text: "historical request"}}}}}
	old, err := adapter.StreamTurn(t.Context(), req, nil)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(old.ProviderState)
	var restored ModelGatewayState
	if err = json.Unmarshal(raw, &restored); err != nil {
		t.Fatal(err)
	}
	req.PreviousState = &restored
	req.Tools = []ToolDef{{Name: "terminal_exec", InputSchema: json.RawMessage(`{"type":"object","properties":{}}`)}}
	req.Messages = append(req.Messages, Message{Role: "assistant", Content: []ContentPart{{Type: "reasoning", Text: old.Reasoning}, {Type: "tool_call", ToolCallID: "old", ToolName: "terminal.exec", ArgsJSON: "{}"}}}, Message{Role: "tool", Content: []ContentPart{{Type: "tool_result", ToolCallID: "old", ToolName: "terminal.exec", Text: "confirmed historical result"}}})
	if _, err = adapter.StreamTurn(t.Context(), req, nil); err != nil {
		t.Fatal(err)
	}
	if len(bodies) != 2 || !bytes.Contains(bodies[1], []byte("signed-old-tool")) || !bytes.Contains(bodies[1], []byte(`"name":"terminal.exec"`)) || !bytes.Contains(bodies[1], []byte(`"name":"terminal_exec"`)) {
		t.Fatal("new definitions altered signed history")
	}
}

func TestReleasedToolNamesUpgradePreservesPendingInteractions(t *testing.T) {
	root := filepath.Join("testdata", "tool-names-v7.107.9")
	raw, err := os.ReadFile(filepath.Join(root, "manifest.json"))
	if err != nil {
		t.Fatal(err)
	}
	var manifest struct {
		SHA256 map[string]string `json:"sha256"`
	}
	if err := json.Unmarshal(raw, &manifest); err != nil {
		t.Fatal(err)
	}
	for name, sum := range manifest.SHA256 {
		data, err := os.ReadFile(filepath.Join(root, name))
		if err != nil {
			t.Fatal(err)
		}
		got := sha256.Sum256(data)
		if hex.EncodeToString(got[:]) != sum {
			t.Fatalf("fixture checksum: %s", name)
		}
	}
	raw, err = os.ReadFile(filepath.Join(root, "identities.json"))
	if err != nil {
		t.Fatal(err)
	}
	var identities map[string]struct {
		ThreadID      identity.ThreadID `json:"thread_id"`
		InteractionID string            `json:"interaction_id"`
	}
	if err := json.Unmarshal(raw, &identities); err != nil {
		t.Fatal(err)
	}
	for _, mode := range []string{"input", "approval"} {
		t.Run(mode, func(t *testing.T) {
			data, err := os.ReadFile(filepath.Join(root, mode+".sqlite"))
			if err != nil {
				t.Fatal(err)
			}
			path := filepath.Join(t.TempDir(), "history.sqlite")
			if err := os.WriteFile(path, data, 0600); err != nil {
				t.Fatal(err)
			}
			var effects atomic.Int32
			gateway := florettest.NewScriptedGateway(flprovider.Identity{Provider: "test", Model: "fixture", StateCompatibilityKey: "fixture"}, flprovider.Capabilities{Reasoning: flprovider.ReasoningUnsupported},
				florettest.Step{Events: []flprovider.Event{{Type: flprovider.EventDelta, Text: "history retained"}, {Type: flprovider.EventDone, Reason: "stop"}}})
			open := func() (*flruntime.Host, flruntime.ThreadService) {
				host, err := flruntime.Open(t.Context(), flruntime.Options{Storage: storage.SQLite(path)})
				if err != nil {
					t.Fatal(err)
				}
				service, err := host.ThreadService(flruntime.AgentFactoryFunc(func(context.Context, flruntime.AgentRequest) (*flruntime.Agent, error) {
					name := "terminal_exec"
					tool := fltools.Define[map[string]any](fltools.Definition{Name: name, InputSchema: fltools.StrictObject(nil, nil), Permission: fltools.PermissionSpec{Mode: fltools.PermissionAllow}}, nil, nil, func(context.Context, fltools.Invocation[map[string]any]) (fltools.Result, error) {
						effects.Add(1)
						return fltools.Result{Text: "must not dispatch old call"}, nil
					})
					return flruntime.NewAgent(flconfig.AgentConfig{Profile: flconfig.AgentProfile{ID: "fixture", Name: "Fixture"}, SystemPrompt: "Inspect.", Context: flconfig.ContextPolicy{ContextWindowTokens: 128000}}, gateway, flruntime.WithAgentTools(tool), flruntime.WithAgentBuiltinToolNames(flruntime.BuiltinToolNames{AskUser: "user_ask", Goal: "goal_manage"}), flruntime.WithAgentEffectAuthorization(floretAllowTestEffect), flruntime.WithAgentDynamicToolSurface(func(context.Context, flruntime.ToolSurfaceRequest) (flruntime.ToolSurface, error) {
						return flruntime.ToolSurface{RefreshProviderSurface: true, Tools: fltools.NewRegistry(tool)}, nil
					}))
				}))
				if err != nil {
					t.Fatal(err)
				}
				return host, service
			}
			id := identities[mode]
			host, svc := open()
			view, err := svc.View(t.Context(), id.ThreadID)
			if err != nil {
				t.Fatal(err)
			}
			if len(view.Interactions) != 1 || view.Interactions[0].ID != id.InteractionID {
				t.Fatalf("lost interaction: %+v", view)
			}
			if err := host.Shutdown(t.Context()); err != nil {
				t.Fatal(err)
			}
			host, svc = open()
			defer host.Shutdown(context.Background())
			answer := flruntime.InteractionAnswer{Input: map[string]string{"q": "yes"}}
			if strings.HasPrefix(mode, "approval") {
				approved := true
				answer = flruntime.InteractionAnswer{Approved: &approved}
			}
			if _, err := svc.Respond(t.Context(), flruntime.RespondInput{ThreadID: id.ThreadID, InteractionID: id.InteractionID, RequestKey: "respond", Answers: []flruntime.InteractionAnswer{answer}}); err != nil {
				t.Fatal(err)
			}
			deadline := time.Now().Add(10 * time.Second)
			for {
				view, err = svc.View(t.Context(), id.ThreadID)
				if err != nil {
					t.Fatal(err)
				}
				if view.Activity == flruntime.ThreadActivityIdle && view.LastOutcome != nil {
					break
				}
				if time.Now().After(deadline) {
					t.Fatalf("did not settle: %+v", view)
				}
				time.Sleep(5 * time.Millisecond)
			}
			if effects.Load() != 0 {
				t.Fatal("historical effect replayed through new name")
			}
			requests := gateway.Requests()
			if len(requests) == 0 {
				t.Fatal("continuation missing")
			}
			if view.Failure != nil {
				t.Fatalf("continuation failed: %+v", view.Failure)
			}
			for _, req := range requests {
				call, result, approvalResult := false, false, false
				for _, m := range req.Messages {
					for _, c := range m.ToolCalls {
						call = call || c.ID == "historical-read" && c.Name == "read_file"
					}
					result = result || m.ToolResult != nil && m.ToolResult.CallID == "historical-read"
					approvalResult = approvalResult || m.ToolResult != nil && m.ToolResult.CallID == "historical-approval" && strings.Contains(m.ToolResult.Text, "not executed")
				}
				if mode == "approval" && !approvalResult {
					t.Fatal("unpaired historical approval")
				}
				if !call || !result {
					t.Fatal("released exchange lost")
				}
				for _, tool := range req.Tools {
					if tool.Name == "ask_user" || tool.Name == "terminal.exec" {
						t.Fatal("old tool advertised")
					}
				}
			}
		})
	}
}
