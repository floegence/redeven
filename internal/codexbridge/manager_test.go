package codexbridge

import (
	"context"
	"encoding/json"
	"testing"
)

type scriptedRPCStep struct {
	method  string
	respond func(t *testing.T, proc *appServerProcess, env rpcEnvelope)
}

type scriptedRPCTransport struct {
	t     *testing.T
	proc  *appServerProcess
	steps []scriptedRPCStep
}

func (s *scriptedRPCTransport) Write(p []byte) (int, error) {
	s.t.Helper()
	var env rpcEnvelope
	if err := json.Unmarshal(bytesTrimSpace(p), &env); err != nil {
		s.t.Fatalf("json.Unmarshal request: %v", err)
	}
	if len(s.steps) == 0 {
		s.t.Fatalf("unexpected RPC call: method=%q", env.Method)
	}
	step := s.steps[0]
	s.steps = s.steps[1:]
	if env.Method != step.method {
		s.t.Fatalf("rpc method=%q, want %q", env.Method, step.method)
	}
	step.respond(s.t, s.proc, env)
	return len(p), nil
}

func (*scriptedRPCTransport) Close() error {
	return nil
}

func newScriptedProcess(t *testing.T, steps []scriptedRPCStep) (*appServerProcess, *scriptedRPCTransport) {
	t.Helper()
	transport := &scriptedRPCTransport{t: t, steps: steps}
	proc := &appServerProcess{
		pending: make(map[string]chan rpcEnvelope),
		done:    make(chan error, 1),
	}
	transport.proc = proc
	proc.stdin = transport
	return proc, transport
}

func mustMarshalParams(t *testing.T, value any) json.RawMessage {
	t.Helper()
	out, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("json.Marshal: %v", err)
	}
	return out
}

func TestHandleEnvelope_ProjectsLiveThreadState(t *testing.T) {
	t.Parallel()

	manager, err := NewManager(Options{AgentHomeDir: "/workspace"})
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}

	manager.handleEnvelope(rpcEnvelope{
		Method: "thread/started",
		Params: mustMarshalParams(t, wireThreadStartedNotification{
			Thread: wireThread{
				ID:            "thread_1",
				Preview:       "Initial preview",
				ModelProvider: "openai/gpt-5.4",
				CreatedAt:     1,
				UpdatedAt:     2,
				Status:        wireThreadStatus{Type: "active"},
				CWD:           "/workspace/ui",
			},
		}),
	})
	manager.handleEnvelope(rpcEnvelope{
		Method: "item/started",
		Params: mustMarshalParams(t, wireItemNotification{
			ThreadID: "thread_1",
			TurnID:   "turn_1",
			Item: wireThreadItem{
				ID:   "item_reasoning",
				Type: "reasoning",
			},
		}),
	})
	manager.handleEnvelope(rpcEnvelope{
		Method: "item/reasoningSummary/textDelta",
		Params: mustMarshalParams(t, wireReasoningSummaryTextDeltaNotification{
			ThreadID:     "thread_1",
			TurnID:       "turn_1",
			ItemID:       "item_reasoning",
			Delta:        "inspect gateway flow",
			SummaryIndex: 0,
		}),
	})
	manager.handleEnvelope(rpcEnvelope{
		Method: "item/reasoning/textDelta",
		Params: mustMarshalParams(t, wireReasoningTextDeltaNotification{
			ThreadID:     "thread_1",
			TurnID:       "turn_1",
			ItemID:       "item_reasoning",
			Delta:        "Streaming the replay-safe projection.",
			ContentIndex: 0,
		}),
	})
	manager.handleEnvelope(rpcEnvelope{
		Method: "rawResponseItem/completed",
		Params: mustMarshalParams(t, wireRawResponseItemCompletedNotification{
			ThreadID: "thread_1",
			TurnID:   "turn_1",
			Item: wireResponseItem{
				Type:   "web_search_call",
				Status: stringPtr("completed"),
				Action: &wireWebSearchAction{
					Type:  "search",
					Query: stringPtr("site:nmc.cn changsha weather"),
					Queries: []string{
						"site:nmc.cn changsha weather",
						"site:weather.com changsha weather",
					},
				},
			},
		}),
	})
	manager.handleEnvelope(rpcEnvelope{
		Method: "thread/name/updated",
		Params: mustMarshalParams(t, wireThreadNameUpdatedNotification{
			ThreadID:   "thread_1",
			ThreadName: stringPtr("Renamed thread"),
		}),
	})
	contextWindow := int64(128000)
	manager.handleEnvelope(rpcEnvelope{
		Method: "thread/tokenUsage/updated",
		Params: mustMarshalParams(t, wireThreadTokenUsageUpdatedNotification{
			ThreadID: "thread_1",
			TurnID:   "turn_1",
			TokenUsage: wireThreadTokenUsage{
				Total: wireTokenUsageBreakdown{
					TotalTokens:           6400,
					InputTokens:           4200,
					CachedInputTokens:     600,
					OutputTokens:          1100,
					ReasoningOutputTokens: 300,
				},
				Last: wireTokenUsageBreakdown{
					TotalTokens:           1200,
					InputTokens:           800,
					CachedInputTokens:     200,
					OutputTokens:          150,
					ReasoningOutputTokens: 50,
				},
				ModelContextWindow: &contextWindow,
			},
		}),
	})
	manager.handleEnvelope(rpcEnvelope{
		Method: "thread/closed",
		Params: mustMarshalParams(t, wireThreadClosedNotification{
			ThreadID: "thread_1",
		}),
	})

	manager.mu.Lock()
	state := manager.threads["thread_1"]
	if state == nil || state.thread == nil {
		manager.mu.Unlock()
		t.Fatalf("expected projected thread state")
	}
	detail := manager.buildThreadDetailLocked(state, *state.thread)
	manager.mu.Unlock()

	if detail.Thread.Name != "Renamed thread" {
		t.Fatalf("Thread.Name=%q", detail.Thread.Name)
	}
	if detail.Thread.Status != "notLoaded" {
		t.Fatalf("Thread.Status=%q", detail.Thread.Status)
	}
	if detail.TokenUsage == nil || detail.TokenUsage.Total.TotalTokens != 6400 {
		t.Fatalf("unexpected token usage: %+v", detail.TokenUsage)
	}
	if detail.LastAppliedSeq != 8 {
		t.Fatalf("LastAppliedSeq=%d", detail.LastAppliedSeq)
	}
	if len(detail.Thread.Turns) != 1 || len(detail.Thread.Turns[0].Items) != 2 {
		t.Fatalf("unexpected projected turns: %+v", detail.Thread.Turns)
	}
	item := detail.Thread.Turns[0].Items[0]
	if len(item.Summary) != 1 || item.Summary[0] != "inspect gateway flow" {
		t.Fatalf("unexpected item summary: %+v", item.Summary)
	}
	if item.Text != "Streaming the replay-safe projection." {
		t.Fatalf("unexpected item text: %q", item.Text)
	}
	webSearch := detail.Thread.Turns[0].Items[1]
	if webSearch.Type != "webSearch" {
		t.Fatalf("unexpected web search item type: %q", webSearch.Type)
	}
	if webSearch.Query != "site:nmc.cn changsha weather" {
		t.Fatalf("unexpected web search query: %q", webSearch.Query)
	}
	if webSearch.Action == nil || webSearch.Action.Type != "search" {
		t.Fatalf("unexpected web search action: %+v", webSearch.Action)
	}
}

func TestStartTurn_RetriesWhenLiveThreadNeedsResume(t *testing.T) {
	t.Parallel()

	manager, err := NewManager(Options{AgentHomeDir: "/workspace"})
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}

	manager.mu.Lock()
	state := manager.ensureThreadStateLocked("thread_1")
	state.thread = &Thread{
		ID:            "thread_1",
		Preview:       "Retry thread",
		ModelProvider: "openai/gpt-5.4",
		Status:        "active",
		CWD:           "/workspace/ui",
	}
	state.liveLoaded = true
	manager.mu.Unlock()

	proc, transport := newScriptedProcess(t, []scriptedRPCStep{
		{
			method: "turn/start",
			respond: func(t *testing.T, proc *appServerProcess, env rpcEnvelope) {
				proc.dispatchEnvelope(rpcEnvelope{
					ID: env.ID,
					Error: &rpcError{
						Code:    -32000,
						Message: "thread not found: thread_1",
					},
				})
			},
		},
		{
			method: "thread/resume",
			respond: func(t *testing.T, proc *appServerProcess, env rpcEnvelope) {
				proc.dispatchEnvelope(rpcEnvelope{
					ID: env.ID,
					Result: mustJSONRaw(wireThreadResumeResponse{
						Thread: wireThread{
							ID:            "thread_1",
							Preview:       "Retry thread",
							ModelProvider: "openai/gpt-5.4",
							CWD:           "/workspace/ui",
							Status:        wireThreadStatus{Type: "active"},
						},
						Model:          "gpt-5.4",
						ModelProvider:  "openai",
						CWD:            "/workspace/ui",
						ApprovalPolicy: json.RawMessage(`"on-request"`),
						Sandbox:        wireSandboxPolicy{Type: "workspaceWrite"},
					}),
				})
			},
		},
		{
			method: "turn/start",
			respond: func(t *testing.T, proc *appServerProcess, env rpcEnvelope) {
				proc.dispatchEnvelope(rpcEnvelope{
					ID: env.ID,
					Result: mustJSONRaw(wireTurnStartResponse{
						Turn: wireTurn{
							ID:     "turn_1",
							Status: "in_progress",
						},
					}),
				})
			},
		},
	})
	manager.mu.Lock()
	manager.proc = proc
	manager.mu.Unlock()

	turn, err := manager.StartTurn(context.Background(), StartTurnRequest{
		ThreadID:  "thread_1",
		InputText: "hi",
		CWD:       "/workspace/ui",
		Model:     "gpt-5.4",
	})
	if err != nil {
		t.Fatalf("StartTurn: %v", err)
	}
	if turn.ID != "turn_1" {
		t.Fatalf("Turn.ID=%q", turn.ID)
	}
	if len(transport.steps) != 0 {
		t.Fatalf("unexpected remaining rpc steps: %d", len(transport.steps))
	}

	manager.mu.Lock()
	defer manager.mu.Unlock()
	if manager.proc == nil {
		t.Fatalf("expected process to remain available after retryable RPC method error")
	}
	if manager.lastError != "" {
		t.Fatalf("lastError=%q", manager.lastError)
	}
	if manager.threads["thread_1"] == nil || !manager.threads["thread_1"].liveLoaded {
		t.Fatalf("expected thread_1 liveLoaded after resume retry")
	}
}

func TestReadThread_FallsBackWhenThreadIsNotYetMaterialized(t *testing.T) {
	t.Parallel()

	manager, err := NewManager(Options{AgentHomeDir: "/workspace"})
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}

	manager.mu.Lock()
	state := manager.ensureThreadStateLocked("thread_1")
	state.thread = &Thread{
		ID:            "thread_1",
		Preview:       "First prompt pending",
		ModelProvider: "openai/gpt-5.4",
		Status:        "active",
		CWD:           "/workspace/ui",
	}
	state.liveLoaded = true
	manager.mu.Unlock()

	proc, transport := newScriptedProcess(t, []scriptedRPCStep{
		{
			method: "thread/read",
			respond: func(t *testing.T, proc *appServerProcess, env rpcEnvelope) {
				proc.dispatchEnvelope(rpcEnvelope{
					ID: env.ID,
					Error: &rpcError{
						Code: -32000,
						Message: "thread thread_1 is not materialized yet; " +
							"includeTurns is unavailable before first user message",
					},
				})
			},
		},
		{
			method: "thread/read",
			respond: func(t *testing.T, proc *appServerProcess, env rpcEnvelope) {
				var params wireThreadReadParams
				if err := json.Unmarshal(env.Params, &params); err != nil {
					t.Fatalf("json.Unmarshal params: %v", err)
				}
				if params.IncludeTurns {
					t.Fatalf("expected fallback read without turns")
				}
				proc.dispatchEnvelope(rpcEnvelope{
					ID: env.ID,
					Result: mustJSONRaw(wireThreadReadResponse{
						Thread: wireThread{
							ID:            "thread_1",
							ModelProvider: "openai/gpt-5.4",
							CWD:           "/workspace/ui",
							Status:        wireThreadStatus{Type: "idle"},
						},
					}),
				})
			},
		},
	})
	manager.mu.Lock()
	manager.proc = proc
	manager.mu.Unlock()

	detail, err := manager.ReadThread(context.Background(), "thread_1")
	if err != nil {
		t.Fatalf("ReadThread: %v", err)
	}
	if len(transport.steps) != 0 {
		t.Fatalf("unexpected remaining rpc steps: %d", len(transport.steps))
	}
	if detail.Thread.ID != "thread_1" {
		t.Fatalf("Thread.ID=%q", detail.Thread.ID)
	}
	if detail.Thread.Status != "active" {
		t.Fatalf("Thread.Status=%q, want active", detail.Thread.Status)
	}
	if detail.Thread.Preview != "First prompt pending" {
		t.Fatalf("Thread.Preview=%q", detail.Thread.Preview)
	}

	manager.mu.Lock()
	defer manager.mu.Unlock()
	if state := manager.threads["thread_1"]; state == nil || !state.liveLoaded {
		t.Fatalf("expected thread_1 to remain live loaded after summary fallback")
	}
}

func TestReadThread_FallbackPreservesProjectedTurns(t *testing.T) {
	t.Parallel()

	manager, err := NewManager(Options{AgentHomeDir: "/workspace"})
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}

	manager.mu.Lock()
	state := manager.ensureThreadStateLocked("thread_1")
	state.thread = &Thread{
		ID:            "thread_1",
		Preview:       "First prompt pending",
		ModelProvider: "openai/gpt-5.4",
		Status:        "active",
		CWD:           "/workspace/ui",
		Turns: []Turn{
			{
				ID:     "turn_1",
				Status: "in_progress",
				Items: []Item{
					{
						ID:   "item_1",
						Type: "userMessage",
						Text: "Draft turn from projected state",
					},
				},
			},
		},
	}
	state.liveLoaded = true
	manager.mu.Unlock()

	proc, transport := newScriptedProcess(t, []scriptedRPCStep{
		{
			method: "thread/read",
			respond: func(t *testing.T, proc *appServerProcess, env rpcEnvelope) {
				proc.dispatchEnvelope(rpcEnvelope{
					ID: env.ID,
					Error: &rpcError{
						Code: -32000,
						Message: "thread thread_1 is not materialized yet; " +
							"includeTurns is unavailable before first user message",
					},
				})
			},
		},
		{
			method: "thread/read",
			respond: func(t *testing.T, proc *appServerProcess, env rpcEnvelope) {
				proc.dispatchEnvelope(rpcEnvelope{
					ID: env.ID,
					Result: mustJSONRaw(wireThreadReadResponse{
						Thread: wireThread{
							ID:            "thread_1",
							ModelProvider: "openai/gpt-5.4",
							CWD:           "/workspace/ui",
							Status:        wireThreadStatus{Type: "idle"},
						},
					}),
				})
			},
		},
	})
	manager.mu.Lock()
	manager.proc = proc
	manager.mu.Unlock()

	detail, err := manager.ReadThread(context.Background(), "thread_1")
	if err != nil {
		t.Fatalf("ReadThread: %v", err)
	}
	if len(transport.steps) != 0 {
		t.Fatalf("unexpected remaining rpc steps: %d", len(transport.steps))
	}
	if len(detail.Thread.Turns) != 1 {
		t.Fatalf("Thread.Turns=%+v, want projected turn", detail.Thread.Turns)
	}
	if len(detail.Thread.Turns[0].Items) != 1 {
		t.Fatalf("Turn.Items=%+v", detail.Thread.Turns[0].Items)
	}
	if detail.Thread.Turns[0].Items[0].Text != "Draft turn from projected state" {
		t.Fatalf("Item.Text=%q", detail.Thread.Turns[0].Items[0].Text)
	}
}
