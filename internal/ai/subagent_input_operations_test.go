package ai

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/floegence/floret/v7/identity"
	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/redeven/internal/session"
)

func TestSubagentGuidanceInterruptsProviderWithoutReplacingTask(t *testing.T) {
	var calls atomic.Int32
	started, cancelled := make(chan struct{}), make(chan struct{})
	inputs := make(chan string, 4)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request map[string]any
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		flusher := w.(http.Flusher)
		w.Header().Set("Content-Type", "text/event-stream")
		if tools, _ := request["tools"].([]any); len(tools) == 0 {
			writeAskUserIntegrationTextResponse(w, flusher, "title", "Steering")
			return
		}
		w.WriteHeader(http.StatusOK)
		flusher.Flush()
		if calls.Add(1) == 1 {
			close(started)
			<-r.Context().Done()
			close(cancelled)
			return
		}
		raw, _ := json.Marshal(request["input"])
		inputs <- string(raw)
		<-r.Context().Done()
	}))
	defer server.Close()
	svc := openRealtimeTestService(t, t.TempDir(), server.URL)
	defer func() { _ = svc.Close() }()
	meta := testSendTurnMeta()
	parent, err := svc.CreateThread(t.Context(), meta, "Steering parent", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	childRuntime := newServiceFloretSubagentRuntime(svc, &run{sessionMeta: meta, endpointID: meta.EndpointID, threadID: parent.ThreadID, turnID: "parent-turn", currentModelID: "openai/gpt-5-mini", permissionType: FlowerPermissionReadonly})
	spawned, err := childRuntime.spawn(t.Context(), "spawn-guide", map[string]any{"task_name": "Review", "task_description": "Review sources", "agent_type": "reviewer", "message": "Start reviewing"})
	if err != nil {
		t.Fatal(err)
	}
	childID := identity.ThreadID(spawned["thread_id"].(string))
	select {
	case <-started:
	case <-time.After(5 * time.Second):
		t.Fatal("child provider did not start")
	}
	before, err := svc.threadRuntime.View(t.Context(), childID)
	if err != nil {
		t.Fatal(err)
	}
	beforeAuthority, err := svc.threadsDB.GetExecutionAuthorityByTurn(t.Context(), childID.String(), before.TurnID.String())
	if err != nil {
		t.Fatal(err)
	}
	args := map[string]any{"target": childID.String(), "message": "Prioritize original release notes"}
	result, err := childRuntime.sendInput(t.Context(), "guide-tool", args)
	if err != nil || result["accepted"] != true {
		t.Fatalf("result=%v err=%v", result, err)
	}
	select {
	case <-cancelled:
	case <-time.After(5 * time.Second):
		t.Fatal("old provider not interrupted")
	}
	select {
	case input := <-inputs:
		if !strings.Contains(input, "Prioritize original release notes") {
			t.Fatalf("provider input=%s", input)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("guidance not applied")
	}
	after, err := svc.threadRuntime.View(t.Context(), childID)
	if err != nil {
		t.Fatal(err)
	}
	if after.TurnID != before.TurnID || after.RunID != before.RunID || len(after.Queue) != 0 {
		t.Fatalf("task replaced or queued: before=%+v after=%+v", before, after)
	}
	afterAuthority, err := svc.threadsDB.GetExecutionAuthorityByTurn(t.Context(), childID.String(), after.TurnID.String())
	if err != nil {
		t.Fatal(err)
	}
	if beforeAuthority == nil || afterAuthority == nil || beforeAuthority.RequestKey != afterAuthority.RequestKey {
		t.Fatalf("active authority replaced: %v -> %v", beforeAuthority, afterAuthority)
	}
	svc.floretEffects.mu.Lock()
	pending := len(svc.floretEffects.pending)
	svc.floretEffects.mu.Unlock()
	if pending != 0 {
		t.Fatalf("unconsumed effect requests=%d", pending)
	}
	if _, err := childRuntime.sendInput(t.Context(), "guide-tool", args); err != nil {
		t.Fatal(err)
	}
	if calls.Load() != 2 {
		t.Fatalf("replay interrupted provider again: %d", calls.Load())
	}
	queuedInput := flruntime.UserInput{Text: "Use the revised scope", References: []flruntime.MessageReference{{ReferenceID: "scope", Kind: flruntime.MessageReferenceText, Label: "Scope", Text: "Exact scope context"}}}
	if _, err := svc.threadRuntime.ImportPendingInputs(t.Context(), flruntime.ImportPendingInputsInput{ThreadID: childID, Items: []flruntime.ImportedPendingInput{{RequestKey: "guide-queue", Input: queuedInput}}}); err != nil {
		t.Fatal(err)
	}
	detail, err := svc.OperateFlowerSubagentInput(t.Context(), meta, parent.ThreadID, childID.String(), SubagentInputOperation{Action: "steer_queue", ItemID: "queue:guide-queue", ExpectedInputFingerprint: queuedInputFingerprint(queuedInput), ClientRequestID: "guide-queue-now"})
	if err != nil || len(detail.Current.Queue) != 0 || detail.Current.TurnID != before.TurnID {
		t.Fatalf("steer queue=%+v err=%v", detail, err)
	}
	select {
	case input := <-inputs:
		if !strings.Contains(input, "Exact scope context") || !strings.Contains(input, "Use the revised scope") {
			t.Fatalf("lost queue context: %s", input)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("queued guidance did not reach provider")
	}
	args["message"] = "conflicting guidance"
	if _, err := childRuntime.sendInput(t.Context(), "guide-tool", args); !errors.Is(err, flruntime.ErrRequestConflict) {
		t.Fatalf("conflict=%v", err)
	}
}

func TestSubagentInputOperationsAuthorizeAndConsumeCanonicalQueue(t *testing.T) {
	svc := newRealtimeTestService(t, time.Millisecond)
	meta := testSendTurnMeta()
	parent, err := svc.CreateThread(t.Context(), meta, "Parent", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	child, err := svc.threadRuntime.Create(t.Context(), flruntime.CreateThreadInput{ParentThreadID: identity.ThreadID(parent.ThreadID), TaskName: "Child", TaskDescription: "Review", HostProfileRef: "reviewer", ForkMode: "mission_only", RequestKey: "create-operation-child"})
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.ensureChildThreadSettings(t.Context(), &run{sessionMeta: meta, endpointID: meta.EndpointID, threadID: parent.ThreadID, permissionType: FlowerPermissionReadonly}, child.ThreadID.String(), parent.ThreadID, "reviewer"); err != nil {
		t.Fatal(err)
	}
	input := flruntime.UserInput{Text: "Canonical instruction", References: []flruntime.MessageReference{{ReferenceID: "reference", Kind: flruntime.MessageReferenceText, Label: "Source", Text: "Complete source"}}}
	if _, err := svc.threadRuntime.ImportPendingInputs(t.Context(), flruntime.ImportPendingInputsInput{ThreadID: child.ThreadID, Items: []flruntime.ImportedPendingInput{{RequestKey: "operation-queue", Input: input}}}); err != nil {
		t.Fatal(err)
	}
	op := SubagentInputOperation{Action: "remove_queue", ItemID: "queue:operation-queue", ClientRequestID: "operation-remove", ExpectedInputFingerprint: queuedInputFingerprint(input)}
	foreign := *meta
	foreign.EndpointID = "foreign"
	other, err := svc.CreateThread(t.Context(), meta, "Other parent", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	readonly := *meta
	readonly.CanExecute = false
	for _, test := range []struct {
		name   string
		meta   *session.Meta
		parent string
	}{{"foreign endpoint", &foreign, parent.ThreadID}, {"permission changed", &readonly, parent.ThreadID}, {"foreign parent", meta, other.ThreadID}} {
		t.Run(test.name, func(t *testing.T) {
			if _, err := svc.OperateFlowerSubagentInput(t.Context(), test.meta, test.parent, child.ThreadID.String(), op); err == nil {
				t.Fatal("unauthorized operation accepted")
			}
		})
	}
	stale := op
	stale.ExpectedInputFingerprint = queuedInputFingerprint(flruntime.UserInput{Text: input.Text})
	if _, err := svc.OperateFlowerSubagentInput(t.Context(), meta, parent.ThreadID, child.ThreadID.String(), stale); !errors.Is(err, flruntime.ErrRequestConflict) {
		t.Fatalf("stale=%v", err)
	}
	detail, err := svc.OperateFlowerSubagentInput(t.Context(), meta, parent.ThreadID, child.ThreadID.String(), op)
	if err != nil || len(detail.Current.Queue) != 0 {
		t.Fatalf("remove=%v err=%v", detail, err)
	}
	if _, err := svc.OperateFlowerSubagentInput(t.Context(), meta, parent.ThreadID, child.ThreadID.String(), op); !errors.Is(err, flruntime.ErrRequestConflict) {
		t.Fatalf("consumed queue=%v", err)
	}
	// Never offer or admit a resend of an uncertain side effect.
	base := svc.threadRuntime
	reason := "effect_outcome_unknown"
	resendCalls := 0
	svc.threadRuntime = &authorityContinuityRuntime{ThreadService: base, list: base.List, view: func(ctx context.Context, id identity.ThreadID) (flruntime.ThreadView, error) {
		v, err := base.View(ctx, id)
		v.Items = append(v.Items, flruntime.ThreadItem{ID: "unsafe", Kind: flruntime.ThreadItemSteering, Text: input.Text, References: input.References, Context: input.Context, Attachments: input.Attachments, Steering: &flruntime.ThreadSteering{Status: flruntime.ThreadSteeringCancelled, Reason: reason}})
		return v, err
	}, steer: func(ctx context.Context, in flruntime.SteerInput) (flruntime.ThreadView, error) {
		resendCalls++
		if in.ThreadID != child.ThreadID || !reflect.DeepEqual(in.Input, input) {
			t.Fatalf("resend changed canonical input: %+v", in)
		}
		return base.View(ctx, in.ThreadID)
	}}
	if _, err := svc.OperateFlowerSubagentInput(t.Context(), meta, parent.ThreadID, child.ThreadID.String(), SubagentInputOperation{Action: "resend_steering", ItemID: "unsafe", ClientRequestID: "unsafe-resend"}); !errors.Is(err, flruntime.ErrRequestConflict) {
		t.Fatalf("unsafe resend=%v", err)
	}
	reason = "stopped"
	if _, err := svc.OperateFlowerSubagentInput(t.Context(), meta, parent.ThreadID, child.ThreadID.String(), SubagentInputOperation{Action: "resend_steering", ItemID: "unsafe", ClientRequestID: "stopped-resend"}); err != nil {
		t.Fatalf("explicit resend=%v", err)
	}
	if resendCalls != 1 {
		t.Fatalf("resend calls=%d", resendCalls)
	}

}
