package ai

import (
	"context"
	"errors"
	"path/filepath"
	"sort"
	"sync"
	"testing"
	"time"

	"github.com/floegence/floret/v3/identity"
	flruntime "github.com/floegence/floret/v3/runtime"
	"github.com/floegence/redeven/internal/ai/threadstore"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/filesystemscope"
)

type mutableRootInventory struct {
	mu      sync.Mutex
	threads map[identity.ThreadID]flruntime.ThreadSnapshot
}

func (i *mutableRootInventory) ListRootThreads(context.Context, floretListRootThreadsRequest) (floretRootThreadsPage, error) {
	i.mu.Lock()
	defer i.mu.Unlock()
	items := make([]flruntime.ThreadSnapshot, 0, len(i.threads))
	for _, item := range i.threads {
		items = append(items, item)
	}
	sort.Slice(items, func(left, right int) bool { return items[left].ID < items[right].ID })
	return floretRootThreadsPage{Threads: items}, nil
}

func (i *mutableRootInventory) DeleteThread(_ context.Context, id identity.ThreadID, _ flruntime.DeleteThreadCommand) error {
	i.mu.Lock()
	defer i.mu.Unlock()
	if _, ok := i.threads[id]; !ok {
		return flruntime.ErrThreadNotFound
	}
	delete(i.threads, id)
	return nil
}

func TestOrphanCanonicalRootAdoptIsExplicitIdempotentAndCrossEndpointClosed(t *testing.T) {
	home := t.TempDir()
	scope, err := filesystemscope.NewDefaultRegistry(home)
	if err != nil {
		t.Fatal(err)
	}
	store, err := threadstore.Open(filepath.Join(t.TempDir(), "threads.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	now := time.Now().UTC()
	inventory := &mutableRootInventory{threads: map[identity.ThreadID]flruntime.ThreadSnapshot{
		"thread_orphan": {ID: "thread_orphan", CreatedAt: now, UpdatedAt: now, Phase: flruntime.ThreadPhaseIdle, Status: flruntime.ThreadStatusIdle, CanAppendMessage: true},
	}}
	service := &Service{
		threadsDB: store, scope: scope,
		cfg:         &config.AIConfig{CurrentModelID: "provider/model", Providers: []config.AIProvider{{ID: "provider", Type: "openai", Models: []config.AIProviderModel{{ModelName: "model"}}}}},
		orphanRoots: &floretOrphanRootMaintenanceCoordinator{inventory: inventory, delete: inventory},
	}
	if count, err := service.ReconcileCanonicalRootOwnership(context.Background()); err != nil || count != 1 {
		t.Fatalf("initial reconciliation = %d, %v", count, err)
	}
	invalidModel := AdoptOrphanCanonicalRootRequest{
		ThreadID: "thread_orphan", EndpointID: "env_a", NamespacePublicID: "ns_a", ModelID: "provider/not-configured",
		PermissionType: "approval_required", WorkingDir: home, OperatorPublicID: "operator_a",
	}
	if _, err := service.AdoptOrphanCanonicalRoot(context.Background(), invalidModel); err == nil {
		t.Fatal("adoption accepted a model outside the active environment profile")
	}
	invalidPermission := invalidModel
	invalidPermission.ModelID = "provider/model"
	invalidPermission.PermissionType = "owner"
	if _, err := service.AdoptOrphanCanonicalRoot(context.Background(), invalidPermission); err == nil {
		t.Fatal("adoption accepted an unknown permission type")
	}
	req := AdoptOrphanCanonicalRootRequest{
		ThreadID: "thread_orphan", EndpointID: "env_a", NamespacePublicID: "ns_a", ModelID: "provider/model",
		PermissionType: "approval_required", WorkingDir: home, OperatorPublicID: "operator_a",
	}
	if count, err := service.AdoptOrphanCanonicalRoot(context.Background(), req); err != nil || count != 0 {
		t.Fatalf("adopt = %d, %v", count, err)
	}
	req.OperatorPublicID = "operator_b"
	if count, err := service.AdoptOrphanCanonicalRoot(context.Background(), req); err != nil || count != 0 {
		t.Fatalf("idempotent adopt = %d, %v", count, err)
	}
	req.EndpointID = "env_b"
	if _, err := service.AdoptOrphanCanonicalRoot(context.Background(), req); !errors.Is(err, ErrCanonicalRootIdentityConflict) {
		t.Fatalf("cross-endpoint adopt = %v", err)
	}
}

func TestOrphanCanonicalRootDeleteUsesPublicAuthorityAndIsIdempotent(t *testing.T) {
	store, err := threadstore.Open(filepath.Join(t.TempDir(), "threads.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	now := time.Now().UTC()
	inventory := &mutableRootInventory{threads: map[identity.ThreadID]flruntime.ThreadSnapshot{
		"thread_orphan": {ID: "thread_orphan", CreatedAt: now, UpdatedAt: now, Phase: flruntime.ThreadPhaseIdle, Status: flruntime.ThreadStatusIdle, CanAppendMessage: true},
	}}
	service := &Service{threadsDB: store, orphanRoots: &floretOrphanRootMaintenanceCoordinator{inventory: inventory, delete: inventory}}
	req := DeleteOrphanCanonicalRootRequest{ThreadID: "thread_orphan", OperatorPublicID: "operator_a"}
	if count, err := service.DeleteOrphanCanonicalRoot(context.Background(), req); err != nil || count != 0 {
		t.Fatalf("delete = %d, %v", count, err)
	}
	if count, err := service.DeleteOrphanCanonicalRoot(context.Background(), req); err != nil || count != 0 {
		t.Fatalf("idempotent delete = %d, %v", count, err)
	}
}

func TestOrphanCanonicalRootMaintenanceHonorsPendingForkOwnership(t *testing.T) {
	home := t.TempDir()
	scope, err := filesystemscope.NewDefaultRegistry(home)
	if err != nil {
		t.Fatal(err)
	}
	store, err := threadstore.Open(filepath.Join(t.TempDir(), "threads.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	ctx := context.Background()
	if err := store.CreateThreadSettings(ctx, threadstore.ThreadSettings{
		ThreadID: "thread_source", EndpointID: "env_a", NamespacePublicID: "ns_a",
		ModelID: "provider/model", PermissionType: "approval_required", WorkingDir: home,
	}); err != nil {
		t.Fatal(err)
	}
	operation, err := store.PrepareForkOperation(ctx, threadstore.ForkThreadRequest{
		OperationID: "fork_pending_ownership", ClientRequestID: "fork_pending_ownership", EndpointID: "env_a", SourceThreadID: "thread_source",
		Title: "Pending fork", CreatedByUserPublicID: "user_pending_fork", CreatedAtUnixMs: time.Now().UnixMilli(),
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.BindForkCanonicalDestination(ctx, operation.OperationID, "thread_pending_fork"); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	inventory := &mutableRootInventory{threads: map[identity.ThreadID]flruntime.ThreadSnapshot{
		"thread_source":       {ID: "thread_source", CreatedAt: now, UpdatedAt: now, Phase: flruntime.ThreadPhaseIdle, Status: flruntime.ThreadStatusIdle, CanAppendMessage: true},
		"thread_pending_fork": {ID: "thread_pending_fork", CreatedAt: now, UpdatedAt: now, Phase: flruntime.ThreadPhaseIdle, Status: flruntime.ThreadStatusIdle, CanAppendMessage: true},
	}}
	service := &Service{
		threadsDB: store, scope: scope,
		cfg:         &config.AIConfig{CurrentModelID: "provider/model", Providers: []config.AIProvider{{ID: "provider", Type: "openai", Models: []config.AIProviderModel{{ModelName: "model"}}}}},
		orphanRoots: &floretOrphanRootMaintenanceCoordinator{inventory: inventory, delete: inventory},
	}
	if count, err := service.ReconcileCanonicalRootOwnership(ctx); err != nil || count != 0 {
		t.Fatalf("pending fork reconciliation = %d, %v", count, err)
	}
	review, err := service.ReviewOrphanCanonicalRoots(ctx)
	if err != nil || review.IssueCount != 0 || len(review.Items) != 0 {
		t.Fatalf("pending fork review = %#v, %v", review, err)
	}
	adopt := AdoptOrphanCanonicalRootRequest{
		ThreadID: "thread_pending_fork", EndpointID: "env_a", NamespacePublicID: "ns_a", ModelID: "provider/model",
		PermissionType: "approval_required", WorkingDir: home, OperatorPublicID: "operator_a",
	}
	if _, err := service.AdoptOrphanCanonicalRoot(ctx, adopt); !errors.Is(err, ErrCanonicalRootNotOrphaned) {
		t.Fatalf("pending fork adopt error = %v", err)
	}
	if _, err := service.DeleteOrphanCanonicalRoot(ctx, DeleteOrphanCanonicalRootRequest{ThreadID: "thread_pending_fork", OperatorPublicID: "operator_a"}); !errors.Is(err, ErrCanonicalRootNotOrphaned) {
		t.Fatalf("pending fork delete error = %v", err)
	}
}
