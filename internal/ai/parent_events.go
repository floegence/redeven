package ai

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/floegence/floret/v7/identity"
	flruntime "github.com/floegence/floret/v7/runtime"
	fltools "github.com/floegence/floret/v7/tools"
	"github.com/floegence/redeven/internal/session"
)

func builtInParentEventToolDefinitions() []ToolDef {
	return []ToolDef{
		{Name: "report_to_parent", Description: "Report an important discovery, blocker or request for help to your canonical direct parent. message must be nonempty UTF-8 text at most 8192 bytes. Returns a stable event reference; does not pause, complete or wake a task. Do not report routine progress.", InputSchema: toolSchemaRaw(map[string]any{"type": "object", "properties": map[string]any{"message": map[string]any{"type": "string", "minLength": 1, "maxLength": 8192}}, "required": []string{"message"}, "additionalProperties": false}), Visibility: ToolVisibilitySharedReadonly, Capabilities: []ToolCapabilityClass{ToolCapabilityInteraction}, Source: "builtin", Namespace: "builtin.subagent", Priority: 100},
		{Name: "subagent_events", Description: "List received child event references or read complete report text. read requires event_id or a fixed first_event_id/last_event_id range. Continue explicit pagination with next_after_event_id; keep the same range. Never claim all delegated work reviewed while unread overflow remains. Use sufficient untruncated reports directly; read a report event only when its body is needed. Completion events contain no final report: use subagents inspect if that child turn result is not already available from inspect/wait. Reading completion events remains available for audit, not report retrieval. Failure details remain in inspect/wait and the source thread.", InputSchema: toolSchemaRaw(map[string]any{"type": "object", "properties": map[string]any{"action": map[string]any{"type": "string", "enum": []string{"list", "read"}}, "event_id": map[string]any{"type": "string"}, "first_event_id": map[string]any{"type": "string"}, "last_event_id": map[string]any{"type": "string"}, "after_event_id": map[string]any{"type": "string"}, "limit": map[string]any{"type": "integer", "minimum": 1, "maximum": 100}}, "required": []string{"action"}, "additionalProperties": false}), Visibility: ToolVisibilitySharedReadonly, Capabilities: []ToolCapabilityClass{ToolCapabilityReadonlyLocal}, Source: "builtin", Namespace: "builtin.subagent", Priority: 100},
	}
}

func (r *run) parentEventService() (flruntime.ThreadParentEventService, error) {
	if r == nil {
		return nil, errors.New("parent event runtime unavailable")
	}
	service, ok := r.threadRuntime.(flruntime.ThreadParentEventService)
	if !ok {
		return nil, errors.New("parent event runtime unavailable")
	}
	return service, nil
}

// Inv carries the exact one-shot authorization already consumed by buildFloretTools.
// Neither the model nor a product setting supplies sender or recipient identities.
func (r *run) reportToParent(ctx context.Context, inv fltools.Invocation[map[string]any]) (fltools.Result, error) {
	if r.subagentDepth == 0 {
		return fltools.Result{}, errors.New("report_to_parent is available only to child tasks")
	}
	message, ok := inv.Args["message"].(string)
	if !ok || !utf8.ValidString(message) || strings.TrimSpace(message) == "" || len(message) > 8192 {
		return fltools.Result{}, errors.New("message requires nonempty UTF-8 text of at most 8192 bytes")
	}
	service, err := r.parentEventService()
	if err != nil {
		return fltools.Result{}, err
	}
	receipt, err := service.ReportToParent(ctx, flruntime.ReportToParentInput{ThreadID: inv.ThreadID, TurnID: inv.TurnID, RunID: inv.RunID, ToolCallID: inv.CallID, ToolName: inv.Name, ArgumentHash: floretEffectArgumentHash(inv.RawArgs), RequestKey: flruntime.RequestKey("report:" + inv.CallID), Message: message})
	if err != nil {
		return fltools.Result{}, err
	}
	return floretToolResultFromFlower(r, ToolResult{ToolID: inv.CallID, ToolName: inv.Name, Status: toolResultStatusSuccess, Summary: "parent.report.accepted", Data: receipt})
}

func (r *run) readSubagentEvents(ctx context.Context, args map[string]any) (any, error) {
	service, err := r.parentEventService()
	if err != nil {
		return nil, err
	}
	page, err := readParentEventPage(ctx, service, identity.ThreadID(r.threadID), args)
	if err != nil {
		return nil, err
	}
	return page, nil
}

func readParentEventPage(ctx context.Context, service flruntime.ThreadParentEventService, threadID identity.ThreadID, args map[string]any) (flruntime.ParentEventPage, error) {
	limit := parseIntArg(args, "limit", 50)
	if limit < 1 || limit > 100 {
		return flruntime.ParentEventPage{}, errors.New("limit must be between 1 and 100")
	}
	field := func(key string) string { return strings.TrimSpace(anyToString(args[key])) }
	switch field("action") {
	case "list":
		if field("event_id") != "" || field("first_event_id") != "" || field("last_event_id") != "" {
			return flruntime.ParentEventPage{}, errors.New("list accepts only after_event_id and limit")
		}
		return service.ListParentEvents(ctx, flruntime.ListParentEventsInput{ThreadID: threadID, AfterEventID: field("after_event_id"), Limit: limit})
	case "read":
		return service.ReadParentEvents(ctx, flruntime.ReadParentEventsInput{ThreadID: threadID, EventID: field("event_id"), FirstEventID: field("first_event_id"), LastEventID: field("last_event_id"), AfterEventID: field("after_event_id"), Limit: limit})
	default:
		return flruntime.ParentEventPage{}, fmt.Errorf("unsupported subagent_events action %q", field("action"))
	}
}

// GetFlowerParentEvents authorizes the current recipient before any canonical read.
// Event references and thread references never grant access by themselves.
func (s *Service) GetFlowerParentEvents(ctx context.Context, meta *session.Meta, threadID string, query ParentEventReadRequest) (flruntime.ParentEventPage, error) {
	if err := requireRead(meta); err != nil {
		return flruntime.ParentEventPage{}, err
	}
	if err := s.requireEndpointThreadAuthority(ctx, meta.EndpointID, threadID); err != nil {
		return flruntime.ParentEventPage{}, err
	}
	service, ok := s.threadRuntime.(flruntime.ThreadParentEventService)
	if !ok {
		return flruntime.ParentEventPage{}, errors.New("parent event runtime unavailable")
	}
	args := map[string]any{"action": query.Action, "event_id": query.EventID, "first_event_id": query.FirstEventID, "last_event_id": query.LastEventID, "after_event_id": query.AfterEventID}
	if query.Limit != 0 {
		args["limit"] = query.Limit
	}
	return readParentEventPage(ctx, service, identity.ThreadID(threadID), args)
}

type ParentEventReadRequest struct {
	Action       string `json:"action"`
	EventID      string `json:"event_id,omitempty"`
	FirstEventID string `json:"first_event_id,omitempty"`
	LastEventID  string `json:"last_event_id,omitempty"`
	AfterEventID string `json:"after_event_id,omitempty"`
	Limit        int    `json:"limit,omitempty"`
}
