package ai

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/floegence/floret/v7/identity"
	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/floret/v7/threadquery"
)

func threadReferenceAction(runtimeID, threadID string) *ContextActionEnvelope {
	return &ContextActionEnvelope{SchemaVersion: ContextActionSchemaVersion, ActionID: contextActionAskFlowerID, Provider: contextActionFlowerProvider,
		Target: ContextActionTarget{TargetID: "current", Locality: contextActionLocalityAuto}, Source: ContextActionSource{Surface: contextActionSurfaceComposer},
		Presentation: ContextActionPresentation{Label: "Conversation", Priority: 100},
		Context:      []ContextActionContextItem{{Kind: contextActionKindThread, Thread: &ThreadReferenceSnapshot{RuntimeID: runtimeID, ThreadID: threadID, Title: "Frozen title", Status: "idle", WorkingDir: "/workspace", CreatedAtMs: 1, UpdatedAtMs: 2, CapturedAtMs: 3}}}}
}

func TestThreadReferenceStrictProjection(t *testing.T) {
	action := threadReferenceAction("env:environment", "thread_source")
	raw, err := json.Marshal(action)
	if err != nil {
		t.Fatal(err)
	}
	var decoded ContextActionEnvelope
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatal(err)
	}
	projection, err := floretContextProjectionForInput(RunInput{ContextAction: &decoded}, nil, nil)
	if err != nil || len(projection.References) != 1 || len(projection.Context) != 0 {
		t.Fatalf("projection: %+v %v", projection, err)
	}
	ref := projection.References[0]
	if ref.Kind != flruntime.MessageReferenceThread || ref.ReferencedThreadID != "thread_source" || ref.ResourceRef != "" || ref.Truncated {
		t.Fatalf("reference: %+v", ref)
	}
	for _, mutation := range []func(map[string]any){
		func(item map[string]any) { item["path"] = "/forged" },
		func(item map[string]any) { item["thread"].(map[string]any)["preview"] = "private message" },
		func(item map[string]any) { delete(item["thread"].(map[string]any), "created_at_ms") },
		func(item map[string]any) { item["thread"].(map[string]any)["thread_id"] = "invalid identity" },
	} {
		var wire map[string]any
		_ = json.Unmarshal(raw, &wire)
		mutation(wire["context"].([]any)[0].(map[string]any))
		changed, _ := json.Marshal(wire)
		var candidate ContextActionEnvelope
		if err := json.Unmarshal(changed, &candidate); err == nil {
			if _, err = normalizeAskFlowerContextActionEnvelope(&candidate); err == nil {
				t.Fatalf("accepted invalid action: %s", changed)
			}
		}
	}
}

func TestThreadReferenceAdmissionAndFrozenReplay(t *testing.T) {
	svc := newRealtimeTestService(t, time.Minute)
	meta := testSendTurnMeta()
	meta.EndpointID = "env_local"
	meta.NamespacePublicID = "ns_local"
	source, err := svc.CreateThread(t.Context(), meta, "Source", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	target, err := svc.CreateThread(t.Context(), meta, "Target", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	// This is the shared Desktop/Env App wire identity for Local UI, not a
	// value derived from the authorization helper being tested.
	action := threadReferenceAction("env:local-environment", source.ThreadID)
	req := SendUserTurnRequest{ThreadID: target.ThreadID, ClientRequestID: "thread-ref", Input: RunInput{ContextAction: action}}
	accepted, err := svc.SendUserTurn(t.Context(), meta, req)
	if err != nil {
		t.Fatal(err)
	}
	original, found, err := svc.threadRuntime.(flruntime.ThreadSendReader).LookupSend(t.Context(), flruntime.LookupSendInput{ThreadID: identity.ThreadID(target.ThreadID), RequestKey: "thread-ref"})
	if err != nil || !found || len(original.References) != 1 {
		t.Fatalf("canonical reference missing: %+v %v", original, err)
	}
	if err := svc.RenameThread(t.Context(), meta, source.ThreadID, "Renamed"); err != nil {
		t.Fatal(err)
	}
	if err := svc.DeleteThread(t.Context(), meta, source.ThreadID, true); err != nil {
		t.Fatal(err)
	}
	replay, err := svc.SendUserTurn(t.Context(), meta, req)
	if err != nil || replay.TurnID != accepted.TurnID {
		t.Fatalf("frozen replay after deletion: %+v %v", replay, err)
	}
	changed := *action.Context[0].Thread
	changed.Title = "Changed snapshot"
	changedAction := *action
	changedAction.Context = []ContextActionContextItem{{Kind: contextActionKindThread, Thread: &changed}}
	changedReq := req
	changedReq.Input.ContextAction = &changedAction
	if _, err := svc.SendUserTurn(t.Context(), meta, changedReq); !errors.Is(err, ErrTurnIdempotencyConflict) {
		t.Fatalf("changed snapshot replay: %v", err)
	}
	req.ClientRequestID = "new-ref-to-deleted"
	if _, err := svc.SendUserTurn(t.Context(), meta, req); err == nil {
		t.Fatal("new send cited deleted source")
	}
	denied := *meta
	denied.NamespacePublicID = "other_namespace"
	if err := svc.authorizeThreadReferences(t.Context(), &denied, threadReferenceAction(flowerThreadReferenceRuntimeID(meta.EndpointID), target.ThreadID)); err == nil {
		t.Fatal("foreign namespace reference accepted")
	}
}

func TestThreadReferenceRuntimeAuthorization(t *testing.T) {
	for _, tc := range []struct{ endpointID, runtimeID string }{
		{"env_local", "env:local-environment"},
		{"env_remote", "env:env_remote"},
	} {
		t.Run(tc.endpointID, func(t *testing.T) {
			svc := newRealtimeTestService(t, time.Minute)
			meta := testSendTurnMeta()
			meta.EndpointID = tc.endpointID
			source, err := svc.CreateThread(t.Context(), meta, "Source", "", "", "")
			if err != nil {
				t.Fatal(err)
			}
			action := threadReferenceAction(tc.runtimeID, source.ThreadID)
			if err := svc.authorizeThreadReferences(t.Context(), meta, action); err != nil {
				t.Fatal(err)
			}
			for _, deniedRuntime := range []string{"env:other", "env:env_local"} {
				if err := svc.authorizeThreadReferences(t.Context(), meta, threadReferenceAction(deniedRuntime, source.ThreadID)); !errors.Is(err, errReadPermissionDenied) {
					t.Fatalf("runtime %q: %v", deniedRuntime, err)
				}
			}
			denied := *meta
			denied.CanRead = false
			if err := svc.authorizeThreadReferences(t.Context(), &denied, action); !errors.Is(err, errReadPermissionDenied) {
				t.Fatalf("revoked read permission: %v", err)
			}
		})
	}
}

func TestThreadQueryToolsAuthorizeBeforeSearchAndPagination(t *testing.T) {
	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	parent, err := svc.CreateThread(t.Context(), meta, "Readable root", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	child, err := svc.threadRuntime.Create(t.Context(), flruntime.CreateThreadInput{ParentThreadID: identity.ThreadID(parent.ThreadID), TaskName: "child", TaskDescription: "child task", HostProfileRef: "reviewer", ForkMode: subagentContextModeMissionOnly, RequestKey: "query-child"})
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.ensureChildThreadSettings(t.Context(), &run{
		endpointID: meta.EndpointID, threadID: parent.ThreadID,
		permissionType: FlowerPermissionApprovalRequired,
	}, child.ThreadID.String(), parent.ThreadID); err != nil {
		t.Fatal(err)
	}
	foreign := *meta
	foreign.NamespacePublicID = "other_namespace"
	hidden, err := svc.CreateThread(t.Context(), &foreign, "Secret namespace", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	input := map[string]any{"object": "threads", "limit": 1}
	result, err := svc.execThreadQueryTool(t.Context(), meta, "threads.query", input)
	if err != nil {
		t.Fatal(err)
	}
	page := result.(threadquery.Page)
	if page.Total != 2 || page.NextCursor == "" {
		t.Fatalf("authorized root/child count: %+v", page)
	}
	read, err := svc.execThreadQueryTool(t.Context(), meta, "threads.read", map[string]any{"ref": page.Records[0].Ref})
	if err != nil {
		t.Fatal(err)
	}
	if read.(threadquery.ReadPage).Record.ThreadID == identity.ThreadID(hidden.ThreadID) {
		t.Fatal("read exposed foreign namespace")
	}
	input["cursor"] = page.NextCursor
	next, err := svc.execThreadQueryTool(t.Context(), meta, "threads.query", input)
	if err != nil {
		t.Fatal(err)
	}
	seen := map[string]bool{page.Records[0].ThreadID.String(): true, next.(threadquery.Page).Records[0].ThreadID.String(): true}
	if !seen[parent.ThreadID] || !seen[child.ThreadID.String()] {
		t.Fatalf("missing readable child: %v", seen)
	}
	if _, err := svc.execThreadQueryTool(t.Context(), &foreign, "threads.query", input); !errors.Is(err, threadquery.ErrCursorInvalid) {
		t.Fatalf("changed authority cursor: %v", err)
	}
	denied := *meta
	denied.CanRead = false
	for _, name := range []string{"threads.query", "threads.read", "threads.aggregate"} {
		if _, err := svc.execThreadQueryTool(t.Context(), &denied, name, map[string]any{}); err == nil {
			t.Fatalf("%s ignored revoked permission", name)
		}
	}
	counted, err := svc.execThreadQueryTool(t.Context(), meta, "threads.aggregate", map[string]any{"object": "threads", "filter": map[string]any{"thread_ids": []string{hidden.ThreadID}}})
	if err != nil || counted.(threadquery.AggregatePage).Total != 0 {
		t.Fatalf("foreign filter count: %+v %v", counted, err)
	}
	if _, err := svc.execThreadQueryTool(t.Context(), meta, "threads.query", map[string]any{"object": "threads", "authority": "forged"}); err == nil {
		t.Fatal("accepted model-authored authority")
	}
	// Removing product ownership alone must invalidate canonical refs and pages,
	// even when the upstream journal remains intact.
	if err := svc.threadsDB.DeleteThreadProductData(t.Context(), meta.EndpointID, parent.ThreadID); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.execThreadQueryTool(t.Context(), meta, "threads.query", input); !errors.Is(err, threadquery.ErrCursorInvalid) {
		t.Fatalf("withdrawn product ownership retained cursor: %v", err)
	}
	if _, err := svc.execThreadQueryTool(t.Context(), meta, "threads.read", map[string]any{"ref": page.Records[0].Ref}); !errors.Is(err, threadquery.ErrCursorInvalid) {
		t.Fatalf("withdrawn product ownership retained record ref: %v", err)
	}

}

func TestThreadQueryToolsKeepPrivateContentOutOfActivity(t *testing.T) {
	for _, def := range builtInThreadQueryToolDefinitions() {
		if def.Mutating || def.RequiresApproval || def.Visibility != ToolVisibilitySharedReadonly {
			t.Fatalf("query tool is not read-only: %+v", def)
		}
		activity, err := floretActivityForToolResult(nil, ToolResult{ToolName: def.Name, Status: toolResultStatusSuccess, Data: map[string]any{"chunks": []any{map[string]any{"text": "PRIVATE_CONFIRMED_RESULT"}}, "arguments": "PRIVATE_ARGUMENT"}})
		if err != nil {
			t.Fatal(err)
		}
		raw, _ := json.Marshal(activity)
		if strings.Contains(string(raw), "PRIVATE_") {
			t.Fatalf("private content exposed: %s", raw)
		}
	}
}
