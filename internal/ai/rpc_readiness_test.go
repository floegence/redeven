package ai

import (
	"context"
	"errors"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	flowersec "github.com/floegence/flowersec/flowersec-go/v2"
	"github.com/floegence/redeven/internal/session"
	"github.com/floegence/redeven/internal/sessionrpc"
)

func TestAcquireRPCServiceReleasesInvalidLease(t *testing.T) {
	var releases atomic.Int32
	service, leaseCtx, release, rpcErr := acquireRPCService(context.Background(), func(context.Context) (*Service, context.Context, uint64, func(), error) {
		return new(Service), nil, 1, func() { releases.Add(1) }, nil
	})
	if service != nil || leaseCtx != nil || release != nil {
		t.Fatalf("invalid lease result = (%p, %v, release=%t), want nils", service, leaseCtx, release != nil)
	}
	if rpcErr == nil || rpcErr.Code != 503 || strings.TrimSpace(rpcErr.Message) != "AI service is unavailable" {
		t.Fatalf("invalid lease error = %#v", rpcErr)
	}
	if got := releases.Load(); got != 1 {
		t.Fatalf("invalid lease release count = %d, want 1", got)
	}
}

func TestAIRealtimeRPCWithoutPeerReturnsUnavailable(t *testing.T) {
	router := sessionrpc.NewRouter()
	meta := &session.Meta{EndpointID: "env_1", CanRead: true, CanWrite: true, CanExecute: true}
	detach := RegisterRPCServiceProviderWithAccessGate(router, meta, nil, nil, func(context.Context) (*Service, context.Context, uint64, func(), error) {
		return newRPCRealtimeTestService(), context.Background(), 1, func() {}, nil
	})
	t.Cleanup(detach)
	for _, request := range []struct {
		name   string
		typeID uint32
		body   any
	}{
		{name: "summary", typeID: TypeID_AI_SUBSCRIBE_SUMMARY, body: map[string]any{}},
		{name: "thread", typeID: TypeID_AI_SUBSCRIBE_THREAD, body: map[string]any{"thread_id": "thread_1"}},
	} {
		t.Run(request.name, func(t *testing.T) {
			err := router.Call(context.Background(), request.typeID, request.body, nil)
			var rpcErr *sessionrpc.Error
			if !errors.As(err, &rpcErr) || rpcErr.Code != 503 {
				t.Fatalf("RPC error = %v, want structured 503 unavailable", err)
			}
		})
	}
}

func TestRPCServiceProviderCleanupDetachesRealtimeSink(t *testing.T) {
	service := newRPCRealtimeTestService()
	provider := newRPCGenerationProvider(service)
	router := sessionrpc.NewRouter()
	meta := &session.Meta{EndpointID: "env_1", CanRead: true, CanWrite: true, CanExecute: true}
	peer := newTestRPCPeer(router)
	detach := RegisterRPCServiceProviderWithAccessGate(router, meta, peer, nil, provider.Acquire)
	t.Cleanup(detach)
	if _, rpcErr, err := callTestRPC(context.Background(), peer, TypeID_AI_SUBSCRIBE_SUMMARY, []byte(`{}`)); err != nil {
		t.Fatalf("subscribe summary: %v", err)
	} else if rpcErr != nil {
		t.Fatalf("subscribe summary RPC error = %#v", rpcErr)
	}

	service.mu.Lock()
	_, attached := service.realtimeSummaryEndpointBySRV[peer]
	service.mu.Unlock()
	if !attached {
		t.Fatal("realtime sink was not attached")
	}
	if active := provider.ActiveLeases(service); active != 1 {
		t.Fatalf("active subscription leases = %d, want 1", active)
	}
	detach()
	detach()
	service.mu.Lock()
	_, attached = service.realtimeSummaryEndpointBySRV[peer]
	_, writerAttached := service.realtimeWriters[peer]
	service.mu.Unlock()
	if attached || writerAttached {
		t.Fatal("realtime sink remained attached after connection cleanup")
	}
	if active := provider.ActiveLeases(service); active != 0 {
		t.Fatalf("active subscription leases after cleanup = %d, want 0", active)
	}
	if acquires, releases := provider.Counts(service); acquires != 1 || releases != 1 {
		t.Fatalf("subscription lease counts = (%d, %d), want (1, 1)", acquires, releases)
	}

}

func TestRPCServiceProviderRebindsRealtimeSinkAcrossGenerations(t *testing.T) {
	first := newRPCRealtimeTestService()
	second := newRPCRealtimeTestService()
	provider := newRPCGenerationProvider(first)

	router := sessionrpc.NewRouter()
	meta := &session.Meta{EndpointID: "env_1", CanRead: true, CanWrite: true, CanExecute: true}
	peer := newTestRPCPeer(router)
	detach := RegisterRPCServiceProviderWithAccessGate(router, meta, peer, nil, provider.Acquire)
	t.Cleanup(detach)
	if _, rpcErr, err := callTestRPC(context.Background(), peer, TypeID_AI_SUBSCRIBE_SUMMARY, []byte(`{}`)); err != nil {
		t.Fatalf("subscribe summary: %v", err)
	} else if rpcErr != nil {
		t.Fatalf("subscribe summary RPC error = %#v", rpcErr)
	}
	if _, rpcErr, err := callTestRPC(context.Background(), peer, TypeID_AI_SUBSCRIBE_THREAD, []byte(`{"thread_id":"thread_1"}`)); err != nil {
		t.Fatalf("subscribe thread: %v", err)
	} else if rpcErr != nil {
		t.Fatalf("subscribe thread RPC error = %#v", rpcErr)
	}
	if active := provider.ActiveLeases(first); active != 1 {
		t.Fatalf("first generation active leases = %d, want 1", active)
	}

	provider.Clear()
	provider.Cancel(first)
	provider.Publish(second)

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		second.mu.Lock()
		_, summaryAttached := second.realtimeSummaryEndpointBySRV[peer]
		threadAttached := second.realtimeThreadBySRV[peer] == runThreadKey("env_1", "thread_1")
		second.mu.Unlock()
		if summaryAttached && threadAttached && provider.ActiveLeases(second) == 1 {
			break
		}
		time.Sleep(time.Millisecond)
	}
	second.mu.Lock()
	_, summaryRebound := second.realtimeSummaryEndpointBySRV[peer]
	threadRebound := second.realtimeThreadBySRV[peer] == runThreadKey("env_1", "thread_1")
	second.mu.Unlock()
	if !summaryRebound || !threadRebound {
		t.Fatal("realtime sink did not rebind to the replacement generation")
	}
	first.mu.Lock()
	_, oldAttached := first.realtimeSummaryEndpointBySRV[peer]
	first.mu.Unlock()
	if oldAttached {
		t.Fatal("realtime sink remained attached to the old generation")
	}
	if active := provider.ActiveLeases(first); active != 0 {
		t.Fatalf("first generation active leases after replacement = %d, want 0", active)
	}
	if active := provider.ActiveLeases(second); active != 1 {
		t.Fatalf("second generation active leases = %d, want 1", active)
	}

	detach()
	detach()
	if active := provider.ActiveLeases(second); active != 0 {
		t.Fatalf("second generation active leases after cleanup = %d, want 0", active)
	}
	second.mu.Lock()
	_, summaryAttached := second.realtimeSummaryEndpointBySRV[peer]
	_, writerAttached := second.realtimeWriters[peer]
	second.mu.Unlock()
	if summaryAttached || writerAttached {
		t.Fatal("replacement generation sink remained attached after cleanup")
	}
}

func TestRPCServiceProviderConcurrentGenerationCancelAndCleanupReleasesOnce(t *testing.T) {
	service := newRPCRealtimeTestService()
	provider := newRPCGenerationProvider(service)
	router := sessionrpc.NewRouter()
	meta := &session.Meta{EndpointID: "env_1", CanRead: true, CanWrite: true, CanExecute: true}
	peer := newTestRPCPeer(router)
	detach := RegisterRPCServiceProviderWithAccessGate(router, meta, peer, nil, provider.Acquire)
	if _, rpcErr, err := callTestRPC(context.Background(), peer, TypeID_AI_SUBSCRIBE_SUMMARY, []byte(`{}`)); err != nil {
		t.Fatalf("subscribe summary: %v", err)
	} else if rpcErr != nil {
		t.Fatalf("subscribe summary RPC error = %#v", rpcErr)
	}

	provider.Clear()
	start := make(chan struct{})
	var cleanup sync.WaitGroup
	cleanup.Add(2)
	go func() {
		defer cleanup.Done()
		<-start
		provider.Cancel(service)
	}()
	go func() {
		defer cleanup.Done()
		<-start
		detach()
	}()
	close(start)
	cleanup.Wait()
	detach()

	if active := provider.ActiveLeases(service); active != 0 {
		t.Fatalf("active leases after concurrent cleanup = %d, want 0", active)
	}
	if acquires, releases := provider.Counts(service); acquires != 1 || releases != 1 {
		t.Fatalf("concurrent cleanup lease counts = (%d, %d), want (1, 1)", acquires, releases)
	}
	service.mu.Lock()
	_, attached := service.realtimeSummaryEndpointBySRV[peer]
	_, writerAttached := service.realtimeWriters[peer]
	service.mu.Unlock()
	if attached || writerAttached {
		t.Fatal("realtime sink remained attached after concurrent cleanup")
	}

}

func newRPCRealtimeTestService() *Service {
	return &Service{
		activeRunByTh:                make(map[string]string),
		realtimeWriters:              make(map[flowersec.RPCPeer]*aiSinkWriter),
		realtimeSummaryByEndpoint:    make(map[string]map[flowersec.RPCPeer]struct{}),
		realtimeSummaryEndpointBySRV: make(map[flowersec.RPCPeer]string),
		realtimeByThread:             make(map[string]map[flowersec.RPCPeer]struct{}),
		realtimeThreadBySRV:          make(map[flowersec.RPCPeer]string),
	}
}

type rpcTestGeneration struct {
	service  *Service
	ctx      context.Context
	cancel   context.CancelFunc
	acquires int
	releases int
	active   int
}

type rpcGenerationProvider struct {
	mu         sync.Mutex
	current    *rpcTestGeneration
	generation map[*Service]*rpcTestGeneration
	nextID     uint64
}

func newRPCGenerationProvider(service *Service) *rpcGenerationProvider {
	p := &rpcGenerationProvider{generation: make(map[*Service]*rpcTestGeneration)}
	p.Publish(service)
	return p
}

func (p *rpcGenerationProvider) Publish(service *Service) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if generation := p.generation[service]; generation != nil {
		p.current = generation
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	generation := &rpcTestGeneration{service: service, ctx: ctx, cancel: cancel}
	p.generation[service] = generation
	p.current = generation
}

func (p *rpcGenerationProvider) Clear() {
	p.mu.Lock()
	p.current = nil
	p.mu.Unlock()
}

func (p *rpcGenerationProvider) Cancel(service *Service) {
	p.mu.Lock()
	generation := p.generation[service]
	p.mu.Unlock()
	if generation != nil {
		generation.cancel()
	}
}

func (p *rpcGenerationProvider) Acquire(ctx context.Context) (*Service, context.Context, uint64, func(), error) {
	p.mu.Lock()
	generation := p.current
	if generation == nil {
		p.mu.Unlock()
		return nil, nil, 0, nil, context.Canceled
	}
	p.nextID++
	generationID := p.nextID
	generation.acquires++
	generation.active++
	p.mu.Unlock()

	leaseCtx, cancelLease := context.WithCancel(ctx)
	stopGenerationCancel := context.AfterFunc(generation.ctx, cancelLease)
	var once sync.Once
	release := func() {
		once.Do(func() {
			stopGenerationCancel()
			cancelLease()
			p.mu.Lock()
			generation.releases++
			generation.active--
			p.mu.Unlock()
		})
	}
	return generation.service, leaseCtx, generationID, release, nil
}

func (p *rpcGenerationProvider) ActiveLeases(service *Service) int {
	p.mu.Lock()
	defer p.mu.Unlock()
	if generation := p.generation[service]; generation != nil {
		return generation.active
	}
	return 0
}

func (p *rpcGenerationProvider) Counts(service *Service) (int, int) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if generation := p.generation[service]; generation != nil {
		return generation.acquires, generation.releases
	}
	return 0, 0
}

func TestRPCServiceProviderRecoversWithoutReconnect(t *testing.T) {
	var mu sync.Mutex
	var service *Service
	acquires := 0
	releases := 0
	acquire := func(ctx context.Context) (*Service, context.Context, uint64, func(), error) {
		mu.Lock()
		defer mu.Unlock()
		acquires++
		if service == nil {
			return nil, nil, 0, nil, context.Canceled
		}
		var once sync.Once
		return service, ctx, 2, func() {
			once.Do(func() {
				mu.Lock()
				releases++
				mu.Unlock()
			})
		}, nil
	}

	router := sessionrpc.NewRouter()
	meta := &session.Meta{CanRead: true, CanWrite: true, CanExecute: true}
	peer := newTestRPCPeer(router)
	RegisterRPCServiceProviderWithAccessGate(router, meta, peer, nil, acquire)

	_, rpcErr, err := callTestRPC(context.Background(), peer, TypeID_AI_STOP_THREAD, []byte(`{"thread_id":"thread_1"}`))
	if err != nil {
		t.Fatalf("blocked call: %v", err)
	}
	if rpcErr == nil || rpcErr.Code != 503 || strings.TrimSpace(rpcErr.Message) != "AI service is unavailable" {
		t.Fatalf("blocked RPC error = %#v", rpcErr)
	}

	mu.Lock()
	service = &Service{}
	mu.Unlock()
	_, rpcErr, err = callTestRPC(context.Background(), peer, TypeID_AI_STOP_THREAD, []byte(`{"thread_id":"thread_1"}`))
	if err != nil {
		t.Fatalf("ready call on same connection: %v", err)
	}
	if rpcErr == nil || rpcErr.Code != 400 {
		t.Fatalf("ready RPC error = %#v, want service-level 400", rpcErr)
	}
	mu.Lock()
	if acquires != 2 || releases != 1 {
		t.Fatalf("lease counts = (%d, %d), want (2, 1)", acquires, releases)
	}
	mu.Unlock()

}
