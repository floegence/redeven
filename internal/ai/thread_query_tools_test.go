package ai

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"
	"time"

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
			invalid := []string{"recent_first", "created_at", "updated_at", "completed_at", "key", "count"}
			if def.Name == "threads.aggregate" {
				keys = []string{"", "key", "count"}
				invalid = []string{"created_at", "time", "created", "order", "recent_first"}
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
				if got := sortProps["descending"].(map[string]any)["default"]; got != true {
					t.Errorf("default descending=%v, want true", got)
				}
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
		{"threads.query", "messages", "recent_first", []string{"time", "order"}},
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

type threadQueryRecordingRuntime struct {
	flruntime.ThreadService
	query     threadquery.QueryInput
	aggregate threadquery.AggregateInput
}

func (r *threadQueryRecordingRuntime) Query(_ context.Context, _ threadquery.Scope, input threadquery.QueryInput) (threadquery.Page, error) {
	r.query = input
	return threadquery.Page{}, nil
}

func (r *threadQueryRecordingRuntime) Read(context.Context, threadquery.Scope, threadquery.ReadInput) (threadquery.ReadPage, error) {
	return threadquery.ReadPage{}, nil
}

func (r *threadQueryRecordingRuntime) Aggregate(_ context.Context, _ threadquery.Scope, input threadquery.AggregateInput) (threadquery.AggregatePage, error) {
	r.aggregate = input
	return threadquery.AggregatePage{}, nil
}

func TestThreadQueryDefaultsToDescending(t *testing.T) {
	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	runtime := &threadQueryRecordingRuntime{ThreadService: svc.threadRuntime}
	svc.threadRuntime = runtime
	for _, object := range []threadquery.Object{threadquery.Threads, threadquery.Messages, threadquery.ToolCalls} {
		key := "time"
		if object == threadquery.Threads {
			key = "created"
		}
		for _, tc := range []struct {
			name string
			sort map[string]any
			want threadquery.Sort
		}{
			{"omitted", nil, threadquery.Sort{Descending: true}},
			{"empty_sort", map[string]any{}, threadquery.Sort{Descending: true}},
			{"empty_key", map[string]any{"key": ""}, threadquery.Sort{Descending: true}},
			{"explicit_ascending", map[string]any{"descending": false}, threadquery.Sort{}},
			{"explicit_descending", map[string]any{"descending": true}, threadquery.Sort{Descending: true}},
			{"concrete_default", map[string]any{"key": key}, threadquery.Sort{Key: key, Descending: true}},
			{"concrete_ascending", map[string]any{"key": key, "descending": false}, threadquery.Sort{Key: key}},
			{"concrete_descending", map[string]any{"key": key, "descending": true}, threadquery.Sort{Key: key, Descending: true}},
		} {
			t.Run(string(object)+"/"+tc.name, func(t *testing.T) {
				args := map[string]any{"object": string(object), "cursor": "frozen-page", "limit": 7}
				if tc.sort != nil {
					args["sort"] = tc.sort
				}
				before, _ := json.Marshal(args)
				if _, err := svc.execThreadQueryTool(t.Context(), meta, "threads.query", args); err != nil {
					t.Fatal(err)
				}
				if runtime.query.Sort != tc.want || runtime.query.Cursor != "frozen-page" || runtime.query.Limit != 7 {
					t.Fatalf("query=%+v, want sort=%+v with original cursor/limit", runtime.query, tc.want)
				}
				after, _ := json.Marshal(args)
				if string(before) != string(after) {
					t.Fatal("query defaults mutated model arguments")
				}
			})
		}
	}
	for _, sort := range []map[string]any{nil, {"key": "count"}, {"key": "count", "descending": true}} {
		args := map[string]any{"object": "messages"}
		if sort != nil {
			args["sort"] = sort
		}
		if _, err := svc.execThreadQueryTool(t.Context(), meta, "threads.aggregate", args); err != nil {
			t.Fatal(err)
		}
		var expected threadquery.AggregateInput
		raw, _ := json.Marshal(args)
		if err := json.Unmarshal(raw, &expected); err != nil {
			t.Fatal(err)
		}
		if runtime.aggregate.Sort != expected.Sort {
			t.Fatalf("aggregate sort changed: %+v, want %+v", runtime.aggregate.Sort, expected.Sort)
		}
	}
}

func TestThreadQueryDefaultReturnsNewestFirstAcrossPages(t *testing.T) {
	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	var ids []string
	for _, title := range []string{"First", "Middle", "Latest"} {
		thread, err := svc.CreateThread(t.Context(), meta, title, "", "", "")
		if err != nil {
			t.Fatal(err)
		}
		ids = append(ids, thread.ThreadID)
		time.Sleep(time.Millisecond)
	}
	args := map[string]any{"object": "threads", "limit": 2}
	result, err := svc.execThreadQueryTool(t.Context(), meta, "threads.query", args)
	if err != nil {
		t.Fatal(err)
	}
	first := result.(threadquery.Page)
	if first.Total != 3 || len(first.Records) != 2 || first.Records[0].ThreadID.String() != ids[2] || first.Records[1].ThreadID.String() != ids[1] || first.NextCursor == "" {
		t.Fatalf("default first page is not newest first: %+v", first)
	}
	args["cursor"] = first.NextCursor
	result, err = svc.execThreadQueryTool(t.Context(), meta, "threads.query", args)
	if err != nil {
		t.Fatal(err)
	}
	last := result.(threadquery.Page)
	if len(last.Records) != 1 || last.Records[0].ThreadID.String() != ids[0] || last.NextCursor != "" {
		t.Fatalf("default continuation is not newest first: %+v", last)
	}
	delete(args, "cursor")
	args["sort"] = map[string]any{"descending": false}
	result, err = svc.execThreadQueryTool(t.Context(), meta, "threads.query", args)
	if err != nil {
		t.Fatal(err)
	}
	ascending := result.(threadquery.Page)
	if len(ascending.Records) != 2 || ascending.Records[0].ThreadID.String() != ids[0] || ascending.Records[1].ThreadID.String() != ids[1] {
		t.Fatalf("explicit ascending order ignored: %+v", ascending)
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
