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
			"descending": map[string]any{"type": "boolean", "description": "Default false (ascending)."},
		})
		return map[string]any{"object": map[string]any{"type": "string", "enum": []string{"threads", "messages", "tool_calls"}}, "filter": filter, "sort": ordering, "limit": map[string]any{"type": "integer", "minimum": 1, "maximum": 200}, "cursor": str}
	}
	add := func(name, description string, properties map[string]any, required []string) ToolDef {
		if name == "threads.query" || name == "threads.read" {
			properties["description"] = map[string]any{"type": "string", "minLength": 1, "maxLength": 160, "description": "User-facing intent in the user's language; omit IDs and private excerpts."}
		}
		schema := object(properties)
		schema["required"] = required
		return ToolDef{Name: name, Description: description, InputSchema: toolSchemaRaw(schema), Visibility: ToolVisibilitySharedReadonly, Capabilities: []ToolCapabilityClass{ToolCapabilityReadonlyLocal}, Source: "builtin", Namespace: "builtin.threads", Priority: 100}
	}
	query := common(queryKeys, "By object: threads created/updated/title/thread_id; messages time/order; tool_calls time/completed/tool_name/elapsed. Omit or empty for the first key listed.")
	query["sort"].(map[string]any)["properties"].(map[string]any)["descending"] = map[string]any{"type": "boolean", "default": true, "description": "Default true (descending)."}
	aggregate := common(append([]string{""}, threadQuerySortKeys("threads.aggregate", "")...), "Default key (group key); count sorts by group size.")
	aggregate["group_by"] = map[string]any{"type": "string", "enum": []string{"", "thread", "role", "tool_name", "status", "day", "week", "month"}}
	return []ToolDef{
		add("threads.query", "Search active paths of readable conversations, including children; excludes reasoning and secrets. Filters use AND; enum arrays use OR. Text matches literal Unicode substrings, keywords and contiguous phrases, case-insensitive by default. Default limit 50. Follow next_cursor with unchanged input; restart expired queries. Pass returned ref to threads.read.", query, []string{"object"}),
		add("threads.read", "Read full message or confirmed tool content from a query ref in UTF-8 chunks with field-local byte offsets (16 KiB/chunk, 64 KiB/response). Follow next_cursor with unchanged ref; requery on expiry or access changes.", map[string]any{"ref": str, "cursor": str}, []string{"ref"}),
		add("threads.aggregate", "Count records with threads.query filters. Omit group_by for exact count. Dates use UTC; weeks start Monday. Sort ties use group key. Follow next_cursor with unchanged input.", aggregate, []string{"object"}),
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
		queryArgs := args
		if name == "threads.query" || name == "threads.read" {
			queryArgs = cloneAnyMap(args)
			delete(queryArgs, "description")
		}
		raw, err := json.Marshal(queryArgs)
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
