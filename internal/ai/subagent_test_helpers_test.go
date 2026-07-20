package ai

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/floegence/redeven/internal/ai/threadstore"
)

func (r *run) manageSubagents(ctx context.Context, args map[string]any) (map[string]any, error) {
	ctx = contextWithToolAuthorizationSnapshot(ctx, r.currentPermissionSnapshot())
	return r.manageSubagentsForTool(ctx, "", args)
}

func newBoundSubagentRuntimeForTest(t *testing.T, parentThreadID string, host floretSubagentHost, childThreadIDs ...string) (*floretSubagentRuntime, *run) {
	t.Helper()
	store, err := threadstore.Open(filepath.Join(t.TempDir(), "threads.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	svc := &Service{threadsDB: store, terminalProcesses: newTerminalProcessManager()}
	t.Cleanup(func() { _ = svc.terminalProcesses.Close(context.Background()) })
	svc.threadMgr = newThreadManager(svc)
	t.Cleanup(svc.threadMgr.Close)
	parent := newRunWithProductStoreForTest(t, runOptions{
		EndpointID: "env_" + parentThreadID,
		ThreadID:   parentThreadID,
		RunID:      "run_" + parentThreadID,
	}, store)
	parent.host = bindTestRunHostCapabilities(t, svc, parent.endpointID, parent.threadID)
	registerTestServiceForRun(t, parent, svc)
	if err := store.CreateThreadSettings(context.Background(), threadstore.ThreadSettings{
		EndpointID: parent.endpointID, ThreadID: parent.threadID, PermissionType: "approval_required",
	}); err != nil {
		t.Fatal(err)
	}
	parentSnapshot := permissionSnapshotWithOwnerIdentity(
		buildPermissionSnapshot(FlowerPermissionApprovalRequired, nil, nil), parent.endpointID, parent.threadID, parent.id,
	)
	parent.setPermissionState(parentSnapshot.PermissionType, parentSnapshot)
	if err := parent.persistPermissionSnapshot(parentSnapshot); err != nil {
		t.Fatal(err)
	}
	for _, childThreadID := range childThreadIDs {
		insertPermissionPolicyChildSnapshot(t, parent, childThreadID)
	}
	runtime := newFloretSubagentRuntimeWithExecutionOwner(parent, func(_ *run, childThreadID string, childRunID string) (subagentExecutionCapabilities, error) {
		return svc.bindSubagentExecutionForParent(parent, childThreadID, childRunID)
	})
	runtime.host = host
	return runtime, parent
}
