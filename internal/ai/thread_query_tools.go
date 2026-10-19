package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
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
	queryKeys := []string{""}
	for _, kind := range []threadquery.Object{threadquery.Threads, threadquery.Messages, threadquery.ToolCalls} {
		for _, key := range threadQuerySortKeys("threads.query", kind) {
			if !slices.Contains(queryKeys, key) {
				queryKeys = append(queryKeys, key)
			}
		}
	}
	common := func(keys []string, description string) map[string]any {
		ordering := object(map[string]any{
			"key":        map[string]any{"type": "string", "enum": keys, "description": description},
			"descending": map[string]any{"type": "boolean", "description": "True for newest/largest first; false or omitted for ascending order."},
		})
		return map[string]any{"object": map[string]any{"type": "string", "enum": []string{"threads", "messages", "tool_calls"}}, "filter": filter, "sort": ordering, "limit": map[string]any{"type": "integer", "minimum": 1, "maximum": 200}, "cursor": str}
	}
	add := func(name, description string, properties map[string]any, required []string) ToolDef {
		schema := object(properties)
		schema["required"] = required
		return ToolDef{Name: name, Description: description, InputSchema: toolSchemaRaw(schema), Visibility: ToolVisibilitySharedReadonly, Capabilities: []ToolCapabilityClass{ToolCapabilityReadonlyLocal}, Source: "builtin", Namespace: "builtin.threads", Priority: 100}
	}
	query := common(queryKeys, "Allowed by object: threads = created, updated, title, thread_id; messages = time, order; tool_calls = time, completed, tool_name, elapsed. Omit or use an empty string for the default key: threads created, messages time, tool_calls time. Queries default to descending order (newest first); set descending to false for ascending order. Response fields such as created_at are not sort keys.")
	query["sort"].(map[string]any)["properties"].(map[string]any)["descending"] = map[string]any{"type": "boolean", "default": true, "description": "True or omitted for descending order (newest/largest first); false for ascending order."}
	aggregate := common(append([]string{""}, threadQuerySortKeys("threads.aggregate", "")...), "Allowed for every object: key or count. Omit or use an empty string for key (group key); count sorts by group size. Query record sort keys do not apply to aggregation.")
	aggregate["group_by"] = map[string]any{"type": "string", "enum": []string{"", "thread", "role", "tool_name", "status", "day", "week", "month"}}
	return []ToolDef{
		add("threads.query", "Search canonical active paths of all readable conversations in the current Runtime, including children. Reference IDs grant no access. Filters combine with AND; enum arrays use OR. Literal Unicode substring, keywords and contiguous phrase matching ignore case by default. Excludes reasoning and secrets. Default sort is newest first: threads created descending; messages/tool_calls time descending. Sort keys: threads created/updated/title/thread_id; messages time/order; tool_calls time/completed/tool_name/elapsed. Default 50, maximum 200. Follow next_cursor with unchanged input; invalid/expired cursors require a new query. Use returned ref with threads.read for full content.", query, []string{"object"}),
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
		if err := d.Decode(out); err != nil {
			return threadQueryArgumentsError{cause: err}
		}
		return nil
	}
	switch name {
	case "threads.query":
		input := threadquery.QueryInput{Sort: threadquery.Sort{Descending: true}}
		if err := decode(&input); err != nil {
			return nil, err
		}
		page, err := reader.Query(ctx, scope, input)
		return page, threadQueryToolError(name, input.Object, input.Sort, err)
	case "threads.read":
		var input threadquery.ReadInput
		if err := decode(&input); err != nil {
			return nil, err
		}
		page, err := reader.Read(ctx, scope, input)
		return page, threadQueryToolError(name, "", threadquery.Sort{}, err)
	case "threads.aggregate":
		var input threadquery.AggregateInput
		if err := decode(&input); err != nil {
			return nil, err
		}
		page, err := reader.Aggregate(ctx, scope, input)
		return page, threadQueryToolError(name, input.Object, input.Sort, err)
	default:
		return nil, errors.New("unknown thread query tool")
	}
}

// These tool-schema values mirror the released threadquery contract. Floret
// remains the validation owner; the adapter only explains its invalid inputs.
func threadQuerySortKeys(toolName string, object threadquery.Object) []string {
	if toolName == "threads.aggregate" {
		return []string{"key", "count"}
	}
	switch object {
	case threadquery.Threads:
		return []string{"created", "updated", "title", "thread_id"}
	case threadquery.Messages:
		return []string{"time", "order"}
	case threadquery.ToolCalls:
		return []string{"time", "completed", "tool_name", "elapsed"}
	default:
		return nil
	}
}

type threadQueryArgumentsError struct {
	cause   error
	message string
	details map[string]any
}

func (e threadQueryArgumentsError) Error() string {
	if e.message != "" {
		return e.message
	}
	return e.cause.Error()
}

func (e threadQueryArgumentsError) Unwrap() error { return e.cause }

func (e threadQueryArgumentsError) InvalidArgumentsCode() string {
	return "invalid_arguments.threads"
}

func (e threadQueryArgumentsError) InvalidArgumentsMeta() map[string]any {
	return cloneAnyMap(e.details)
}

func threadQueryToolError(toolName string, object threadquery.Object, ordering threadquery.Sort, err error) error {
	if !errors.Is(err, threadquery.ErrInvalidQuery) {
		return err
	}
	out := threadQueryArgumentsError{cause: err}
	allowed := threadQuerySortKeys(toolName, object)
	if ordering.Key != "" && len(allowed) > 0 && !slices.Contains(allowed, ordering.Key) {
		out.message = fmt.Sprintf("%s; sort.key %q is unsupported for object %q; allowed values: %s. Omit sort.key or use an empty string for the default %q.", err, ordering.Key, object, strings.Join(allowed, ", "), allowed[0])
		out.details = map[string]any{"field": "sort.key", "value": ordering.Key, "object": string(object), "allowed_values": allowed}
	}
	return out
}

func isThreadQueryTool(name string) bool {
	switch name {
	case "threads.query", "threads.read", "threads.aggregate":
		return true
	}
	return false
}
