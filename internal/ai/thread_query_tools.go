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

// Thread tools browse one authorized conversation at a time. The product tool
// contract deliberately does not expose the engine's general query language.
type threadBrowseInput struct {
	Object   threadquery.Object `json:"object,omitempty"`
	ThreadID identity.ThreadID  `json:"thread_id,omitempty"`
	Title    string             `json:"title,omitempty"`
	Limit    int                `json:"limit,omitempty"`
	Cursor   string             `json:"cursor,omitempty"`
}

func builtInThreadQueryToolDefinitions() []ToolDef {
	str := map[string]any{"type": "string"}
	add := func(name, description string, properties map[string]any, required []string) ToolDef {
		properties["description"] = map[string]any{"type": "string", "minLength": 1, "maxLength": 160, "description": "User-facing intent in the user's language; omit IDs and private excerpts."}
		schema := map[string]any{"type": "object", "properties": properties, "additionalProperties": false, "required": required}
		return ToolDef{Name: name, Description: description, InputSchema: toolSchemaRaw(schema), Visibility: ToolVisibilitySharedReadonly, Capabilities: []ToolCapabilityClass{ToolCapabilityReadonlyLocal}, Source: "builtin", Namespace: "builtin.threads", Priority: 100}
	}
	return []ToolDef{
		add("threads.query", "Find a readable conversation, then browse its content. Omit object or use threads to list conversations, most recently updated first; title optionally matches a literal part of the title. For messages or tool_calls, supply one thread_id: records are listed chronologically. Default limit 50. Follow next_cursor with unchanged input. Pass a returned ref to threads.read for complete content. Excludes reasoning and secrets.", map[string]any{
			"object":    map[string]any{"type": "string", "enum": []string{"threads", "messages", "tool_calls"}, "default": "threads"},
			"thread_id": map[string]any{"type": "string", "minLength": 1, "description": "One conversation to browse. Required for messages or tool_calls."},
			"title":     map[string]any{"type": "string", "description": "Optional literal, case-insensitive title fragment; only for threads."},
			"limit":     map[string]any{"type": "integer", "minimum": 1, "maximum": 200}, "cursor": str,
		}, []string{}),
		add("threads.read", "Read complete content from a threads.query ref in bounded UTF-8 chunks. Follow next_cursor with unchanged ref until complete; query again if the ref expires or access changes.", map[string]any{"ref": str, "cursor": str}, []string{"ref"}),
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
		var browse threadBrowseInput
		if err := decode(&browse); err != nil {
			return nil, err
		}
		if browse.Object == "" {
			browse.Object = threadquery.Threads
		}
		input := threadquery.QueryInput{Object: browse.Object, Limit: browse.Limit, Cursor: browse.Cursor}
		if browse.ThreadID != "" {
			input.Filter.ThreadIDs = []identity.ThreadID{browse.ThreadID}
		}
		switch browse.Object {
		case threadquery.Threads:
			input.Filter.Title = threadquery.TextMatch{Contains: browse.Title}
			input.Sort = threadquery.Sort{Key: "updated", Descending: true}
		case threadquery.Messages, threadquery.ToolCalls:
			if strings.TrimSpace(browse.ThreadID.String()) == "" || browse.Title != "" {
				return nil, threadQueryArgumentsError{cause: threadquery.ErrInvalidQuery, message: "messages and tool_calls require one thread_id; title is only supported when listing threads"}
			}
			input.Sort.Key = "time"
			if browse.Object == threadquery.Messages {
				input.Sort.Key = "order"
			}
		default:
			return nil, threadQueryArgumentsError{cause: threadquery.ErrInvalidQuery, message: "object must be threads, messages, or tool_calls"}
		}
		page, err := reader.Query(ctx, scope, input)
		return page, threadQueryToolError(err)
	case "threads.read":
		var input threadquery.ReadInput
		if err := decode(&input); err != nil {
			return nil, err
		}
		page, err := reader.Read(ctx, scope, input)
		return page, threadQueryToolError(err)

	default:
		return nil, errors.New("unknown thread query tool")
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

func threadQueryToolError(err error) error {
	if errors.Is(err, threadquery.ErrThreadQueryIndexNotReady) {
		return threadQueryIndexNotReadyFailure{cause: err}
	}
	if errors.Is(err, threadquery.ErrInvalidQuery) {
		return threadQueryArgumentsError{cause: err}
	}
	return err
}

type threadQueryIndexNotReadyFailure struct{ cause error }

func (failure threadQueryIndexNotReadyFailure) Error() string {
	return "conversation search index is not ready"
}

func (failure threadQueryIndexNotReadyFailure) Unwrap() error { return failure.cause }

func (threadQueryIndexNotReadyFailure) ThreadQueryIndexNotReady() bool { return true }

func isThreadQueryTool(name string) bool {
	switch name {
	case "threads.query", "threads.read":
		return true
	}
	return false
}
