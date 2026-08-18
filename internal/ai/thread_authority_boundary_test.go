package ai

import (
	"context"
	"database/sql"
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	"github.com/floegence/floret/v4/identity"
	flruntime "github.com/floegence/floret/v4/runtime"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/session"
)

func TestThreadViewDoesNotExposeRedevenAgentOwnershipShadow(t *testing.T) {
	t.Parallel()

	typeOfView := reflect.TypeOf(ThreadView{})
	for _, field := range []string{"OwnerKind", "OwnerID", "ParentThreadID"} {
		if _, ok := typeOfView.FieldByName(field); ok {
			t.Fatalf("ThreadView still defines Redeven-owned Agent shadow field %q", field)
		}
	}
	body, err := json.Marshal(ThreadView{ThreadID: "thread_1", Title: "Canonical title"})
	if err != nil {
		t.Fatal(err)
	}
	for _, field := range []string{"owner_kind", "owner_id", "parent_thread_id"} {
		if strings.Contains(string(body), field) {
			t.Fatalf("ThreadView exposed Redeven-owned Agent shadow field %q: %s", field, body)
		}
	}
}

func TestForeignEndpointCannotReadSubagentDetail(t *testing.T) {
	svc := newSendTurnTestService(t)
	owner := testSendTurnMeta()
	parent, err := svc.CreateThread(t.Context(), owner, "subagent endpoint authority", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	child, err := svc.threadRuntime.Create(t.Context(), flruntime.CreateThreadInput{
		ParentThreadID: identity.ThreadID(parent.ThreadID), TaskName: "private child", TaskDescription: "private child task",
		HostProfileRef: subagentAgentTypeReviewer, ForkMode: subagentContextModeMissionOnly, RequestKey: "create-private-child",
	})
	if err != nil {
		t.Fatal(err)
	}
	foreign := &session.Meta{
		ChannelID: "foreign-channel", EndpointID: "foreign-endpoint", NamespacePublicID: "foreign-namespace",
		UserPublicID: "foreign-user", CanRead: true, CanWrite: true, CanExecute: true,
	}
	if _, err := svc.GetFlowerSubagentDetail(t.Context(), foreign, parent.ThreadID, child.ThreadID.String(), 0, 50); !errorsIsNoRows(err) {
		t.Fatalf("foreign subagent detail error=%v, want endpoint-scoped not found", err)
	}
}

func TestForeignEndpointCannotMutateCanonicalThread(t *testing.T) {
	svc := newSendTurnTestService(t)
	owner := testSendTurnMeta()
	thread, err := svc.CreateThread(t.Context(), owner, "endpoint authority", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	foreign := &session.Meta{
		ChannelID: "foreign-channel", EndpointID: "foreign-endpoint", NamespacePublicID: "foreign-namespace",
		UserPublicID: "foreign-user", CanRead: true, CanWrite: true, CanExecute: true,
	}
	before, err := svc.readCanonicalThreadState(t.Context(), thread.ThreadID)
	if err != nil {
		t.Fatal(err)
	}

	mutations := []struct {
		name string
		call func() error
	}{
		{name: "send", call: func() error {
			_, err := svc.SendUserTurn(t.Context(), foreign, SendUserTurnRequest{ClientRequestID: "foreign-send", ThreadID: thread.ThreadID, Input: RunInput{Text: "must not be admitted"}})
			return err
		}},
		{name: "respond", call: func() error {
			_, err := svc.SubmitRequestUserInputResponse(t.Context(), foreign, SubmitRequestUserInputResponseRequest{ThreadID: thread.ThreadID, Response: RequestUserInputResponse{PromptID: "foreign-prompt"}})
			return err
		}},
		{name: "delete queued", call: func() error { return svc.DeleteQueuedInput(t.Context(), foreign, thread.ThreadID, "foreign-queue") }},
		{name: "promote queued", call: func() error {
			_, err := svc.PromoteQueuedInput(t.Context(), foreign, thread.ThreadID, "foreign-queue")
			return err
		}},
		{name: "reorder queue", call: func() error { return svc.ReorderQueue(t.Context(), foreign, thread.ThreadID, ReorderQueueRequest{}) }},
		{name: "approval", call: func() error {
			_, err := svc.SubmitFlowerApproval(foreign, SubmitFlowerApprovalRequest{ThreadID: thread.ThreadID, RejectAll: true})
			return err
		}},
		{name: "cancel", call: func() error {
			_, err := svc.StopThread(t.Context(), foreign, thread.ThreadID)
			return err
		}},
		{name: "retry", call: func() error {
			_, err := svc.RetryThreadContinuation(t.Context(), foreign, thread.ThreadID)
			return err
		}},
		{name: "retry effect", call: func() error {
			_, err := svc.RetryThreadEffect(t.Context(), foreign, thread.ThreadID, RetryThreadEffectRequest{EffectAttemptID: "foreign-attempt", ToolCallID: "foreign-tool", AcknowledgeUnknownRisk: true})
			return err
		}},
		{name: "rename", call: func() error { return svc.RenameThread(t.Context(), foreign, thread.ThreadID, "foreign title") }},
		{name: "fork", call: func() error {
			_, err := svc.ForkThreadWithOptions(t.Context(), foreign, thread.ThreadID, ForkThreadRequest{ClientRequestID: "foreign-fork"})
			return err
		}},
		{name: "model", call: func() error { return svc.SetThreadModel(t.Context(), foreign, thread.ThreadID, "openai/gpt-4o-mini") }},
		{name: "reasoning", call: func() error {
			return svc.SetThreadReasoningSelection(t.Context(), foreign, thread.ThreadID, config.AIReasoningSelection{})
		}},
		{name: "clear reasoning", call: func() error { return svc.ClearThreadReasoningSelection(t.Context(), foreign, thread.ThreadID) }},
		{name: "permission", call: func() error {
			return svc.SetThreadPermissionType(t.Context(), foreign, thread.ThreadID, string(FlowerPermissionReadonly))
		}},
		{name: "pin", call: func() error {
			_, err := svc.SetThreadPinned(t.Context(), foreign, thread.ThreadID, true)
			return err
		}},
		{name: "delete", call: func() error {
			return svc.DeleteThread(t.Context(), foreign, thread.ThreadID, true)
		}},
	}

	for _, mutation := range mutations {
		t.Run(mutation.name, func(t *testing.T) {
			if err := mutation.call(); !errorsIsNoRows(err) {
				t.Fatalf("foreign mutation error=%v, want endpoint-scoped not found", err)
			}
			after, err := svc.readCanonicalThreadState(context.Background(), thread.ThreadID)
			if err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(after, before) {
				t.Fatalf("foreign mutation changed canonical view\nbefore=%#v\nafter=%#v", before, after)
			}
		})
	}
}

func errorsIsNoRows(err error) bool {
	return err != nil && (err == sql.ErrNoRows || strings.Contains(err.Error(), sql.ErrNoRows.Error()))
}
