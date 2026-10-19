package ai

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"

	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/floret/v7/threadquery"
	aitools "github.com/floegence/redeven/internal/ai/tools"
)

func TestThreadQuerySortSchemas(t *testing.T) {
	t.Parallel()
	for _, def := range builtInThreadQueryToolDefinitions() {
		if def.Name == "threads.read" {
			continue
		}
		t.Run(def.Name, func(t *testing.T) {
			var schema map[string]any
			if err := json.Unmarshal(def.InputSchema, &schema); err != nil {
				t.Fatal(err)
			}
			validator, err := compileArgumentSchema(schema)
			if err != nil {
				t.Fatal(err)
			}
			keys := []string{"", "created", "updated", "title", "thread_id", "time", "order", "completed", "tool_name", "elapsed"}
			invalid := []string{"created_at", "updated_at", "completed_at", "key", "count"}
			if def.Name == "threads.aggregate" {
				keys = []string{"", "key", "count"}
				invalid = []string{"created_at", "time", "created", "order"}
			}
			for _, key := range keys {
				input := map[string]any{"object": "messages", "sort": map[string]any{"key": key}}
				if err := validator.Validate(input); err != nil {
					t.Errorf("supported sort key %q rejected: %v", key, err)
				}
			}
			for _, key := range invalid {
				input := map[string]any{"object": "messages", "sort": map[string]any{"key": key}}
				if err := validator.Validate(input); err == nil {
					t.Errorf("unsupported sort key %q accepted", key)
				}
			}
			if err := validator.Validate(map[string]any{"object": "messages"}); err != nil {
				t.Fatalf("omitted sort rejected: %v", err)
			}
			props := schema["properties"].(map[string]any)
			sortProps := props["sort"].(map[string]any)["properties"].(map[string]any)
			description, _ := sortProps["key"].(map[string]any)["description"].(string)
			if def.Name == "threads.query" {
				for _, rule := range []string{"threads", "messages", "tool_calls", "time", "order", "created_at"} {
					if !strings.Contains(description, rule) {
						t.Errorf("sort.key description omits %q: %q", rule, description)
					}
				}
			} else if !strings.Contains(description, "count") || !strings.Contains(description, "key") {
				t.Errorf("aggregate sort.key description is incomplete: %q", description)
			}
		})
	}
}

func TestThreadQueryToolSortValidation(t *testing.T) {
	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	for _, tc := range []struct {
		tool, object, invalid string
		allowed               []string
	}{
		{"threads.query", "messages", "created_at", []string{"time", "order"}},
		{"threads.query", "threads", "time", []string{"created", "updated", "title", "thread_id"}},
		{"threads.query", "tool_calls", "title", []string{"time", "completed", "tool_name", "elapsed"}},
		{"threads.aggregate", "messages", "time", []string{"key", "count"}},
		{"threads.aggregate", "threads", "created_at", []string{"key", "count"}},
	} {
		t.Run(tc.tool+"/"+tc.object, func(t *testing.T) {
			args := map[string]any{"object": tc.object, "sort": map[string]any{"key": tc.invalid, "descending": true}}
			_, err := svc.execThreadQueryTool(t.Context(), meta, tc.tool, args)
			if !errors.Is(err, threadquery.ErrInvalidQuery) {
				t.Fatalf("invalid sort classification lost: %v", err)
			}
			toolErr := aitools.ClassifyError(aitools.Invocation{ToolName: tc.tool, Args: args}, err)
			if toolErr.Code != aitools.ErrorCodeInvalidArguments || toolErr.Retryable {
				t.Fatalf("invalid sort tool error: %+v", toolErr)
			}
			for _, value := range append([]string{tc.invalid, tc.object}, tc.allowed...) {
				if !strings.Contains(toolErr.Message, value) {
					t.Errorf("error omits %q: %q", value, toolErr.Message)
				}
			}
			details, _ := toolErr.Meta["validation_details"].(map[string]any)
			if details["field"] != "sort.key" || details["value"] != tc.invalid || details["object"] != tc.object || !reflect.DeepEqual(details["allowed_values"], tc.allowed) {
				t.Errorf("sort validation details: %v", details)
			}
			if args["sort"].(map[string]any)["key"] != tc.invalid {
				t.Fatal("invalid sort silently rewritten")
			}
			for _, key := range append([]string{""}, tc.allowed...) {
				args["sort"] = map[string]any{"key": key, "descending": true}
				if _, err := svc.execThreadQueryTool(t.Context(), meta, tc.tool, args); err != nil {
					t.Errorf("supported sort key %q rejected: %v", key, err)
				}
			}
		})
	}
}

func TestThreadQueryToolInvalidInputClassification(t *testing.T) {
	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	for _, tc := range []struct {
		name, tool string
		args       map[string]any
		canonical  bool
	}{
		{"unknown_object", "threads.query", map[string]any{"object": "unknown"}, true},
		{"invalid_filter", "threads.query", map[string]any{"object": "messages", "filter": map[string]any{"roles": []string{"tool"}}}, true},
		{"invalid_limit", "threads.query", map[string]any{"object": "messages", "limit": 201}, true},
		{"unknown_field", "threads.query", map[string]any{"object": "messages", "unknown": true}, false},
		{"wrong_sort_type", "threads.aggregate", map[string]any{"object": "messages", "sort": map[string]any{"key": 42}}, false},
		{"wrong_ref_type", "threads.read", map[string]any{"ref": 42}, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := svc.execThreadQueryTool(t.Context(), meta, tc.tool, tc.args)
			if err == nil {
				t.Fatal("invalid input accepted")
			}
			if tc.canonical && !errors.Is(err, threadquery.ErrInvalidQuery) {
				t.Fatalf("canonical error classification lost: %v", err)
			}
			toolErr := aitools.ClassifyError(aitools.Invocation{ToolName: tc.tool, Args: tc.args}, err)
			if toolErr.Code != aitools.ErrorCodeInvalidArguments || toolErr.Retryable || toolErr.Meta["validation_details"] != nil {
				t.Fatalf("invalid input misclassified: %+v", toolErr)
			}
		})
	}
}

type threadQueryFailureRuntime struct {
	flruntime.ThreadService
	failure error
}

func (r threadQueryFailureRuntime) Query(context.Context, threadquery.Scope, threadquery.QueryInput) (threadquery.Page, error) {
	return threadquery.Page{}, r.failure
}

func (r threadQueryFailureRuntime) Read(context.Context, threadquery.Scope, threadquery.ReadInput) (threadquery.ReadPage, error) {
	return threadquery.ReadPage{}, r.failure
}

func (r threadQueryFailureRuntime) Aggregate(context.Context, threadquery.Scope, threadquery.AggregateInput) (threadquery.AggregatePage, error) {
	return threadquery.AggregatePage{}, r.failure
}

func TestThreadQueryToolPreservesRuntimeFailures(t *testing.T) {
	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	base := svc.threadRuntime
	defer func() { svc.threadRuntime = base }()
	for _, failure := range []error{threadquery.ErrCursorInvalid, threadquery.ErrSnapshotLimit, threadquery.ErrRecordUnavailable, context.Canceled, context.DeadlineExceeded, errors.New("storage unavailable")} {
		for _, tool := range []string{"threads.query", "threads.read", "threads.aggregate"} {
			svc.threadRuntime = threadQueryFailureRuntime{ThreadService: base, failure: failure}
			args := map[string]any{"object": "messages"}
			if tool == "threads.read" {
				args = map[string]any{"ref": "opaque"}
			}
			_, err := svc.execThreadQueryTool(t.Context(), meta, tool, args)
			if err != failure {
				t.Errorf("%s changed runtime failure: %v, want %v", tool, err, failure)
			}
			if toolErr := aitools.ClassifyError(aitools.Invocation{ToolName: tool, Args: args}, err); toolErr.Code == aitools.ErrorCodeInvalidArguments {
				t.Errorf("%s runtime failure classified as invalid input: %+v", tool, toolErr)
			}
		}
	}
}
