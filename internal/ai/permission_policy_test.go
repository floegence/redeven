package ai

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	flruntime "github.com/floegence/floret/runtime"
	fltools "github.com/floegence/floret/tools"
	"github.com/floegence/redeven/internal/ai/threadstore"
	aitools "github.com/floegence/redeven/internal/ai/tools"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/session"
)

func newPermissionPolicyTestRun(t *testing.T, workspace string, permissionType FlowerPermissionType, messageID string) *run {
	t.Helper()
	svc := &Service{terminalProcesses: newTerminalProcessManager(nil)}
	t.Cleanup(svc.terminalProcesses.Close)
	r := newRun(runOptions{
		Log:          slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{})),
		AgentHomeDir: workspace,
		Shell:        "bash",
		Service:      svc,
		RunID:        "run_" + messageID,
		EndpointID:   "env_permission_policy",
		ThreadID:     "thread_" + messageID,
		UserPublicID: "user_permission_policy",
		SessionMeta: &session.Meta{
			EndpointID:   "env_permission_policy",
			UserPublicID: "user_permission_policy",
			CanRead:      true,
			CanWrite:     true,
			CanExecute:   true,
			CanAdmin:     true,
		},
		MessageID: messageID,
	})
	r.permissionType = permissionType
	freezePermissionPolicyTestSnapshot(t, r)
	return r
}

func freezePermissionPolicyTestSnapshot(t *testing.T, r *run) {
	t.Helper()
	registry := NewInMemoryToolRegistry()
	if err := registerBuiltInTools(registry, r); err != nil {
		t.Fatalf("registerBuiltInTools: %v", err)
	}
	permissionFilter := newPermissionToolFilter(!r.noUserInteraction)
	permissionFilter = r.withToolAllowlistFilter(permissionFilter)
	activeTools := permissionFilter.FilterTools(r.permissionType, registry.Snapshot())
	activeSignals := permissionFilter.FilterTools(r.permissionType, builtInControlSignalDefinitions())
	snapshot := r.freezePermissionSnapshot(buildPermissionSnapshot(r.permissionType, activeTools, activeSignals))
	if err := validatePermissionSnapshotConsistency(snapshot); err != nil {
		t.Fatalf("invalid permission snapshot: %v", err)
	}
}

func insertPermissionPolicyChildSnapshot(t *testing.T, parent *run, childThreadID string, toolNames ...string) PermissionSnapshot {
	t.Helper()
	registry := NewInMemoryToolRegistry()
	childRun := parent.subagentChildRun()
	childRunID := permissionPolicyTestChildRunID(childThreadID)
	if childRunID == "child_run_" || childRunID == strings.TrimSpace(childThreadID) || (parent != nil && childRunID == strings.TrimSpace(parent.id)) {
		t.Fatalf("invalid test child run id %q for thread %q", childRunID, childThreadID)
	}
	if err := registerBuiltInTools(registry, childRun); err != nil {
		t.Fatalf("registerBuiltInTools: %v", err)
	}
	activeTools := make([]ToolDef, 0, len(toolNames))
	for _, name := range toolNames {
		def, _, ok := registry.resolve(name)
		if !ok {
			t.Fatalf("resolve tool %q", name)
		}
		activeTools = append(activeTools, def)
	}
	snapshot := permissionSnapshotWithOwnerIdentity(buildPermissionSnapshot(parent.permissionType, activeTools, nil), parent.endpointID, childThreadID, childRunID)
	if err := parent.insertChildPermissionSnapshot(childThreadID, childRunID, "spawn_"+childThreadID, snapshot); err != nil {
		t.Fatalf("insertChildPermissionSnapshot: %v", err)
	}
	return snapshot
}

func insertPermissionPolicyChildSnapshotRecord(t *testing.T, parent *run, childThreadID string, snapshot PermissionSnapshot, mutate func(*threadstore.ChildPermissionSnapshotRecord)) {
	t.Helper()
	childRunID := permissionPolicyTestChildRunID(childThreadID)
	payload, err := json.Marshal(snapshot)
	if err != nil {
		t.Fatalf("marshal child snapshot: %v", err)
	}
	rec := threadstore.ChildPermissionSnapshotRecord{
		ChildSnapshotID:   snapshot.SnapshotID,
		EndpointID:        parent.endpointID,
		ParentSnapshotID:  parent.permissionSnapshot.SnapshotID,
		SpawnToolCallID:   "spawn_" + childThreadID,
		ParentThreadID:    parent.threadID,
		ParentRunID:       parent.id,
		SubagentID:        childThreadID,
		ChildThreadID:     childThreadID,
		ChildRunID:        childRunID,
		State:             "finalized",
		SnapshotJSON:      string(payload),
		SnapshotHash:      snapshot.SnapshotHash,
		RegistryHash:      snapshot.RegistryHash,
		SchemaHash:        snapshot.SchemaHash,
		PresentationHash:  snapshot.PresentationHash,
		CreatedAtUnixMs:   time.Now().UnixMilli(),
		FinalizedAtUnixMs: time.Now().UnixMilli(),
	}
	if mutate != nil {
		mutate(&rec)
	}
	if err := parent.threadsDB.InsertChildPermissionSnapshot(context.Background(), rec); err != nil {
		t.Fatalf("InsertChildPermissionSnapshot: %v", err)
	}
}

func buildPermissionPolicySnapshotForTools(t *testing.T, r *run, ownerThreadID string, toolNames ...string) PermissionSnapshot {
	t.Helper()
	ownerRunID := permissionPolicyTestChildRunID(ownerThreadID)
	registry := NewInMemoryToolRegistry()
	if err := registerBuiltInTools(registry, r); err != nil {
		t.Fatalf("registerBuiltInTools: %v", err)
	}
	activeTools := make([]ToolDef, 0, len(toolNames))
	for _, name := range toolNames {
		def, _, ok := registry.resolve(name)
		if !ok {
			t.Fatalf("resolve tool %q", name)
		}
		activeTools = append(activeTools, def)
	}
	return permissionSnapshotWithOwnerIdentity(buildPermissionSnapshot(r.permissionType, activeTools, nil), r.endpointID, ownerThreadID, ownerRunID)
}

func permissionPolicyTestChildRunID(childThreadID string) string {
	return "child_run_" + strings.TrimSpace(childThreadID)
}

func configurePermissionPolicyDelegatedChild(t *testing.T, parent *run, child *run, childThreadID string, toolNames ...string) {
	t.Helper()
	if len(toolNames) == 0 {
		toolNames = []string{"terminal.exec"}
	}
	if child != nil && child.service == nil && parent != nil {
		child.service = parent.service
	}
	if parent != nil && parent.threadsDB == nil && parent.service != nil {
		parent.threadsDB = parent.service.threadsDB
	}
	if parent != nil {
		parent.persistPermissionSnapshot(parent.permissionSnapshot)
	}
	if child != nil && child.threadsDB == nil {
		if child.service != nil {
			child.threadsDB = child.service.threadsDB
		} else if parent != nil {
			child.threadsDB = parent.threadsDB
		}
	}
	child.noUserInteraction = true
	child.allowDelegatedApproval = true
	child.delegatedApprovalParent = parent
	child.subagentDepth = 1
	child.threadID = childThreadID
	child.id = permissionPolicyTestChildRunID(childThreadID)
	insertPermissionPolicyChildSnapshot(t, parent, childThreadID, toolNames...)
}

func newPermissionPolicyBridgeService(t *testing.T) *Service {
	t.Helper()
	store, err := threadstore.Open(filepath.Join(t.TempDir(), "threads.sqlite"))
	if err != nil {
		t.Fatalf("threadstore.Open: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	manager := newTerminalProcessManager(nil)
	t.Cleanup(manager.Close)
	return &Service{
		flowerLiveByThread: map[string]*flowerLiveThreadStream{},
		delegatedApprovals: map[string]*delegatedApprovalHandle{},
		threadsDB:          store,
		persistOpTO:        time.Second,
		terminalProcesses:  manager,
	}
}

func TestPermissionPolicy_ParentInvocationRejectsMismatchedFloretRunID(t *testing.T) {
	t.Parallel()

	workspace := t.TempDir()
	svc := newPermissionPolicyBridgeService(t)
	parent := newPermissionPolicyTestRun(t, workspace, FlowerPermissionApprovalRequired, "parent_identity_mismatch")
	parent.service = svc
	parent.threadsDB = svc.threadsDB

	execRun, err := floretInvocationRunContext(parent, fltools.Invocation[map[string]any]{
		RunID:    "wrong_floret_run",
		ThreadID: parent.threadID,
		TurnID:   parent.messageID,
	})
	if err == nil || !strings.Contains(err.Error(), "run identity mismatch") {
		t.Fatalf("floretInvocationRunContext err=%v, want run identity mismatch", err)
	}
	if execRun != nil {
		t.Fatalf("mismatched parent identity returned run: %#v", execRun)
	}
	if rec, ok, err := svc.threadsDB.GetFinalizedChildPermissionSnapshot(context.Background(), parent.endpointID, "child_identity_mismatch", "child_run_identity_mismatch"); err != nil {
		t.Fatalf("GetFinalizedChildPermissionSnapshot: %v", err)
	} else if ok {
		t.Fatalf("mismatched parent identity created child snapshot: %#v", rec)
	}
}

func TestPermissionPolicy_ChildInvocationUsesStoredPermissionSnapshot(t *testing.T) {
	t.Parallel()

	workspace := t.TempDir()
	svc := newPermissionPolicyBridgeService(t)
	parent := newPermissionPolicyTestRun(t, workspace, FlowerPermissionApprovalRequired, "child_snapshot_invocation")
	parent.service = svc
	parent.threadsDB = svc.threadsDB
	freezePermissionPolicyTestSnapshot(t, parent)
	childThreadID := "child_snapshot_invocation"
	snapshot := insertPermissionPolicyChildSnapshot(t, parent, childThreadID, "okf.search")
	childBase := parent.subagentChildRun()
	childBase.permissionType = FlowerPermissionFullAccess
	childRunID := permissionPolicyTestChildRunID(childThreadID)

	execRun, err := floretInvocationRunContext(childBase, fltools.Invocation[map[string]any]{
		RunID:    "floret-exec-child-snapshot-invocation",
		ThreadID: childThreadID,
		TurnID:   "child-turn",
		HostContext: map[string]string{
			subagentToolHostContextChildThreadIDKey: childThreadID,
			subagentToolHostContextChildRunIDKey:    childRunID,
		},
	})
	if err != nil {
		t.Fatalf("floretInvocationRunContext: %v", err)
	}
	if execRun == nil {
		t.Fatalf("floretInvocationRunContext returned nil")
	}
	if got := execRun.permissionSnapshot.SnapshotID; got != snapshot.SnapshotID {
		t.Fatalf("child snapshot id=%q, want stored snapshot %q", got, snapshot.SnapshotID)
	}
	if execRun.id != childRunID ||
		execRun.settlementRunID != "floret-exec-child-snapshot-invocation" ||
		execRun.threadID != childThreadID ||
		execRun.settlementThreadID != childThreadID ||
		execRun.messageID != "child-turn" ||
		execRun.settlementTurnID != "child-turn" {
		t.Fatalf("child run identities audit=(%s,%s,%s) settlement=(%s,%s,%s), want audit child_run_id plus Floret execution identity",
			execRun.threadID, execRun.id, execRun.messageID,
			execRun.settlementThreadID, execRun.settlementRunID, execRun.settlementTurnID)
	}
	if decision, ok := execRun.permissionDecisionForToolFromSnapshot("terminal.exec"); !ok || decision != ApprovalDecisionDeny {
		t.Fatalf("terminal.exec decision=%q ok=%v, want snapshot deny", decision, ok)
	}
	if decision, ok := execRun.permissionDecisionForToolFromSnapshot("okf.search"); !ok || decision != ApprovalDecisionAllow {
		t.Fatalf("okf.search decision=%q ok=%v, want snapshot allow", decision, ok)
	}
}

func TestPermissionPolicy_ChildSnapshotWithWidenedToolSetFailsClosed(t *testing.T) {
	t.Parallel()

	workspace := t.TempDir()
	svc := newPermissionPolicyBridgeService(t)
	parent := newPermissionPolicyTestRun(t, workspace, FlowerPermissionApprovalRequired, "child_snapshot_widened")
	parent.service = svc
	parent.threadsDB = svc.threadsDB
	freezePermissionPolicyTestSnapshot(t, parent)
	childThreadID := "child_snapshot_widened"
	childRun := parent.subagentChildRun()
	widened := buildPermissionPolicySnapshotForTools(t, childRun, childThreadID, "okf.search", "read_file")
	insertPermissionPolicyChildSnapshotRecord(t, parent, childThreadID, widened, nil)
	childRunID := permissionPolicyTestChildRunID(childThreadID)

	execRun, err := floretInvocationRunContext(parent.subagentChildRun(), fltools.Invocation[map[string]any]{
		RunID:    "floret-exec-child-snapshot-widened",
		ThreadID: childThreadID,
		TurnID:   "child-turn",
		HostContext: map[string]string{
			subagentToolHostContextChildThreadIDKey: childThreadID,
			subagentToolHostContextChildRunIDKey:    childRunID,
		},
	})
	if err != nil {
		t.Fatalf("floretInvocationRunContext: %v", err)
	}
	if execRun == nil {
		t.Fatalf("floretInvocationRunContext returned nil")
	}
	if got := execRun.permissionSnapshot.SnapshotID; got != "missing_child_permission_snapshot" {
		t.Fatalf("child snapshot id=%q, want fail-closed snapshot", got)
	}
	if decision, ok := execRun.permissionDecisionForToolFromSnapshot("okf.search"); !ok || decision != ApprovalDecisionDeny {
		t.Fatalf("okf.search decision=%q ok=%v, want fail-closed deny", decision, ok)
	}
}

func TestPermissionPolicy_ChildSnapshotHashMismatchFailsClosed(t *testing.T) {
	t.Parallel()

	workspace := t.TempDir()
	svc := newPermissionPolicyBridgeService(t)
	parent := newPermissionPolicyTestRun(t, workspace, FlowerPermissionApprovalRequired, "child_snapshot_hash")
	parent.service = svc
	parent.threadsDB = svc.threadsDB
	freezePermissionPolicyTestSnapshot(t, parent)
	childThreadID := "child_snapshot_hash"
	childRun := parent.subagentChildRun()
	snapshot := buildPermissionPolicySnapshotForTools(t, childRun, childThreadID, "okf.search")
	insertPermissionPolicyChildSnapshotRecord(t, parent, childThreadID, snapshot, func(rec *threadstore.ChildPermissionSnapshotRecord) {
		rec.SnapshotHash = "tampered_hash"
	})
	childRunID := permissionPolicyTestChildRunID(childThreadID)

	execRun, err := floretInvocationRunContext(parent.subagentChildRun(), fltools.Invocation[map[string]any]{
		RunID:    "floret-exec-child-snapshot-hash",
		ThreadID: childThreadID,
		TurnID:   "child-turn",
		HostContext: map[string]string{
			subagentToolHostContextChildThreadIDKey: childThreadID,
			subagentToolHostContextChildRunIDKey:    childRunID,
		},
	})
	if err != nil {
		t.Fatalf("floretInvocationRunContext: %v", err)
	}
	if execRun == nil {
		t.Fatalf("floretInvocationRunContext returned nil")
	}
	if got := execRun.permissionSnapshot.SnapshotID; got != "missing_child_permission_snapshot" {
		t.Fatalf("child snapshot id=%q, want fail-closed snapshot", got)
	}
	if decision, ok := execRun.permissionDecisionForToolFromSnapshot("okf.search"); !ok || decision != ApprovalDecisionDeny {
		t.Fatalf("okf.search decision=%q ok=%v, want fail-closed deny", decision, ok)
	}
}

func TestPermissionPolicy_ChildSnapshotCompatibilityHashMismatchFailsClosed(t *testing.T) {
	t.Parallel()

	for _, tc := range []struct {
		name   string
		mutate func(*PermissionSnapshot, *threadstore.ChildPermissionSnapshotRecord)
	}{
		{
			name: "record_registry_hash",
			mutate: func(_ *PermissionSnapshot, rec *threadstore.ChildPermissionSnapshotRecord) {
				rec.RegistryHash = "tampered_registry_hash"
			},
		},
		{
			name: "record_schema_hash",
			mutate: func(_ *PermissionSnapshot, rec *threadstore.ChildPermissionSnapshotRecord) {
				rec.SchemaHash = "tampered_schema_hash"
			},
		},
		{
			name: "record_presentation_hash",
			mutate: func(_ *PermissionSnapshot, rec *threadstore.ChildPermissionSnapshotRecord) {
				rec.PresentationHash = "tampered_presentation_hash"
			},
		},
		{
			name: "current_registry_incompatible",
			mutate: func(snapshot *PermissionSnapshot, rec *threadstore.ChildPermissionSnapshotRecord) {
				snapshot.RegistryHash = stableStringListHash(snapshot.FloretToolNames)
				snapshot.SnapshotHash = permissionSnapshotHash(*snapshot)
				payload, err := json.Marshal(snapshot)
				if err != nil {
					panic(err)
				}
				rec.SnapshotJSON = string(payload)
				rec.SnapshotHash = snapshot.SnapshotHash
				rec.RegistryHash = snapshot.RegistryHash
			},
		},
		{
			name: "current_schema_incompatible",
			mutate: func(snapshot *PermissionSnapshot, rec *threadstore.ChildPermissionSnapshotRecord) {
				snapshot.SchemaHash = stableStringListHash(snapshot.FloretToolNames)
				snapshot.SnapshotHash = permissionSnapshotHash(*snapshot)
				payload, err := json.Marshal(snapshot)
				if err != nil {
					panic(err)
				}
				rec.SnapshotJSON = string(payload)
				rec.SnapshotHash = snapshot.SnapshotHash
				rec.SchemaHash = snapshot.SchemaHash
			},
		},
		{
			name: "current_presentation_incompatible",
			mutate: func(snapshot *PermissionSnapshot, rec *threadstore.ChildPermissionSnapshotRecord) {
				snapshot.PresentationHash = stableStringListHash(snapshot.PromptCapabilityNames)
				snapshot.SnapshotHash = permissionSnapshotHash(*snapshot)
				payload, err := json.Marshal(snapshot)
				if err != nil {
					panic(err)
				}
				rec.SnapshotJSON = string(payload)
				rec.SnapshotHash = snapshot.SnapshotHash
				rec.PresentationHash = snapshot.PresentationHash
			},
		},
	} {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			workspace := t.TempDir()
			svc := newPermissionPolicyBridgeService(t)
			parent := newPermissionPolicyTestRun(t, workspace, FlowerPermissionApprovalRequired, "child_snapshot_"+tc.name)
			parent.service = svc
			parent.threadsDB = svc.threadsDB
			freezePermissionPolicyTestSnapshot(t, parent)
			childThreadID := "child_snapshot_" + tc.name
			childRun := parent.subagentChildRun()
			snapshot := buildPermissionPolicySnapshotForTools(t, childRun, childThreadID, "okf.search")
			insertPermissionPolicyChildSnapshotRecord(t, parent, childThreadID, snapshot, func(rec *threadstore.ChildPermissionSnapshotRecord) {
				mutated := snapshot
				tc.mutate(&mutated, rec)
			})

			childRunID := permissionPolicyTestChildRunID(childThreadID)
			execRun, err := floretInvocationRunContext(parent.subagentChildRun(), fltools.Invocation[map[string]any]{
				RunID:    "floret-exec-" + childThreadID,
				ThreadID: childThreadID,
				TurnID:   "child-turn",
				HostContext: map[string]string{
					subagentToolHostContextChildThreadIDKey: childThreadID,
					subagentToolHostContextChildRunIDKey:    childRunID,
				},
			})
			if err != nil {
				t.Fatalf("floretInvocationRunContext: %v", err)
			}
			if execRun == nil {
				t.Fatalf("floretInvocationRunContext returned nil")
			}
			if got := execRun.permissionSnapshot.SnapshotID; got != "missing_child_permission_snapshot" {
				t.Fatalf("child snapshot id=%q, want fail-closed snapshot", got)
			}
			if decision, ok := execRun.permissionDecisionForToolFromSnapshot("okf.search"); !ok || decision != ApprovalDecisionDeny {
				t.Fatalf("okf.search decision=%q ok=%v, want fail-closed deny", decision, ok)
			}
		})
	}
}

func TestPermissionPolicy_ChildSnapshotParentOwnerMismatchFailsClosed(t *testing.T) {
	t.Parallel()

	for _, tc := range []struct {
		name   string
		mutate func(*threadstore.ChildPermissionSnapshotRecord)
	}{
		{
			name: "parent_thread",
			mutate: func(rec *threadstore.ChildPermissionSnapshotRecord) {
				rec.ParentThreadID = "thread_intruder"
			},
		},
		{
			name: "parent_run",
			mutate: func(rec *threadstore.ChildPermissionSnapshotRecord) {
				rec.ParentRunID = "run_intruder"
			},
		},
	} {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			workspace := t.TempDir()
			svc := newPermissionPolicyBridgeService(t)
			parent := newPermissionPolicyTestRun(t, workspace, FlowerPermissionApprovalRequired, "child_snapshot_parent_owner_"+tc.name)
			parent.service = svc
			parent.threadsDB = svc.threadsDB
			freezePermissionPolicyTestSnapshot(t, parent)
			childThreadID := "child_snapshot_parent_owner_" + tc.name
			childRun := parent.subagentChildRun()
			snapshot := buildPermissionPolicySnapshotForTools(t, childRun, childThreadID, "okf.search")
			insertPermissionPolicyChildSnapshotRecord(t, parent, childThreadID, snapshot, tc.mutate)

			childRunID := permissionPolicyTestChildRunID(childThreadID)
			execRun, err := floretInvocationRunContext(parent.subagentChildRun(), fltools.Invocation[map[string]any]{
				RunID:    "floret-exec-" + childThreadID,
				ThreadID: childThreadID,
				TurnID:   "child-turn",
				HostContext: map[string]string{
					subagentToolHostContextChildThreadIDKey: childThreadID,
					subagentToolHostContextChildRunIDKey:    childRunID,
				},
			})
			if err != nil {
				t.Fatalf("floretInvocationRunContext: %v", err)
			}
			if execRun == nil {
				t.Fatalf("floretInvocationRunContext returned nil")
			}
			if got := execRun.permissionSnapshot.SnapshotID; got != "missing_child_permission_snapshot" {
				t.Fatalf("child snapshot id=%q, want fail-closed snapshot", got)
			}
			if decision, ok := execRun.permissionDecisionForToolFromSnapshot("okf.search"); !ok || decision != ApprovalDecisionDeny {
				t.Fatalf("okf.search decision=%q ok=%v, want fail-closed deny", decision, ok)
			}
		})
	}
}

func TestPermissionPolicy_ChildSnapshotInvalidRunIdentityFailsClosed(t *testing.T) {
	t.Parallel()

	for _, tc := range []struct {
		name       string
		childRunID func(parent *run, childThreadID string) string
	}{
		{
			name: "missing",
			childRunID: func(_ *run, _ string) string {
				return ""
			},
		},
		{
			name: "thread_alias",
			childRunID: func(_ *run, childThreadID string) string {
				return childThreadID
			},
		},
		{
			name: "parent_alias",
			childRunID: func(parent *run, _ string) string {
				return parent.id
			},
		},
	} {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			workspace := t.TempDir()
			dbPath := filepath.Join(t.TempDir(), "threads.sqlite")
			store, err := threadstore.Open(dbPath)
			if err != nil {
				t.Fatalf("threadstore.Open: %v", err)
			}
			t.Cleanup(func() { _ = store.Close() })
			svc := &Service{
				flowerLiveByThread: map[string]*flowerLiveThreadStream{},
				delegatedApprovals: map[string]*delegatedApprovalHandle{},
				threadsDB:          store,
				persistOpTO:        time.Second,
			}
			parent := newPermissionPolicyTestRun(t, workspace, FlowerPermissionApprovalRequired, "child_snapshot_identity_"+tc.name)
			parent.service = svc
			parent.threadsDB = svc.threadsDB
			freezePermissionPolicyTestSnapshot(t, parent)
			childThreadID := "child_snapshot_identity_" + tc.name
			childRun := parent.subagentChildRun()
			snapshot := buildPermissionPolicySnapshotForTools(t, childRun, childThreadID, "okf.search")
			insertPermissionPolicyChildSnapshotRecord(t, parent, childThreadID, snapshot, nil)
			rawDB, err := sql.Open("sqlite", dbPath)
			if err != nil {
				t.Fatalf("sql.Open raw store: %v", err)
			}
			t.Cleanup(func() { _ = rawDB.Close() })
			if _, err := rawDB.ExecContext(context.Background(), `
UPDATE ai_child_permission_snapshots
SET child_run_id = ?
WHERE endpoint_id = ? AND child_thread_id = ?
`, tc.childRunID(parent, childThreadID), parent.endpointID, childThreadID); err != nil {
				t.Fatalf("corrupt child_run_id: %v", err)
			}

			childRunID := permissionPolicyTestChildRunID(childThreadID)
			execRun, err := floretInvocationRunContext(parent.subagentChildRun(), fltools.Invocation[map[string]any]{
				RunID:    "floret-exec-" + childThreadID,
				ThreadID: childThreadID,
				TurnID:   "child-turn",
				HostContext: map[string]string{
					subagentToolHostContextChildThreadIDKey: childThreadID,
					subagentToolHostContextChildRunIDKey:    childRunID,
				},
			})
			if err != nil {
				t.Fatalf("floretInvocationRunContext: %v", err)
			}
			if execRun == nil {
				t.Fatalf("floretInvocationRunContext returned nil")
			}
			if got := execRun.permissionSnapshot.SnapshotID; got != "missing_child_permission_snapshot" {
				t.Fatalf("child snapshot id=%q, want fail-closed snapshot", got)
			}
			if decision, ok := execRun.permissionDecisionForToolFromSnapshot("okf.search"); !ok || decision != ApprovalDecisionDeny {
				t.Fatalf("okf.search decision=%q ok=%v, want fail-closed deny", decision, ok)
			}
		})
	}
}

func TestPermissionPolicy_DelegatedApprovalRefUsesExplicitChildRunID(t *testing.T) {
	t.Parallel()

	parent := &run{threadID: "thread_parent", id: "run_parent", messageID: "turn_parent"}
	child := &run{threadID: "thread_child", id: "thread_child", messageID: "turn_child"}
	ref := delegatedApprovalRef(parent, child, fltools.ApprovalRequest{
		ID:         "tool_call_child",
		ApprovalID: "approval_child",
		HostContext: map[string]string{
			subagentToolHostContextChildThreadIDKey: "thread_child",
			subagentToolHostContextChildRunIDKey:    "run_child_actual",
		},
	})
	if ref.ChildRunID != "run_child_actual" {
		t.Fatalf("child_run_id=%q, want explicit child run id", ref.ChildRunID)
	}

	ref = delegatedApprovalRef(parent, child, fltools.ApprovalRequest{
		ID:         "tool_call_fallback",
		ApprovalID: "approval_fallback",
		HostContext: map[string]string{
			subagentToolHostContextChildThreadIDKey: "thread_child",
		},
	})
	if ref.ChildRunID != "" || validDelegatedApprovalRef(ref) {
		t.Fatalf("fallback child_run_id=%q valid=%v, want missing run id to fail closed", ref.ChildRunID, validDelegatedApprovalRef(ref))
	}

	ref = delegatedApprovalRef(parent, child, fltools.ApprovalRequest{
		ID:         "tool_call_thread_alias",
		ApprovalID: "approval_thread_alias",
		HostContext: map[string]string{
			subagentToolHostContextChildThreadIDKey: "thread_child",
			subagentToolHostContextChildRunIDKey:    "thread_child",
		},
	})
	if ref.ChildRunID != "" || validDelegatedApprovalRef(ref) {
		t.Fatalf("thread alias child_run_id=%q valid=%v, want explicit thread alias to fail closed", ref.ChildRunID, validDelegatedApprovalRef(ref))
	}

	ref = delegatedApprovalRef(parent, child, fltools.ApprovalRequest{
		ID:         "tool_call_parent_alias",
		ApprovalID: "approval_parent_alias",
		HostContext: map[string]string{
			subagentToolHostContextChildThreadIDKey: "thread_child",
			subagentToolHostContextChildRunIDKey:    "run_parent",
		},
	})
	if ref.ChildRunID != "" || validDelegatedApprovalRef(ref) {
		t.Fatalf("parent alias child_run_id=%q valid=%v, want explicit parent run alias to fail closed", ref.ChildRunID, validDelegatedApprovalRef(ref))
	}
}

func TestPermissionPolicy_DelegatedApprovalRejectsParentRunAliasChildRunID(t *testing.T) {
	t.Parallel()

	workspace := t.TempDir()
	svc := newPermissionPolicyBridgeService(t)
	parent := newPermissionPolicyTestRun(t, workspace, FlowerPermissionApprovalRequired, "msg_parent_alias")
	parent.service = svc
	child := newPermissionPolicyTestRun(t, workspace, FlowerPermissionApprovalRequired, "msg_child_alias")
	child.service = svc
	child.noUserInteraction = true
	child.allowDelegatedApproval = true
	child.delegatedApprovalParent = parent
	child.subagentDepth = 1
	child.threadID = "child_thread_alias"

	_, _, err := svc.registerDelegatedApproval(parent, child, fltools.ApprovalRequest{
		ID:         "tool_child_alias",
		ApprovalID: "approval_child_alias",
		Name:       "terminal.exec",
		Args:       `{"command":"pwd"}`,
		ArgsHash:   "args-alias",
		ValidatedArgs: map[string]any{
			"command": "pwd",
		},
		HostContext: map[string]string{
			subagentToolHostContextChildThreadIDKey: "child_thread_alias",
			subagentToolHostContextSubagentIDKey:    "child_thread_alias",
			subagentToolHostContextChildRunIDKey:    parent.id,
		},
	})
	if err == nil || !strings.Contains(err.Error(), "missing identity") {
		t.Fatalf("register delegated approval error=%v, want missing identity", err)
	}
}

func TestPermissionPolicy_DelegatedApprovalRejectsChildSnapshotRunIDMismatch(t *testing.T) {
	t.Parallel()

	workspace := t.TempDir()
	svc := newPermissionPolicyBridgeService(t)
	parent := newPermissionPolicyTestRun(t, workspace, FlowerPermissionApprovalRequired, "msg_parent_snapshot_mismatch")
	parent.service = svc
	parent.threadsDB = svc.threadsDB
	childThreadID := "child_thread_snapshot_mismatch"
	insertPermissionPolicyChildSnapshot(t, parent, childThreadID, "terminal.exec")
	child := newPermissionPolicyTestRun(t, workspace, FlowerPermissionApprovalRequired, "msg_child_snapshot_mismatch")
	child.service = svc
	child.noUserInteraction = true
	child.allowDelegatedApproval = true
	child.delegatedApprovalParent = parent
	child.subagentDepth = 1
	child.threadID = childThreadID
	child.id = "child_run_wrong_snapshot_mismatch"

	_, _, err := svc.registerDelegatedApproval(parent, child, fltools.ApprovalRequest{
		ID:         "tool_child_snapshot_mismatch",
		ApprovalID: "approval_child_snapshot_mismatch",
		Name:       "terminal.exec",
		Args:       `{"command":"pwd"}`,
		ArgsHash:   "args-snapshot-mismatch",
		ValidatedArgs: map[string]any{
			"command": "pwd",
		},
		HostContext: map[string]string{
			subagentToolHostContextChildThreadIDKey: childThreadID,
			subagentToolHostContextSubagentIDKey:    childThreadID,
			subagentToolHostContextChildRunIDKey:    child.id,
		},
	})
	if err == nil || !strings.Contains(err.Error(), "identity mismatch") {
		t.Fatalf("register delegated approval error=%v, want identity mismatch", err)
	}
}

func TestPermissionPolicy_DelegatedApprovalActionOmitsMainApprovalIDs(t *testing.T) {
	t.Parallel()

	parent := &run{threadID: "thread_parent", id: "run_parent", messageID: "turn_parent"}
	child := &run{threadID: "thread_child", id: "run_child", messageID: "turn_child"}
	ref := delegatedApprovalRef(parent, child, fltools.ApprovalRequest{
		ID:         "tool_call_child",
		ApprovalID: "approval_child",
		Name:       "terminal.exec",
		HostContext: map[string]string{
			subagentToolHostContextChildThreadIDKey: "thread_child",
			subagentToolHostContextChildRunIDKey:    "run_child",
		},
	})
	action := delegatedApprovalAction(parent, child, fltools.ApprovalRequest{
		ID:         "tool_call_child",
		ApprovalID: "approval_child",
		Name:       "terminal.exec",
	}, ref, "dappr_contract", 100, 200)
	payload := mustFlowerPayload(action)
	var decoded map[string]any
	if err := json.Unmarshal(payload, &decoded); err != nil {
		t.Fatalf("delegated approval action payload invalid: %v", err)
	}
	if _, ok := decoded["run_id"]; ok {
		t.Fatalf("delegated approval payload includes run_id: %s", payload)
	}
	if _, ok := decoded["tool_id"]; ok {
		t.Fatalf("delegated approval payload includes tool_id: %s", payload)
	}
	refPayload, ok := decoded["delegated_ref"].(map[string]any)
	if !ok {
		t.Fatalf("delegated approval payload missing delegated_ref: %#v", decoded)
	}
	if refPayload["parent_run_id"] != "run_parent" || refPayload["child_tool_call_id"] != "tool_call_child" {
		t.Fatalf("delegated ref payload=%#v, want parent run and child tool call identity", refPayload)
	}
}

func TestPermissionPolicy_ChildApprovalUsesStoredPermissionSnapshot(t *testing.T) {
	t.Parallel()

	workspace := t.TempDir()
	svc := newPermissionPolicyBridgeService(t)
	parent := newPermissionPolicyTestRun(t, workspace, FlowerPermissionApprovalRequired, "child_snapshot_approval")
	parent.service = svc
	parent.threadsDB = svc.threadsDB
	freezePermissionPolicyTestSnapshot(t, parent)
	childThreadID := "child_snapshot_approval"
	insertPermissionPolicyChildSnapshot(t, parent, childThreadID, "okf.search")
	childRunID := permissionPolicyTestChildRunID(childThreadID)
	childBase := parent.subagentChildRun()
	childBase.permissionType = FlowerPermissionFullAccess

	decision, err := childBase.approveFloretTool(context.Background(), fltools.ApprovalRequest{
		ID:       "tool_call_1",
		Name:     "terminal.exec",
		RunID:    "floret-exec-child-snapshot-approval",
		ThreadID: childThreadID,
		TurnID:   "child-turn",
		HostContext: map[string]string{
			subagentToolHostContextChildThreadIDKey: childThreadID,
			subagentToolHostContextChildRunIDKey:    childRunID,
		},
	})
	if err != nil {
		t.Fatalf("approveFloretTool: %v", err)
	}
	if decision.Allowed() || !strings.Contains(decision.RejectionReason(), "permission") {
		t.Fatalf("decision=%#v, want stored snapshot permission denial", decision)
	}
}

func TestPermissionPolicy_ChildInvocationMissingStoredSnapshotFailsClosed(t *testing.T) {
	t.Parallel()

	workspace := t.TempDir()
	svc := newPermissionPolicyBridgeService(t)
	parent := newPermissionPolicyTestRun(t, workspace, FlowerPermissionFullAccess, "child_snapshot_missing")
	parent.service = svc
	parent.threadsDB = svc.threadsDB
	freezePermissionPolicyTestSnapshot(t, parent)
	childBase := parent.subagentChildRun()
	childRunID := permissionPolicyTestChildRunID("child_missing")

	execRun, err := floretInvocationRunContext(childBase, fltools.Invocation[map[string]any]{
		RunID:    "floret-exec-child-missing",
		ThreadID: "child_missing",
		TurnID:   "child-turn",
		HostContext: map[string]string{
			subagentToolHostContextChildThreadIDKey: "child_missing",
			subagentToolHostContextChildRunIDKey:    childRunID,
		},
	})
	if err != nil {
		t.Fatalf("floretInvocationRunContext: %v", err)
	}
	if execRun == nil {
		t.Fatalf("floretInvocationRunContext returned nil")
	}
	if decision, ok := execRun.permissionDecisionForToolFromSnapshot("terminal.exec"); !ok || decision != ApprovalDecisionDeny {
		t.Fatalf("terminal.exec decision=%q ok=%v, want fail-closed deny", decision, ok)
	}
}

func waitDelegatedApprovalRequested(t *testing.T, svc *Service, endpointID string, threadID string) FlowerApprovalAction {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		svc.mu.Lock()
		stream := svc.flowerLiveByThread[runThreadKey(endpointID, threadID)]
		if stream != nil {
			for _, action := range stream.State.ApprovalActions {
				if action.Origin == FlowerApprovalOriginDelegatedSubagent && action.Status == FlowerApprovalStatusPending {
					svc.mu.Unlock()
					return action
				}
			}
		}
		svc.mu.Unlock()
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("delegated approval request was not raised")
	return FlowerApprovalAction{}
}

func approvalQueueRevisionForTest(svc *Service, endpointID string, threadID string) int64 {
	if svc == nil {
		return 0
	}
	svc.mu.Lock()
	defer svc.mu.Unlock()
	stream := svc.flowerLiveByThread[runThreadKey(endpointID, threadID)]
	if stream == nil || stream.State.ApprovalQueue == nil {
		return 0
	}
	return stream.State.ApprovalQueue.Revision
}

func waitApprovalRequested(t *testing.T, r *run, toolID string) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		r.mu.Lock()
		_, pending := r.toolApprovals[toolID]
		r.mu.Unlock()
		if pending {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("tool approval request was not raised for %s", toolID)
}

func assertNoApprovalWait(t *testing.T, r *run, toolID string) {
	t.Helper()
	r.mu.Lock()
	_, pending := r.toolApprovals[toolID]
	r.mu.Unlock()
	if pending {
		t.Fatalf("unexpected approval wait state: tool_id=%s pending=%v", toolID, pending)
	}
}

func runTerminalToolCall(t *testing.T, r *run, toolID string, args map[string]any, approve bool, expectApproval bool) *toolCallOutcome {
	t.Helper()
	return runBuiltinToolCall(t, r, toolID, "terminal.exec", args, approve, expectApproval)
}

func runBuiltinToolCall(t *testing.T, r *run, toolID string, toolName string, args map[string]any, approve bool, expectApproval bool) *toolCallOutcome {
	t.Helper()
	type result struct {
		outcome *toolCallOutcome
		err     error
	}

	done := make(chan result, 1)
	go func() {
		outcome, err := r.runBuiltInToolThroughFloret(context.Background(), toolID, toolName, args)
		done <- result{outcome: outcome, err: err}
	}()

	if expectApproval {
		waitApprovalRequested(t, r, toolID)
		if err := r.approveTool(toolID, approve); err != nil {
			t.Fatalf("approveTool: %v", err)
		}
	}

	select {
	case res := <-done:
		if res.err != nil {
			t.Fatalf("%s tool call returned error: %v", toolName, res.err)
		}
		if res.outcome == nil {
			t.Fatalf("missing tool call outcome")
		}
		assertNoApprovalWait(t, r, toolID)
		return res.outcome
	case <-time.After(3 * time.Second):
		if !expectApproval {
			r.mu.Lock()
			_, pending := r.toolApprovals[toolID]
			r.mu.Unlock()
			if pending {
				_ = r.approveTool(toolID, false)
				t.Fatalf("unexpected approval request for %s", toolID)
			}
		}
		t.Fatalf("timed out waiting for tool result")
		return nil
	}
}

func (r *run) runTerminalExecThroughFloret(ctx context.Context, toolID string, args map[string]any) (*toolCallOutcome, error) {
	return r.runBuiltInToolThroughFloret(ctx, toolID, "terminal.exec", args)
}

func (r *run) runBuiltInToolThroughFloret(ctx context.Context, toolID string, toolName string, args map[string]any) (*toolCallOutcome, error) {
	reg := NewInMemoryToolRegistry()
	if err := registerBuiltInTools(reg, r); err != nil {
		return nil, err
	}
	def, _, ok := reg.resolve(toolName)
	if !ok {
		return nil, fmt.Errorf("%s test tool is missing", toolName)
	}
	flReg, err := buildFloretToolRegistry(r, []ToolDef{def}, nil)
	if err != nil {
		return nil, err
	}
	raw, err := json.Marshal(args)
	if err != nil {
		return nil, err
	}
	result := flReg.RunWithOptions(ctx, fltools.ToolCall{
		ID:   strings.TrimSpace(toolID),
		Name: strings.TrimSpace(toolName),
		Args: string(raw),
	}, floretToolApproverForRun(r), permissionPolicyTestRunOptions(r))
	return toolCallOutcomeFromFloretResult(result), nil
}

func permissionPolicyTestRunOptions(r *run) fltools.RunOptions {
	if r == nil {
		return fltools.RunOptions{Step: 1}
	}
	opts := fltools.RunOptions{
		RunID:         strings.TrimSpace(r.id),
		ThreadID:      strings.TrimSpace(r.threadID),
		TurnID:        strings.TrimSpace(r.messageID),
		PromptScopeID: strings.TrimSpace(r.threadID),
		Step:          1,
	}
	if r.subagentDepth > 0 {
		childThreadID := strings.TrimSpace(r.threadID)
		childRunID := strings.TrimSpace(r.id)
		opts.HostContext = map[string]string{
			subagentToolHostContextChildThreadIDKey:    childThreadID,
			subagentToolHostContextSubagentIDKey:       childThreadID,
			subagentToolHostContextParentPermissionKey: permissionTypeString(r.permissionType),
		}
		if childRunID != "" && childRunID != childThreadID {
			opts.HostContext[subagentToolHostContextChildRunIDKey] = childRunID
		}
	}
	return opts
}

func toolCallOutcomeFromFloretResult(result fltools.Result) *toolCallOutcome {
	outcome := &toolCallOutcome{
		Success:  false,
		ToolName: strings.TrimSpace(result.Name),
		Args:     map[string]any{},
	}
	if result.Structured != nil {
		status := strings.TrimSpace(anyToString(result.Structured["status"]))
		outcome.Success = status == toolResultStatusSuccess && !result.IsError
		outcome.Result = result.Structured["data"]
		if errorPayload, ok := result.Structured["error"].(map[string]any); ok {
			outcome.ToolError = &aitools.ToolError{
				Code:      aitools.ErrorCode(strings.TrimSpace(anyToString(errorPayload["code"]))),
				Message:   strings.TrimSpace(anyToString(errorPayload["message"])),
				Retryable: readBoolField(errorPayload, "retryable"),
			}
			outcome.ToolError.Normalize()
		}
		if outcome.ToolError == nil && !outcome.Success {
			outcome.ToolError = &aitools.ToolError{Code: aitools.ErrorCodeUnknown, Message: strings.TrimSpace(anyToString(result.Structured["details"]))}
			outcome.ToolError.Normalize()
		}
		return outcome
	}
	if result.IsError {
		outcome.ToolError = &aitools.ToolError{Code: aitools.ErrorCodePermissionDenied, Message: strings.TrimSpace(result.Text)}
		outcome.ToolError.Normalize()
		return outcome
	}
	outcome.Success = true
	return outcome
}

func TestPermissionPolicy_ReadonlyDeniesTerminalExec(t *testing.T) {
	t.Parallel()

	workspace := t.TempDir()
	target := filepath.Join(workspace, "note.txt")
	r := newPermissionPolicyTestRun(t, workspace, FlowerPermissionReadonly, "msg_readonly_terminal")

	outcome := runTerminalToolCall(t, r, "tool_readonly_terminal", map[string]any{
		"command": "printf 'readonly denied' > note.txt",
	}, false, false)

	if outcome.Success {
		t.Fatalf("terminal.exec must be denied in readonly permission")
	}
	if outcome.ToolError == nil || outcome.ToolError.Code != aitools.ErrorCodePermissionDenied {
		t.Fatalf("tool error=%+v, want permission denied", outcome.ToolError)
	}
	if _, statErr := os.Stat(target); !os.IsNotExist(statErr) {
		t.Fatalf("target file should not be created, statErr=%v", statErr)
	}
}

func TestPermissionPolicy_ExecuteOnlyCannotLaunchTerminalProcess(t *testing.T) {
	t.Parallel()

	workspace := t.TempDir()
	target := filepath.Join(workspace, "execute-only.txt")
	r := newPermissionPolicyTestRun(t, workspace, FlowerPermissionFullAccess, "msg_execute_only_terminal")
	r.sessionMeta.CanWrite = false
	r.sessionMeta.CanExecute = true

	outcome := runTerminalToolCall(t, r, "tool_execute_only_terminal", map[string]any{
		"command": "printf 'must not run' > execute-only.txt",
	}, false, false)

	if outcome.Success {
		t.Fatalf("terminal.exec must be denied without write permission")
	}
	if outcome.ToolError == nil || outcome.ToolError.Code != aitools.ErrorCodePermissionDenied || !strings.Contains(outcome.ToolError.Message, "write and execute permissions") {
		t.Fatalf("tool error=%+v, want process permission denied", outcome.ToolError)
	}
	if _, statErr := os.Stat(target); !os.IsNotExist(statErr) {
		t.Fatalf("target file should not be created, statErr=%v", statErr)
	}
}

func TestPermissionPolicy_ReadonlyStandardHostToolsFailClosed(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name     string
		toolName string
		args     map[string]any
		path     string
	}{
		{
			name:     "file_write",
			toolName: "file.write",
			args:     map[string]any{"file_path": "written.txt", "content": "blocked"},
			path:     "written.txt",
		},
		{
			name:     "file_edit",
			toolName: "file.edit",
			args:     map[string]any{"file_path": "edit.txt", "old_string": "before", "new_string": "after"},
			path:     "edit.txt",
		},
		{
			name:     "apply_patch",
			toolName: "apply_patch",
			args: map[string]any{"patch": strings.Join([]string{
				"*** Begin Patch",
				"*** Add File: patched.txt",
				"+blocked",
				"*** End Patch",
			}, "\n")},
			path: "patched.txt",
		},
		{
			name:     "use_skill",
			toolName: "use_skill",
			args:     map[string]any{"name": "frontend-design"},
		},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			workspace := t.TempDir()
			if tc.toolName == "file.edit" {
				if err := os.WriteFile(filepath.Join(workspace, tc.path), []byte("before"), 0o644); err != nil {
					t.Fatalf("write seed: %v", err)
				}
			}
			r := newPermissionPolicyTestRun(t, workspace, FlowerPermissionReadonly, "msg_readonly_standard_"+tc.name)
			toolID := "tool_readonly_standard_" + tc.name
			outcome, err := r.runBuiltInToolThroughFloret(context.Background(), toolID, tc.toolName, tc.args)
			if err != nil {
				t.Fatalf("run %s through Floret: %v", tc.toolName, err)
			}
			if outcome == nil || outcome.Success || outcome.ToolError == nil || outcome.ToolError.Code != aitools.ErrorCodePermissionDenied {
				t.Fatalf("%s outcome=%+v, want permission denied", tc.toolName, outcome)
			}
			assertNoApprovalWait(t, r, toolID)

			if _, err := r.execTool(context.Background(), r.sessionMeta, toolID+"_direct", tc.toolName, tc.args); err == nil || !strings.Contains(err.Error(), "unavailable") {
				t.Fatalf("direct execTool(%s) error=%v, want unavailable", tc.toolName, err)
			}
			if tc.path != "" {
				got, statErr := os.ReadFile(filepath.Join(workspace, tc.path))
				if tc.toolName == "file.edit" {
					if statErr != nil || string(got) != "before" {
						t.Fatalf("seed file after readonly edit statErr=%v content=%q, want before", statErr, string(got))
					}
				} else if !os.IsNotExist(statErr) {
					t.Fatalf("%s should not exist after readonly denial, statErr=%v content=%q", tc.path, statErr, string(got))
				}
			}
		})
	}
}

func TestPermissionPolicy_ReadonlyAllowsReadFileWithoutApproval(t *testing.T) {
	t.Parallel()

	workspace := t.TempDir()
	if err := os.WriteFile(filepath.Join(workspace, "note.txt"), []byte("hello readonly\n"), 0o644); err != nil {
		t.Fatalf("write note: %v", err)
	}
	r := newPermissionPolicyTestRun(t, workspace, FlowerPermissionReadonly, "msg_readonly_read_file")

	outcome, err := r.runBuiltInToolThroughFloret(context.Background(), "tool_readonly_read_file", "read_file", map[string]any{
		"path":  "note.txt",
		"limit": 20,
	})
	if err != nil {
		t.Fatalf("run read_file through Floret: %v", err)
	}
	if !outcome.Success {
		t.Fatalf("read_file should succeed without approval, err=%+v", outcome.ToolError)
	}
	assertNoApprovalWait(t, r, "tool_readonly_read_file")
	data, ok := outcome.Result.(map[string]any)
	if !ok {
		t.Fatalf("result=%#v, want map", outcome.Result)
	}
	if !strings.Contains(anyToString(data["content"]), "hello readonly") {
		t.Fatalf("content=%#v, want file contents", data["content"])
	}
}

func TestPermissionPolicy_ReadonlyAllowsWebFetchWithoutApproval(t *testing.T) {
	t.Parallel()

	workspace := t.TempDir()
	r := newPermissionPolicyTestRun(t, workspace, FlowerPermissionReadonly, "msg_readonly_web_fetch")
	r.webFetchResolver = fakeWebFetchResolver{"example.com": {"93.184.216.34"}}
	r.webFetchHTTPClient = &http.Client{
		Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
			return webFetchResponse(http.StatusOK, "text/plain; charset=utf-8", "hello from web"), nil
		}),
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}

	outcome, err := r.runBuiltInToolThroughFloret(context.Background(), "tool_readonly_web_fetch", "web_fetch", map[string]any{
		"url":    "https://example.com/page",
		"format": "text",
	})
	if err != nil {
		t.Fatalf("run web_fetch through Floret: %v", err)
	}
	if !outcome.Success {
		t.Fatalf("web_fetch should succeed without approval, err=%+v", outcome.ToolError)
	}
	assertNoApprovalWait(t, r, "tool_readonly_web_fetch")
	data, ok := outcome.Result.(map[string]any)
	if !ok {
		t.Fatalf("result=%#v, want map", outcome.Result)
	}
	if anyToString(data["output"]) != "hello from web" {
		t.Fatalf("output=%#v, want fetched body", data["output"])
	}
}

func TestPermissionPolicy_ReadonlyExclusiveToolsFailClosedOutsideReadonly(t *testing.T) {
	t.Parallel()

	workspace := t.TempDir()
	if err := os.WriteFile(filepath.Join(workspace, "note.txt"), []byte("needle\n"), 0o644); err != nil {
		t.Fatalf("write note: %v", err)
	}

	toolArgs := map[string]map[string]any{
		"file.read":  {"file_path": "note.txt", "limit": 1},
		"read_file":  {"path": "note.txt", "limit": 1},
		"read_files": {"paths": []string{"note.txt"}, "limit": 1},
		"find":       {"root": ".", "name": "*.txt", "type": "file", "max_results": 1},
		"rgrep":      {"query": "needle", "paths": []string{"."}, "glob": []string{"*.txt"}, "fixed_strings": true, "max_matches": 1},
		"web_fetch":  {"url": "https://example.com/", "format": "markdown"},
	}

	for _, permissionType := range []FlowerPermissionType{FlowerPermissionApprovalRequired, FlowerPermissionFullAccess} {
		permissionType := permissionType
		for toolName, args := range toolArgs {
			toolName, args := toolName, args
			t.Run(permissionTypeString(permissionType)+"/"+toolName, func(t *testing.T) {
				t.Parallel()

				toolID := "tool_hidden_" + strings.ReplaceAll(toolName, ".", "_")
				r := newPermissionPolicyTestRun(t, workspace, permissionType, "msg_hidden_"+permissionTypeString(permissionType)+"_"+strings.ReplaceAll(toolName, ".", "_"))
				outcome, err := r.runBuiltInToolThroughFloret(context.Background(), toolID, toolName, args)
				if err != nil {
					t.Fatalf("run %s through Floret: %v", toolName, err)
				}
				if outcome == nil || outcome.Success || outcome.ToolError == nil || outcome.ToolError.Code != aitools.ErrorCodePermissionDenied {
					t.Fatalf("%s outcome=%+v, want permission denied without handler execution", toolName, outcome)
				}
				assertNoApprovalWait(t, r, toolID)

				if _, err := r.execTool(context.Background(), r.sessionMeta, toolID+"_direct", toolName, args); err == nil || !strings.Contains(err.Error(), "unavailable") {
					t.Fatalf("direct execTool(%s) error=%v, want unavailable", toolName, err)
				}
				assertNoApprovalWait(t, r, toolID+"_direct")
			})
		}
	}
}

func TestPermissionPolicy_ReadonlyExclusiveToolsFailClosedWithoutSnapshot(t *testing.T) {
	t.Parallel()

	workspace := t.TempDir()
	if err := os.WriteFile(filepath.Join(workspace, "note.txt"), []byte("needle\n"), 0o644); err != nil {
		t.Fatalf("write note: %v", err)
	}
	r := newRun(runOptions{
		Log:          slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{})),
		AgentHomeDir: workspace,
		WorkingDir:   workspace,
		Shell:        "bash",
		SessionMeta:  &session.Meta{CanRead: true, CanWrite: true, CanExecute: true},
	})
	r.permissionType = FlowerPermissionApprovalRequired

	for toolName, args := range map[string]map[string]any{
		"file.read":  {"file_path": "note.txt", "limit": 1},
		"read_file":  {"path": "note.txt", "limit": 1},
		"read_files": {"paths": []string{"note.txt"}, "limit": 1},
		"find":       {"root": ".", "name": "*.txt", "type": "file", "max_results": 1},
		"rgrep":      {"query": "needle", "paths": []string{"."}, "fixed_strings": true, "max_matches": 1},
		"web_fetch":  {"url": "https://example.com/", "format": "markdown"},
	} {
		toolName, args := toolName, args
		t.Run(toolName, func(t *testing.T) {
			if _, err := r.execTool(context.Background(), r.sessionMeta, "tool_empty_snapshot_"+strings.ReplaceAll(toolName, ".", "_"), toolName, args); err == nil || !strings.Contains(err.Error(), "readonly tool unavailable") {
				t.Fatalf("execTool(%s) error=%v, want readonly tool unavailable", toolName, err)
			}
		})
	}
}

func TestPermissionPolicy_WebSearchUsesReadPermissionGate(t *testing.T) {
	t.Parallel()

	workspace := t.TempDir()
	r := newPermissionPolicyTestRun(t, workspace, FlowerPermissionReadonly, "msg_readonly_web_search")
	r.webSearchToolEnabled = true
	freezePermissionPolicyTestSnapshot(t, r)
	meta := &session.Meta{CanRead: true, CanExecute: false}

	_, err := r.execTool(context.Background(), meta, "tool_web_search", "web.search", map[string]any{
		"query": "redeven permission model",
	})
	if err == nil || strings.Contains(err.Error(), "execute permission denied") {
		t.Fatalf("web.search error=%v, want read gate to pass before provider/key validation", err)
	}
}

func TestPermissionPolicy_SubagentsInvocationDoesNotRequestApproval(t *testing.T) {
	t.Parallel()

	for _, permissionType := range []FlowerPermissionType{
		FlowerPermissionReadonly,
		FlowerPermissionApprovalRequired,
		FlowerPermissionFullAccess,
	} {
		permissionType := permissionType
		t.Run(permissionTypeString(permissionType), func(t *testing.T) {
			t.Parallel()

			workspace := t.TempDir()
			toolID := "tool_subagents_" + permissionTypeString(permissionType)
			r := newPermissionPolicyTestRun(t, workspace, permissionType, "msg_"+toolID)

			outcome, err := r.runBuiltInToolThroughFloret(context.Background(), toolID, "subagents", map[string]any{
				"action": "list",
			})
			if err != nil {
				t.Fatalf("run subagents through Floret: %v", err)
			}
			assertNoApprovalWait(t, r, toolID)
			if outcome == nil {
				t.Fatalf("missing subagents outcome")
			}
		})
	}
}

func TestPermissionPolicy_SubagentsRuntimeActionsDoNotRequestApproval(t *testing.T) {
	t.Parallel()

	actions := []struct {
		name string
		args map[string]any
	}{
		{
			name: "spawn",
			args: map[string]any{
				"action":           "spawn",
				"agent_type":       "worker",
				"task_name":        "runtime no approval",
				"task_description": "Run without approving the orchestration action.",
				"message":          "run without approving the orchestration action",
			},
		},
		{
			name: "wait",
			args: map[string]any{"action": "wait", "ids": []string{"child_runtime_no_approval"}},
		},
		{
			name: "send_input",
			args: map[string]any{"action": "send_input", "target": "child_runtime_no_approval", "message": "continue"},
		},
		{
			name: "inspect",
			args: map[string]any{"action": "inspect", "target": "child_runtime_no_approval"},
		},
		{
			name: "close",
			args: map[string]any{"action": "close", "target": "child_runtime_no_approval"},
		},
		{
			name: "close_all",
			args: map[string]any{"action": "close_all", "scope": "current_run"},
		},
		{
			name: "list",
			args: map[string]any{"action": "list"},
		},
	}
	for _, permissionType := range []FlowerPermissionType{
		FlowerPermissionReadonly,
		FlowerPermissionApprovalRequired,
		FlowerPermissionFullAccess,
	} {
		permissionType := permissionType
		t.Run(permissionTypeString(permissionType), func(t *testing.T) {
			t.Parallel()

			for _, tc := range actions {
				tc := tc
				t.Run(tc.name, func(t *testing.T) {
					t.Parallel()

					workspace := t.TempDir()
					svc := newPermissionPolicyBridgeService(t)
					r := newPermissionPolicyTestRun(t, workspace, permissionType, "subagents_runtime_"+permissionTypeString(permissionType)+"_"+tc.name)
					r.service = svc
					r.threadsDB = svc.threadsDB
					r.cfg = &config.AIConfig{
						CurrentModelID: "compat/gpt-5-mini",
						Providers: []config.AIProvider{{
							ID:      "compat",
							Type:    "openai_compatible",
							BaseURL: "https://example.invalid/v1",
							Models:  []config.AIProviderModel{{ModelName: "gpt-5-mini"}},
						}},
					}
					r.currentModelID = "compat/gpt-5-mini"
					r.resolveProviderKey = func(providerID string) (string, bool, error) {
						return "provider-key", strings.TrimSpace(providerID) == "compat", nil
					}
					freezePermissionPolicyTestSnapshot(t, r)
					childThreadID := "child_runtime_no_approval"
					insertPermissionPolicyChildSnapshot(t, r, childThreadID, "okf.search")
					now := time.Now()
					host := &recordingFloretHost{snapshots: []flruntime.SubAgentSnapshot{{
						ThreadID:       flruntime.ThreadID(childThreadID),
						ParentThreadID: flruntime.ThreadID(r.threadID),
						TaskName:       "runtime no approval child",
						HostProfileRef: subagentAgentTypeWorker,
						Status:         flruntime.SubAgentStatusRunning,
						CreatedAt:      now.Add(-time.Minute),
						UpdatedAt:      now,
						CanSendInput:   true,
						CanInterrupt:   true,
						CanClose:       true,
					}}}
					r.subagentRuntime = &floretSubagentRuntime{parent: r, host: host}

					toolID := "tool_subagents_runtime_" + permissionTypeString(permissionType) + "_" + tc.name
					outcome, err := r.runBuiltInToolThroughFloret(context.Background(), toolID, "subagents", tc.args)
					if err != nil {
						t.Fatalf("run subagents %s through Floret: %v", tc.name, err)
					}
					assertNoApprovalWait(t, r, toolID)
					if outcome == nil || !outcome.Success {
						t.Fatalf("subagents %s outcome=%+v, want success without approval", tc.name, outcome)
					}
					records, err := svc.threadsDB.ListDelegatedApprovalRequestsForThread(context.Background(), r.endpointID, r.threadID, 10)
					if err != nil {
						t.Fatalf("ListDelegatedApprovalRequestsForThread: %v", err)
					}
					if len(records) != 0 {
						t.Fatalf("subagents %s wrote delegated approval records: %#v", tc.name, records)
					}
					if tc.name == "spawn" {
						rec, ok, err := svc.threadsDB.GetChildPermissionSnapshotBySpawnToolCall(context.Background(), r.endpointID, toolID)
						if err != nil {
							t.Fatalf("GetChildPermissionSnapshotBySpawnToolCall: %v", err)
						}
						if !ok || rec.State != "finalized" || rec.SpawnToolCallID != toolID {
							t.Fatalf("spawn child snapshot=%#v ok=%v, want finalized record keyed by real tool call id %q", rec, ok, toolID)
						}
						if rec.ChildThreadID == toolID || rec.ChildRunID == rec.ChildThreadID || rec.ChildRunID == r.id {
							t.Fatalf("spawn child identity reused tool/thread/parent ids: %#v", rec)
						}
					}
				})
			}
		})
	}
}

func TestPermissionPolicy_SubagentsValidationFailureDoesNotCreateDelegatedApprovalLedger(t *testing.T) {
	t.Parallel()

	workspace := t.TempDir()
	svc := newPermissionPolicyBridgeService(t)
	r := newPermissionPolicyTestRun(t, workspace, FlowerPermissionApprovalRequired, "msg_subagents_zero_ledger")
	r.service = svc

	outcome, err := r.runBuiltInToolThroughFloret(context.Background(), "tool_subagents_invalid", "subagents", map[string]any{
		"action": "spawn",
	})
	if err != nil {
		t.Fatalf("run subagents through Floret: %v", err)
	}
	assertNoApprovalWait(t, r, "tool_subagents_invalid")
	if outcome == nil || outcome.Success {
		t.Fatalf("invalid subagents call outcome=%+v, want tool error", outcome)
	}
	records, err := svc.threadsDB.ListDelegatedApprovalRequestsForThread(context.Background(), r.endpointID, r.threadID, 10)
	if err != nil {
		t.Fatalf("ListDelegatedApprovalRequestsForThread: %v", err)
	}
	if len(records) != 0 {
		t.Fatalf("subagents validation failure created delegated approvals: %#v", records)
	}
}

func TestPermissionPolicy_ApprovalRequiredAsksForEveryTerminalExec(t *testing.T) {
	t.Parallel()

	workspace := t.TempDir()
	target := filepath.Join(workspace, "note.txt")
	if err := os.WriteFile(target, []byte("hello"), 0o644); err != nil {
		t.Fatalf("write seed file: %v", err)
	}
	r := newPermissionPolicyTestRun(t, workspace, FlowerPermissionApprovalRequired, "msg_approval_terminal")

	outcome := runTerminalToolCall(t, r, "tool_approval_readonly_shell", map[string]any{
		"command": `find . -type f | egrep "note.txt" | head -n 20`,
	}, true, true)
	if !outcome.Success {
		t.Fatalf("approved readonly-looking shell should run, err=%+v", outcome.ToolError)
	}

	outcome = runTerminalToolCall(t, r, "tool_approval_mutating_shell", map[string]any{
		"command": "printf 'approved' > note.txt",
	}, true, true)
	if !outcome.Success {
		t.Fatalf("approved mutating shell should run, err=%+v", outcome.ToolError)
	}
	got, err := os.ReadFile(target)
	if err != nil {
		t.Fatalf("read target: %v", err)
	}
	if string(got) != "approved" {
		t.Fatalf("file content=%q, want approved", string(got))
	}
}

func TestPermissionPolicy_ApprovalRequiredAsksForMutatingTools(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name        string
		toolName    string
		seed        map[string]string
		args        map[string]any
		rejectArgs  map[string]any
		wantPath    string
		wantContent string
		rejectPath  string
	}{
		{
			name:        "file_write",
			toolName:    "file.write",
			args:        map[string]any{"file_path": "written.txt", "content": "approved write"},
			rejectArgs:  map[string]any{"file_path": "blocked-write.txt", "content": "blocked"},
			wantPath:    "written.txt",
			wantContent: "approved write",
			rejectPath:  "blocked-write.txt",
		},
		{
			name:        "file_edit",
			toolName:    "file.edit",
			seed:        map[string]string{"edit.txt": "before"},
			args:        map[string]any{"file_path": "edit.txt", "old_string": "before", "new_string": "after"},
			rejectArgs:  map[string]any{"file_path": "edit.txt", "old_string": "after", "new_string": "blocked"},
			wantPath:    "edit.txt",
			wantContent: "after",
			rejectPath:  "edit.txt",
		},
		{
			name:     "apply_patch",
			toolName: "apply_patch",
			args: map[string]any{"patch": strings.Join([]string{
				"*** Begin Patch",
				"*** Add File: patched.txt",
				"+approved patch",
				"*** End Patch",
			}, "\n")},
			rejectArgs: map[string]any{"patch": strings.Join([]string{
				"*** Begin Patch",
				"*** Add File: blocked-patch.txt",
				"+blocked",
				"*** End Patch",
			}, "\n")},
			wantPath:    "patched.txt",
			wantContent: "approved patch\n",
			rejectPath:  "blocked-patch.txt",
		},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			workspace := t.TempDir()
			for path, content := range tc.seed {
				if err := os.WriteFile(filepath.Join(workspace, path), []byte(content), 0o644); err != nil {
					t.Fatalf("write seed %s: %v", path, err)
				}
			}
			r := newPermissionPolicyTestRun(t, workspace, FlowerPermissionApprovalRequired, "msg_approval_mutation_"+tc.name)

			outcome := runBuiltinToolCall(t, r, "tool_approval_"+tc.name, tc.toolName, tc.args, true, true)
			if !outcome.Success {
				t.Fatalf("approved %s should run, err=%+v", tc.toolName, outcome.ToolError)
			}
			got, err := os.ReadFile(filepath.Join(workspace, tc.wantPath))
			if err != nil {
				t.Fatalf("read %s: %v", tc.wantPath, err)
			}
			if string(got) != tc.wantContent {
				t.Fatalf("%s content=%q, want %q", tc.wantPath, string(got), tc.wantContent)
			}

			outcome = runBuiltinToolCall(t, r, "tool_approval_"+tc.name+"_reject", tc.toolName, tc.rejectArgs, false, true)
			if outcome.Success {
				t.Fatalf("rejected %s must not succeed", tc.toolName)
			}
			if tc.rejectPath != "" && tc.rejectPath != tc.wantPath {
				if _, statErr := os.Stat(filepath.Join(workspace, tc.rejectPath)); !os.IsNotExist(statErr) {
					t.Fatalf("%s should not exist after reject, statErr=%v", tc.rejectPath, statErr)
				}
			}
		})
	}
}

func TestPermissionPolicy_ApprovalRequiredRejectPreventsExecution(t *testing.T) {
	t.Parallel()

	workspace := t.TempDir()
	target := filepath.Join(workspace, "note.txt")
	r := newPermissionPolicyTestRun(t, workspace, FlowerPermissionApprovalRequired, "msg_approval_reject")

	outcome := runTerminalToolCall(t, r, "tool_approval_reject", map[string]any{
		"command": "printf 'blocked' > note.txt",
	}, false, true)

	if outcome.Success {
		t.Fatalf("rejected terminal.exec must not succeed")
	}
	if _, statErr := os.Stat(target); !os.IsNotExist(statErr) {
		t.Fatalf("target file should not be created after reject, statErr=%v", statErr)
	}
}

func TestPermissionPolicy_SnapshotGuardBlocksDirectAskToolExecution(t *testing.T) {
	t.Parallel()

	workspace := t.TempDir()
	r := newPermissionPolicyTestRun(t, workspace, FlowerPermissionApprovalRequired, "msg_direct_snapshot_guard")

	outcome, err := r.handleToolCall(context.Background(), "tool_direct_write", "file.write", map[string]any{
		"file_path": "direct.txt",
		"content":   "must not run",
	})
	if err != nil {
		t.Fatalf("handleToolCall: %v", err)
	}
	if outcome == nil || outcome.Success || outcome.ToolError == nil || outcome.ToolError.Code != aitools.ErrorCodePermissionDenied {
		t.Fatalf("direct file.write outcome=%+v, want permission denied", outcome)
	}
	if _, statErr := os.Stat(filepath.Join(workspace, "direct.txt")); !os.IsNotExist(statErr) {
		t.Fatalf("direct file.write should not create file, statErr=%v", statErr)
	}
}

func TestPermissionPolicy_SubagentApprovalDelegatesToParentRun(t *testing.T) {
	t.Parallel()

	workspace := t.TempDir()
	target := filepath.Join(workspace, "delegated.txt")
	svc := newPermissionPolicyBridgeService(t)
	parent := newPermissionPolicyTestRun(t, workspace, FlowerPermissionApprovalRequired, "msg_parent")
	parent.service = svc
	child := newPermissionPolicyTestRun(t, workspace, FlowerPermissionApprovalRequired, "msg_child")
	child.service = svc
	configurePermissionPolicyDelegatedChild(t, parent, child, "child_thread_delegated")

	type result struct {
		outcome *toolCallOutcome
		err     error
	}
	done := make(chan result, 1)
	go func() {
		outcome, err := child.runTerminalExecThroughFloret(context.Background(), "tool_child_shell", map[string]any{
			"command": "printf 'delegated' > delegated.txt",
		})
		done <- result{outcome: outcome, err: err}
	}()

	action := waitDelegatedApprovalRequested(t, svc, parent.endpointID, parent.threadID)
	if action.RunID != "" || action.ToolID != "" {
		t.Fatalf("delegated action carried main approval ids: run_id=%q tool_id=%q", action.RunID, action.ToolID)
	}
	if action.DelegatedRef == nil || action.DelegatedRef.ChildThreadID != child.threadID || action.DelegatedRef.ChildToolCallID != "tool_child_shell" {
		t.Fatalf("delegated action mismatch: %#v", action)
	}
	if action.DelegatedRef.ChildRunID != child.id || action.DelegatedRef.ChildRunID == child.threadID {
		t.Fatalf("delegated child_run_id=%q, want distinct child run %q", action.DelegatedRef.ChildRunID, child.id)
	}
	assertNoApprovalWait(t, parent, "tool_child_shell")
	assertNoApprovalWait(t, child, "tool_child_shell")
	approveReq := SubmitFlowerApprovalRequest{
		ThreadID:        parent.threadID,
		Origin:          FlowerApprovalOriginDelegatedSubagent,
		ActionID:        action.ActionID,
		Approved:        true,
		ExpectedSeq:     action.ExpectedSeq,
		Revision:        action.Revision,
		Version:         action.Version,
		SurfaceEpoch:    action.SurfaceEpoch,
		QueueGeneration: action.QueueGeneration,
		QueueRevision:   approvalQueueRevisionForTest(svc, parent.endpointID, parent.threadID),
		IdempotencyKey:  "idem-delegated-approve",
		DelegatedRef:    action.DelegatedRef,
	}
	if _, err := svc.SubmitFlowerApproval(parent.sessionMeta, approveReq); err != nil {
		t.Fatalf("SubmitFlowerApproval delegated approve: %v", err)
	}
	select {
	case res := <-done:
		if res.err != nil {
			t.Fatalf("child terminal tool returned error: %v", res.err)
		}
		if res.outcome == nil || !res.outcome.Success {
			t.Fatalf("child terminal outcome=%+v, want success", res.outcome)
		}
	case <-time.After(3 * time.Second):
		t.Fatalf("timed out waiting for delegated approval result")
	}
	got, err := os.ReadFile(target)
	if err != nil {
		t.Fatalf("read target: %v", err)
	}
	if string(got) != "delegated" {
		t.Fatalf("file content=%q, want delegated", string(got))
	}
	if _, err := svc.SubmitFlowerApproval(parent.sessionMeta, approveReq); err != nil {
		t.Fatalf("SubmitFlowerApproval delegated approve idempotent replay: %v", err)
	}
	rec, ok, err := svc.threadsDB.GetDelegatedApprovalRequest(context.Background(), parent.endpointID, parent.threadID, action.ActionID)
	if err != nil {
		t.Fatalf("GetDelegatedApprovalRequest: %v", err)
	}
	if !ok || rec.State != "approved" || rec.Status != "resolved" || rec.DeliveryState != "delivery_delivered" {
		t.Fatalf("delegated approval durable record=%#v", rec)
	}
}

func TestPermissionPolicy_SubagentDelegatedSubmitRequiresParentOwner(t *testing.T) {
	t.Parallel()

	workspace := t.TempDir()
	target := filepath.Join(workspace, "delegated-owner.txt")
	svc := newPermissionPolicyBridgeService(t)
	parent := newPermissionPolicyTestRun(t, workspace, FlowerPermissionApprovalRequired, "msg_parent_owner")
	parent.service = svc
	child := newPermissionPolicyTestRun(t, workspace, FlowerPermissionApprovalRequired, "msg_child_owner")
	child.service = svc
	configurePermissionPolicyDelegatedChild(t, parent, child, "child_thread_owner")

	type result struct {
		outcome *toolCallOutcome
		err     error
	}
	done := make(chan result, 1)
	go func() {
		outcome, err := child.runTerminalExecThroughFloret(context.Background(), "tool_child_owner", map[string]any{
			"command": "printf 'owner-approved' > delegated-owner.txt",
		})
		done <- result{outcome: outcome, err: err}
	}()

	action := waitDelegatedApprovalRequested(t, svc, parent.endpointID, parent.threadID)
	approveReq := SubmitFlowerApprovalRequest{
		ThreadID:        parent.threadID,
		Origin:          FlowerApprovalOriginDelegatedSubagent,
		ActionID:        action.ActionID,
		Approved:        true,
		ExpectedSeq:     action.ExpectedSeq,
		Revision:        action.Revision,
		Version:         action.Version,
		SurfaceEpoch:    action.SurfaceEpoch,
		QueueGeneration: action.QueueGeneration,
		QueueRevision:   approvalQueueRevisionForTest(svc, parent.endpointID, parent.threadID),
		IdempotencyKey:  "idem-delegated-owner-intruder",
		DelegatedRef:    action.DelegatedRef,
	}
	intruderMeta := *parent.sessionMeta
	intruderMeta.UserPublicID = "user_intruder"
	if _, err := svc.SubmitFlowerApproval(&intruderMeta, approveReq); err == nil || !strings.Contains(err.Error(), "run not found") {
		t.Fatalf("intruder delegated approval error=%v, want run not found", err)
	}
	if _, statErr := os.Stat(target); !os.IsNotExist(statErr) {
		t.Fatalf("target should not exist after intruder submit, statErr=%v", statErr)
	}
	rec, ok, err := svc.threadsDB.GetDelegatedApprovalRequest(context.Background(), parent.endpointID, parent.threadID, action.ActionID)
	if err != nil {
		t.Fatalf("GetDelegatedApprovalRequest: %v", err)
	}
	if !ok || rec.ParentUserPublicID != parent.userPublicID || rec.Status != "pending" || rec.State != "requested" {
		t.Fatalf("delegated record after intruder submit=%#v, want original owner pending", rec)
	}
	select {
	case res := <-done:
		t.Fatalf("child completed after intruder submit: outcome=%+v err=%v", res.outcome, res.err)
	case <-time.After(150 * time.Millisecond):
	}

	cleanup := approveReq
	cleanup.Approved = false
	cleanup.IdempotencyKey = "idem-delegated-owner-cleanup"
	if _, err := svc.SubmitFlowerApproval(parent.sessionMeta, cleanup); err != nil {
		t.Fatalf("owner cleanup reject: %v", err)
	}
	select {
	case res := <-done:
		if res.err != nil {
			t.Fatalf("child terminal tool returned error: %v", res.err)
		}
		if res.outcome == nil || res.outcome.Success {
			t.Fatalf("child terminal outcome=%+v, want rejected after owner cleanup", res.outcome)
		}
	case <-time.After(3 * time.Second):
		t.Fatalf("timed out waiting for delegated owner cleanup")
	}
}

func TestPermissionPolicy_SubagentDelegatedConcurrentSubmitOnlyOneWins(t *testing.T) {
	t.Parallel()

	workspace := t.TempDir()
	target := filepath.Join(workspace, "delegated-race.txt")
	svc := newPermissionPolicyBridgeService(t)
	parent := newPermissionPolicyTestRun(t, workspace, FlowerPermissionApprovalRequired, "msg_parent_race")
	parent.service = svc
	child := newPermissionPolicyTestRun(t, workspace, FlowerPermissionApprovalRequired, "msg_child_race")
	child.service = svc
	configurePermissionPolicyDelegatedChild(t, parent, child, "child_thread_race")

	type result struct {
		outcome *toolCallOutcome
		err     error
	}
	done := make(chan result, 1)
	go func() {
		outcome, err := child.runTerminalExecThroughFloret(context.Background(), "tool_child_race", map[string]any{
			"command": "printf 'race-approved' > delegated-race.txt",
		})
		done <- result{outcome: outcome, err: err}
	}()

	action := waitDelegatedApprovalRequested(t, svc, parent.endpointID, parent.threadID)
	base := SubmitFlowerApprovalRequest{
		ThreadID:        parent.threadID,
		Origin:          FlowerApprovalOriginDelegatedSubagent,
		ActionID:        action.ActionID,
		ExpectedSeq:     action.ExpectedSeq,
		Revision:        action.Revision,
		Version:         action.Version,
		SurfaceEpoch:    action.SurfaceEpoch,
		QueueGeneration: action.QueueGeneration,
		QueueRevision:   approvalQueueRevisionForTest(svc, parent.endpointID, parent.threadID),
		DelegatedRef:    action.DelegatedRef,
	}
	approveReq := base
	approveReq.Approved = true
	approveReq.IdempotencyKey = "idem-delegated-race-approve"
	rejectReq := base
	rejectReq.Approved = false
	rejectReq.IdempotencyKey = "idem-delegated-race-reject"

	errCh := make(chan error, 2)
	go func() {
		_, err := svc.SubmitFlowerApproval(parent.sessionMeta, approveReq)
		errCh <- err
	}()
	go func() {
		_, err := svc.SubmitFlowerApproval(parent.sessionMeta, rejectReq)
		errCh <- err
	}()

	var successCount, errorCount int
	for i := 0; i < 2; i++ {
		if err := <-errCh; err != nil {
			errorCount++
		} else {
			successCount++
		}
	}
	if successCount != 1 || errorCount != 1 {
		t.Fatalf("concurrent delegated submit success=%d error=%d, want one winner and one stale loser", successCount, errorCount)
	}

	select {
	case res := <-done:
		if res.err != nil {
			t.Fatalf("child terminal tool returned error: %v", res.err)
		}
		if res.outcome == nil {
			t.Fatalf("missing child outcome")
		}
	case <-time.After(3 * time.Second):
		t.Fatalf("timed out waiting for delegated race result")
	}
	rec, ok, err := svc.threadsDB.GetDelegatedApprovalRequest(context.Background(), parent.endpointID, parent.threadID, action.ActionID)
	if err != nil {
		t.Fatalf("GetDelegatedApprovalRequest: %v", err)
	}
	if !ok || rec.Status != "resolved" {
		t.Fatalf("delegated race record=%#v, want resolved", rec)
	}
	if rec.State == "approved" {
		got, err := os.ReadFile(target)
		if err != nil {
			t.Fatalf("read target after approved race: %v", err)
		}
		if string(got) != "race-approved" {
			t.Fatalf("file content=%q, want race-approved", string(got))
		}
	} else if rec.State == "rejected" {
		if _, statErr := os.Stat(target); !os.IsNotExist(statErr) {
			t.Fatalf("target should not exist after rejected race, statErr=%v", statErr)
		}
	} else {
		t.Fatalf("delegated race state=%q, want approved or rejected", rec.State)
	}
}

func TestPermissionPolicy_SubagentDelegatedStaleVersionAndSurfaceEpochDoNotDeliver(t *testing.T) {
	t.Parallel()

	workspace := t.TempDir()
	target := filepath.Join(workspace, "delegated-stale.txt")
	svc := newPermissionPolicyBridgeService(t)
	parent := newPermissionPolicyTestRun(t, workspace, FlowerPermissionApprovalRequired, "msg_parent_stale")
	parent.service = svc
	child := newPermissionPolicyTestRun(t, workspace, FlowerPermissionApprovalRequired, "msg_child_stale")
	child.service = svc
	configurePermissionPolicyDelegatedChild(t, parent, child, "child_thread_stale")

	type result struct {
		outcome *toolCallOutcome
		err     error
	}
	done := make(chan result, 1)
	go func() {
		outcome, err := child.runTerminalExecThroughFloret(context.Background(), "tool_child_stale", map[string]any{
			"command": "printf 'stale-delivered' > delegated-stale.txt",
		})
		done <- result{outcome: outcome, err: err}
	}()

	action := waitDelegatedApprovalRequested(t, svc, parent.endpointID, parent.threadID)
	base := SubmitFlowerApprovalRequest{
		ThreadID:        parent.threadID,
		Origin:          FlowerApprovalOriginDelegatedSubagent,
		ActionID:        action.ActionID,
		Approved:        true,
		Version:         action.Version,
		SurfaceEpoch:    action.SurfaceEpoch,
		QueueGeneration: action.QueueGeneration,
		QueueRevision:   approvalQueueRevisionForTest(svc, parent.endpointID, parent.threadID),
		IdempotencyKey:  "idem-delegated-stale",
		DelegatedRef:    action.DelegatedRef,
	}
	staleVersion := base
	staleVersion.Version++
	if _, err := svc.SubmitFlowerApproval(parent.sessionMeta, staleVersion); !errors.Is(err, ErrRunChanged) {
		t.Fatalf("stale version submit error=%v, want ErrRunChanged", err)
	}
	staleSurface := base
	staleSurface.SurfaceEpoch++
	if _, err := svc.SubmitFlowerApproval(parent.sessionMeta, staleSurface); !errors.Is(err, ErrRunChanged) {
		t.Fatalf("stale surface submit error=%v, want ErrRunChanged", err)
	}
	if _, statErr := os.Stat(target); !os.IsNotExist(statErr) {
		t.Fatalf("target should not exist after stale decisions, statErr=%v", statErr)
	}
	rec, ok, err := svc.threadsDB.GetDelegatedApprovalRequest(context.Background(), parent.endpointID, parent.threadID, action.ActionID)
	if err != nil {
		t.Fatalf("GetDelegatedApprovalRequest: %v", err)
	}
	if !ok || rec.Status != "pending" || rec.State != "requested" || rec.DeliveryState != "waiting_decision" {
		t.Fatalf("delegated record after stale decisions=%#v, want still pending", rec)
	}

	reject := base
	reject.Approved = false
	reject.IdempotencyKey = "idem-delegated-stale-cleanup"
	if _, err := svc.SubmitFlowerApproval(parent.sessionMeta, reject); err != nil {
		t.Fatalf("cleanup reject: %v", err)
	}
	select {
	case res := <-done:
		if res.err != nil {
			t.Fatalf("child terminal tool returned error: %v", res.err)
		}
		if res.outcome == nil || res.outcome.Success {
			t.Fatalf("child terminal outcome=%+v, want rejected after cleanup", res.outcome)
		}
	case <-time.After(3 * time.Second):
		t.Fatalf("timed out waiting for delegated stale cleanup")
	}
}

func TestPermissionPolicy_SubagentDelegatedIdempotencyConflictDoesNotRedeliver(t *testing.T) {
	t.Parallel()

	workspace := t.TempDir()
	target := filepath.Join(workspace, "delegated-idem.txt")
	svc := newPermissionPolicyBridgeService(t)
	parent := newPermissionPolicyTestRun(t, workspace, FlowerPermissionApprovalRequired, "msg_parent_idem")
	parent.service = svc
	child := newPermissionPolicyTestRun(t, workspace, FlowerPermissionApprovalRequired, "msg_child_idem")
	child.service = svc
	configurePermissionPolicyDelegatedChild(t, parent, child, "child_thread_idem")

	type result struct {
		outcome *toolCallOutcome
		err     error
	}
	done := make(chan result, 1)
	go func() {
		outcome, err := child.runTerminalExecThroughFloret(context.Background(), "tool_child_idem", map[string]any{
			"command": "printf 'idem-approved' > delegated-idem.txt",
		})
		done <- result{outcome: outcome, err: err}
	}()

	action := waitDelegatedApprovalRequested(t, svc, parent.endpointID, parent.threadID)
	approveReq := SubmitFlowerApprovalRequest{
		ThreadID:        parent.threadID,
		Origin:          FlowerApprovalOriginDelegatedSubagent,
		ActionID:        action.ActionID,
		Approved:        true,
		Version:         action.Version,
		SurfaceEpoch:    action.SurfaceEpoch,
		QueueGeneration: action.QueueGeneration,
		QueueRevision:   approvalQueueRevisionForTest(svc, parent.endpointID, parent.threadID),
		IdempotencyKey:  "idem-delegated-conflict",
		DelegatedRef:    action.DelegatedRef,
	}
	if _, err := svc.SubmitFlowerApproval(parent.sessionMeta, approveReq); err != nil {
		t.Fatalf("approve delegated: %v", err)
	}
	select {
	case res := <-done:
		if res.err != nil {
			t.Fatalf("child terminal tool returned error: %v", res.err)
		}
		if res.outcome == nil || !res.outcome.Success {
			t.Fatalf("child terminal outcome=%+v, want success", res.outcome)
		}
	case <-time.After(3 * time.Second):
		t.Fatalf("timed out waiting for delegated idempotency approval")
	}
	conflicting := approveReq
	conflicting.Approved = false
	if _, err := svc.SubmitFlowerApproval(parent.sessionMeta, conflicting); err == nil || !strings.Contains(err.Error(), "idempotency conflict") {
		t.Fatalf("conflicting delegated replay error=%v, want idempotency conflict", err)
	}
	got, err := os.ReadFile(target)
	if err != nil {
		t.Fatalf("read target: %v", err)
	}
	if string(got) != "idem-approved" {
		t.Fatalf("file content=%q, want idem-approved", string(got))
	}
}

func TestPermissionPolicy_SubagentDelegatedRepeatedAskReusesRecordAndLiveAction(t *testing.T) {
	t.Parallel()

	workspace := t.TempDir()
	svc := newPermissionPolicyBridgeService(t)
	parent := newPermissionPolicyTestRun(t, workspace, FlowerPermissionApprovalRequired, "msg_parent_repeat")
	parent.service = svc
	child := newPermissionPolicyTestRun(t, workspace, FlowerPermissionApprovalRequired, "msg_child_repeat")
	child.service = svc
	configurePermissionPolicyDelegatedChild(t, parent, child, "child_thread_repeat")
	req := fltools.ApprovalRequest{
		ID:         "tool_child_repeat",
		ApprovalID: "approval_child_repeat",
		Name:       "terminal.exec",
		Args:       `{"command":"pwd"}`,
		ArgsHash:   "args-repeat",
		ValidatedArgs: map[string]any{
			"command": "pwd",
		},
		HostContext: map[string]string{
			subagentToolHostContextChildThreadIDKey: "child_thread_repeat",
			subagentToolHostContextSubagentIDKey:    "child_thread_repeat",
			subagentToolHostContextChildRunIDKey:    child.id,
		},
	}

	handle, created, err := svc.registerDelegatedApproval(parent, child, req)
	if err != nil {
		t.Fatalf("register delegated approval: %v", err)
	}
	if handle == nil || !created {
		t.Fatalf("first register handle=%v created=%v, want new handle", handle, created)
	}
	handle2, created2, err := svc.registerDelegatedApproval(parent, child, req)
	if err != nil {
		t.Fatalf("register repeated delegated approval: %v", err)
	}
	if handle2 != handle || created2 {
		t.Fatalf("repeated ask handle=%p created=%v, want existing %p and created=false", handle2, created2, handle)
	}
	actionID := handle.action.ActionID
	records, err := svc.threadsDB.ListDelegatedApprovalRequestsForThread(context.Background(), parent.endpointID, parent.threadID, 10)
	if err != nil {
		t.Fatalf("ListDelegatedApprovalRequestsForThread: %v", err)
	}
	if len(records) != 1 || records[0].ActionID != actionID {
		t.Fatalf("delegated records=%#v, want one record %s", records, actionID)
	}
	svc.mu.Lock()
	stream := svc.flowerLiveByThread[runThreadKey(parent.endpointID, parent.threadID)]
	liveCount := 0
	if stream != nil {
		for _, action := range stream.State.ApprovalActions {
			if action.ActionID == actionID {
				liveCount++
			}
		}
	}
	svc.mu.Unlock()
	if liveCount != 1 {
		t.Fatalf("live actions for %s=%d, want 1", actionID, liveCount)
	}
	if err := handle.resolve(false); err != nil {
		t.Fatalf("resolve cleanup: %v", err)
	}
}

func TestNewService_ReconcilesDelegatedApprovalDeliveryStatesOnStartup(t *testing.T) {
	t.Parallel()

	stateDir := t.TempDir()
	agentHome := t.TempDir()
	if err := os.MkdirAll(filepath.Join(stateDir, "ai"), 0o700); err != nil {
		t.Fatalf("mkdir ai state: %v", err)
	}
	store, err := threadstore.Open(filepath.Join(stateDir, "ai", "threads.sqlite"))
	if err != nil {
		t.Fatalf("threadstore.Open: %v", err)
	}
	record := func(actionID string) threadstore.DelegatedApprovalRecord {
		return threadstore.DelegatedApprovalRecord{
			ActionID:            actionID,
			EndpointID:          "env_permission_policy",
			ParentThreadID:      "thread_startup",
			ParentUserPublicID:  "user_permission_policy",
			ParentRunID:         "run_parent_startup",
			ParentTurnID:        "turn_parent_startup",
			SubagentID:          "subagent_startup",
			ChildThreadID:       "thread_child_startup",
			ChildRunID:          "run_child_startup",
			ChildTurnID:         "turn_child_startup",
			ChildToolCallID:     "tool_child_" + actionID,
			ApprovalID:          "approval_child_" + actionID,
			RefHash:             "ref_hash_" + actionID,
			State:               "requested",
			Status:              "pending",
			DeliveryState:       "waiting_decision",
			ChildExecutionState: "pending",
			Version:             1,
			SurfaceEpoch:        1,
			RequestedAtUnixMs:   100,
			ExpiresAtUnixMs:     1000,
			ActionJSON:          fmt.Sprintf(`{"action_id":%q,"state":"requested","status":"pending","can_approve":true}`, actionID),
			CreatedAtUnixMs:     100,
			UpdatedAtUnixMs:     100,
		}
	}
	ctx := context.Background()
	pending := record("dappr_startup_pending")
	deliveryPending := record("dappr_startup_delivery_pending")
	delivered := record("dappr_startup_delivered")
	for _, rec := range []threadstore.DelegatedApprovalRecord{pending, deliveryPending, delivered} {
		if err := store.UpsertDelegatedApprovalRequest(ctx, rec); err != nil {
			_ = store.Close()
			t.Fatalf("UpsertDelegatedApprovalRequest %s: %v", rec.ActionID, err)
		}
	}
	for _, rec := range []threadstore.DelegatedApprovalRecord{deliveryPending, delivered} {
		if _, err := store.SubmitDelegatedApprovalDecisionCAS(ctx, threadstore.DelegatedApprovalDecisionRequest{
			EndpointID:       rec.EndpointID,
			ParentThreadID:   rec.ParentThreadID,
			ActionID:         rec.ActionID,
			RefHash:          rec.RefHash,
			Version:          1,
			SurfaceEpoch:     1,
			Approved:         true,
			NextVersion:      2,
			NextActionJSON:   fmt.Sprintf(`{"action_id":%q,"state":"approved","status":"resolved","delivery_state":"delivery_pending","can_approve":false}`, rec.ActionID),
			ResolvedAtUnixMs: 200,
			ActorScope:       rec.EndpointID + ":" + rec.ParentUserPublicID + ":" + rec.ParentThreadID,
			IdempotencyKey:   "idem-" + rec.ActionID,
			ResponseJSON:     `{"ok":true}`,
		}); err != nil {
			_ = store.Close()
			t.Fatalf("SubmitDelegatedApprovalDecisionCAS %s: %v", rec.ActionID, err)
		}
	}
	if changed, err := store.MarkDelegatedApprovalDelivered(ctx, delivered.EndpointID, delivered.ParentThreadID, delivered.ActionID, 2, fmt.Sprintf(`{"action_id":%q,"state":"approved","status":"resolved","delivery_state":"delivery_delivered","can_approve":false}`, delivered.ActionID), 250); err != nil || !changed {
		_ = store.Close()
		t.Fatalf("MarkDelegatedApprovalDelivered changed=%v err=%v", changed, err)
	}
	if err := store.Close(); err != nil {
		t.Fatalf("close seed store: %v", err)
	}

	svc, err := NewService(Options{
		Logger:       slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{})),
		StateDir:     stateDir,
		AgentHomeDir: agentHome,
	})
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}
	t.Cleanup(func() { _ = svc.Close() })
	cases := []struct {
		record       threadstore.DelegatedApprovalRecord
		wantState    string
		wantStatus   string
		wantDelivery string
		wantVersion  int64
	}{
		{record: pending, wantState: "unavailable", wantStatus: "unavailable", wantDelivery: "delivery_unavailable", wantVersion: 2},
		{record: deliveryPending, wantState: "approved", wantStatus: "resolved", wantDelivery: "delivery_ack_unknown", wantVersion: 3},
		{record: delivered, wantState: "approved", wantStatus: "resolved", wantDelivery: "delivery_delivered", wantVersion: 2},
	}
	for _, tc := range cases {
		got, ok, err := svc.threadsDB.GetDelegatedApprovalRequest(context.Background(), tc.record.EndpointID, tc.record.ParentThreadID, tc.record.ActionID)
		if err != nil {
			t.Fatalf("GetDelegatedApprovalRequest %s: %v", tc.record.ActionID, err)
		}
		if !ok {
			t.Fatalf("delegated approval %s missing after startup", tc.record.ActionID)
		}
		if got.State != tc.wantState || got.Status != tc.wantStatus || got.DeliveryState != tc.wantDelivery || got.Version != tc.wantVersion {
			t.Fatalf("startup delegated record %s=%#v, want state=%s status=%s delivery=%s version=%d", tc.record.ActionID, got, tc.wantState, tc.wantStatus, tc.wantDelivery, tc.wantVersion)
		}
		var action map[string]any
		if err := json.Unmarshal([]byte(got.ActionJSON), &action); err != nil {
			t.Fatalf("startup action_json for %s is invalid: %v", tc.record.ActionID, err)
		}
		if action["can_approve"] != false || action["state"] != tc.wantState || action["delivery_state"] != tc.wantDelivery {
			t.Fatalf("startup action_json for %s=%#v, want non-decidable %s/%s", tc.record.ActionID, action, tc.wantState, tc.wantDelivery)
		}
	}
}

func TestPermissionPolicy_SubagentDelegatedSubmitRequiresMatchingRef(t *testing.T) {
	t.Parallel()

	workspace := t.TempDir()
	svc := newPermissionPolicyBridgeService(t)
	parent := newPermissionPolicyTestRun(t, workspace, FlowerPermissionApprovalRequired, "msg_parent_ref")
	parent.service = svc
	child := newPermissionPolicyTestRun(t, workspace, FlowerPermissionApprovalRequired, "msg_child_ref")
	child.service = svc
	configurePermissionPolicyDelegatedChild(t, parent, child, "child_thread_ref")

	type result struct {
		outcome *toolCallOutcome
		err     error
	}
	done := make(chan result, 1)
	go func() {
		outcome, err := child.runTerminalExecThroughFloret(context.Background(), "tool_child_ref", map[string]any{
			"command": "printf 'ref-checked' > delegated-ref.txt",
		})
		done <- result{outcome: outcome, err: err}
	}()

	action := waitDelegatedApprovalRequested(t, svc, parent.endpointID, parent.threadID)
	base := SubmitFlowerApprovalRequest{
		ThreadID:        parent.threadID,
		Origin:          FlowerApprovalOriginDelegatedSubagent,
		ActionID:        action.ActionID,
		Approved:        true,
		ExpectedSeq:     action.ExpectedSeq,
		Revision:        action.Revision,
		Version:         action.Version,
		SurfaceEpoch:    action.SurfaceEpoch,
		QueueGeneration: action.QueueGeneration,
		QueueRevision:   approvalQueueRevisionForTest(svc, parent.endpointID, parent.threadID),
		IdempotencyKey:  "idem-delegated-ref",
	}
	if _, err := svc.SubmitFlowerApproval(parent.sessionMeta, base); err == nil || !strings.Contains(err.Error(), "ref is required") {
		t.Fatalf("missing delegated ref error=%v, want ref required", err)
	}
	mismatched := *action.DelegatedRef
	mismatched.ApprovalID += "_other"
	base.DelegatedRef = &mismatched
	if _, err := svc.SubmitFlowerApproval(parent.sessionMeta, base); err == nil || !strings.Contains(err.Error(), "ref mismatch") {
		t.Fatalf("mismatched delegated ref error=%v, want ref mismatch", err)
	}

	base.Approved = false
	base.DelegatedRef = action.DelegatedRef
	base.IdempotencyKey = "idem-delegated-ref-reject"
	if _, err := svc.SubmitFlowerApproval(parent.sessionMeta, base); err != nil {
		t.Fatalf("SubmitFlowerApproval delegated cleanup reject: %v", err)
	}
	select {
	case res := <-done:
		if res.err != nil {
			t.Fatalf("child terminal tool returned error: %v", res.err)
		}
		if res.outcome == nil || res.outcome.Success {
			t.Fatalf("child terminal outcome=%+v, want rejected after cleanup decision", res.outcome)
		}
	case <-time.After(3 * time.Second):
		t.Fatalf("timed out waiting for delegated ref cleanup")
	}
}

func TestPermissionPolicy_SubagentDelegatedRejectPreventsExecution(t *testing.T) {
	t.Parallel()

	workspace := t.TempDir()
	target := filepath.Join(workspace, "delegated-reject.txt")
	svc := newPermissionPolicyBridgeService(t)
	parent := newPermissionPolicyTestRun(t, workspace, FlowerPermissionApprovalRequired, "msg_parent_reject")
	parent.service = svc
	child := newPermissionPolicyTestRun(t, workspace, FlowerPermissionApprovalRequired, "msg_child_reject")
	child.service = svc
	configurePermissionPolicyDelegatedChild(t, parent, child, "child_thread_reject")

	type result struct {
		outcome *toolCallOutcome
		err     error
	}
	done := make(chan result, 1)
	go func() {
		outcome, err := child.runTerminalExecThroughFloret(context.Background(), "tool_child_reject", map[string]any{
			"command": "printf 'blocked' > delegated-reject.txt",
		})
		done <- result{outcome: outcome, err: err}
	}()

	action := waitDelegatedApprovalRequested(t, svc, parent.endpointID, parent.threadID)
	if action.DelegatedRef == nil || action.DelegatedRef.ChildToolCallID != "tool_child_reject" {
		t.Fatalf("delegated action ref=%#v, want child tool call tool_child_reject", action.DelegatedRef)
	}
	if _, err := svc.SubmitFlowerApproval(parent.sessionMeta, SubmitFlowerApprovalRequest{
		ThreadID:        parent.threadID,
		Origin:          FlowerApprovalOriginDelegatedSubagent,
		ActionID:        action.ActionID,
		Approved:        false,
		ExpectedSeq:     action.ExpectedSeq,
		Revision:        action.Revision,
		Version:         action.Version,
		SurfaceEpoch:    action.SurfaceEpoch,
		QueueGeneration: action.QueueGeneration,
		QueueRevision:   approvalQueueRevisionForTest(svc, parent.endpointID, parent.threadID),
		IdempotencyKey:  "idem-delegated-reject",
		DelegatedRef:    action.DelegatedRef,
	}); err != nil {
		t.Fatalf("SubmitFlowerApproval delegated reject: %v", err)
	}
	select {
	case res := <-done:
		if res.err != nil {
			t.Fatalf("child terminal tool returned error: %v", res.err)
		}
		if res.outcome == nil || res.outcome.Success {
			t.Fatalf("child terminal outcome=%+v, want rejected", res.outcome)
		}
	case <-time.After(3 * time.Second):
		t.Fatalf("timed out waiting for delegated reject result")
	}
	if _, statErr := os.Stat(target); !os.IsNotExist(statErr) {
		t.Fatalf("target file should not be created after delegated reject, statErr=%v", statErr)
	}
}

func TestPermissionPolicy_FullAccessAllowsTerminalExecWithoutApproval(t *testing.T) {
	t.Parallel()

	workspace := t.TempDir()
	target := filepath.Join(workspace, "note.txt")
	r := newPermissionPolicyTestRun(t, workspace, FlowerPermissionFullAccess, "msg_full_access")

	outcome := runTerminalToolCall(t, r, "tool_full_access", map[string]any{
		"command": "printf 'full access' > note.txt",
	}, true, false)

	if !outcome.Success {
		t.Fatalf("full_access terminal.exec should run without approval, err=%+v", outcome.ToolError)
	}
	got, err := os.ReadFile(target)
	if err != nil {
		t.Fatalf("read target: %v", err)
	}
	if string(got) != "full access" {
		t.Fatalf("file content=%q, want full access", string(got))
	}
}

func TestPermissionPolicy_FullAccessAllowsMutatingToolsWithoutApproval(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name        string
		toolName    string
		seed        map[string]string
		args        map[string]any
		wantPath    string
		wantContent string
	}{
		{
			name:        "file_write",
			toolName:    "file.write",
			args:        map[string]any{"file_path": "written.txt", "content": "full write"},
			wantPath:    "written.txt",
			wantContent: "full write",
		},
		{
			name:        "file_edit",
			toolName:    "file.edit",
			seed:        map[string]string{"edit.txt": "before"},
			args:        map[string]any{"file_path": "edit.txt", "old_string": "before", "new_string": "after"},
			wantPath:    "edit.txt",
			wantContent: "after",
		},
		{
			name:     "apply_patch",
			toolName: "apply_patch",
			args: map[string]any{"patch": strings.Join([]string{
				"*** Begin Patch",
				"*** Add File: patched.txt",
				"+full patch",
				"*** End Patch",
			}, "\n")},
			wantPath:    "patched.txt",
			wantContent: "full patch\n",
		},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			workspace := t.TempDir()
			for path, content := range tc.seed {
				if err := os.WriteFile(filepath.Join(workspace, path), []byte(content), 0o644); err != nil {
					t.Fatalf("write seed %s: %v", path, err)
				}
			}
			r := newPermissionPolicyTestRun(t, workspace, FlowerPermissionFullAccess, "msg_full_mutation_"+tc.name)
			outcome := runBuiltinToolCall(t, r, "tool_full_"+tc.name, tc.toolName, tc.args, true, false)
			if !outcome.Success {
				t.Fatalf("full_access %s should run without approval, err=%+v", tc.toolName, outcome.ToolError)
			}
			got, err := os.ReadFile(filepath.Join(workspace, tc.wantPath))
			if err != nil {
				t.Fatalf("read %s: %v", tc.wantPath, err)
			}
			if string(got) != tc.wantContent {
				t.Fatalf("%s content=%q, want %q", tc.wantPath, string(got), tc.wantContent)
			}
		})
	}
}
