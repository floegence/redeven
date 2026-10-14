package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"strings"

	"github.com/floegence/floret/v7/identity"
	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/floret/v7/threadquery"
	"github.com/floegence/redeven/internal/session"
)

func builtInThreadQueryToolDefinitions() []ToolDef {
	str := map[string]any{"type": "string"}
	array := map[string]any{"type": "array", "items": str}
	object := func(properties map[string]any) map[string]any {
		return map[string]any{"type": "object", "properties": properties, "additionalProperties": false}
	}
	text := object(map[string]any{"contains": str, "keywords": array, "any_keyword": map[string]any{"type": "boolean"}, "phrase": str, "case_sensitive": map[string]any{"type": "boolean"}})
	instant := map[string]any{"type": "string", "format": "date-time", "description": "UTC RFC3339 instant; from inclusive, to exclusive"}
	timeRange := object(map[string]any{"from": instant, "to": instant})
	fields := map[string]any{}
	for _, key := range []string{"thread_ids", "parent_thread_ids", "turn_ids", "run_ids", "roles", "tool_names", "tool_kinds", "statuses", "activities", "outcomes"} {
		fields[key] = array
	}
	for _, key := range []string{"text", "title", "arguments", "result"} {
		fields[key] = text
	}
	for _, key := range []string{"time", "created", "updated", "completed"} {
		fields[key] = timeRange
	}
	filter := object(fields)
	sort := object(map[string]any{"key": str, "descending": map[string]any{"type": "boolean"}})
	common := func() map[string]any {
		return map[string]any{"object": map[string]any{"type": "string", "enum": []string{"threads", "messages", "tool_calls"}}, "filter": filter, "sort": sort, "limit": map[string]any{"type": "integer", "minimum": 1, "maximum": 200}, "cursor": str}
	}
	add := func(name, description string, properties map[string]any, required []string) ToolDef {
		schema := object(properties)
		schema["required"] = required
		return ToolDef{Name: name, Description: description, InputSchema: toolSchemaRaw(schema), Visibility: ToolVisibilitySharedReadonly, Capabilities: []ToolCapabilityClass{ToolCapabilityReadonlyLocal}, Source: "builtin", Namespace: "builtin.threads", Priority: 100}
	}
	aggregate := common()
	aggregate["group_by"] = map[string]any{"type": "string", "enum": []string{"", "thread", "role", "tool_name", "status", "day", "week", "month"}}
	return []ToolDef{
		add("threads.query", "Search canonical active paths of all readable conversations in the current Runtime, including children. Reference IDs grant no access. Filters combine with AND; enum arrays use OR. Literal Unicode substring, keywords and contiguous phrase matching ignore case by default. Excludes reasoning and secrets. Sort: threads created/updated/title/thread_id; messages time/order; tool_calls time/completed/tool_name/elapsed. Default 50, maximum 200. Follow next_cursor with unchanged input; invalid/expired cursors require a new query. Use returned ref with threads.read for full content.", common(), []string{"object"}),
		add("threads.read", "Read the exact authorized ref returned by threads.query. Full visible content includes confirmed tool arguments/results only here. UTF-8 chunks have field-local byte offsets, at most 16 KiB each and 64 KiB per response; follow next_cursor without changing ref. No silent truncation. Expiry or access changes require a new query.", map[string]any{"ref": str, "cursor": str}, []string{"ref"}),
		add("threads.aggregate", "Count canonical records with the same filters as threads.query. Omit group_by for exact count; otherwise group by thread, role, tool_name, status or UTC day/week/month (Monday weeks). Sort key is key or count, with stable key ties. Authorization applies before counting. Follow next_cursor with unchanged input.", aggregate, []string{"object"}),
	}
}

func (s *Service) threadQueryScope(ctx context.Context, meta *session.Meta) (threadquery.Scope, error) {
	if err := requireRead(meta); err != nil {
		return threadquery.Scope{}, err
	}
	if strings.TrimSpace(meta.UserPublicID) == "" || strings.TrimSpace(meta.EndpointID) == "" || strings.TrimSpace(meta.NamespacePublicID) == "" {
		return threadquery.Scope{}, errReadPermissionDenied
	}
	s.mu.Lock()
	db := s.threadsDB
	s.mu.Unlock()
	if db == nil {
		return threadquery.Scope{}, errors.New("threads store not ready")
	}
	ids, err := db.ReadableThreadIDs(ctx, meta.EndpointID, meta.NamespacePublicID)
	if err != nil {
		return threadquery.Scope{}, err
	}
	authority, err := json.Marshal([]string{meta.UserPublicID, meta.EndpointID, meta.NamespacePublicID})
	if err != nil {
		return threadquery.Scope{}, err
	}
	scope := threadquery.Scope{Authority: string(authority)}
	for _, id := range ids {
		scope.ThreadIDs = append(scope.ThreadIDs, identity.ThreadID(id))
	}
	return scope, nil
}

func (s *Service) execThreadQueryTool(ctx context.Context, meta *session.Meta, name string, args map[string]any) (any, error) {
	scope, err := s.threadQueryScope(ctx, meta)
	if err != nil {
		return nil, err
	}
	reader, ok := s.threadRuntime.(flruntime.ThreadQueryReader)
	if !ok {
		return nil, errors.New("thread query is unavailable")
	}
	decode := func(out any) error {
		raw, err := json.Marshal(args)
		if err != nil {
			return err
		}
		d := json.NewDecoder(bytes.NewReader(raw))
		d.DisallowUnknownFields()
		return d.Decode(out)
	}
	switch name {
	case "threads.query":
		var input threadquery.QueryInput
		if err := decode(&input); err != nil {
			return nil, err
		}
		return reader.Query(ctx, scope, input)
	case "threads.read":
		var input threadquery.ReadInput
		if err := decode(&input); err != nil {
			return nil, err
		}
		return reader.Read(ctx, scope, input)
	case "threads.aggregate":
		var input threadquery.AggregateInput
		if err := decode(&input); err != nil {
			return nil, err
		}
		return reader.Aggregate(ctx, scope, input)
	default:
		return nil, errors.New("unknown thread query tool")
	}
}

func isThreadQueryTool(name string) bool {
	switch name {
	case "threads.query", "threads.read", "threads.aggregate":
		return true
	}
	return false
}
