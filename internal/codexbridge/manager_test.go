package codexbridge

import (
	"encoding/json"
	"testing"
)

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
