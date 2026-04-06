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

func TestReadThread_PreservesCompletedProjectedItemLifecycleWithoutExplicitUpstreamStatus(t *testing.T) {
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
				Preview:       "Switch back to this thread",
				ModelProvider: "openai/gpt-5.4",
				CreatedAt:     1,
				UpdatedAt:     2,
				Status:        wireThreadStatus{Type: "active"},
				CWD:           "/workspace/ui",
			},
		}),
	})
	manager.handleEnvelope(rpcEnvelope{
		Method: "item/agentMessage/delta",
		Params: mustMarshalParams(t, wireDeltaNotification{
			ThreadID: "thread_1",
			TurnID:   "turn_1",
			ItemID:   "item_agent",
			Delta:    "Historical answer",
		}),
	})
	manager.handleEnvelope(rpcEnvelope{
		Method: "item/completed",
		Params: mustMarshalParams(t, wireItemNotification{
			ThreadID: "thread_1",
			TurnID:   "turn_1",
			Item: wireThreadItem{
				ID:   "item_agent",
				Type: "agentMessage",
				Text: "Historical answer",
			},
		}),
	})

	proc, transport := newScriptedProcess(t, []scriptedRPCStep{
		{
			method: "thread/read",
			respond: func(t *testing.T, proc *appServerProcess, env rpcEnvelope) {
				var params wireThreadReadParams
				if err := json.Unmarshal(env.Params, &params); err != nil {
					t.Fatalf("json.Unmarshal params: %v", err)
				}
				if !params.IncludeTurns {
					t.Fatalf("expected read with turns enabled")
				}
				proc.dispatchEnvelope(rpcEnvelope{
					ID: env.ID,
					Result: mustJSONRaw(wireThreadReadResponse{
						Thread: wireThread{
							ID:            "thread_1",
							Preview:       "Switch back to this thread",
							ModelProvider: "openai/gpt-5.4",
							CreatedAt:     1,
							UpdatedAt:     3,
							Status:        wireThreadStatus{Type: "active"},
							CWD:           "/workspace/ui",
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
	if len(detail.Thread.Turns) != 1 || len(detail.Thread.Turns[0].Items) != 1 {
		t.Fatalf("unexpected projected turns: %+v", detail.Thread.Turns)
	}
	if got := detail.Thread.Turns[0].Items[0].Status; got != "completed" {
		t.Fatalf("Item.Status=%q, want completed", got)
	}
	if got := detail.Thread.Turns[0].Items[0].Text; got != "Historical answer" {
		t.Fatalf("Item.Text=%q, want Historical answer", got)
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

func TestListThreads_ForwardsArchivedFilter(t *testing.T) {
	t.Parallel()

	manager, err := NewManager(Options{AgentHomeDir: "/workspace"})
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}

	archived := true
	proc, transport := newScriptedProcess(t, []scriptedRPCStep{
		{
			method: "thread/list",
			respond: func(t *testing.T, proc *appServerProcess, env rpcEnvelope) {
				var params wireThreadListParams
				if err := json.Unmarshal(env.Params, &params); err != nil {
					t.Fatalf("json.Unmarshal params: %v", err)
				}
				if params.Limit != 10 {
					t.Fatalf("Limit=%d, want 10", params.Limit)
				}
				if params.Archived == nil || !*params.Archived {
					t.Fatalf("Archived=%v, want true", params.Archived)
				}
				if params.SortKey != "updated_at" {
					t.Fatalf("SortKey=%q", params.SortKey)
				}
				proc.dispatchEnvelope(rpcEnvelope{
					ID: env.ID,
					Result: mustJSONRaw(wireThreadListResponse{
						Data: []wireThread{
							{
								ID:            "thread_archived_1",
								Preview:       "Archived thread",
								ModelProvider: "openai/gpt-5.4",
								Status:        wireThreadStatus{Type: "archived"},
								CWD:           "/workspace",
							},
						},
					}),
				})
			},
		},
	})
	manager.mu.Lock()
	manager.proc = proc
	manager.mu.Unlock()

	threads, err := manager.ListThreads(context.Background(), ListThreadsRequest{
		Limit:    10,
		Archived: &archived,
	})
	if err != nil {
		t.Fatalf("ListThreads: %v", err)
	}
	if len(transport.steps) != 0 {
		t.Fatalf("unexpected remaining rpc steps: %d", len(transport.steps))
	}
	if len(threads) != 1 || threads[0].ID != "thread_archived_1" || threads[0].Status != "archived" {
		t.Fatalf("unexpected threads: %+v", threads)
	}
}

func TestReadCapabilities_DefaultOperationsMatchActiveOnlyBrowserSurface(t *testing.T) {
	t.Parallel()

	manager, err := NewManager(Options{AgentHomeDir: "/workspace"})
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}

	proc, transport := newScriptedProcess(t, []scriptedRPCStep{
		{
			method: "model/list",
			respond: func(t *testing.T, proc *appServerProcess, env rpcEnvelope) {
				var params wireModelListParams
				if err := json.Unmarshal(env.Params, &params); err != nil {
					t.Fatalf("json.Unmarshal params: %v", err)
				}
				if params.IncludeHidden == nil || *params.IncludeHidden {
					t.Fatalf("IncludeHidden=%v, want false", params.IncludeHidden)
				}
				proc.dispatchEnvelope(rpcEnvelope{
					ID:     env.ID,
					Result: mustJSONRaw(wireModelListResponse{}),
				})
			},
		},
		{
			method: "config/read",
			respond: func(t *testing.T, proc *appServerProcess, env rpcEnvelope) {
				var params wireConfigReadParams
				if err := json.Unmarshal(env.Params, &params); err != nil {
					t.Fatalf("json.Unmarshal params: %v", err)
				}
				if params.CWD == nil || *params.CWD != "/workspace" {
					t.Fatalf("CWD=%v, want /workspace", params.CWD)
				}
				proc.dispatchEnvelope(rpcEnvelope{
					ID: env.ID,
					Result: mustJSONRaw(wireConfigReadResponse{
						Config: wireConfig{
							Model:             stringPtr("gpt-5.4"),
							ModelProvider:     stringPtr("openai"),
							ApprovalPolicy:    json.RawMessage(`"on-request"`),
							ApprovalsReviewer: stringPtr("user"),
							SandboxMode:       stringPtr("workspace-write"),
						},
					}),
				})
			},
		},
		{
			method: "configRequirements/read",
			respond: func(t *testing.T, proc *appServerProcess, env rpcEnvelope) {
				proc.dispatchEnvelope(rpcEnvelope{
					ID: env.ID,
					Result: mustJSONRaw(wireConfigRequirementsReadResponse{
						Requirements: &wireConfigRequirements{
							AllowedApprovalPolicies: []json.RawMessage{json.RawMessage(`"on-request"`)},
							AllowedSandboxModes:     []string{"workspace-write"},
						},
					}),
				})
			},
		},
	})
	manager.mu.Lock()
	manager.proc = proc
	manager.mu.Unlock()

	capabilities, err := manager.ReadCapabilities(context.Background(), "")
	if err != nil {
		t.Fatalf("ReadCapabilities: %v", err)
	}
	if len(transport.steps) != 0 {
		t.Fatalf("unexpected remaining rpc steps: %d", len(transport.steps))
	}
	want := []OperationName{
		OperationThreadArchive,
		OperationThreadFork,
		OperationTurnSteer,
		OperationTurnInterrupt,
		OperationReviewStart,
	}
	if len(capabilities.Operations) != len(want) {
		t.Fatalf("Operations=%v, want=%v", capabilities.Operations, want)
	}
	for index, operation := range want {
		if capabilities.Operations[index] != operation {
			t.Fatalf("Operations[%d]=%q, want=%q", index, capabilities.Operations[index], operation)
		}
	}
}

func TestSteerTurn_ProjectsSteerableRegularTurn(t *testing.T) {
	t.Parallel()

	manager, err := NewManager(Options{AgentHomeDir: "/workspace"})
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}

	manager.mu.Lock()
	state := manager.ensureThreadStateLocked("thread_1")
	state.thread = &Thread{
		ID:            "thread_1",
		Preview:       "Steer thread",
		ModelProvider: "openai/gpt-5.4",
		Status:        "active",
		CWD:           "/workspace/ui",
	}
	state.liveLoaded = true
	manager.mu.Unlock()

	proc, transport := newScriptedProcess(t, []scriptedRPCStep{
		{
			method: "turn/steer",
			respond: func(t *testing.T, proc *appServerProcess, env rpcEnvelope) {
				var params wireTurnSteerParams
				if err := json.Unmarshal(env.Params, &params); err != nil {
					t.Fatalf("json.Unmarshal params: %v", err)
				}
				if params.ThreadID != "thread_1" || params.ExpectedTurnID != "turn_1" {
					t.Fatalf("unexpected steer params: %+v", params)
				}
				if len(params.Input) != 1 || params.Input[0].Type != "text" || params.Input[0].Text != "continue current turn" {
					t.Fatalf("unexpected steer inputs: %+v", params.Input)
				}
				proc.dispatchEnvelope(rpcEnvelope{
					ID: env.ID,
					Result: mustJSONRaw(wireTurnSteerResponse{
						TurnID: "turn_1",
					}),
				})
			},
		},
	})
	manager.mu.Lock()
	manager.proc = proc
	manager.mu.Unlock()

	turn, err := manager.SteerTurn(context.Background(), SteerTurnRequest{
		ThreadID:       "thread_1",
		ExpectedTurnID: "turn_1",
		Inputs: []UserInputEntry{
			{
				Type: "text",
				Text: "continue current turn",
			},
		},
	})
	if err != nil {
		t.Fatalf("SteerTurn: %v", err)
	}
	if turn.ID != "turn_1" {
		t.Fatalf("Turn.ID=%q", turn.ID)
	}
	if turn.Kind != "regular" {
		t.Fatalf("Turn.Kind=%q", turn.Kind)
	}
	if turn.AcceptsSteer == nil || !*turn.AcceptsSteer {
		t.Fatalf("Turn.AcceptsSteer=%v", turn.AcceptsSteer)
	}
	if len(transport.steps) != 0 {
		t.Fatalf("unexpected remaining rpc steps: %d", len(transport.steps))
	}

	manager.mu.Lock()
	defer manager.mu.Unlock()
	projected := manager.threads["thread_1"].thread
	if projected == nil || len(projected.Turns) != 1 {
		t.Fatalf("unexpected projected thread: %+v", projected)
	}
	if projected.Turns[0].ID != "turn_1" || projected.Turns[0].Kind != "regular" {
		t.Fatalf("unexpected projected turn: %+v", projected.Turns[0])
	}
	if projected.Turns[0].AcceptsSteer == nil || !*projected.Turns[0].AcceptsSteer {
		t.Fatalf("projected turn steerability=%v", projected.Turns[0].AcceptsSteer)
	}
}

func TestSteerTurn_WrapsCodexErrorCode(t *testing.T) {
	t.Parallel()

	manager, err := NewManager(Options{AgentHomeDir: "/workspace"})
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}

	manager.mu.Lock()
	state := manager.ensureThreadStateLocked("thread_1")
	state.thread = &Thread{
		ID:            "thread_1",
		Preview:       "Steer thread",
		ModelProvider: "openai/gpt-5.4",
		Status:        "active",
		CWD:           "/workspace/ui",
	}
	state.liveLoaded = true
	manager.mu.Unlock()

	proc, transport := newScriptedProcess(t, []scriptedRPCStep{
		{
			method: "turn/steer",
			respond: func(t *testing.T, proc *appServerProcess, env rpcEnvelope) {
				proc.dispatchEnvelope(rpcEnvelope{
					ID: env.ID,
					Error: &rpcError{
						Code:    -32000,
						Message: "Active turn rejected steer",
						Data: mustJSONRaw(wireTurnError{
							Message:        "Active turn rejected steer",
							CodexErrorInfo: json.RawMessage(`{"activeTurnNotSteerable":{}}`),
						}),
					},
				})
			},
		},
	})
	manager.mu.Lock()
	manager.proc = proc
	manager.mu.Unlock()

	_, err = manager.SteerTurn(context.Background(), SteerTurnRequest{
		ThreadID:       "thread_1",
		ExpectedTurnID: "turn_1",
		Inputs: []UserInputEntry{
			{
				Type: "text",
				Text: "continue current turn",
			},
		},
	})
	if err == nil {
		t.Fatalf("expected steer error")
	}
	if got := CodexErrorCode(err); got != "activeTurnNotSteerable" {
		t.Fatalf("CodexErrorCode(err)=%q", got)
	}
	if len(transport.steps) != 0 {
		t.Fatalf("unexpected remaining rpc steps: %d", len(transport.steps))
	}
}

func TestForkThread_UsesNormalizedOverrides(t *testing.T) {
	t.Parallel()

	manager, err := NewManager(Options{AgentHomeDir: "/workspace"})
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}

	proc, transport := newScriptedProcess(t, []scriptedRPCStep{
		{
			method: "thread/fork",
			respond: func(t *testing.T, proc *appServerProcess, env rpcEnvelope) {
				var params wireThreadForkParams
				if err := json.Unmarshal(env.Params, &params); err != nil {
					t.Fatalf("json.Unmarshal params: %v", err)
				}
				if params.ThreadID != "thread_1" {
					t.Fatalf("ThreadID=%q, want thread_1", params.ThreadID)
				}
				if stringValue(params.Model) != "gpt-5.4" {
					t.Fatalf("Model=%q", stringValue(params.Model))
				}
				if stringValue(params.ApprovalPolicy) != "on-request" {
					t.Fatalf("ApprovalPolicy=%q", stringValue(params.ApprovalPolicy))
				}
				if stringValue(params.Sandbox) != "workspace-write" {
					t.Fatalf("Sandbox=%q", stringValue(params.Sandbox))
				}
				if stringValue(params.ApprovalsReviewer) != "user" {
					t.Fatalf("ApprovalsReviewer=%q", stringValue(params.ApprovalsReviewer))
				}
				if !params.PersistExtendedHistory {
					t.Fatalf("PersistExtendedHistory=false, want true")
				}
				proc.dispatchEnvelope(rpcEnvelope{
					ID: env.ID,
					Result: mustJSONRaw(wireThreadForkResponse{
						Thread: wireThread{
							ID:            "thread_forked_1",
							Preview:       "Forked thread",
							ModelProvider: "openai/gpt-5.4",
							Status:        wireThreadStatus{Type: "active"},
							CWD:           "/workspace",
						},
						Model:             "gpt-5.4",
						ModelProvider:     "openai",
						CWD:               "/workspace",
						ApprovalPolicy:    json.RawMessage(`"on-request"`),
						ApprovalsReviewer: "user",
						Sandbox:           wireSandboxPolicy{Type: "workspaceWrite"},
					}),
				})
			},
		},
	})
	manager.mu.Lock()
	manager.proc = proc
	manager.mu.Unlock()

	detail, err := manager.ForkThread(context.Background(), ForkThreadRequest{
		ThreadID:          "thread_1",
		Model:             "gpt-5.4",
		ApprovalPolicy:    "on-request",
		SandboxMode:       "workspace-write",
		ApprovalsReviewer: "user",
	})
	if err != nil {
		t.Fatalf("ForkThread: %v", err)
	}
	if len(transport.steps) != 0 {
		t.Fatalf("unexpected remaining rpc steps: %d", len(transport.steps))
	}
	if detail.Thread.ID != "thread_forked_1" {
		t.Fatalf("Thread.ID=%q", detail.Thread.ID)
	}
	if detail.RuntimeConfig.Model != "gpt-5.4" || detail.RuntimeConfig.ApprovalPolicy != "on-request" || detail.RuntimeConfig.SandboxMode != "workspace-write" {
		t.Fatalf("unexpected runtime config: %+v", detail.RuntimeConfig)
	}
}

func TestUnarchiveThread_ProjectsNotLoadedState(t *testing.T) {
	t.Parallel()

	manager, err := NewManager(Options{AgentHomeDir: "/workspace"})
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	manager.mu.Lock()
	state := manager.ensureThreadStateLocked("thread_1")
	state.thread = &Thread{
		ID:            "thread_1",
		Preview:       "Archived thread",
		ModelProvider: "openai/gpt-5.4",
		Status:        "archived",
		CWD:           "/workspace",
	}
	state.liveLoaded = false
	manager.mu.Unlock()

	proc, transport := newScriptedProcess(t, []scriptedRPCStep{
		{
			method: "thread/unarchive",
			respond: func(t *testing.T, proc *appServerProcess, env rpcEnvelope) {
				proc.dispatchEnvelope(rpcEnvelope{
					ID: env.ID,
					Result: mustJSONRaw(wireThreadUnarchiveResponse{
						Thread: wireThread{
							ID:            "thread_1",
							Preview:       "Archived thread",
							ModelProvider: "openai/gpt-5.4",
							Status:        wireThreadStatus{Type: "active"},
							CWD:           "/workspace",
						},
					}),
				})
			},
		},
	})
	manager.mu.Lock()
	manager.proc = proc
	manager.mu.Unlock()

	if err := manager.UnarchiveThread(context.Background(), "thread_1"); err != nil {
		t.Fatalf("UnarchiveThread: %v", err)
	}
	if len(transport.steps) != 0 {
		t.Fatalf("unexpected remaining rpc steps: %d", len(transport.steps))
	}
	manager.mu.Lock()
	defer manager.mu.Unlock()
	state = manager.threads["thread_1"]
	if state == nil || state.thread == nil {
		t.Fatalf("expected thread state")
	}
	if state.thread.Status != "notLoaded" {
		t.Fatalf("thread.Status=%q, want notLoaded", state.thread.Status)
	}
	if state.liveLoaded {
		t.Fatalf("liveLoaded=true, want false")
	}
}

func TestInterruptTurn_ForwardsThreadAndTurnIDs(t *testing.T) {
	t.Parallel()

	manager, err := NewManager(Options{AgentHomeDir: "/workspace"})
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}

	proc, transport := newScriptedProcess(t, []scriptedRPCStep{
		{
			method: "turn/interrupt",
			respond: func(t *testing.T, proc *appServerProcess, env rpcEnvelope) {
				var params wireTurnInterruptParams
				if err := json.Unmarshal(env.Params, &params); err != nil {
					t.Fatalf("json.Unmarshal params: %v", err)
				}
				if params.ThreadID != "thread_1" || params.TurnID != "turn_7" {
					t.Fatalf("unexpected params: %+v", params)
				}
				proc.dispatchEnvelope(rpcEnvelope{ID: env.ID, Result: mustJSONRaw(map[string]any{})})
			},
		},
	})
	manager.mu.Lock()
	manager.proc = proc
	manager.mu.Unlock()

	if err := manager.InterruptTurn(context.Background(), InterruptTurnRequest{
		ThreadID: "thread_1",
		TurnID:   "turn_7",
	}); err != nil {
		t.Fatalf("InterruptTurn: %v", err)
	}
	if len(transport.steps) != 0 {
		t.Fatalf("unexpected remaining rpc steps: %d", len(transport.steps))
	}
}

func TestStartReview_ProjectsInlineTurn(t *testing.T) {
	t.Parallel()

	manager, err := NewManager(Options{AgentHomeDir: "/workspace"})
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	manager.mu.Lock()
	state := manager.ensureThreadStateLocked("thread_1")
	state.thread = &Thread{
		ID:            "thread_1",
		Preview:       "Review current changes",
		ModelProvider: "openai/gpt-5.4",
		Status:        "active",
		CWD:           "/workspace",
	}
	state.liveLoaded = true
	manager.mu.Unlock()

	proc, transport := newScriptedProcess(t, []scriptedRPCStep{
		{
			method: "review/start",
			respond: func(t *testing.T, proc *appServerProcess, env rpcEnvelope) {
				var params wireReviewStartParams
				if err := json.Unmarshal(env.Params, &params); err != nil {
					t.Fatalf("json.Unmarshal params: %v", err)
				}
				if params.ThreadID != "thread_1" || params.Target.Type != "uncommittedChanges" {
					t.Fatalf("unexpected review params: %+v", params)
				}
				proc.dispatchEnvelope(rpcEnvelope{
					ID: env.ID,
					Result: mustJSONRaw(wireReviewStartResponse{
						Turn: wireTurn{
							ID:     "turn_review_1",
							Status: "in_progress",
						},
						ReviewThreadID: "thread_1",
					}),
				})
			},
		},
	})
	manager.mu.Lock()
	manager.proc = proc
	manager.mu.Unlock()

	detail, err := manager.StartReview(context.Background(), StartReviewRequest{
		ThreadID: "thread_1",
		Target:   "uncommitted_changes",
	})
	if err != nil {
		t.Fatalf("StartReview: %v", err)
	}
	if len(transport.steps) != 0 {
		t.Fatalf("unexpected remaining rpc steps: %d", len(transport.steps))
	}
	if len(detail.Thread.Turns) != 1 || detail.Thread.Turns[0].ID != "turn_review_1" {
		t.Fatalf("unexpected review turns: %+v", detail.Thread.Turns)
	}
}
