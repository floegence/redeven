package ai

import (
	"context"
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
	store, err := threadstore.Open(filepath.Join(t.TempDir(), "permission.sqlite"))
	if err != nil {
		t.Fatalf("threadstore.Open: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	svc := &Service{terminalProcesses: newTerminalProcessManager(), threadsDB: store}
	svc.threadMgr = newThreadManager(svc)
	t.Cleanup(svc.threadMgr.Close)
	t.Cleanup(func() { _ = svc.terminalProcesses.Close(context.Background()) })
	r := newRunWithProductStoreForTest(t, runOptions{
		Log:              slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{})),
		AgentHomeDir:     workspace,
		Shell:            "bash",
		HostCapabilities: bindTestRunHostCapabilities(t, svc, "env_permission_policy", "thread_"+messageID),
		RunID:            "run_" + messageID,
		EndpointID:       "env_permission_policy",
		ThreadID:         "thread_" + messageID,
		UserPublicID:     "user_permission_policy",
		SessionMeta: &session.Meta{
			EndpointID:   "env_permission_policy",
			UserPublicID: "user_permission_policy",
			CanRead:      true,
			CanWrite:     true,
			CanExecute:   true,
			CanAdmin:     true,
		},
		MessageID: messageID,
	}, store)
	registerTestServiceForRun(t, r, svc)
	r.permissionType = permissionType
	if err := store.CreateThreadSettings(context.Background(), threadstore.ThreadSettings{
		EndpointID: r.endpointID, ThreadID: r.threadID, PermissionType: permissionTypeString(permissionType),
	}); err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	owner := &terminalProcessTestOwner{}
	r.setPendingToolSettlementOwnerResolver(func() floretPendingToolSettler { return owner })
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
	snapshot, err := r.freezePermissionSnapshot(buildPermissionSnapshot(r.permissionType, activeTools, activeSignals))
	if err != nil {
		t.Fatalf("freezePermissionSnapshot: %v", err)
	}
	if err := validatePermissionSnapshotConsistency(snapshot); err != nil {
		t.Fatalf("invalid permission snapshot: %v", err)
	}
}

func insertPermissionPolicyChildSnapshot(t *testing.T, parent *run, childThreadID string, toolNames ...string) PermissionSnapshot {
	t.Helper()
	registry := NewInMemoryToolRegistry()
	childRun := parent.subagentPolicyRun()
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
	record, err := parent.childPermissionSnapshotRecord(childThreadID, childRunID, "spawn_"+childThreadID, "finalized", parent.currentPermissionSnapshot(), snapshot)
	if err != nil {
		t.Fatalf("childPermissionSnapshotRecord: %v", err)
	}
	if err := runThreadStoreForTest(t, parent).InsertChildPermissionSnapshot(context.Background(), record); err != nil {
		t.Fatalf("InsertChildPermissionSnapshot: %v", err)
	}
	return snapshot
}

func permissionPolicyTestChildRunID(childThreadID string) string {
	return "child_run_" + strings.TrimSpace(childThreadID)
}

func ensurePermissionPolicyThreadSettings(t *testing.T, owner *run) {
	t.Helper()
	if owner == nil || owner.product.currentSettings == nil {
		t.Fatal("permission policy thread settings owner is unavailable")
	}
	store := runThreadStoreForTest(t, owner)
	settings, err := store.GetThreadSettings(context.Background(), owner.endpointID, owner.threadID)
	if err != nil {
		t.Fatalf("GetThread settings for %s: %v", owner.threadID, err)
	}
	if settings != nil {
		return
	}
	if err := store.CreateThreadSettings(context.Background(), threadstore.ThreadSettings{
		EndpointID:     owner.endpointID,
		ThreadID:       owner.threadID,
		PermissionType: permissionTypeString(owner.permissionType),
	}); err != nil {
		t.Fatalf("CreateThread settings for %s: %v", owner.threadID, err)
	}
}

func configurePermissionPolicyDelegatedChild(t *testing.T, parent *run, child *run, childThreadID string, toolNames ...string) {
	t.Helper()
	if len(toolNames) == 0 {
		toolNames = []string{"terminal.exec"}
	}
	if parent != nil {
		if err := parent.persistPermissionSnapshot(parent.permissionSnapshot); err != nil {
			t.Fatalf("persist parent permission snapshot: %v", err)
		}
	}
	if child != nil {
		child.noUserInteraction = true
		child.allowDelegatedApproval = true
		child.bindSubagentParentAuthority(parent)
		child.subagentDepth = 1
		child.threadID = childThreadID
		child.id = permissionPolicyTestChildRunID(childThreadID)
		if parent != nil {
			capabilities, err := bindChildRunProductCapabilities(runThreadStoreForTest(t, parent), parent.endpointID, parent.threadID, child.threadID, child.id)
			if err != nil {
				t.Fatalf("bindChildRunProductCapabilities: %v", err)
			}
			child.product = capabilities
			runThreadStoresForTest.Store(child, runThreadStoreForTest(t, parent))
			t.Cleanup(func() { runThreadStoresForTest.Delete(child) })
			registered, ok := testRunServices.Load(parent)
			if !ok {
				t.Fatal("permission policy parent service is unavailable")
			}
			execution, err := registered.(*Service).bindSubagentExecutionForParent(parent, child.threadID, child.id)
			if err != nil {
				t.Fatalf("bind SubAgent execution capabilities: %v", err)
			}
			child.host = execution.host
		}
		ensurePermissionPolicyThreadSettings(t, parent)
		child.toolAllowlist = stringSet(toolNames...)
		currentSnapshot := insertPermissionPolicyChildSnapshot(t, parent, childThreadID, toolNames...)
		child.setPermissionState(currentSnapshot.PermissionType, currentSnapshot)
		if err := child.persistPermissionSnapshot(currentSnapshot); err != nil {
			t.Fatalf("persist current child permission snapshot: %v", err)
		}
		if _, ok, err := runThreadStoreForTest(t, child).GetFinalizedChildPermissionSnapshot(context.Background(), child.endpointID, child.threadID, child.id); err != nil {
			t.Fatalf("GetFinalizedChildPermissionSnapshot fixture: %v", err)
		} else if !ok {
			t.Fatalf("finalized child permission snapshot fixture is missing for thread=%q run=%q", child.threadID, child.id)
		}
	}
}

func bindPermissionPolicyRunsToService(t *testing.T, svc *Service, parent *run, children ...*run) {
	t.Helper()
	if parent == nil {
		t.Fatal("permission policy parent run is required")
	}
	parent.host = bindTestRunHostCapabilities(t, svc, parent.endpointID, parent.threadID)
	registerTestServiceForRun(t, parent, svc)
	setRunThreadStoreForTest(t, parent, svc.threadsDB)
	for _, child := range children {
		if child == nil {
			continue
		}
		setRunThreadStoreForTest(t, child, svc.threadsDB)
	}
}

func newPermissionPolicyBridgeService(t *testing.T) *Service {
	t.Helper()
	store, err := threadstore.Open(filepath.Join(t.TempDir(), "threads.sqlite"))
	if err != nil {
		t.Fatalf("threadstore.Open: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	manager := newTerminalProcessManager()
	t.Cleanup(func() { _ = manager.Close(context.Background()) })
	svc := &Service{
		flowerLiveByThread: map[string]*flowerLiveThreadStream{},
		delegatedApprovals: map[string]*delegatedApprovalHandle{},
		threadsDB:          store,
		persistOpTO:        time.Second,
		terminalProcesses:  manager,
	}
	svc.threadMgr = newThreadManager(svc)
	t.Cleanup(svc.threadMgr.Close)
	return svc
}

func TestPermissionPolicy_ParentInvocationRejectsMismatchedFloretRunID(t *testing.T) {
	t.Parallel()

	workspace := t.TempDir()
	svc := newPermissionPolicyBridgeService(t)
	parent := newPermissionPolicyTestRun(t, workspace, FlowerPermissionApprovalRequired, "parent_identity_mismatch")
	bindPermissionPolicyRunsToService(t, svc, parent)

	execRun, err := floretInvocationRunContext(context.Background(), parent, fltools.Invocation[map[string]any]{
		RunID:    "wrong_floret_run",
		ThreadID: parent.threadID,
		TurnID:   parent.messageID,
	}, parent.currentPermissionSnapshot())
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

func TestPermissionPolicy_DelegatedApprovalRefUsesExplicitChildRunID(t *testing.T) {
	t.Parallel()

	parent := &run{threadID: "thread_parent", id: "run_parent", messageID: "turn_parent"}
	child := &run{threadID: "thread_child", id: "thread_child", messageID: "turn_child"}
	ref := delegatedApprovalRef(parent, child, flruntime.EffectAuthorizationRequest{
		ToolCallID:      "tool_call_child",
		EffectAttemptID: "approval_child",
		HostContext: map[string]string{
			subagentToolHostContextChildThreadIDKey: "thread_child",
			subagentToolHostContextChildRunIDKey:    "run_child_actual",
		},
	})
	if ref.ChildRunID != "run_child_actual" {
		t.Fatalf("child_run_id=%q, want explicit child run id", ref.ChildRunID)
	}

	ref = delegatedApprovalRef(parent, child, flruntime.EffectAuthorizationRequest{
		ToolCallID:      "tool_call_fallback",
		EffectAttemptID: "approval_fallback",
		HostContext: map[string]string{
			subagentToolHostContextChildThreadIDKey: "thread_child",
		},
	})
	if ref.ChildRunID != "" || validDelegatedApprovalRef(ref) {
		t.Fatalf("fallback child_run_id=%q valid=%v, want missing run id to fail closed", ref.ChildRunID, validDelegatedApprovalRef(ref))
	}

	ref = delegatedApprovalRef(parent, child, flruntime.EffectAuthorizationRequest{
		ToolCallID:      "tool_call_thread_alias",
		EffectAttemptID: "approval_thread_alias",
		HostContext: map[string]string{
			subagentToolHostContextChildThreadIDKey: "thread_child",
			subagentToolHostContextChildRunIDKey:    "thread_child",
		},
	})
	if ref.ChildRunID != "" || validDelegatedApprovalRef(ref) {
		t.Fatalf("thread alias child_run_id=%q valid=%v, want explicit thread alias to fail closed", ref.ChildRunID, validDelegatedApprovalRef(ref))
	}

	ref = delegatedApprovalRef(parent, child, flruntime.EffectAuthorizationRequest{
		ToolCallID:      "tool_call_parent_alias",
		EffectAttemptID: "approval_parent_alias",
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
	child := newPermissionPolicyTestRun(t, workspace, FlowerPermissionApprovalRequired, "msg_child_alias")
	bindPermissionPolicyRunsToService(t, svc, parent, child)
	child.noUserInteraction = true
	child.allowDelegatedApproval = true
	child.bindSubagentParentAuthority(parent)
	child.subagentDepth = 1
	child.threadID = "child_thread_alias"

	_, _, err := svc.registerDelegatedApproval(parent, child, flruntime.EffectAuthorizationRequest{
		ToolCallID:      "tool_child_alias",
		EffectAttemptID: "approval_child_alias",
		ToolName:        "terminal.exec",
		ArgumentHash:    "args-alias",
		Resources:       []fltools.ResourceRef{{Kind: "command", Value: "pwd"}},
		HostContext: map[string]string{
			subagentToolHostContextChildThreadIDKey: "child_thread_alias",
			subagentToolHostContextChildRunIDKey:    parent.id,
		},
	})
	if err == nil || !strings.Contains(err.Error(), "missing identity") {
		t.Fatalf("register delegated approval error=%v, want missing identity", err)
	}
}

func TestPermissionPolicy_DelegatedApprovalRejectsMissingExactChildSnapshot(t *testing.T) {
	t.Parallel()

	workspace := t.TempDir()
	svc := newPermissionPolicyBridgeService(t)
	parent := newPermissionPolicyTestRun(t, workspace, FlowerPermissionApprovalRequired, "msg_parent_snapshot_mismatch")
	childThreadID := "child_thread_snapshot_mismatch"
	insertPermissionPolicyChildSnapshot(t, parent, childThreadID, "terminal.exec")
	child := newPermissionPolicyTestRun(t, workspace, FlowerPermissionApprovalRequired, "msg_child_snapshot_mismatch")
	bindPermissionPolicyRunsToService(t, svc, parent, child)
	child.noUserInteraction = true
	child.allowDelegatedApproval = true
	child.bindSubagentParentAuthority(parent)
	child.subagentDepth = 1
	child.threadID = childThreadID
	child.id = "child_run_wrong_snapshot_mismatch"

	_, _, err := svc.registerDelegatedApproval(parent, child, flruntime.EffectAuthorizationRequest{
		ToolCallID:      "tool_child_snapshot_mismatch",
		EffectAttemptID: "approval_child_snapshot_mismatch",
		ToolName:        "terminal.exec",
		ArgumentHash:    "args-snapshot-mismatch",
		Resources:       []fltools.ResourceRef{{Kind: "command", Value: "pwd"}},
		HostContext: map[string]string{
			subagentToolHostContextChildThreadIDKey: childThreadID,
			subagentToolHostContextChildRunIDKey:    child.id,
		},
	})
	if err == nil || !strings.Contains(err.Error(), "snapshot missing") {
		t.Fatalf("register delegated approval error=%v, want exact snapshot missing", err)
	}
}

func TestPermissionPolicy_DelegatedApprovalActionOmitsMainApprovalIDs(t *testing.T) {
	t.Parallel()

	parent := &run{threadID: "thread_parent", id: "run_parent", messageID: "turn_parent"}
	child := &run{threadID: "thread_child", id: "run_child", messageID: "turn_child"}
	ref := delegatedApprovalRef(parent, child, flruntime.EffectAuthorizationRequest{
		ToolCallID:      "tool_call_child",
		EffectAttemptID: "approval_child",
		ToolName:        "terminal.exec",
		HostContext: map[string]string{
			subagentToolHostContextChildThreadIDKey: "thread_child",
			subagentToolHostContextChildRunIDKey:    "run_child",
		},
	})
	action, err := delegatedApprovalAction(parent, child, flruntime.EffectAuthorizationRequest{
		ToolCallID:      "tool_call_child",
		EffectAttemptID: "approval_child",
		ToolName:        "terminal.exec",
		Resources:       []fltools.ResourceRef{{Kind: "command", Value: "pwd"}},
	}, ref, "dappr_contract", 100, 200)
	if err != nil {
		t.Fatal(err)
	}
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
	result := flReg.Dispatch(ctx, fltools.ToolCall{
		ID:   strings.TrimSpace(toolID),
		Name: strings.TrimSpace(toolName),
		Args: string(raw),
	}, permissionPolicyTestRunOptions(r))
	return toolCallOutcomeFromFloretResult(result), nil
}

func permissionPolicyTestRunOptions(r *run) fltools.DispatchOptions {
	if r == nil {
		return fltools.DispatchOptions{Step: 1}
	}
	opts := fltools.DispatchOptions{
		RunID:         strings.TrimSpace(r.id),
		ThreadID:      strings.TrimSpace(r.threadID),
		TurnID:        strings.TrimSpace(r.messageID),
		PromptScopeID: strings.TrimSpace(r.threadID),
		Step:          1,
	}
	snapshot := r.currentPermissionSnapshot()
	authorityThreadID := strings.TrimSpace(r.threadID)
	if r.subagentParentAuthority != nil {
		authorityThreadID = strings.TrimSpace(r.subagentParentAuthority.threadID)
	}
	opts.HostContext = map[string]string{
		floretToolHostContextPermissionSnapshotIDKey: strings.TrimSpace(snapshot.SnapshotID),
		floretToolHostContextPermissionEpochKey:      permissionSurfaceEpoch(snapshot),
		floretToolHostContextAuthorityThreadIDKey:    authorityThreadID,
	}
	if r.subagentDepth > 0 {
		childThreadID := strings.TrimSpace(r.threadID)
		childRunID := strings.TrimSpace(r.id)
		opts.HostContext[subagentToolHostContextChildThreadIDKey] = childThreadID
		opts.HostContext[subagentToolHostContextForkModeKey] = string(flruntime.SubAgentForkNone)
		if childRunID != "" && childRunID != childThreadID {
			opts.HostContext[subagentToolHostContextChildRunIDKey] = childRunID
		}
	}
	opts.EffectDispatcher = floretToolRegistryTestEffectDispatcher(r)
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
		message := strings.TrimSpace(result.Text)
		if result.DispatchErr != nil {
			message = result.DispatchErr.Error()
		}
		outcome.ToolError = &aitools.ToolError{Code: aitools.ErrorCodePermissionDenied, Message: message}
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
			if _, err := r.execTool(context.Background(), r.sessionMeta, "tool_empty_snapshot_"+strings.ReplaceAll(toolName, ".", "_"), toolName, args); err == nil || !strings.Contains(err.Error(), "authorization proof is unavailable") {
				t.Fatalf("execTool(%s) error=%v, want authorization proof failure", toolName, err)
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

	_, err := r.execTool(authorizedToolContextForTest(t, r, "tool_web_search", "web.search"), meta, "tool_web_search", "web.search", map[string]any{
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
					bindPermissionPolicyRunsToService(t, svc, r)
					ensurePermissionPolicyThreadSettings(t, r)
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
					runtime := newFloretSubagentRuntimeWithExecutionOwner(r, func(_ *run, childThreadID string, childRunID string) (subagentExecutionCapabilities, error) {
						return svc.bindSubagentExecutionForParent(r, childThreadID, childRunID)
					})
					runtime.host = host
					r.subagentRuntime = runtime

					toolID := "tool_subagents_runtime_" + permissionTypeString(permissionType) + "_" + tc.name
					outcome, err := r.runBuiltInToolThroughFloret(context.Background(), toolID, "subagents", tc.args)
					if err != nil {
						t.Fatalf("run subagents %s through Floret: %v", tc.name, err)
					}
					assertNoApprovalWait(t, r, toolID)
					if outcome == nil || !outcome.Success {
						var toolErr any
						if outcome != nil {
							toolErr = outcome.ToolError
						}
						t.Fatalf("subagents %s outcome=%+v tool_error=%+v, want success without approval", tc.name, outcome, toolErr)
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
	bindPermissionPolicyRunsToService(t, svc, r)

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
	svc.mu.Lock()
	hasDelegatedApproval := len(svc.delegatedApprovals) != 0
	svc.mu.Unlock()
	if hasDelegatedApproval {
		t.Fatal("subagents validation failure created a delegated approval")
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

	baseContext := authorizedToolContextForTest(t, r, "tool_direct_write", "file.write")
	snapshot := r.currentPermissionSnapshot()
	outcome, err := r.handleToolCall(contextWithFloretToolExecutionAuthorization(baseContext, "tool_direct_write", "file.write", "test_effect:tool_direct_write", snapshot, ApprovalDecisionAsk, false, map[string]string{
		floretToolHostContextAuthorityThreadIDKey: r.threadID,
	}), "tool_direct_write", "file.write", map[string]any{
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
	child := newPermissionPolicyTestRun(t, workspace, FlowerPermissionApprovalRequired, "msg_child")
	bindPermissionPolicyRunsToService(t, svc, parent, child)
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
	approvalReceipt, err := svc.SubmitFlowerApproval(parent.sessionMeta, approveReq)
	if err != nil {
		t.Fatalf("SubmitFlowerApproval delegated approve: %v", err)
	}
	assertFlowerApprovalReceiptCursor(t, svc, parent.endpointID, parent.threadID, action.ActionID, approvalReceipt)
	select {
	case res := <-done:
		if res.err != nil {
			t.Fatalf("child terminal tool returned error: %v", res.err)
		}
		if res.outcome == nil || !res.outcome.Success {
			t.Fatalf("child terminal outcome=%+v tool_error=%+v, want success", res.outcome, res.outcome.ToolError)
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
}

func TestPermissionPolicy_SubagentDelegatedSubmitRequiresParentOwner(t *testing.T) {
	t.Parallel()

	workspace := t.TempDir()
	target := filepath.Join(workspace, "delegated-owner.txt")
	svc := newPermissionPolicyBridgeService(t)
	parent := newPermissionPolicyTestRun(t, workspace, FlowerPermissionApprovalRequired, "msg_parent_owner")
	child := newPermissionPolicyTestRun(t, workspace, FlowerPermissionApprovalRequired, "msg_child_owner")
	bindPermissionPolicyRunsToService(t, svc, parent, child)
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
	child := newPermissionPolicyTestRun(t, workspace, FlowerPermissionApprovalRequired, "msg_child_race")
	bindPermissionPolicyRunsToService(t, svc, parent, child)
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
	if got, err := os.ReadFile(target); err == nil && string(got) != "race-approved" {
		t.Fatalf("file content=%q, want race-approved when approval won", string(got))
	} else if err != nil && !os.IsNotExist(err) {
		t.Fatalf("inspect race target: %v", err)
	}
}

func TestPermissionPolicy_SubagentDelegatedStaleVersionAndSurfaceEpochDoNotDeliver(t *testing.T) {
	t.Parallel()

	workspace := t.TempDir()
	target := filepath.Join(workspace, "delegated-stale.txt")
	svc := newPermissionPolicyBridgeService(t)
	parent := newPermissionPolicyTestRun(t, workspace, FlowerPermissionApprovalRequired, "msg_parent_stale")
	child := newPermissionPolicyTestRun(t, workspace, FlowerPermissionApprovalRequired, "msg_child_stale")
	bindPermissionPolicyRunsToService(t, svc, parent, child)
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
	if _, err := svc.SubmitFlowerApproval(parent.sessionMeta, staleVersion); !errors.Is(err, ErrApprovalConflict) {
		t.Fatalf("stale version submit error=%v, want ErrApprovalConflict", err)
	}
	staleSurface := base
	staleSurface.SurfaceEpoch++
	if _, err := svc.SubmitFlowerApproval(parent.sessionMeta, staleSurface); !errors.Is(err, ErrApprovalConflict) {
		t.Fatalf("stale surface submit error=%v, want ErrApprovalConflict", err)
	}
	if _, statErr := os.Stat(target); !os.IsNotExist(statErr) {
		t.Fatalf("target should not exist after stale decisions, statErr=%v", statErr)
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
	child := newPermissionPolicyTestRun(t, workspace, FlowerPermissionApprovalRequired, "msg_child_idem")
	bindPermissionPolicyRunsToService(t, svc, parent, child)
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
	if _, err := svc.SubmitFlowerApproval(parent.sessionMeta, conflicting); !errors.Is(err, ErrApprovalConflict) {
		t.Fatalf("conflicting delegated replay error=%v, want ErrApprovalConflict", err)
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
	child := newPermissionPolicyTestRun(t, workspace, FlowerPermissionApprovalRequired, "msg_child_repeat")
	bindPermissionPolicyRunsToService(t, svc, parent, child)
	configurePermissionPolicyDelegatedChild(t, parent, child, "child_thread_repeat")
	req := flruntime.EffectAuthorizationRequest{
		ToolCallID:      "tool_child_repeat",
		EffectAttemptID: "approval_child_repeat",
		ToolName:        "terminal.exec",
		ArgumentHash:    "args-repeat",
		Resources:       []fltools.ResourceRef{{Kind: "command", Value: "pwd"}},
		HostContext: map[string]string{
			subagentToolHostContextChildThreadIDKey: "child_thread_repeat",
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

func TestPermissionPolicy_SubagentDelegatedSubmitRequiresMatchingRef(t *testing.T) {
	t.Parallel()

	workspace := t.TempDir()
	svc := newPermissionPolicyBridgeService(t)
	parent := newPermissionPolicyTestRun(t, workspace, FlowerPermissionApprovalRequired, "msg_parent_ref")
	child := newPermissionPolicyTestRun(t, workspace, FlowerPermissionApprovalRequired, "msg_child_ref")
	bindPermissionPolicyRunsToService(t, svc, parent, child)
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
	child := newPermissionPolicyTestRun(t, workspace, FlowerPermissionApprovalRequired, "msg_child_reject")
	bindPermissionPolicyRunsToService(t, svc, parent, child)
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

func TestPermissionPolicy_SubagentPermissionDowngradeRejectsStaleAllowThenRequiresApproval(t *testing.T) {
	t.Parallel()

	workspace := t.TempDir()
	target := filepath.Join(workspace, "downgraded-child.txt")
	svc := newPermissionPolicyBridgeService(t)
	parent := newPermissionPolicyTestRun(t, workspace, FlowerPermissionFullAccess, "msg_parent_downgrade")
	child := newPermissionPolicyTestRun(t, workspace, FlowerPermissionFullAccess, "msg_child_downgrade")
	bindPermissionPolicyRunsToService(t, svc, parent, child)
	configurePermissionPolicyDelegatedChild(t, parent, child, "child_thread_downgrade")

	if err := svc.threadsDB.UpdateThreadPermissionType(context.Background(), parent.endpointID, parent.threadID, config.AIPermissionApprovalRequired); err != nil {
		t.Fatal(err)
	}
	stale, err := child.runTerminalExecThroughFloret(context.Background(), "tool_child_stale_allow", map[string]any{
		"command": "printf 'stale' > downgraded-child.txt",
	})
	if err != nil {
		t.Fatalf("stale child tool: %v", err)
	}
	if stale == nil || stale.Success || stale.ToolError == nil || !strings.Contains(stale.ToolError.Message, "authorization snapshot is stale") {
		t.Fatalf("stale child outcome=%+v, want stale allow rejection", stale)
	}
	if _, statErr := os.Stat(target); !os.IsNotExist(statErr) {
		t.Fatalf("stale child authorization executed tool, statErr=%v", statErr)
	}
	_, _, current, err := child.buildCurrentSubagentPermissionSurface(context.Background(), flruntime.SubAgentForkNone)
	if err != nil {
		t.Fatal(err)
	}
	if current.PermissionType != FlowerPermissionApprovalRequired {
		t.Fatalf("current child permission=%q, want approval_required", current.PermissionType)
	}
	if _, ok, err := svc.threadsDB.GetPermissionSnapshot(context.Background(), child.endpointID, current.SnapshotID); err != nil || !ok {
		t.Fatalf("current child snapshot persisted=%v err=%v", ok, err)
	}

	type result struct {
		outcome *toolCallOutcome
		err     error
	}
	done := make(chan result, 1)
	go func() {
		outcome, err := child.runTerminalExecThroughFloret(context.Background(), "tool_child_after_downgrade", map[string]any{
			"command": "printf 'blocked' > downgraded-child.txt",
		})
		done <- result{outcome: outcome, err: err}
	}()
	action := waitDelegatedApprovalRequested(t, svc, parent.endpointID, parent.threadID)
	if action.DelegatedRef == nil || action.DelegatedRef.ChildToolCallID != "tool_child_after_downgrade" {
		t.Fatalf("delegated action ref=%#v", action.DelegatedRef)
	}
	if _, err := svc.SubmitFlowerApproval(parent.sessionMeta, SubmitFlowerApprovalRequest{
		ThreadID: parent.threadID, Origin: FlowerApprovalOriginDelegatedSubagent, ActionID: action.ActionID,
		Approved: false, ExpectedSeq: action.ExpectedSeq, Revision: action.Revision, Version: action.Version,
		SurfaceEpoch: action.SurfaceEpoch, QueueGeneration: action.QueueGeneration,
		QueueRevision:  approvalQueueRevisionForTest(svc, parent.endpointID, parent.threadID),
		IdempotencyKey: "idem-child-downgrade-reject", DelegatedRef: action.DelegatedRef,
	}); err != nil {
		t.Fatal(err)
	}
	select {
	case res := <-done:
		if res.err != nil || res.outcome == nil || res.outcome.Success {
			t.Fatalf("downgraded child result=%+v err=%v, want rejected", res.outcome, res.err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("timed out waiting for downgraded child rejection")
	}
	if _, statErr := os.Stat(target); !os.IsNotExist(statErr) {
		t.Fatalf("downgraded child tool created file, statErr=%v", statErr)
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
