package ai

import (
	"context"
	"errors"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	flruntime "github.com/floegence/floret/runtime"
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

func (h *scriptedInterruptedTurnRecoveryHost) RecoverInterruptedTurn(context.Context) (flruntime.RecoverInterruptedTurnResult, error) {
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

type lifecycleBoundStartupRecoveryHost struct {
	mu                 sync.Mutex
	calls              int
	backgroundStarted  chan struct{}
	backgroundCanceled chan struct{}
}

func (h *lifecycleBoundStartupRecoveryHost) RecoverInterruptedTurn(ctx context.Context) (flruntime.RecoverInterruptedTurnResult, error) {
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

func (h startupRecoverySubagentReadHost) ListSubAgents(context.Context, flruntime.ThreadID) ([]flruntime.SubAgentSnapshot, error) {
	return append([]flruntime.SubAgentSnapshot(nil), h.snapshots...), nil
}

func (startupRecoverySubagentReadHost) ReadSubAgentDetail(context.Context, flruntime.ReadSubAgentDetailRequest) (flruntime.SubAgentDetail, error) {
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

func TestFloretStartupRecoveryRetriesBusyExactLeaseWithoutRuntimeFallback(t *testing.T) {
	store := newStartupRecoveryTestStore(t, threadstore.ThreadSettings{
		EndpointID: "env_recovery", ThreadID: "thread_recovery", PermissionType: "approval_required",
	})
	host := &scriptedInterruptedTurnRecoveryHost{errors: []error{flruntime.ErrThreadBusy, nil}}
	factory := &scriptedInterruptedTurnRecoveryFactory{host: host}
	bindCalls := 0
	capabilities := floretStartupRecoveryCapabilities{
		root: func(_ context.Context, threadID flruntime.ThreadID) (floretInterruptedTurnRecoveryHostFactory, error) {
			bindCalls++
			if threadID != "thread_recovery" {
				t.Fatalf("root recovery thread=%q", threadID)
			}
			return factory, nil
		},
		subagent: func(context.Context, flruntime.ThreadID, flruntime.ThreadID) (floretInterruptedTurnRecoveryHostFactory, error) {
			t.Fatal("unexpected child recovery")
			return nil, nil
		},
		listSubagents: func(context.Context, flruntime.ThreadID) (floretSubagentReadHost, error) {
			return startupRecoverySubagentReadHost{}, nil
		},
	}
	targets, err := buildFloretStartupRecoveryTargets(context.Background(), store, capabilities)
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
	store := newStartupRecoveryTestStore(t, threadstore.ThreadSettings{
		EndpointID: "env_child_recovery", ThreadID: "parent_recovery", PermissionType: "approval_required",
	})
	childHost := &scriptedInterruptedTurnRecoveryHost{}
	childFactory := &scriptedInterruptedTurnRecoveryFactory{host: childHost}
	capabilities := floretStartupRecoveryCapabilities{
		listSubagents: func(_ context.Context, parentThreadID flruntime.ThreadID) (floretSubagentReadHost, error) {
			if parentThreadID != "parent_recovery" {
				t.Fatalf("SubAgent read parent=%q", parentThreadID)
			}
			return startupRecoverySubagentReadHost{snapshots: []flruntime.SubAgentSnapshot{{
				ThreadID: "child_recovery", ParentThreadID: "parent_recovery",
			}}}, nil
		},
		root: func(context.Context, flruntime.ThreadID) (floretInterruptedTurnRecoveryHostFactory, error) {
			return nil, flruntime.ErrInterruptedTurnNotFound
		},
		subagent: func(_ context.Context, parentThreadID flruntime.ThreadID, childThreadID flruntime.ThreadID) (floretInterruptedTurnRecoveryHostFactory, error) {
			if parentThreadID != "parent_recovery" || childThreadID != "child_recovery" {
				t.Fatalf("child recovery authority parent=%q child=%q", parentThreadID, childThreadID)
			}
			return childFactory, nil
		},
	}
	targets, err := buildFloretStartupRecoveryTargets(context.Background(), store, capabilities)
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

func TestFloretStartupRecoveryRejectsMissingCanonicalAuthority(t *testing.T) {
	store := newStartupRecoveryTestStore(t, threadstore.ThreadSettings{
		EndpointID: "env_missing_recovery", ThreadID: "missing_canonical_recovery", PermissionType: "approval_required",
	})
	floretStore := flruntime.NewMemoryStore()
	t.Cleanup(func() { _ = floretStore.Close() })
	_, recovery, err := configureFloretRuntime(floretStore)
	if err != nil {
		t.Fatal(err)
	}
	_, err = buildFloretStartupRecoveryTargets(context.Background(), store, recovery)
	if !errors.Is(err, flruntime.ErrThreadNotFound) {
		t.Fatalf("recovery error=%v, want %v", err, flruntime.ErrThreadNotFound)
	}
}

func TestFloretRuntimeBindingFailsWhileStartupRecoveryOwnsSettlement(t *testing.T) {
	called := false
	svc := &Service{floretRuntime: &floretRuntimeCapabilityIssuer{bind: func(flruntime.ThreadID) (floretThreadRuntimeCapabilities, error) {
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
