package ai

import (
	"context"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/floegence/redeven/internal/ai/threadstore"
)

var runThreadStoresForTest sync.Map

func newRunWithProductStoreForTest(t *testing.T, opts runOptions, providedStores ...*threadstore.Store) *run {
	t.Helper()
	var store *threadstore.Store
	if len(providedStores) > 1 {
		t.Fatal("newRunWithProductStoreForTest accepts at most one store")
	}
	if len(providedStores) == 1 {
		store = providedStores[0]
	}
	if store == nil {
		var err error
		store, err = threadstore.Open(filepath.Join(t.TempDir(), "threads.sqlite"))
		if err != nil {
			t.Fatalf("threadstore.Open: %v", err)
		}
		t.Cleanup(func() { _ = store.Close() })
	}
	if strings.TrimSpace(opts.EndpointID) == "" {
		opts.EndpointID = "env_run_product_test"
	}
	if strings.TrimSpace(opts.ThreadID) == "" {
		opts.ThreadID = "thread_run_product_test"
	}
	if strings.TrimSpace(opts.RunID) == "" {
		opts.RunID = "run_run_product_test"
	}
	capabilities, err := bindRootRunProductCapabilities(store, opts.EndpointID, opts.ThreadID, opts.RunID)
	if err != nil {
		t.Fatalf("bindRootRunProductCapabilities: %v", err)
	}
	opts.ProductCapabilities = capabilities
	r := newRun(opts)
	runThreadStoresForTest.Store(r, store)
	t.Cleanup(func() { runThreadStoresForTest.Delete(r) })
	return r
}

func runThreadStoreForTest(t *testing.T, r *run) *threadstore.Store {
	t.Helper()
	if r == nil {
		t.Fatal("run is nil")
	}
	store, ok := runThreadStoresForTest.Load(r)
	if !ok || store == nil {
		t.Fatal("run test product store is unavailable")
	}
	return store.(*threadstore.Store)
}

func setRunThreadStoreForTest(t *testing.T, r *run, store *threadstore.Store) {
	t.Helper()
	if r == nil || store == nil {
		t.Fatal("run test product store is unavailable")
	}
	if strings.TrimSpace(r.id) == "" {
		r.id = "run_tool_authority_test"
	}
	capabilities, err := bindRootRunProductCapabilities(store, r.endpointID, r.threadID, r.id)
	if err != nil {
		t.Fatalf("bindRootRunProductCapabilities: %v", err)
	}
	r.product = capabilities
	runThreadStoresForTest.Store(r, store)
	t.Cleanup(func() { runThreadStoresForTest.Delete(r) })
}

func ensureToolExecutionAuthorityForTest(t *testing.T, r *run) {
	t.Helper()
	if r == nil {
		t.Fatal("nil tool authorization run")
	}
	if strings.TrimSpace(r.endpointID) == "" {
		r.endpointID = "env_tool_authority_test"
	}
	if strings.TrimSpace(r.threadID) == "" {
		r.threadID = "thread_tool_authority_test"
	}
	if _, ok := runThreadStoresForTest.Load(r); !ok {
		store, err := threadstore.Open(filepath.Join(t.TempDir(), "threads.sqlite"))
		if err != nil {
			t.Fatalf("threadstore.Open: %v", err)
		}
		t.Cleanup(func() { _ = store.Close() })
		setRunThreadStoreForTest(t, r, store)
	}
	store := runThreadStoreForTest(t, r)
	if strings.TrimSpace(r.host.authorityThreadID) == "" {
		svc := &Service{threadsDB: store}
		r.host = bindTestRunHostCapabilities(t, svc, r.endpointID, r.threadID)
	}
	settings, err := store.GetThreadSettings(context.Background(), r.endpointID, r.threadID)
	if err != nil {
		t.Fatalf("GetThreadSettings: %v", err)
	}
	if settings == nil {
		if err := store.CreateThreadSettings(context.Background(), threadstore.ThreadSettings{
			EndpointID: r.endpointID, ThreadID: r.threadID, PermissionType: permissionTypeString(r.permissionType),
		}); err != nil {
			t.Fatalf("CreateThreadSettings: %v", err)
		}
	}
}

func allowToolsForTest(t *testing.T, r *run, names ...string) {
	t.Helper()
	ensureToolExecutionAuthorityForTest(t, r)
	registry := NewInMemoryToolRegistry()
	if err := registerBuiltInTools(registry, r); err != nil {
		t.Fatalf("registerBuiltInTools: %v", err)
	}
	tools := make([]ToolDef, 0, len(names))
	for _, name := range names {
		def, _, ok := registry.resolve(name)
		if !ok {
			t.Fatalf("resolve tool %q", name)
		}
		tools = append(tools, def)
	}
	r.permissionType = FlowerPermissionFullAccess
	if len(tools) > 0 {
		readonlyOnly := true
		for _, def := range tools {
			if def.Visibility != ToolVisibilityReadonlyExclusive {
				readonlyOnly = false
				break
			}
		}
		if readonlyOnly {
			r.permissionType = FlowerPermissionReadonly
		}
	}
	if err := runThreadStoreForTest(t, r).UpdateThreadPermissionType(context.Background(), r.endpointID, r.threadID, permissionTypeString(r.permissionType)); err != nil {
		t.Fatalf("UpdateThreadPermissionType: %v", err)
	}
	allowedNames := make([]string, 0, len(tools))
	for _, tool := range tools {
		allowedNames = append(allowedNames, tool.Name)
	}
	r.toolAllowlist = stringSet(allowedNames...)
	r.dynamicSurfaceConfig = r.buildDynamicToolSurfaceConfig("test tool execution", TaskComplexityStandard, true, nil, nil)
	if _, err := r.buildRunToolSurface(context.Background(), r.dynamicSurfaceConfig); err != nil {
		t.Fatalf("buildRunToolSurface: %v", err)
	}
}

func authorizedToolContextForTest(t *testing.T, r *run, toolID string, toolName string) context.Context {
	return authorizedToolContextForTestFrom(t, context.Background(), r, toolID, toolName)
}

func authorizedToolContextForTestFrom(t *testing.T, ctx context.Context, r *run, toolID string, toolName string) context.Context {
	t.Helper()
	if r == nil {
		t.Fatal("nil tool authorization run")
	}
	ensureToolExecutionAuthorityForTest(t, r)
	snapshot := r.currentPermissionSnapshot()
	policy, ok := snapshot.ToolPolicies[strings.TrimSpace(toolName)]
	if !ok {
		t.Fatalf("tool %q missing from permission snapshot", toolName)
	}
	hostContext := map[string]string{
		floretToolHostContextPermissionSnapshotIDKey: strings.TrimSpace(snapshot.SnapshotID),
		floretToolHostContextPermissionEpochKey:      permissionSurfaceEpoch(snapshot),
		floretToolHostContextAuthorityThreadIDKey:    strings.TrimSpace(r.threadID),
	}
	ctx = contextWithToolAuthorizationSnapshot(ctx, snapshot)
	return contextWithFloretToolExecutionAuthorization(ctx, toolID, toolName, "test_effect:"+strings.TrimSpace(toolID), snapshot, policy.ApprovalDecision, policy.ApprovalDecision == ApprovalDecisionAsk, hostContext)
}
