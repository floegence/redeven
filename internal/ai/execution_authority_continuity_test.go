package ai

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/floegence/floret/v4/identity"
	flruntime "github.com/floegence/floret/v4/runtime"
	"github.com/floegence/redeven/internal/ai/threadstore"
	"github.com/floegence/redeven/internal/session"
)

type authorityContinuityRuntime struct {
	flruntime.ThreadService
	create              func(context.Context, flruntime.CreateThreadInput) (flruntime.ThreadView, error)
	setTitle            func(context.Context, flruntime.SetTitleInput) (flruntime.ThreadView, error)
	list                func(context.Context, flruntime.ThreadScope) ([]flruntime.ThreadSummary, error)
	view                func(context.Context, identity.ThreadID) (flruntime.ThreadView, error)
	send                func(context.Context, flruntime.SendInput) (flruntime.ThreadView, error)
	retry               func(context.Context, flruntime.RetryInput) (flruntime.ThreadView, error)
	importPendingInputs func(context.Context, flruntime.ImportPendingInputsInput) (flruntime.ImportResult, error)
}

func (runtime *authorityContinuityRuntime) Create(ctx context.Context, input flruntime.CreateThreadInput) (flruntime.ThreadView, error) {
	return runtime.create(ctx, input)
}

func (runtime *authorityContinuityRuntime) SetTitle(ctx context.Context, input flruntime.SetTitleInput) (flruntime.ThreadView, error) {
	return runtime.setTitle(ctx, input)
}

func (runtime *authorityContinuityRuntime) List(ctx context.Context, scope flruntime.ThreadScope) ([]flruntime.ThreadSummary, error) {
	return runtime.list(ctx, scope)
}

func (runtime *authorityContinuityRuntime) View(ctx context.Context, threadID identity.ThreadID) (flruntime.ThreadView, error) {
	return runtime.view(ctx, threadID)
}

func (runtime *authorityContinuityRuntime) Send(ctx context.Context, input flruntime.SendInput) (flruntime.ThreadView, error) {
	return runtime.send(ctx, input)
}

func (runtime *authorityContinuityRuntime) Retry(ctx context.Context, input flruntime.RetryInput) (flruntime.ThreadView, error) {
	return runtime.retry(ctx, input)
}

func (runtime *authorityContinuityRuntime) ImportPendingInputs(ctx context.Context, input flruntime.ImportPendingInputsInput) (flruntime.ImportResult, error) {
	return runtime.importPendingInputs(ctx, input)
}

func newAuthorityContinuityStore(t *testing.T) *threadstore.Store {
	t.Helper()
	store, err := threadstore.Open(filepath.Join(t.TempDir(), "threads.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	return store
}

func TestRetryThreadContinuationBindsAuthorityToEveryRetryTurn(t *testing.T) {
	ctx := t.Context()
	const threadID = "thread_retry_authority"
	meta := &session.Meta{
		EndpointID: "endpoint_retry", NamespacePublicID: "namespace_retry", ChannelID: "channel_retry",
		UserPublicID: "user_retry", UserEmail: "retry@example.com", CanRead: true, CanWrite: true, CanExecute: true,
	}
	store := newAuthorityContinuityStore(t)
	if err := store.CreateThreadSettings(ctx, threadstore.ThreadSettings{
		ThreadID: threadID, EndpointID: meta.EndpointID, NamespacePublicID: meta.NamespacePublicID,
		ModelID: "openai/gpt-5-mini", PermissionType: permissionTypeString(FlowerPermissionApprovalRequired),
	}); err != nil {
		t.Fatal(err)
	}
	if err := store.PutExecutionAuthority(ctx, threadstore.ExecutionAuthority{
		RequestKey: "source-request", ThreadID: threadID, TurnID: "turn-source",
		EndpointID: meta.EndpointID, NamespacePublicID: meta.NamespacePublicID, ChannelID: meta.ChannelID,
		UserPublicID: meta.UserPublicID, UserEmail: meta.UserEmail,
	}); err != nil {
		t.Fatal(err)
	}

	failed := flruntime.TurnOutcomeFailed
	current := flruntime.ThreadView{
		ThreadID: identity.ThreadID(threadID), TurnID: identity.TurnID("turn-source"),
		Activity: flruntime.ThreadActivityIdle, LastOutcome: &failed,
	}
	retryTurns := []identity.TurnID{"turn-retry-1", "turn-retry-2"}
	retryCount := 0
	var cancelAcceptedRetry context.CancelFunc
	runtime := &authorityContinuityRuntime{}
	runtime.view = func(context.Context, identity.ThreadID) (flruntime.ThreadView, error) { return current, nil }
	runtime.retry = func(ctx context.Context, input flruntime.RetryInput) (flruntime.ThreadView, error) {
		persisted, err := store.GetExecutionAuthority(ctx, string(input.RequestKey))
		if err != nil {
			t.Fatal(err)
		}
		if persisted == nil || persisted.TurnID != input.SourceTurnID.String() || persisted.UserPublicID != meta.UserPublicID {
			t.Fatalf("authority before retry=%#v, source_turn=%q", persisted, input.SourceTurnID)
		}
		turnID := retryTurns[retryCount]
		retryCount++
		current = flruntime.ThreadView{
			ThreadID: identity.ThreadID(threadID), TurnID: turnID,
			Activity: flruntime.ThreadActivityIdle, LastOutcome: &failed,
		}
		if cancelAcceptedRetry != nil {
			cancelAcceptedRetry()
		}
		return current, nil
	}
	svc := &Service{threadsDB: store, threadRuntime: runtime, floretEffects: newFloretEffectAdapter()}

	for index, wantTurnID := range retryTurns {
		retryCtx := ctx
		if index == len(retryTurns)-1 {
			var cancelRetry context.CancelFunc
			retryCtx, cancelRetry = context.WithCancel(ctx)
			defer cancelRetry()
			cancelAcceptedRetry = cancelRetry
		}
		if _, err := svc.RetryThreadContinuation(retryCtx, meta, threadID); err != nil {
			t.Fatalf("retry %d: %v", index+1, err)
		}
		authority, err := store.GetExecutionAuthorityByTurn(ctx, threadID, wantTurnID.String())
		if err != nil {
			t.Fatal(err)
		}
		if authority == nil || authority.UserPublicID != meta.UserPublicID || authority.EndpointID != meta.EndpointID {
			t.Fatalf("retry %d turn authority=%#v", index+1, authority)
		}
	}
}

func TestSubagentInputsPersistAuthorityBeforeSendAndRestoreAutonomousOptions(t *testing.T) {
	ctx := t.Context()
	const parentThreadID = "thread_parent_authority"
	const childThreadID = "thread_child_authority"
	meta := &session.Meta{
		EndpointID: "endpoint_subagent", NamespacePublicID: "namespace_subagent", ChannelID: "channel_subagent",
		UserPublicID: "user_subagent", UserEmail: "subagent@example.com", CanRead: true, CanWrite: true, CanExecute: true,
	}
	store := newAuthorityContinuityStore(t)
	if err := store.CreateThreadSettings(ctx, threadstore.ThreadSettings{
		ThreadID: parentThreadID, EndpointID: meta.EndpointID, NamespacePublicID: meta.NamespacePublicID,
		ModelID: "openai/gpt-5-mini", PermissionType: permissionTypeString(FlowerPermissionApprovalRequired),
	}); err != nil {
		t.Fatal(err)
	}

	now := time.Now().UTC()
	childSummary := flruntime.ThreadSummary{
		ID: identity.ThreadID(childThreadID), ParentThreadID: identity.ThreadID(parentThreadID), ParentTurnID: "turn-parent",
		TaskName: "review authority", TaskDescription: "check authority continuity", HostProfileRef: subagentAgentTypeReviewer,
		ForkMode: subagentContextModeMissionOnly, CreatedAt: now, UpdatedAt: now,
	}
	parentSummary := flruntime.ThreadSummary{ID: identity.ThreadID(parentThreadID), CreatedAt: now, UpdatedAt: now}
	childView := flruntime.ThreadView{ThreadID: identity.ThreadID(childThreadID), Activity: flruntime.ThreadActivityActive}
	sendKeys := make([]string, 0, 2)
	sendCount := 0
	var cancelAcceptedSend context.CancelFunc
	runtime := &authorityContinuityRuntime{}
	runtime.create = func(context.Context, flruntime.CreateThreadInput) (flruntime.ThreadView, error) {
		return childView, nil
	}
	runtime.setTitle = func(context.Context, flruntime.SetTitleInput) (flruntime.ThreadView, error) {
		return childView, nil
	}
	runtime.list = func(_ context.Context, scope flruntime.ThreadScope) ([]flruntime.ThreadSummary, error) {
		if scope.ParentID != nil {
			return []flruntime.ThreadSummary{childSummary}, nil
		}
		return []flruntime.ThreadSummary{parentSummary}, nil
	}
	runtime.view = func(_ context.Context, threadID identity.ThreadID) (flruntime.ThreadView, error) {
		if threadID == identity.ThreadID(childThreadID) {
			return childView, nil
		}
		return flruntime.ThreadView{ThreadID: threadID, Activity: flruntime.ThreadActivityActive}, nil
	}
	runtime.send = func(ctx context.Context, input flruntime.SendInput) (flruntime.ThreadView, error) {
		authority, err := store.GetExecutionAuthority(ctx, string(input.RequestKey))
		if err != nil {
			t.Fatal(err)
		}
		if authority == nil || authority.TurnID != "" || authority.UserPublicID != meta.UserPublicID {
			t.Fatalf("authority before child send=%#v", authority)
		}
		sendCount++
		sendKeys = append(sendKeys, string(input.RequestKey))
		childView.TurnID = identity.TurnID("turn-child-" + string(rune('0'+sendCount)))
		if cancelAcceptedSend != nil {
			cancelAcceptedSend()
		}
		return childView, nil
	}
	effects := newFloretEffectAdapter()
	svc := &Service{threadsDB: store, threadRuntime: runtime, floretEffects: effects}
	effects.bind(svc)
	parent := &run{
		sessionMeta: meta, threadID: parentThreadID, turnID: "turn-parent", endpointID: meta.EndpointID,
		currentModelID: "openai/gpt-5-mini", permissionType: FlowerPermissionApprovalRequired,
	}
	subagents := newServiceFloretSubagentRuntime(svc, parent)

	if _, err := subagents.spawn(ctx, "tool-spawn", map[string]any{
		"task_name": "review authority", "task_description": "check authority continuity", "message": "Review the child execution.",
		"agent_type": subagentAgentTypeReviewer, "context_mode": subagentContextModeMissionOnly,
	}); err != nil {
		t.Fatal(err)
	}
	spawnAuthority, err := store.GetExecutionAuthorityByTurn(ctx, childThreadID, "turn-child-1")
	if err != nil {
		t.Fatal(err)
	}
	if spawnAuthority == nil || spawnAuthority.RequestKey != sendKeys[0] {
		t.Fatalf("spawn authority=%#v, send_key=%q", spawnAuthority, sendKeys[0])
	}
	childSettings, err := store.GetThreadSettings(ctx, meta.EndpointID, childThreadID)
	if err != nil {
		t.Fatal(err)
	}
	if childSettings == nil || childSettings.PermissionType != permissionTypeString(FlowerPermissionReadonly) {
		t.Fatalf("reviewer child settings=%#v, want readonly permission", childSettings)
	}
	restored, err := svc.restoreFloretEffectRequest(ctx, flruntime.AgentRequest{
		ThreadID: identity.ThreadID(childThreadID), TurnID: "turn-child-1", RequestKey: sendKeys[0],
		Input: flruntime.UserInput{Text: "Review the child execution."},
	})
	if err != nil {
		t.Fatal(err)
	}
	if restored.meta.UserPublicID != meta.UserPublicID || restored.meta.EndpointID != meta.EndpointID || restored.meta.ChannelID != meta.ChannelID {
		t.Fatalf("restored child authority=%#v", restored.meta)
	}
	if !restored.req.Options.NoUserInteraction {
		t.Fatal("restored child execution allowed direct user interaction")
	}
	if restored.req.Options.PermissionType != permissionTypeString(FlowerPermissionReadonly) {
		t.Fatalf("restored child permission=%q, want readonly", restored.req.Options.PermissionType)
	}

	sendCtx, cancelSend := context.WithCancel(ctx)
	defer cancelSend()
	cancelAcceptedSend = cancelSend
	if _, err := subagents.sendInput(sendCtx, "tool-send", map[string]any{
		"target": childThreadID, "message": "Review the updated execution.",
	}); err != nil {
		t.Fatal(err)
	}
	sendAuthority, err := store.GetExecutionAuthorityByTurn(ctx, childThreadID, "turn-child-2")
	if err != nil {
		t.Fatal(err)
	}
	if sendAuthority == nil || sendAuthority.RequestKey != sendKeys[1] || sendAuthority.UserPublicID != meta.UserPublicID {
		t.Fatalf("send_input authority=%#v, send_key=%q", sendAuthority, sendKeys[1])
	}
}
