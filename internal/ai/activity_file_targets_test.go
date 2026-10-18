package ai

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"strings"
	"testing"

	"github.com/floegence/floret/v7/identity"
	"github.com/floegence/floret/v7/observation"
	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/floret/v7/threadquery"
	fltools "github.com/floegence/floret/v7/tools"
	"github.com/floegence/redeven/internal/config"
)

func TestFileActivityTargetsConfirmedExecution(t *testing.T) {
	for _, name := range []string{"read_file", "file.edit", "file.write", "image.read"} {
		t.Run(name, func(t *testing.T) {
			for _, status := range []string{"success", "error", "aborted", "rejected"} {
				if status == "rejected" {
					continue
				}
				result := ToolResult{ToolName: name, Status: status, Data: map[string]any{"file_path": "/workspace/a.txt", "change_type": "noop"}}
				activity, err := floretActivityForToolResult(nil, result)
				if err != nil {
					t.Fatal(err)
				}
				got := false
				for _, target := range activity.TargetRefs {
					got = got || target.Path == "/workspace/a.txt"
				}
				if got != (status == "success") {
					t.Fatalf("status %s targets=%+v", status, activity.TargetRefs)
				}
			}
		})
	}
	for _, invalid := range []string{"relative.txt", "/a\nfile", "/" + strings.Repeat("a", 501)} {
		if target := fileActivityTarget(invalid, "file"); target != nil {
			t.Fatalf("invalid path accepted: %+v", target)
		}
	}
}

func TestFileActivityTargetsOwnBatchResource(t *testing.T) {
	activity := &fltools.ActivityPresentation{Renderer: fltools.ActivityRendererStructured, Payload: fltools.StructuredActivityPayload{}}
	files := []any{map[string]any{"path": "/one/a.txt", "error": "not found"}, map[string]any{"path": "/two/a.txt", "result": map[string]any{"file_path": "/two/a.txt", "content": "confirmed"}}}
	applyFileActivityTargets(activity, "read_files", map[string]any{"files": files})
	rows := activity.Payload.(fltools.StructuredActivityPayload).Rows
	if len(rows) != 2 || rows[0].Target != nil || rows[1].Target == nil || rows[1].Target.Path != "/two/a.txt" {
		t.Fatalf("rows=%+v", rows)
	}
	files = nil
	for i := 0; i < structuredActivityRowLimit+2; i++ {
		files = append(files, map[string]any{"result": map[string]any{"file_path": fmt.Sprintf("/file-%d", i), "content": "x"}})
	}
	applyFileActivityTargets(activity, "read_files", map[string]any{"files": files})
	rows = activity.Payload.(fltools.StructuredActivityPayload).Rows
	if len(rows) != structuredActivityRowLimit || rows[len(rows)-1].Target.Path != fmt.Sprintf("/file-%d", structuredActivityRowLimit-1) {
		t.Fatalf("bounded row target shifted: %+v", rows[len(rows)-1])
	}
	patch := &fltools.ActivityPresentation{Renderer: fltools.ActivityRendererPatch, Payload: fltools.PatchActivityPayload{}}
	applyFileActivityTargets(patch, "apply_patch", map[string]any{"mutations": []any{
		map[string]any{"file_path": "/old/a.txt", "old_path": "/old/a.txt", "new_path": "/new/a.txt", "change_type": "move"},
		map[string]any{"file_path": "/gone/a.txt", "old_path": "/gone/a.txt", "change_type": "delete"},
	}})
	mutations := *patch.Payload.(fltools.PatchActivityPayload).Mutations
	if mutations[0].Target.Path != "/new/a.txt" || mutations[1].Target.Kind != "directory" || mutations[1].Target.Path != "/gone" {
		t.Fatalf("mutations=%+v", mutations)
	}
	for _, name := range []string{"read_file", "read_files", "apply_patch"} {
		p := &fltools.ActivityPresentation{Renderer: fltools.ActivityRendererFile, Payload: fltools.FileActivityPayload{}}
		applyFileActivityTargets(p, name, map[string]any{"target_id": "remote", "file_path": "/remote/a.txt"})
		if len(p.TargetRefs) != 0 {
			t.Fatalf("remote path became local: %+v", p)
		}
	}
}

type fileTargetQueryRuntime struct {
	flruntime.ThreadService
	records        []threadquery.Record
	bodies         map[threadquery.RecordRef]string
	queries, reads int
	beforeRead     func()
	queryHook      func(threadquery.Scope, threadquery.QueryInput) (threadquery.Page, error)
	readHook       func(threadquery.Scope, threadquery.ReadInput) (threadquery.ReadPage, error)
}

func (r *fileTargetQueryRuntime) Query(_ context.Context, scope threadquery.Scope, input threadquery.QueryInput) (threadquery.Page, error) {
	r.queries++
	if r.queryHook != nil {
		return r.queryHook(scope, input)
	}
	if len(scope.ThreadIDs) != 1 || scope.Authority == "" || input.Object != threadquery.ToolCalls {
		return threadquery.Page{}, errors.New("missing exact authorized scope")
	}
	return threadquery.Page{Records: r.records}, nil
}
func (r *fileTargetQueryRuntime) Read(_ context.Context, scope threadquery.Scope, input threadquery.ReadInput) (threadquery.ReadPage, error) {
	r.reads++
	if r.readHook != nil {
		return r.readHook(scope, input)
	}
	if r.beforeRead != nil {
		r.beforeRead()
	}
	for _, record := range r.records {
		if record.Ref == input.Ref {
			return threadquery.ReadPage{Record: record, Chunks: []threadquery.Chunk{{Field: "result", Text: r.bodies[input.Ref]}}}, nil
		}
	}
	return threadquery.ReadPage{}, errors.New("unknown ref")
}
func TestHydrateFileActivityTargetsExactCanonicalIdentity(t *testing.T) {
	svc := newTestService(t, &config.AIConfig{CurrentModelID: "openai/gpt-5-mini", Providers: []config.AIProvider{{ID: "openai", Name: "OpenAI", Type: "openai", Models: []config.AIProviderModel{{ModelName: "gpt-5-mini"}}}}})
	meta := testSendTurnMeta()
	thread, err := svc.CreateThread(t.Context(), meta, "Files", "", "", svc.agentHomeDir)
	if err != nil {
		t.Fatal(err)
	}
	item := flruntime.ThreadItem{ID: "item", Kind: flruntime.ThreadItemTool, TurnID: "turn", RunID: "run", Activity: &observation.ActivityItem{ItemID: "activity", ToolID: "call", ToolName: "read_file", Status: observation.ActivityStatusSuccess, Presentation: &fltools.ActivityPresentation{Renderer: fltools.ActivityRendererFile, Label: "a.txt", Payload: fltools.FileActivityPayload{Content: "historical snapshot"}}}}
	before, _ := json.Marshal(item)
	record := threadquery.Record{Ref: "correct", ThreadID: identity.ThreadID(thread.ThreadID), TurnID: "turn", RunID: "run", ToolCallID: "call", ToolName: "read_file", Status: "success"}
	wrong := record
	wrong.Ref = "wrong"
	wrong.RunID = "another-run"
	runtime := &fileTargetQueryRuntime{records: []threadquery.Record{wrong, record}, bodies: map[threadquery.RecordRef]string{"correct": "{\"status\":\"success\",\"data\":{\"file_path\":\"/no-longer-present/a.txt\"}}", "wrong": "{\"status\":\"success\",\"data\":{\"file_path\":\"/wrong/a.txt\"}}"}}
	svc.threadRuntime = runtime
	got, err := svc.hydrateActivityTargets(t.Context(), meta, thread.ThreadID, []flruntime.ThreadItem{item})
	if err != nil {
		t.Fatal(err)
	}
	if runtime.queries != 1 || runtime.reads != 1 || got[0].Activity.Presentation.TargetRefs[0].Path != "/no-longer-present/a.txt" {
		t.Fatalf("incorrect canonical match: %+v queries=%d reads=%d", got, runtime.queries, runtime.reads)
	}
	after, _ := json.Marshal(item)
	if !reflect.DeepEqual(before, after) {
		t.Fatal("canonical source changed")
	}
	if got[0].Activity.Presentation.Payload.(fltools.FileActivityPayload).Content != "historical snapshot" {
		t.Fatal("historical content changed")
	}
	_, err = svc.hydrateActivityTargets(t.Context(), meta, thread.ThreadID, got)
	if err != nil || runtime.queries != 1 {
		t.Fatalf("modern target queried again: %v", err)
	}
}

func (r *fileTargetQueryRuntime) Aggregate(context.Context, threadquery.Scope, threadquery.AggregateInput) (threadquery.AggregatePage, error) {
	panic("unexpected aggregate")
}

func TestHistoricalBatchTargetsRequireExactTypedEvidence(t *testing.T) {
	data := map[string]any{"files": []any{
		map[string]any{"path": "/first/same.txt", "error": "not found"},
		map[string]any{"path": "/second/same.txt", "result": map[string]any{"file_path": "/second/same.txt", "content": "confirmed"}},
	}}
	rows := structuredToolResults("read_files", data, nil)
	activity := &fltools.ActivityPresentation{Renderer: fltools.ActivityRendererStructured, Payload: fltools.StructuredActivityPayload{Rows: rows, Summary: "original summary", RowsProvided: true}}
	mergeHistoricalFileActivityTargets(activity, "read_files", data)
	result := activity.Payload.(fltools.StructuredActivityPayload)
	if result.Summary != "original summary" || !result.RowsProvided || len(result.Rows) != 2 || result.Rows[0].Target != nil || result.Rows[1].Target == nil || result.Rows[1].Target.Path != "/second/same.txt" {
		t.Fatalf("historical batch=%+v", result)
	}
	// Equal filenames never authorize pairing if any of the typed facts differ.
	changed := *activity
	payload := result
	payload.Rows = append([]fltools.StructuredActivityRow(nil), result.Rows...)
	payload.Rows[1].Target = nil
	payload.Rows[1].Content = "different historical snapshot"
	changed.Payload = payload
	before, _ := json.Marshal(changed)
	mergeHistoricalFileActivityTargets(&changed, "read_files", data)
	after, _ := json.Marshal(changed)
	if string(before) != string(after) {
		t.Fatal("unproven historical rows changed")
	}
}

func TestReadFileRPCNavigationDoesNotAcceptWhitespaceOrTruncatedPaths(t *testing.T) {
	for _, path := range []string{" /workspace/file.txt", "/workspace/file.txt ", "/workspace/\nfile.txt", "relative.txt"} {
		if fileActivityTarget(path, "file") != nil || mutationActivityTarget(map[string]any{"file_path": path}) != nil || mutationActivityTarget(map[string]any{"old_path": path, "change_type": "delete"}) != nil {
			t.Fatalf("invalid exact path accepted: %q", path)
		}
	}
}

func TestHistoricalFileTargetsReauthorizeEveryCanonicalRead(t *testing.T) {
	svc := newTestService(t, &config.AIConfig{CurrentModelID: "openai/gpt-5-mini", Providers: []config.AIProvider{{ID: "openai", Name: "OpenAI", Type: "openai", Models: []config.AIProviderModel{{ModelName: "gpt-5-mini"}}}}})
	meta := testSendTurnMeta()
	thread, err := svc.CreateThread(t.Context(), meta, "Files", "", "", svc.agentHomeDir)
	if err != nil {
		t.Fatal(err)
	}
	item := flruntime.ThreadItem{ID: "item", Kind: flruntime.ThreadItemTool, TurnID: "turn", RunID: "run", Activity: &observation.ActivityItem{ToolID: "call", ToolName: "read_file", Status: observation.ActivityStatusSuccess, Presentation: &fltools.ActivityPresentation{Renderer: fltools.ActivityRendererFile, Payload: fltools.FileActivityPayload{}}}}
	runtime := &fileTargetQueryRuntime{
		queryHook: func(scope threadquery.Scope, _ threadquery.QueryInput) (threadquery.Page, error) {
			want, _ := json.Marshal([]string{meta.UserPublicID, meta.EndpointID, meta.NamespacePublicID})
			if scope.Authority != string(want) {
				t.Fatalf("authority=%q", scope.Authority)
			}
			meta.CanRead = false
			return threadquery.Page{Records: []threadquery.Record{{Ref: "result", ThreadID: identity.ThreadID(thread.ThreadID), TurnID: "turn", RunID: "run", ToolCallID: "call", ToolName: "read_file", Status: "success"}}}, nil
		},
	}
	svc.threadRuntime = runtime
	if _, err := svc.hydrateActivityTargets(t.Context(), meta, thread.ThreadID, []flruntime.ThreadItem{item}); !errors.Is(err, errReadPermissionDenied) || runtime.reads != 0 {
		t.Fatalf("revocation err=%v reads=%d", err, runtime.reads)
	}
}

func TestHistoricalFileTargetsValidateEveryResultChunk(t *testing.T) {
	for _, invalid := range []bool{false, true} {
		t.Run(fmt.Sprint(invalid), func(t *testing.T) {
			svc := newTestService(t, &config.AIConfig{CurrentModelID: "openai/gpt-5-mini", Providers: []config.AIProvider{{ID: "openai", Name: "OpenAI", Type: "openai", Models: []config.AIProviderModel{{ModelName: "gpt-5-mini"}}}}})
			meta := testSendTurnMeta()
			thread, err := svc.CreateThread(t.Context(), meta, "Files", "", "", svc.agentHomeDir)
			if err != nil {
				t.Fatal(err)
			}
			item := flruntime.ThreadItem{ID: "item", Kind: flruntime.ThreadItemTool, TurnID: "turn", RunID: "run", Activity: &observation.ActivityItem{ToolID: "call", ToolName: "read_file", Status: observation.ActivityStatusSuccess, Presentation: &fltools.ActivityPresentation{Renderer: fltools.ActivityRendererFile, Payload: fltools.FileActivityPayload{}}}}
			record := threadquery.Record{Ref: "result", ThreadID: identity.ThreadID(thread.ThreadID), TurnID: "turn", RunID: "run", ToolCallID: "call", ToolName: "read_file", Status: "success"}
			first := "{\"status\":\"success\",\"data\":{\"file_path\":"
			runtime := &fileTargetQueryRuntime{records: []threadquery.Record{record}}
			runtime.readHook = func(_ threadquery.Scope, input threadquery.ReadInput) (threadquery.ReadPage, error) {
				if input.Cursor == "" {
					return threadquery.ReadPage{Record: record, Chunks: []threadquery.Chunk{{Field: "arguments", Text: "{}"}, {Field: "result", Text: first}}, NextCursor: "next"}, nil
				}
				offset := len(first)
				if invalid {
					offset--
				}
				return threadquery.ReadPage{Record: record, Chunks: []threadquery.Chunk{{Field: "result", Offset: offset, Text: "\"/restored/a.txt\"}}"}}}, nil
			}
			svc.threadRuntime = runtime
			out, err := svc.hydrateActivityTargets(t.Context(), meta, thread.ThreadID, []flruntime.ThreadItem{item})
			if invalid {
				if err == nil {
					t.Fatal("discontinuous result accepted")
				}
			} else if err != nil || out[0].Activity.Presentation.TargetRefs[0].Path != "/restored/a.txt" {
				t.Fatalf("paginated result=%+v err=%v", out, err)
			}
		})
	}
}
