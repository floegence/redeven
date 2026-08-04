package ai

import (
	"context"
	"errors"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	flconfig "github.com/floegence/floret/v3/config"
	"github.com/floegence/floret/v3/florettest"
	"github.com/floegence/floret/v3/identity"
	flprovider "github.com/floegence/floret/v3/provider"
	flruntime "github.com/floegence/floret/v3/runtime"
	flstorage "github.com/floegence/floret/v3/storage"
	"github.com/floegence/redeven/internal/ai/threadstore"
)

type scriptedInterruptedTurnRecoveryHost struct {
	mu      sync.Mutex
	errors  []error
	calls   int
	results []flruntime.RecoverInterruptedTurnResult
}

type scriptedInterruptedTurnRecoveryFactory struct {
	mu     sync.Mutex
	host   floretInterruptedTurnRecoveryHost
	errors []error
	calls  int
}

func (f *scriptedInterruptedTurnRecoveryFactory) NewHost(context.Context) (floretInterruptedTurnRecoveryHost, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	index := f.calls
	f.calls++
	if index < len(f.errors) && f.errors[index] != nil {
		return nil, f.errors[index]
	}
	return f.host, nil
}

func (h *scriptedInterruptedTurnRecoveryHost) Recover(context.Context) (flruntime.RecoverInterruptedTurnResult, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	index := h.calls
	h.calls++
	if index < len(h.errors) && h.errors[index] != nil {
		return flruntime.RecoverInterruptedTurnResult{}, h.errors[index]
	}
	if index < len(h.results) {
		return h.results[index], nil
	}
	return flruntime.RecoverInterruptedTurnResult{}, nil
}

type startupRecoverySubagentReadHost struct {
	snapshots []flruntime.SubAgentSnapshot
}

type delayedStartupRecoverySubagentReadHost struct {
	delay time.Duration
}

type scriptedFloretRootInventory struct {
	mu       sync.Mutex
	pages    []floretRootThreadsPage
	requests []floretListRootThreadsRequest
}

func (i *scriptedFloretRootInventory) ListRootThreads(_ context.Context, req floretListRootThreadsRequest) (floretRootThreadsPage, error) {
	i.mu.Lock()
	defer i.mu.Unlock()
	index := len(i.requests)
	i.requests = append(i.requests, req)
	if index >= len(i.pages) {
		return floretRootThreadsPage{}, errors.New("unexpected root inventory page")
	}
	return i.pages[index], nil
}

type lifecycleBoundStartupRecoveryHost struct {
	mu                 sync.Mutex
	calls              int
	backgroundStarted  chan struct{}
	backgroundCanceled chan struct{}
}

func (h *lifecycleBoundStartupRecoveryHost) Recover(ctx context.Context) (flruntime.RecoverInterruptedTurnResult, error) {
	h.mu.Lock()
	h.calls++
	call := h.calls
	h.mu.Unlock()
	if call == 1 {
		return flruntime.RecoverInterruptedTurnResult{}, flruntime.ErrThreadBusy
	}
	close(h.backgroundStarted)
	<-ctx.Done()
	close(h.backgroundCanceled)
	return flruntime.RecoverInterruptedTurnResult{}, ctx.Err()
}

func (h startupRecoverySubagentReadHost) ListSubAgents(context.Context) ([]flruntime.SubAgentSnapshot, error) {
	return append([]flruntime.SubAgentSnapshot(nil), h.snapshots...), nil
}

func (h delayedStartupRecoverySubagentReadHost) ListSubAgents(ctx context.Context) ([]flruntime.SubAgentSnapshot, error) {
	select {
	case <-time.After(h.delay):
		return nil, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

func (delayedStartupRecoverySubagentReadHost) ListThreadTurns(context.Context, identity.ThreadID, flruntime.ThreadTurnsRequest) (flruntime.ThreadTurnsPage, error) {
	return flruntime.ThreadTurnsPage{}, errors.New("unexpected SubAgent turn read")
}

func (delayedStartupRecoverySubagentReadHost) ReadThreadTurn(context.Context, identity.ThreadID, identity.TurnID) (flruntime.ThreadTurnSnapshot, error) {
	return flruntime.ThreadTurnSnapshot{}, errors.New("unexpected SubAgent exact turn read")
}

func (delayedStartupRecoverySubagentReadHost) ReadSubAgentDetail(context.Context, identity.ThreadID, flruntime.ThreadDetailRequest) (flruntime.SubAgentDetail, error) {
	return flruntime.SubAgentDetail{}, errors.New("unexpected SubAgent detail read")
}

func (startupRecoverySubagentReadHost) ListThreadTurns(context.Context, identity.ThreadID, flruntime.ThreadTurnsRequest) (flruntime.ThreadTurnsPage, error) {
	return flruntime.ThreadTurnsPage{}, errors.New("unexpected SubAgent turn read")
}

func (startupRecoverySubagentReadHost) ReadThreadTurn(context.Context, identity.ThreadID, identity.TurnID) (flruntime.ThreadTurnSnapshot, error) {
	return flruntime.ThreadTurnSnapshot{}, errors.New("unexpected SubAgent exact turn read")
}

func (startupRecoverySubagentReadHost) ReadSubAgentDetail(context.Context, identity.ThreadID, flruntime.ThreadDetailRequest) (flruntime.SubAgentDetail, error) {
	return flruntime.SubAgentDetail{}, errors.New("unexpected SubAgent detail read")
}

func newStartupRecoveryTestStore(t *testing.T, settings ...threadstore.ThreadSettings) *threadstore.Store {
	t.Helper()
	store, err := threadstore.Open(filepath.Join(t.TempDir(), "threads.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	for _, item := range settings {
		if err := store.CreateThreadSettings(context.Background(), item); err != nil {
			t.Fatal(err)
		}
	}
	return store
}

func TestFloretStartupInventoryReconcilesPagedCanonicalAndProductRoots(t *testing.T) {
	t.Parallel()

	store := newStartupRecoveryTestStore(t, threadstore.ThreadSettings{
		EndpointID: "env_inventory", ThreadID: "root_product", PermissionType: "approval_required",
	})
	now := time.Now().UTC()
	inventory := &scriptedFloretRootInventory{pages: []floretRootThreadsPage{
		{
			Threads: []flruntime.ThreadSnapshot{{
				ID: "root_product", CreatedAt: now, UpdatedAt: now,
				Phase: flruntime.ThreadPhaseIdle, Status: flruntime.ThreadStatusIdle, CanAppendMessage: true,
			}},
			NextCursor: "opaque-root-page-2", HasMore: true,
		},
		{
			Threads: []flruntime.ThreadSnapshot{{
				ID: "root_orphan", CreatedAt: now.Add(-time.Second), UpdatedAt: now.Add(-time.Second),
				Phase: flruntime.ThreadPhaseIdle, Status: flruntime.ThreadStatusIdle, CanAppendMessage: true,
			}},
		},
	}}
	reconciliation, err := reconcileFloretRootThreadInventory(context.Background(), store, inventory)
	if err != nil {
		t.Fatalf("reconcile root inventory: %v", err)
	}
	if got := reconciliation.RootThreadIDs; len(got) != 2 || got[0] != "root_product" || got[1] != "root_orphan" {
		t.Fatalf("canonical roots=%v", got)
	}
	if got := reconciliation.OrphanedRootThreadIDs; len(got) != 1 || got[0] != "root_orphan" {
		t.Fatalf("orphaned roots=%v", got)
	}
	inventory.mu.Lock()
	requests := append([]floretListRootThreadsRequest(nil), inventory.requests...)
	inventory.mu.Unlock()
	if len(requests) != 2 || requests[0].Cursor != "" || requests[1].Cursor != "opaque-root-page-2" {
		t.Fatalf("inventory requests=%#v", requests)
	}
}

func TestFloretStartupInventoryRejectsProductOnlyRoot(t *testing.T) {
	t.Parallel()

	store := newStartupRecoveryTestStore(t, threadstore.ThreadSettings{
		EndpointID: "env_inventory", ThreadID: "root_missing", PermissionType: "approval_required",
	})
	inventory := &scriptedFloretRootInventory{pages: []floretRootThreadsPage{{}}}
	if _, err := reconcileFloretRootThreadInventory(context.Background(), store, inventory); err == nil || !strings.Contains(err.Error(), "root_missing") {
		t.Fatalf("error=%v, want settings-only canonical integrity failure", err)
	}
}

func TestFloretStartupInventoryRejectsNonAdvancingCanonicalCursor(t *testing.T) {
	t.Parallel()

	store := newStartupRecoveryTestStore(t)
	now := time.Now().UTC()
	inventory := &scriptedFloretRootInventory{pages: []floretRootThreadsPage{
		{
			Threads: []flruntime.ThreadSnapshot{{
				ID: "root_page", CreatedAt: now, UpdatedAt: now,
				Phase: flruntime.ThreadPhaseIdle, Status: flruntime.ThreadStatusIdle, CanAppendMessage: true,
			}},
			NextCursor: "opaque-page", HasMore: true,
		},
		{
			Threads: []flruntime.ThreadSnapshot{{
				ID: "root_page_2", CreatedAt: now.Add(-time.Second), UpdatedAt: now.Add(-time.Second),
				Phase: flruntime.ThreadPhaseIdle, Status: flruntime.ThreadStatusIdle, CanAppendMessage: true,
			}},
			NextCursor: "opaque-page", HasMore: true,
		},
	}}
	if _, err := reconcileFloretRootThreadInventory(context.Background(), store, inventory); err == nil || !strings.Contains(err.Error(), "did not advance") {
		t.Fatalf("error=%v, want non-advancing cursor failure", err)
	}
}

func TestFloretStartupRecoveryRetriesBusyExactLeaseWithoutRuntimeFallback(t *testing.T) {
	host := &scriptedInterruptedTurnRecoveryHost{errors: []error{flruntime.ErrThreadBusy, nil}}
	factory := &scriptedInterruptedTurnRecoveryFactory{host: host}
	bindCalls := 0
	capabilities := floretStartupRecoveryCapabilities{
		candidates: func(context.Context) ([]flruntime.InterruptedTurnRecoveryCandidate, error) {
			return []flruntime.InterruptedTurnRecoveryCandidate{{ThreadID: "thread_recovery"}}, nil
		},
		root: func(_ context.Context, threadID identity.ThreadID) (floretInterruptedTurnRecoveryHostFactory, error) {
			bindCalls++
			if threadID != "thread_recovery" {
				t.Fatalf("root recovery thread=%q", threadID)
			}
			return factory, nil
		},
		subagent: func(context.Context, identity.ThreadID, identity.ThreadID) (floretInterruptedTurnRecoveryHostFactory, error) {
			t.Fatal("unexpected child recovery")
			return nil, nil
		},
	}
	targets, err := buildFloretStartupRecoveryTargets(context.Background(), []identity.ThreadID{"thread_recovery"}, capabilities)
	if err != nil {
		t.Fatal(err)
	}
	first, err := recoverInterruptedFloretTurns(context.Background(), targets)
	if err != nil {
		t.Fatal(err)
	}
	if !first.pending || first.recovered != 0 {
		t.Fatalf("first recovery=%+v, want pending exact lease", first)
	}
	second, err := recoverInterruptedFloretTurns(context.Background(), targets)
	if err != nil {
		t.Fatal(err)
	}
	if second.pending || second.recovered != 1 {
		t.Fatalf("second recovery=%+v, want one recovered turn", second)
	}
	if bindCalls != 1 || factory.calls != 2 {
		t.Fatalf("bind calls=%d factory NewHost calls=%d, want 1 and 2", bindCalls, factory.calls)
	}
}

func TestFloretStartupRecoveryUsesOnlyPublishedCandidateIdentities(t *testing.T) {
	var rootBinds int
	var childBinds int
	capabilities := floretStartupRecoveryCapabilities{
		candidates: func(context.Context) ([]flruntime.InterruptedTurnRecoveryCandidate, error) {
			return []flruntime.InterruptedTurnRecoveryCandidate{
				{ThreadID: "root-a"},
				{ThreadID: "child-b", ParentThreadID: "root-a"},
			}, nil
		},
		root: func(_ context.Context, threadID identity.ThreadID) (floretInterruptedTurnRecoveryHostFactory, error) {
			rootBinds++
			if threadID != "root-a" {
				t.Fatalf("unexpected root bind %q", threadID)
			}
			return nil, flruntime.ErrInterruptedTurnNotFound
		},
		subagent: func(_ context.Context, parentThreadID, childThreadID identity.ThreadID) (floretInterruptedTurnRecoveryHostFactory, error) {
			childBinds++
			if parentThreadID != "root-a" || childThreadID != "child-b" {
				t.Fatalf("unexpected child bind parent=%q child=%q", parentThreadID, childThreadID)
			}
			return nil, flruntime.ErrInterruptedTurnNotFound
		},
	}
	targets, err := buildFloretStartupRecoveryTargets(context.Background(), []identity.ThreadID{"root-a", "root-unused"}, capabilities)
	if err != nil {
		t.Fatal(err)
	}
	if len(targets) != 0 || rootBinds != 1 || childBinds != 1 {
		t.Fatalf("targets=%#v root binds=%d child binds=%d, want no targets and one exact bind each", targets, rootBinds, childBinds)
	}

	var unexpectedBind bool
	empty := floretStartupRecoveryCapabilities{
		candidates: func(context.Context) ([]flruntime.InterruptedTurnRecoveryCandidate, error) { return nil, nil },
		root: func(context.Context, identity.ThreadID) (floretInterruptedTurnRecoveryHostFactory, error) {
			unexpectedBind = true
			return nil, nil
		},
		subagent: func(context.Context, identity.ThreadID, identity.ThreadID) (floretInterruptedTurnRecoveryHostFactory, error) {
			unexpectedBind = true
			return nil, nil
		},
	}
	targets, err = buildFloretStartupRecoveryTargets(context.Background(), []identity.ThreadID{"root-a"}, empty)
	if err != nil || len(targets) != 0 || unexpectedBind {
		t.Fatalf("empty candidate scan targets=%#v err=%v unexpectedBind=%v", targets, err, unexpectedBind)
	}
}

func TestFloretStartupRecoveryUsesPerOperationTimeoutAcrossLargeInventory(t *testing.T) {
	t.Parallel()

	const operationDelay = 8 * time.Millisecond
	const operationTimeout = 25 * time.Millisecond
	wait := func(ctx context.Context) error {
		select {
		case <-time.After(operationDelay):
			return nil
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	capabilities := floretStartupRecoveryCapabilities{
		candidates: func(ctx context.Context) ([]flruntime.InterruptedTurnRecoveryCandidate, error) {
			if err := wait(ctx); err != nil {
				return nil, err
			}
			return nil, nil
		},
		root: func(ctx context.Context, _ identity.ThreadID) (floretInterruptedTurnRecoveryHostFactory, error) {
			if err := wait(ctx); err != nil {
				return nil, err
			}
			return nil, flruntime.ErrInterruptedTurnNotFound
		},
		subagent: func(context.Context, identity.ThreadID, identity.ThreadID) (floretInterruptedTurnRecoveryHostFactory, error) {
			t.Fatal("empty candidate inventory must not bind child recovery")
			return nil, nil
		},
	}

	started := time.Now()
	targets, err := buildFloretStartupRecoveryTargetsWithOperationTimeout(
		context.Background(),
		[]identity.ThreadID{"root_a", "root_b"},
		capabilities,
		operationTimeout,
	)
	if err != nil {
		t.Fatalf("build recovery targets: %v", err)
	}
	if len(targets) != 0 {
		t.Fatalf("recovery targets=%d, want 0", len(targets))
	}
	if elapsed := time.Since(started); elapsed >= operationTimeout {
		t.Fatalf("elapsed=%s, want one candidate scan below its operation timeout", elapsed)
	}
}

func TestFloretStartupRecoveryRejectsOperationExceedingTimeout(t *testing.T) {
	t.Parallel()

	_, err := buildFloretStartupRecoveryTargetsWithOperationTimeout(
		context.Background(),
		[]identity.ThreadID{"slow_root"},
		floretStartupRecoveryCapabilities{
			candidates: func(ctx context.Context) ([]flruntime.InterruptedTurnRecoveryCandidate, error) {
				<-ctx.Done()
				return nil, ctx.Err()
			},
			root: func(ctx context.Context, _ identity.ThreadID) (floretInterruptedTurnRecoveryHostFactory, error) {
				<-ctx.Done()
				return nil, ctx.Err()
			},
			subagent: func(context.Context, identity.ThreadID, identity.ThreadID) (floretInterruptedTurnRecoveryHostFactory, error) {
				t.Fatal("timed-out root must not bind child recovery")
				return nil, nil
			},
		},
		10*time.Millisecond,
	)
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("error=%v, want context deadline exceeded", err)
	}
}

func TestFloretStartupRecoveryCloseCancelsLifecycleBoundBackgroundAttempt(t *testing.T) {
	lifecycleCtx, lifecycleCancel := context.WithCancel(context.Background())
	host := &lifecycleBoundStartupRecoveryHost{
		backgroundStarted:  make(chan struct{}),
		backgroundCanceled: make(chan struct{}),
	}
	factory := &scriptedInterruptedTurnRecoveryFactory{host: host}
	svc := &Service{
		persistOpTO:     5 * time.Second,
		recoveryStopCh:  make(chan struct{}),
		lifecycleCtx:    lifecycleCtx,
		lifecycleCancel: lifecycleCancel,
	}
	if err := svc.startFloretStartupRecovery(context.Background(), []floretStartupRecoveryTarget{{
		description: "lifecycle-bound root",
		factory:     factory,
	}}); err != nil {
		t.Fatalf("start recovery: %v", err)
	}

	select {
	case <-host.backgroundStarted:
	case <-time.After(2 * floretStartupRecoveryRetryInterval):
		t.Fatal("background recovery attempt did not start")
	}
	closed := make(chan error, 1)
	go func() { closed <- svc.Close() }()
	select {
	case err := <-closed:
		if err != nil {
			t.Fatalf("close service: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("service close did not stop background recovery")
	}
	select {
	case <-host.backgroundCanceled:
	default:
		t.Fatal("background recovery did not observe lifecycle cancellation")
	}
}

func TestFloretStartupRecoveryBindsChildToExactCanonicalParent(t *testing.T) {
	childHost := &scriptedInterruptedTurnRecoveryHost{}
	childFactory := &scriptedInterruptedTurnRecoveryFactory{host: childHost}
	capabilities := floretStartupRecoveryCapabilities{
		candidates: func(context.Context) ([]flruntime.InterruptedTurnRecoveryCandidate, error) {
			return []flruntime.InterruptedTurnRecoveryCandidate{{ThreadID: "child_recovery", ParentThreadID: "parent_recovery"}}, nil
		},
		root: func(context.Context, identity.ThreadID) (floretInterruptedTurnRecoveryHostFactory, error) {
			return nil, flruntime.ErrInterruptedTurnNotFound
		},
		subagent: func(_ context.Context, parentThreadID identity.ThreadID, childThreadID identity.ThreadID) (floretInterruptedTurnRecoveryHostFactory, error) {
			if parentThreadID != "parent_recovery" || childThreadID != "child_recovery" {
				t.Fatalf("child recovery authority parent=%q child=%q", parentThreadID, childThreadID)
			}
			return childFactory, nil
		},
	}
	targets, err := buildFloretStartupRecoveryTargets(context.Background(), []identity.ThreadID{"parent_recovery"}, capabilities)
	if err != nil {
		t.Fatal(err)
	}
	result, err := recoverInterruptedFloretTurns(context.Background(), targets)
	if err != nil {
		t.Fatal(err)
	}
	if result.pending || result.recovered != 1 {
		t.Fatalf("recovery=%+v, want exact child recovery", result)
	}
}

func TestFloretStartupRecoverySkipsClosedDirectChild(t *testing.T) {
	ctx := context.Background()
	host := openTestFloretRuntimeHost(t, flstorage.Memory())
	created, err := host.Threads().CreateThread(ctx, flruntime.CreateThreadCommand{LogicalRequestID: "create_recovery_parent"})
	if err != nil {
		t.Fatal(err)
	}
	parent, err := host.Thread(ctx, created.ThreadID)
	if err != nil {
		t.Fatal(err)
	}
	gateway := florettest.NewScriptedGateway(
		flprovider.Identity{Provider: "test", Model: "model", StateCompatibilityKey: "test:model:v1"},
		flprovider.Capabilities{Reasoning: flprovider.ReasoningUnsupported, AttachmentPayload: flprovider.AttachmentDescriptors},
		florettest.Step{Events: []flprovider.Event{{Type: flprovider.EventDelta, Text: "done"}, {Type: flprovider.EventDone}}},
	)
	agent, err := flruntime.NewAgent(flconfig.AgentConfig{
		Profile: flconfig.AgentProfile{ID: "assistant", Name: "Assistant"}, SystemPrompt: "Complete the delegated task.",
		Context: flconfig.ContextPolicy{ContextWindowTokens: flconfig.DefaultContextWindowTokens},
	}, gateway)
	if err != nil {
		t.Fatal(err)
	}
	manager, err := parent.SubAgentManager(ctx, agent)
	if err != nil {
		t.Fatal(err)
	}
	spawned, err := manager.SpawnSubAgent(ctx, flruntime.SpawnSubAgentCommand{
		LogicalRequestID: "spawn_recovery_child", TaskName: "recovery_child",
		Input: flruntime.TurnInput{Text: "finish"}, ForkMode: flruntime.SubAgentForkNone,
	})
	if err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		children, listErr := manager.List(ctx)
		if listErr != nil {
			t.Fatal(listErr)
		}
		if slices.ContainsFunc(children, func(child flruntime.SubAgentSnapshot) bool {
			return child.ThreadID == spawned.Child.ThreadID && child.Status == flruntime.SubAgentStatusCompleted
		}) {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	closed, err := manager.CloseSubAgent(ctx, flruntime.CloseSubAgentCommand{
		LogicalRequestID: "close_recovery_child",
		ChildThreadID:    spawned.Child.ThreadID,
		Reason:           "parent_terminal",
	})
	if err != nil {
		t.Fatal(err)
	}
	if !closed.Child.Closed || closed.Child.Status != flruntime.SubAgentStatusClosed {
		t.Fatalf("closed child=%#v", closed.Child)
	}

	_, recovery, err := configureFloretRuntime(host)
	if err != nil {
		t.Fatal(err)
	}
	targets, err := buildFloretStartupRecoveryTargets(ctx, []identity.ThreadID{created.ThreadID}, recovery)
	if err != nil {
		t.Fatalf("build recovery targets for root with closed direct child: %v", err)
	}
	if len(targets) != 0 {
		t.Fatalf("closed root tree recovery targets=%d, want 0", len(targets))
	}
}

func TestFloretStartupRecoveryDoesNotRebindDirectChildrenAsRoots(t *testing.T) {
	t.Parallel()

	var bound [][2]identity.ThreadID
	capabilities := floretStartupRecoveryCapabilities{
		candidates: func(context.Context) ([]flruntime.InterruptedTurnRecoveryCandidate, error) {
			return []flruntime.InterruptedTurnRecoveryCandidate{{ThreadID: "child_nested", ParentThreadID: "root_nested"}}, nil
		},
		root: func(context.Context, identity.ThreadID) (floretInterruptedTurnRecoveryHostFactory, error) {
			return nil, flruntime.ErrInterruptedTurnNotFound
		},
		subagent: func(_ context.Context, parentThreadID identity.ThreadID, childThreadID identity.ThreadID) (floretInterruptedTurnRecoveryHostFactory, error) {
			bound = append(bound, [2]identity.ThreadID{parentThreadID, childThreadID})
			return nil, flruntime.ErrInterruptedTurnNotFound
		},
	}
	if _, err := buildFloretStartupRecoveryTargets(context.Background(), []identity.ThreadID{"root_nested"}, capabilities); err != nil {
		t.Fatalf("build nested startup recovery targets: %v", err)
	}
	if want := [][2]identity.ThreadID{{"root_nested", "child_nested"}}; !slices.Equal(bound, want) {
		t.Fatalf("bound direct children=%v, want %v", bound, want)
	}
}

func TestFloretStartupRecoveryRejectsRootReusedAsDescendant(t *testing.T) {
	t.Parallel()
	capabilities := floretStartupRecoveryCapabilities{
		candidates: func(context.Context) ([]flruntime.InterruptedTurnRecoveryCandidate, error) {
			return []flruntime.InterruptedTurnRecoveryCandidate{
				{ThreadID: "root_b", ParentThreadID: "root_a"},
			}, nil
		},
		root: func(context.Context, identity.ThreadID) (floretInterruptedTurnRecoveryHostFactory, error) {
			return nil, flruntime.ErrInterruptedTurnNotFound
		},
		subagent: func(context.Context, identity.ThreadID, identity.ThreadID) (floretInterruptedTurnRecoveryHostFactory, error) {
			t.Fatal("duplicate root must be rejected before binding a SubAgent target")
			return nil, nil
		},
	}
	_, err := buildFloretStartupRecoveryTargets(context.Background(), []identity.ThreadID{"root_a", "root_b"}, capabilities)
	if err == nil || !strings.Contains(err.Error(), "reuses root") {
		t.Fatalf("error=%v, want duplicate durable identity rejection", err)
	}
}

func TestFloretStartupRecoveryCompletesResolvedExactTarget(t *testing.T) {
	factory := &scriptedInterruptedTurnRecoveryFactory{errors: []error{flruntime.ErrRecoveryTargetResolved}}
	result, err := recoverInterruptedFloretTurns(context.Background(), []floretStartupRecoveryTarget{{
		description: "resolved root", factory: factory,
	}})
	if err != nil {
		t.Fatal(err)
	}
	if result.pending || result.recovered != 0 || factory.calls != 1 {
		t.Fatalf("recovery=%+v factory calls=%d, want completed resolved target", result, factory.calls)
	}
}

func TestFloretStartupRecoveryReturnsNoTargetsWhenCandidateScanIsEmpty(t *testing.T) {
	floretStore := openTestFloretRuntimeHost(t, flstorage.Memory())
	_, recovery, err := configureFloretRuntime(floretStore)
	if err != nil {
		t.Fatal(err)
	}
	targets, err := buildFloretStartupRecoveryTargets(context.Background(), nil, recovery)
	if err != nil {
		t.Fatal(err)
	}
	if len(targets) != 0 {
		t.Fatalf("recovery targets=%d, want 0", len(targets))
	}
}

func TestFloretRuntimeBindingFailsWhileStartupRecoveryOwnsSettlement(t *testing.T) {
	called := false
	svc := &Service{floretRuntime: &floretRuntimeCapabilityIssuer{bind: func(identity.ThreadID) (floretThreadRuntimeCapabilities, error) {
		called = true
		return floretThreadRuntimeCapabilities{}, nil
	}}}
	svc.setFloretStartupRecoveryState(true, nil)
	if _, err := svc.bindFloretThreadRuntime("thread_pending_recovery"); err == nil || !strings.Contains(err.Error(), "startup recovery") {
		t.Fatalf("bind runtime error=%v, want explicit recovery gate", err)
	}
	if called {
		t.Fatal("runtime binder was called before startup recovery completed")
	}
}

func TestPostTurnStartupRecoveryDrainsForksBeforeSubAgentPublications(t *testing.T) {
	t.Parallel()

	forkBatches := []int{20, 3, 0}
	var order []string
	err := recoverPostTurnStartupOperations(
		context.Background(),
		func(context.Context) (int, error) {
			order = append(order, "fork")
			completed := forkBatches[0]
			forkBatches = forkBatches[1:]
			return completed, nil
		},
		func(context.Context) (int, error) {
			order = append(order, "publication")
			return 4, nil
		},
	)
	if err != nil {
		t.Fatalf("recoverPostTurnStartupOperations: %v", err)
	}
	want := []string{"fork", "fork", "fork", "publication"}
	if len(order) != len(want) {
		t.Fatalf("order=%#v, want %#v", order, want)
	}
	for index := range want {
		if order[index] != want[index] {
			t.Fatalf("order=%#v, want %#v", order, want)
		}
	}
}
