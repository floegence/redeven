package ai

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/floegence/floret/v7/identity"
	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/redeven/internal/ai/threadstore"
	"github.com/floegence/redeven/internal/session"
)

type authorityContinuityRuntime struct {
	flruntime.ThreadService
	create              func(context.Context, flruntime.CreateThreadInput) (flruntime.ThreadView, error)
	setTitle            func(context.Context, flruntime.SetTitleInput) (flruntime.ThreadView, error)
	list                func(context.Context, flruntime.ThreadScope) ([]flruntime.ThreadSummary, error)
	view                func(context.Context, identity.ThreadID) (flruntime.ThreadView, error)
	steer               func(context.Context, flruntime.SteerInput) (flruntime.ThreadView, error)
	lookupSend          func(context.Context, flruntime.LookupSendInput) (flruntime.UserInput, bool, error)
	send                func(context.Context, flruntime.SendInput) (flruntime.ThreadView, error)
	retry               func(context.Context, flruntime.RetryInput) (flruntime.ThreadView, error)
	importPendingInputs func(context.Context, flruntime.ImportPendingInputsInput) (flruntime.ImportResult, error)
}

func (runtime *authorityContinuityRuntime) SubscribeUpdates(ctx context.Context) (*flruntime.ThreadUpdateSubscription, error) {
	return runtime.ThreadService.(flruntime.ThreadUpdateSource).SubscribeUpdates(ctx)
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

func (runtime *authorityContinuityRuntime) LookupSend(ctx context.Context, input flruntime.LookupSendInput) (flruntime.UserInput, bool, error) {
	if runtime.lookupSend != nil {
		return runtime.lookupSend(ctx, input)
	}
	if runtime.ThreadService != nil {
		return runtime.ThreadService.(flruntime.ThreadSendReader).LookupSend(ctx, input)
	}
	return flruntime.UserInput{}, false, nil
}

func (runtime *authorityContinuityRuntime) Steer(ctx context.Context, input flruntime.SteerInput) (flruntime.ThreadView, error) {
	if runtime.steer != nil {
		return runtime.steer(ctx, input)
	}
	return runtime.ThreadService.(flruntime.ThreadSteeringController).Steer(ctx, input)
}
func (runtime *authorityContinuityRuntime) SteerQueued(ctx context.Context, input flruntime.SteerQueuedInput) (flruntime.ThreadView, error) {
	return runtime.ThreadService.(flruntime.ThreadSteeringController).SteerQueued(ctx, input)
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
		ModelID: "openai/gpt-5-mini", PermissionType: permissionTypeString(FlowerPermissionReadonly),
	}); err != nil {
		t.Fatal(err)
	}
	if err := store.PutExecutionAuthority(ctx, threadstore.ExecutionAuthority{
		RequestKey: "source-request", ThreadID: threadID, TurnID: "turn-source",
		EndpointID: meta.EndpointID, NamespacePublicID: meta.NamespacePublicID, ChannelID: meta.ChannelID,
		PermissionType: "approval_required", UserPublicID: meta.UserPublicID, UserEmail: meta.UserEmail,
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
		if persisted == nil || persisted.TurnID != input.SourceTurnID.String() || persisted.UserPublicID != meta.UserPublicID || persisted.PermissionType != "approval_required" {
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
		if authority == nil || authority.UserPublicID != meta.UserPublicID || authority.EndpointID != meta.EndpointID || authority.PermissionType != "approval_required" {
			t.Fatalf("retry %d turn authority=%#v", index+1, authority)
		}
	}
}

func TestSubagentInputsPersistAuthorityBeforeSendAndRestoreAutonomousOptions(t *testing.T) {
	ctx := t.Context()
	const parentThreadID = "thread_parent_authority"
	const childThreadID = "thread_child_authority"
	const delegatedMessage = "\n  Review the child execution.\n\nKeep the task text verbatim.  \n"
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
		TaskName: "review authority", TaskDescription: "check authority continuity",
		ForkMode: subagentContextModeMissionOnly, CreatedAt: now, UpdatedAt: now,
	}
	parentSummary := flruntime.ThreadSummary{ID: identity.ThreadID(parentThreadID), CreatedAt: now, UpdatedAt: now}
	childView := flruntime.ThreadView{ThreadID: identity.ThreadID(childThreadID), Activity: flruntime.ThreadActivityActive}
	sendKeys := make([]string, 0, 2)
	sendCount := 0
	listCount := 0
	viewCount := 0
	setTitleCount := 0
	var cancelAcceptedSend context.CancelFunc
	runtime := &authorityContinuityRuntime{}
	var createdHostProfileRef string
	runtime.create = func(_ context.Context, input flruntime.CreateThreadInput) (flruntime.ThreadView, error) {
		createdHostProfileRef = input.HostProfileRef
		return childView, nil
	}
	runtime.setTitle = func(context.Context, flruntime.SetTitleInput) (flruntime.ThreadView, error) {
		setTitleCount++
		return childView, nil
	}
	runtime.list = func(_ context.Context, scope flruntime.ThreadScope) ([]flruntime.ThreadSummary, error) {
		listCount++
		if scope.ParentID != nil {
			return []flruntime.ThreadSummary{childSummary}, nil
		}
		return []flruntime.ThreadSummary{parentSummary}, nil
	}
	runtime.view = func(_ context.Context, threadID identity.ThreadID) (flruntime.ThreadView, error) {
		viewCount++
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
		if sendCount == 0 && input.Input.Text != delegatedMessage {
			t.Fatalf("delegation changed parent instructions: %q", input.Input.Text)
		}
		if sendCount == 1 {
			if input.Input.Text != " \nReview the updated execution.\n" {
				t.Fatalf("send_input changed parent instructions: %q", input.Input.Text)
			}
			authority, err := store.GetExecutionAuthority(ctx, string(input.RequestKey))
			if err != nil {
				t.Fatal(err)
			}
			if authority == nil || authority.PermissionType != permissionTypeString(FlowerPermissionFullAccess) {
				t.Fatalf("send_input authority before steering=%#v", authority)
			}
		}
		sendCount++
		sendKeys = append(sendKeys, string(input.RequestKey))
		childView.TurnID = identity.TurnID("turn-child-" + string(rune('0'+sendCount)))
		childView.Items = append(childView.Items, flruntime.ThreadItem{ID: "user:" + string(input.RequestKey), TurnID: childView.TurnID, Kind: flruntime.ThreadItemUser, Text: input.Input.Text})
		if cancelAcceptedSend != nil {
			cancelAcceptedSend()
		}
		return childView, nil
	}
	runtime.steer = func(ctx context.Context, input flruntime.SteerInput) (flruntime.ThreadView, error) {
		return runtime.send(ctx, flruntime.SendInput{ThreadID: input.ThreadID, Input: input.Input, RequestKey: input.RequestKey})
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
		"task_name": "review authority", "task_description": "check authority continuity", "message": delegatedMessage,
		"context_mode": subagentContextModeMissionOnly,
	}); err != nil {
		t.Fatal(err)
	}
	if createdHostProfileRef != "flower" {
		t.Fatalf("new child host profile=%q, want the shared flower host profile", createdHostProfileRef)
	}
	if listCount != 0 || viewCount != 0 || setTitleCount != 0 {
		t.Fatalf("spawn post-admission reads: list=%d view=%d set_title=%d, want zero", listCount, viewCount, setTitleCount)
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
	if childSettings == nil || childSettings.PermissionType != permissionTypeString(FlowerPermissionApprovalRequired) {
		t.Fatalf("child settings=%#v, want inherited approval_required permission", childSettings)
	}
	restored, err := svc.restoreFloretEffectRequest(ctx, flruntime.AgentRequest{
		ThreadID: identity.ThreadID(childThreadID), TurnID: "turn-child-1", RequestKey: sendKeys[0],
		Input: flruntime.UserInput{Text: delegatedMessage}, CanonicalTurnInput: flruntime.UserInput{Text: delegatedMessage},
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
	if restored.req.Options.PermissionType != permissionTypeString(FlowerPermissionApprovalRequired) {
		t.Fatalf("restored child permission=%q, want approval_required", restored.req.Options.PermissionType)
	}

	if err := store.UpdateThreadModelID(ctx, meta.EndpointID, childThreadID, "anthropic/claude-sonnet"); err != nil {
		t.Fatal(err)
	}
	if err := store.UpdateThreadPermissionType(ctx, meta.EndpointID, childThreadID, permissionTypeString(FlowerPermissionFullAccess)); err != nil {
		t.Fatal(err)
	}
	childSummary.HostProfileRef = "reviewer" // Historical metadata must not override current child settings.
	sendCtx, cancelSend := context.WithCancel(ctx)
	defer cancelSend()
	cancelAcceptedSend = cancelSend
	if _, err := subagents.sendInput(sendCtx, "tool-send", map[string]any{
		"target": childThreadID, "message": " \nReview the updated execution.\n",
	}); err != nil {
		t.Fatal(err)
	}
	if listCount != 1 || viewCount != 1 {
		t.Fatalf("send_input reads: list=%d view=%d, want one pre-effect list and view", listCount, viewCount)
	}
	sendAuthority, err := store.GetExecutionAuthority(ctx, sendKeys[1])
	if err != nil {
		t.Fatal(err)
	}
	if sendAuthority == nil || sendAuthority.RequestKey != sendKeys[1] || sendAuthority.UserPublicID != meta.UserPublicID || sendAuthority.PermissionType != permissionTypeString(FlowerPermissionFullAccess) {
		t.Fatalf("send_input authority=%#v, send_key=%q", sendAuthority, sendKeys[1])
	}
	restoredSteering, err := svc.restoreFloretEffectRequest(ctx, flruntime.AgentRequest{
		ThreadID: identity.ThreadID(childThreadID), TurnID: "turn-child-2", RequestKey: sendKeys[1],
		Input:              flruntime.UserInput{Text: " \nReview the updated execution.\n"},
		CanonicalTurnInput: flruntime.UserInput{Text: " \nReview the updated execution.\n"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if restoredSteering.req.Model != "anthropic/claude-sonnet" || restoredSteering.req.Options.PermissionType != permissionTypeString(FlowerPermissionFullAccess) {
		t.Fatalf("restored steering settings=%#v", restoredSteering.req)
	}
}

func TestNewSubagentSettingsInheritEveryParentPermissionMode(t *testing.T) {
	ctx := t.Context()
	meta := &session.Meta{
		EndpointID: "endpoint_subagent_modes", NamespacePublicID: "namespace_subagent_modes",
		UserPublicID: "user_subagent_modes", CanRead: true, CanWrite: true, CanExecute: true,
	}
	for _, permission := range []FlowerPermissionType{
		FlowerPermissionReadonly,
		FlowerPermissionApprovalRequired,
		FlowerPermissionFullAccess,
	} {
		t.Run(permissionTypeString(permission), func(t *testing.T) {
			store := newAuthorityContinuityStore(t)
			if err := store.CreateThreadSettings(ctx, threadstore.ThreadSettings{
				ThreadID: "parent-" + permissionTypeString(permission), EndpointID: meta.EndpointID,
				NamespacePublicID: meta.NamespacePublicID, ModelID: "openai/gpt-5-mini",
				PermissionType: permissionTypeString(permission),
			}); err != nil {
				t.Fatal(err)
			}
			service := &Service{threadsDB: store}
			parent := &run{
				endpointID: meta.EndpointID, threadID: "parent-" + permissionTypeString(permission),
				permissionType: permission,
			}
			childID := "child-" + permissionTypeString(permission)
			if err := service.ensureChildThreadSettings(ctx, parent, childID, parent.threadID); err != nil {
				t.Fatal(err)
			}
			child, err := store.GetThreadSettings(ctx, meta.EndpointID, childID)
			if err != nil || child == nil || child.PermissionType != permissionTypeString(permission) {
				t.Fatalf("child settings=%#v err=%v, want %q", child, err, permission)
			}
		})
	}
}

func TestHistoricalSubagentSpawnReplayKeepsOriginalInputAndPermission(t *testing.T) {
	ctx := t.Context()
	const parentThreadID = "thread_parent_legacy_spawn"
	const childThreadID = "thread_child_legacy_spawn"
	const toolCallID = "legacy-spawn-call"
	const oldChildInput = "# Delegated Mission\nReview the original request.\n\n# Role\nReviewer: independently inspect evidence."
	meta := &session.Meta{
		EndpointID: "endpoint_legacy_spawn", NamespacePublicID: "namespace_legacy_spawn",
		UserPublicID: "user_legacy_spawn", CanRead: true, CanWrite: true, CanExecute: true,
	}
	store := newAuthorityContinuityStore(t)
	for _, settings := range []threadstore.ThreadSettings{
		{ThreadID: parentThreadID, EndpointID: meta.EndpointID, NamespacePublicID: meta.NamespacePublicID, ModelID: "openai/gpt-5-mini", PermissionType: permissionTypeString(FlowerPermissionFullAccess)},
		{ThreadID: childThreadID, EndpointID: meta.EndpointID, NamespacePublicID: meta.NamespacePublicID, ModelID: "openai/gpt-5-mini", PermissionType: permissionTypeString(FlowerPermissionReadonly), ParentThreadID: parentThreadID},
	} {
		if err := store.CreateThreadSettings(ctx, settings); err != nil {
			t.Fatal(err)
		}
	}
	publicationID, err := subagentPublicationID(parentThreadID, "turn-parent-legacy", toolCallID)
	if err != nil {
		t.Fatal(err)
	}
	sendKey := publicationID + ":input"
	view := flruntime.ThreadView{
		ThreadID: identity.ThreadID(childThreadID), TurnID: "turn-legacy-child",
		Activity: flruntime.ThreadActivityActive,
		Items: []flruntime.ThreadItem{{
			ID: "user:" + sendKey, TurnID: "turn-legacy-child", Kind: flruntime.ThreadItemUser, Text: oldChildInput,
		}},
	}
	threadRuntime := &authorityContinuityRuntime{}
	threadRuntime.lookupSend = func(_ context.Context, input flruntime.LookupSendInput) (flruntime.UserInput, bool, error) {
		if input.ThreadID != view.ThreadID || input.RequestKey != flruntime.RequestKey(sendKey) {
			t.Fatalf("historical input lookup=%+v", input)
		}
		return flruntime.UserInput{Text: oldChildInput}, true, nil
	}
	var originalHostProfileRef string
	threadRuntime.create = func(_ context.Context, input flruntime.CreateThreadInput) (flruntime.ThreadView, error) {
		originalHostProfileRef = input.HostProfileRef
		return view, nil
	}
	threadRuntime.send = func(context.Context, flruntime.SendInput) (flruntime.ThreadView, error) {
		t.Fatal("historical spawn replay resubmitted its already-admitted child input")
		return flruntime.ThreadView{}, nil
	}
	service := &Service{threadsDB: store, threadRuntime: threadRuntime, floretEffects: newFloretEffectAdapter()}
	parent := &run{
		sessionMeta: meta, endpointID: meta.EndpointID, threadID: parentThreadID, turnID: "turn-parent-legacy",
		currentModelID: "anthropic/claude-sonnet", permissionType: FlowerPermissionFullAccess,
	}
	result, err := newServiceFloretSubagentRuntime(service, parent).spawn(ctx, toolCallID, map[string]any{
		"task_name": "Release review", "task_description": "Review the original request.",
		"message": "Review the original request.", "agent_type": "reviewer",
		"context_mode": subagentContextModeMissionOnly,
	})
	if err != nil {
		t.Fatal(err)
	}
	if originalHostProfileRef != "reviewer" {
		t.Fatalf("historical create profile=%q, want the original fingerprint input", originalHostProfileRef)
	}
	if result["accepted"] != true {
		t.Fatalf("historical spawn result=%#v", result)
	}
	if _, exists := result["agent_type"]; exists {
		t.Fatalf("historical role leaked into the new result projection: %#v", result)
	}
	child, err := store.GetThreadSettings(ctx, meta.EndpointID, childThreadID)
	if err != nil || child == nil || child.PermissionType != permissionTypeString(FlowerPermissionReadonly) {
		t.Fatalf("historical child permission changed: %#v err=%v", child, err)
	}
}

func (runtime *authorityContinuityRuntime) Context(ctx context.Context, threadID identity.ThreadID) (flruntime.ThreadContextSnapshot, error) {
	return runtime.ThreadService.(flruntime.ThreadContextReader).Context(ctx, threadID)
}
