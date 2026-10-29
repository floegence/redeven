package ai

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/floegence/floret/v7/identity"
	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/floret/v7/threadquery"
	aitools "github.com/floegence/redeven/internal/ai/tools"
)

type threadQueryRecordingRuntime struct {
	flruntime.ThreadService
	query threadquery.QueryInput
	calls int
}

func (r *threadQueryRecordingRuntime) Query(_ context.Context, _ threadquery.Scope, input threadquery.QueryInput) (threadquery.Page, error) {
	r.query = input
	r.calls++
	return threadquery.Page{}, nil
}
func (r *threadQueryRecordingRuntime) Read(context.Context, threadquery.Scope, threadquery.ReadInput) (threadquery.ReadPage, error) {
	return threadquery.ReadPage{}, nil
}
func (r *threadQueryRecordingRuntime) Aggregate(context.Context, threadquery.Scope, threadquery.AggregateInput) (threadquery.AggregatePage, error) {
	panic("aggregation must never be dispatched")
}

func TestThreadBrowseSchemasExcludeAdvancedQueries(t *testing.T) {
	defs := builtInThreadQueryToolDefinitions()
	if len(defs) != 2 || defs[0].Name != "threads.query" || defs[1].Name != "threads.read" || isThreadQueryTool("threads.aggregate") {
		t.Fatalf("unexpected tools: %+v", defs)
	}
	var schema map[string]any
	if err := json.Unmarshal(defs[0].InputSchema, &schema); err != nil {
		t.Fatal(err)
	}
	validator, err := compileArgumentSchema(schema)
	if err != nil {
		t.Fatal(err)
	}
	for _, args := range []map[string]any{{}, {"title": "Release"}, {"object": "messages", "thread_id": "thread"}, {"object": "tool_calls", "thread_id": "thread", "limit": 5, "cursor": "page"}} {
		if err := validator.Validate(args); err != nil {
			t.Fatalf("browse rejected: %v %v", args, err)
		}
	}
	for _, key := range []string{"filter", "sort", "group_by", "text", "arguments", "result", "keywords", "phrase", "roles", "tool_names", "statuses", "time"} {
		if err := validator.Validate(map[string]any{key: map[string]any{}}); err == nil {
			t.Fatalf("advanced parameter accepted: %s", key)
		}
	}
}

func TestThreadBrowseMapsOnlyNecessaryInputs(t *testing.T) {
	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	runtime := &threadQueryRecordingRuntime{ThreadService: svc.threadRuntime}
	svc.threadRuntime = runtime
	for _, tc := range []struct {
		args map[string]any
		want threadquery.QueryInput
	}{
		{map[string]any{}, threadquery.QueryInput{Object: threadquery.Threads, Sort: threadquery.Sort{Key: "updated", Descending: true}}},
		{map[string]any{"title": "发布", "limit": 7, "cursor": "page"}, threadquery.QueryInput{Object: threadquery.Threads, Filter: threadquery.Filter{Title: threadquery.TextMatch{Contains: "发布"}}, Sort: threadquery.Sort{Key: "updated", Descending: true}, Limit: 7, Cursor: "page"}},
		{map[string]any{"object": "messages", "thread_id": "thread"}, threadquery.QueryInput{Object: threadquery.Messages, Filter: threadquery.Filter{ThreadIDs: []identity.ThreadID{"thread"}}, Sort: threadquery.Sort{Key: "order"}}},
		{map[string]any{"object": "tool_calls", "thread_id": "thread"}, threadquery.QueryInput{Object: threadquery.ToolCalls, Filter: threadquery.Filter{ThreadIDs: []identity.ThreadID{"thread"}}, Sort: threadquery.Sort{Key: "time"}}},
	} {
		before, _ := json.Marshal(tc.args)
		if _, err := svc.execThreadQueryTool(t.Context(), meta, "threads.query", tc.args); err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(runtime.query, tc.want) {
			t.Fatalf("query=%+v want=%+v", runtime.query, tc.want)
		}
		after, _ := json.Marshal(tc.args)
		if string(before) != string(after) {
			t.Fatal("mutated tool arguments")
		}
	}
}

func TestThreadBrowseRejectsAdvancedAndUnscopedInputs(t *testing.T) {
	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	for _, args := range []map[string]any{
		{"object": "messages"}, {"object": "tool_calls"}, {"object": "messages", "thread_id": "thread", "title": "needle"},
		{"filter": map[string]any{"text": map[string]any{"contains": "needle"}}}, {"sort": map[string]any{"key": "time"}},
		{"object": "unknown"}, {"limit": 201}, {"authority": "forged"},
	} {
		_, err := svc.execThreadQueryTool(t.Context(), meta, "threads.query", args)
		if err == nil {
			t.Fatalf("accepted invalid browse: %v", args)
		}
		classified := aitools.ClassifyError(err)
		if classified.Code != aitools.ErrorCodeInvalidArguments || classified.Retryable {
			t.Fatalf("invalid classification: %+v", classified)
		}
	}
	runtime := &threadQueryRecordingRuntime{ThreadService: svc.threadRuntime}
	svc.threadRuntime = runtime
	if _, err := svc.execThreadQueryTool(t.Context(), meta, "threads.aggregate", map[string]any{}); err == nil {
		t.Fatal("removed aggregation accepted")
	}
	if runtime.calls != 0 {
		t.Fatal("removed aggregation reached runtime")
	}
}

func TestThreadBrowseListsRecentThreadsAndPages(t *testing.T) {
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
	args := map[string]any{"limit": 2}
	result, err := svc.execThreadQueryTool(t.Context(), meta, "threads.query", args)
	if err != nil {
		t.Fatal(err)
	}
	first := result.(threadquery.Page)
	if first.Total != 3 || len(first.Records) != 2 || first.Records[0].ThreadID.String() != ids[2] || first.NextCursor == "" {
		t.Fatalf("first page=%+v", first)
	}
	args["cursor"] = first.NextCursor
	result, err = svc.execThreadQueryTool(t.Context(), meta, "threads.query", args)
	if err != nil {
		t.Fatal(err)
	}
	last := result.(threadquery.Page)
	if len(last.Records) != 1 || last.Records[0].ThreadID.String() != ids[0] || last.NextCursor != "" {
		t.Fatalf("last page=%+v", last)
	}
	result, err = svc.execThreadQueryTool(t.Context(), meta, "threads.query", map[string]any{"title": "IDDLE"})
	if err != nil {
		t.Fatal(err)
	}
	matched := result.(threadquery.Page)
	if matched.Total != 1 || matched.Records[0].ThreadID.String() != ids[1] {
		t.Fatalf("title lookup=%+v", matched)
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
		for _, tool := range []string{"threads.query", "threads.read"} {
			svc.threadRuntime = threadQueryFailureRuntime{ThreadService: base, failure: failure}
			args := map[string]any{"object": "messages", "thread_id": "thread"}
			if tool == "threads.read" {
				args = map[string]any{"ref": "opaque"}
			}
			_, err := svc.execThreadQueryTool(t.Context(), meta, tool, args)
			if err != failure {
				t.Errorf("%s changed runtime failure: %v, want %v", tool, err, failure)
			}
			if toolErr := aitools.ClassifyError(err); toolErr.Code == aitools.ErrorCodeInvalidArguments {
				t.Errorf("%s runtime failure classified as invalid input: %+v", tool, toolErr)
			}
		}
	}
}

func TestThreadQueryIndexNotReadyIsRetryableAndNeverLooksPartial(t *testing.T) {
	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	base := svc.threadRuntime
	defer func() { svc.threadRuntime = base }()
	for _, tool := range []string{"threads.query", "threads.read"} {
		svc.threadRuntime = threadQueryFailureRuntime{ThreadService: base, failure: threadquery.ErrThreadQueryIndexNotReady}
		args := map[string]any{"object": "messages", "thread_id": "thread"}
		if tool == "threads.read" {
			args = map[string]any{"ref": "opaque"}
		}
		_, err := svc.execThreadQueryTool(t.Context(), meta, tool, args)
		if !errors.Is(err, threadquery.ErrThreadQueryIndexNotReady) {
			t.Fatalf("%s lost index readiness classification: %v", tool, err)
		}
		classified := aitools.ClassifyError(err)
		if classified.Code != aitools.ErrorCodeThreadQueryIndexNotReady || !classified.Retryable {
			t.Fatalf("%s index readiness error = %+v", tool, classified)
		}
		if !strings.Contains(classified.Message, "No partial results") || len(classified.SuggestedFixes) == 0 {
			t.Fatalf("%s readiness guidance is incomplete: %+v", tool, classified)
		}
	}
}

func TestThreadQueryInvocationDescription(t *testing.T) {
	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	svc.threadRuntime = &threadQueryRecordingRuntime{ThreadService: svc.threadRuntime}
	for _, name := range []string{"threads.query", "threads.read"} {
		args := map[string]any{"description": "Find recent release discussions", "object": "threads"}
		if name == "threads.read" {
			args = map[string]any{"description": "Read the release plan", "ref": "expired"}
		}
		_, err := svc.execThreadQueryTool(t.Context(), meta, name, args)
		if err != nil {
			t.Fatalf("description reached canonical query decoder: %v", err)
		}
		if args["description"] == nil {
			t.Fatal("invocation metadata mutated")
		}
		call := floretActivityForToolCall(name, args)
		if call == nil || call.Label != args["description"] {
			t.Fatalf("intent label: %+v", call)
		}
		result, err := floretActivityForToolResult(nil, ToolResult{ToolName: name, Status: toolResultStatusSuccess, activityInput: args, Data: map[string]any{"description": "Untrusted result title"}})
		if err != nil || result.Label != args["description"] {
			t.Fatalf("result lost invocation intent: %+v %v", result, err)
		}
	}
}

func TestThreadQueryDescriptionSchemas(t *testing.T) {
	for _, def := range builtInThreadQueryToolDefinitions() {
		if def.Name == "threads.aggregate" {
			continue
		}
		var schema map[string]any
		if err := json.Unmarshal(def.InputSchema, &schema); err != nil {
			t.Fatal(err)
		}
		validator, err := compileArgumentSchema(schema)
		if err != nil {
			t.Fatal(err)
		}
		args := map[string]any{"object": "threads"}
		if def.Name == "threads.read" {
			args = map[string]any{"ref": "opaque"}
		}
		if err := validator.Validate(args); err != nil {
			t.Fatalf("historical arguments rejected: %v", err)
		}
		args["description"] = "Find release discussions"
		if err := validator.Validate(args); err != nil {
			t.Fatalf("invocation intent rejected: %v", err)
		}
		for _, invalid := range []any{"", 42, strings.Repeat("a", 161)} {
			args["description"] = invalid
			if err := validator.Validate(args); err == nil {
				t.Fatalf("invalid intent accepted for %s", def.Name)
			}
		}
	}
}

func TestThreadBrowseReadsReferencedConversationContent(t *testing.T) {
	svc := newRealtimeTestService(t, time.Minute)
	meta := testSendTurnMeta()
	source, err := svc.CreateThread(t.Context(), meta, "Source conversation", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	target, err := svc.CreateThread(t.Context(), meta, "Reading conversation", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	if source.ThreadID == target.ThreadID {
		t.Fatal("same conversation")
	}
	text := strings.Repeat("发布计划🌸 with complete context. ", 3000)
	_, err = svc.threadRuntime.Send(t.Context(), flruntime.SendInput{ThreadID: identity.ThreadID(source.ThreadID), RequestKey: "cross-thread-read", Input: flruntime.UserInput{Text: text}})
	if err != nil {
		t.Fatal(err)
	}
	result, err := svc.execThreadQueryTool(t.Context(), meta, "threads.query", map[string]any{"object": "messages", "thread_id": source.ThreadID, "limit": 1})
	if err != nil {
		t.Fatal(err)
	}
	page := result.(threadquery.Page)
	if len(page.Records) != 1 || page.Records[0].ThreadID.String() != source.ThreadID || page.Records[0].Role != "user" {
		t.Fatalf("wrong source page: %+v", page)
	}
	input := map[string]any{"ref": page.Records[0].Ref}
	var body strings.Builder
	for {
		result, err = svc.execThreadQueryTool(t.Context(), meta, "threads.read", input)
		if err != nil {
			t.Fatal(err)
		}
		read := result.(threadquery.ReadPage)
		for _, chunk := range read.Chunks {
			if chunk.Field == "body" {
				body.WriteString(chunk.Text)
			}
		}
		if read.NextCursor == "" {
			break
		}
		input["cursor"] = read.NextCursor
	}
	if body.String() != text {
		t.Fatalf("cross-thread read truncated content: got=%d want=%d", body.Len(), len(text))
	}
	foreign := *meta
	foreign.NamespacePublicID = "unrelated"
	result, err = svc.execThreadQueryTool(t.Context(), &foreign, "threads.query", map[string]any{"object": "messages", "thread_id": source.ThreadID})
	if err != nil || result.(threadquery.Page).Total != 0 {
		t.Fatalf("foreign content visible: %v %v", result, err)
	}
}
