package ai

import (
	"encoding/json"
	"strings"

	flprovider "github.com/floegence/floret/v7/provider"
	oresponses "github.com/openai/openai-go/responses"
)

// Map native output items into Floret events without taking ownership of tools
// or agent execution. Item IDs deduplicate streamed and terminal snapshots.
type responsesHostedEvents struct {
	onEvent func(StreamEvent)
	started map[string]bool
	ended   map[string]bool
}

func newResponsesHostedEvents(onEvent func(StreamEvent)) *responsesHostedEvents {
	return &responsesHostedEvents{onEvent: onEvent, started: map[string]bool{}, ended: map[string]bool{}}
}

func (h *responsesHostedEvents) item(item oresponses.ResponseOutputItemUnion) {
	if item.Type != "web_search_call" || strings.TrimSpace(item.ID) == "" || h.ended[item.ID] {
		return
	}
	action := item.Action
	args := map[string]string{"action": action.Type}
	for key, value := range map[string]string{"query": action.Query, "url": action.URL, "pattern": action.Pattern} {
		if value != "" {
			args[key] = value
		}
	}
	rawArgs, _ := json.Marshal(args)
	call := &flprovider.ToolCall{ID: item.ID, Name: "web_search", Args: string(rawArgs)}
	emit := func(event flprovider.Event) {
		emitProviderEvent(h.onEvent, StreamEvent{Type: StreamEventHostedTool, HostedToolEvent: &event})
	}
	if !h.started[item.ID] {
		h.started[item.ID] = true
		emit(flprovider.Event{Type: flprovider.EventHostedToolCall, HostedToolCall: call})
	}
	if item.Status != "completed" && item.Status != "failed" {
		return
	}
	h.ended[item.ID] = true
	result := &flprovider.HostedToolResult{Text: "Web search completed", Metadata: map[string]any{"status": item.Status}}
	if item.Status == "failed" {
		result.Text = "Web search failed"
		result.Error = &flprovider.HostedToolResultError{Code: "search_failed", Message: result.Text}
	}
	// The pinned SDK retains newer source fields in RawJSON. Project only public
	// source fields; never persist arbitrary provider output as tool metadata.
	var sourceItem struct {
		Action struct {
			Sources []struct {
				Title string `json:"title"`
				URL   string `json:"url"`
			} `json:"sources"`
		} `json:"action"`
	}
	if json.Unmarshal([]byte(item.RawJSON()), &sourceItem) == nil && sourceItem.Action.Sources != nil {
		result.ResultsProvided = true
		for _, source := range sourceItem.Action.Sources {
			result.Results = append(result.Results, flprovider.HostedToolResultItem{Title: source.Title, URL: source.URL})
		}
	}
	emit(flprovider.Event{Type: flprovider.EventHostedToolResult, HostedToolCall: call, HostedResult: result})
}
