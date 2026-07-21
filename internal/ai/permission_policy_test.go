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

	flconfig "github.com/floegence/floret/config"
	flruntime "github.com/floegence/floret/runtime"
	fltools "github.com/floegence/floret/tools"
	"github.com/floegence/redeven/internal/ai/threadstore"
	aitools "github.com/floegence/redeven/internal/ai/tools"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/session"
)

type canonicalChildApprovalGateway struct{}

func (canonicalChildApprovalGateway) StreamModel(_ context.Context, req flruntime.ModelRequest) (<-chan flruntime.ModelEvent, error) {
	events := make(chan flruntime.ModelEvent, 3)
	if req.Step == 1 {
		events <- flruntime.ModelEvent{Type: flruntime.ModelEventToolCalls, ToolCalls: []fltools.ToolCall{{
			ID: "child-write", Name: "write_note", Args: `{"path":"notes.md"}`,
		}}}
		events <- flruntime.ModelEvent{Type: flruntime.ModelEventDone, Reason: "tool_calls"}
	} else {
		events <- flruntime.ModelEvent{Type: flruntime.ModelEventDelta, Text: "done"}
		events <- flruntime.ModelEvent{Type: flruntime.ModelEventDone, Reason: "stop"}
	}
	close(events)
	return events, nil
}

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
		TurnID:    "turn_" + messageID,
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
		threadsDB:          store,
		persistOpTO:        time.Second,
		terminalProcesses:  manager,
	}
	svc.threadMgr = newThreadManager(svc)
	t.Cleanup(svc.threadMgr.Close)
	return svc
}

func TestPermissionPolicy_SubagentCanonicalQueueConcurrentResolveOneWins(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	store := flruntime.NewMemoryStore()
	t.Cleanup(func() { _ = store.Close() })
	adapter := testFloretBootstrap(t, store)
	create, err := adapter.newThreadCreate("permission-root", "create-permission-root")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := create.CreateThread(ctx, flruntime.CreateThreadRequest{ThreadID: "permission-root", CreateIntentID: "create-permission-root"}); err != nil {
		t.Fatal(err)
	}
	runtimeCaps, err := adapter.bindThreadRuntime("permission-root")
	if err != nil {
		t.Fatal(err)
	}
	toolsRegistry := fltools.NewRegistry()
	if err := toolsRegistry.Register(fltools.Define[map[string]any](
		fltools.Definition{
			Name: "write_note", InputSchema: fltools.StrictObject(map[string]any{"path": fltools.String("path")}, []string{"path"}),
			Effects: []fltools.Effect{fltools.EffectWrite}, Permission: fltools.PermissionSpec{Mode: fltools.PermissionAsk},
		}, nil,
		func(inv fltools.Invocation[map[string]any]) ([]fltools.ResourceRef, error) {
			return []fltools.ResourceRef{{Kind: "file", Value: strings.TrimSpace(anyToString(inv.Args["path"]))}}, nil
		},
		func(context.Context, fltools.Invocation[map[string]any]) (fltools.Result, error) {
			return fltools.Result{Text: "written"}, nil
		},
	)); err != nil {
		t.Fatal(err)
	}
	childHost, err := runtimeCaps.SubAgent(ctx, flruntime.SubAgentHostOptions{
		Config:       flconfig.Config{ContextPolicy: flconfig.ContextPolicy{ContextWindowTokens: flconfig.DefaultContextWindowTokens}},
		ModelGateway: canonicalChildApprovalGateway{}, ModelGatewayIdentity: flruntime.ModelGatewayIdentity{Provider: "fake", Model: "fake-model", StateCompatibilityKey: "permission-test"},
		Tools: toolsRegistry, EffectAuthorizationGate: allowFloretEffectGateForTest{},
	})
	if err != nil {
		t.Fatal(err)
	}
	rootHost, err := runtimeCaps.Turn(ctx, flruntime.TurnExecutionHostOptions{Config: flconfig.Config{Provider: flconfig.ProviderFake, Model: "fake-model"}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := childHost.SpawnSubAgent(ctx, flruntime.SpawnSubAgentRequest{
		PublicationID: "permission-publication", ParentThreadID: "permission-root", ThreadID: "permission-child",
		TaskName: "permission worker", Message: "write a note", ForkMode: flruntime.SubAgentForkNone,
	}); err != nil {
		t.Fatal(err)
	}
	type waitOutcome struct {
		result flruntime.WaitSubAgentsResult
		err    error
	}
	waitDone := make(chan waitOutcome, 1)
	go func() {
		result, waitErr := childHost.WaitSubAgents(ctx, flruntime.WaitSubAgentsRequest{
			ParentThreadID: "permission-root", ChildThreadIDs: []flruntime.ThreadID{"permission-child"}, Timeout: 3 * time.Second,
		})
		waitDone <- waitOutcome{result: result, err: waitErr}
	}()
	var queue flruntime.ApprovalQueue
	deadline := time.Now().Add(3 * time.Second)
	for {
		queue, err = rootHost.ReadApprovalQueue(ctx, flruntime.ReadApprovalQueueRequest{ThreadID: "permission-root"})
		if err != nil {
			t.Fatal(err)
		}
		if len(queue.Items) == 1 {
			break
		}
		if time.Now().After(deadline) {
			children, listErr := childHost.ListSubAgents(ctx, "permission-root")
			t.Fatalf("timed out waiting for canonical child approval: queue=%#v children=%#v list_err=%v", queue, children, listErr)
		}
		time.Sleep(time.Millisecond)
	}
	pending := queue.Items[0]
	if pending.ThreadID != "permission-child" || pending.ParentThreadID != "permission-root" || pending.RunID == "permission-child" {
		t.Fatalf("canonical child approval identity=%#v", pending)
	}
	resolve := func(decisionID string) error {
		_, err := rootHost.ResolveApproval(ctx, flruntime.ResolveApprovalRequest{
			DecisionID: decisionID, ExpectedRootThreadID: queue.RootThreadID, ExpectedGeneration: queue.Generation, ExpectedRevision: queue.Revision,
			ExpectedCurrent:          flruntime.ApprovalIdentity{ApprovalID: pending.ApprovalID, ThreadID: pending.ThreadID, TurnID: pending.TurnID, RunID: pending.RunID, ToolCallID: pending.ToolCallID, EffectAttemptID: pending.EffectAttemptID},
			ExpectedApprovalRevision: pending.Revision, Decision: flruntime.ApprovalDecisionApprove,
		})
		return err
	}
	errCh := make(chan error, 2)
	go func() { errCh <- resolve("decision-child-a") }()
	go func() { errCh <- resolve("decision-child-b") }()
	var successes, conflicts int
	for i := 0; i < 2; i++ {
		if err := <-errCh; err == nil {
			successes++
		} else if errors.Is(err, flruntime.ErrStaleAuthority) {
			conflicts++
		} else {
			t.Fatalf("unexpected canonical approval resolve error: %v", err)
		}
	}
	if successes != 1 || conflicts != 1 {
		t.Fatalf("canonical concurrent resolution successes=%d conflicts=%d, want 1/1", successes, conflicts)
	}
	waited := <-waitDone
	if waited.err != nil || waited.result.TimedOut {
		t.Fatalf("canonical child did not settle after approval: waited=%#v err=%v", waited.result, waited.err)
	}
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
		TurnID:   parent.turnID,
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

func assertNoApprovalWait(t *testing.T, r *run, toolID string) {
	t.Helper()
	r.mu.Lock()
	_, pending := r.toolApprovals[toolID]
	r.mu.Unlock()
	if pending {
		t.Fatalf("unexpected approval wait state: tool_id=%s pending=%v", toolID, pending)
	}
}

func runTerminalToolCall(t *testing.T, r *run, toolID string, args map[string]any) *toolCallOutcome {
	t.Helper()
	return runBuiltinToolCall(t, r, toolID, "terminal.exec", args)
}

func runBuiltinToolCall(t *testing.T, r *run, toolID string, toolName string, args map[string]any) *toolCallOutcome {
	t.Helper()
	outcome, err := r.runBuiltInToolThroughFloret(context.Background(), toolID, toolName, args)
	if err != nil {
		t.Fatalf("%s tool call returned error: %v", toolName, err)
	}
	if outcome == nil {
		t.Fatal("missing tool call outcome")
	}
	assertNoApprovalWait(t, r, toolID)
	return outcome
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
		TurnID:        strings.TrimSpace(r.turnID),
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
	})

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
	})

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

func TestPermissionPolicy_SubagentsValidationFailureDoesNotReachEffectDispatch(t *testing.T) {
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
}

func TestPermissionPolicy_ApprovalRequiredTerminalExecUsesCanonicalFloretDecision(t *testing.T) {
	t.Parallel()

	workspace := t.TempDir()
	target := filepath.Join(workspace, "note.txt")
	if err := os.WriteFile(target, []byte("hello"), 0o644); err != nil {
		t.Fatalf("write seed file: %v", err)
	}
	r := newPermissionPolicyTestRun(t, workspace, FlowerPermissionApprovalRequired, "msg_approval_terminal")

	outcome := runTerminalToolCall(t, r, "tool_approval_readonly_shell", map[string]any{
		"command": `find . -type f | egrep "note.txt" | head -n 20`,
	})
	if !outcome.Success {
		t.Fatalf("approved readonly-looking shell should run, err=%+v", outcome.ToolError)
	}

	outcome = runTerminalToolCall(t, r, "tool_approval_mutating_shell", map[string]any{
		"command": "printf 'approved' > note.txt",
	})
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

func TestPermissionPolicy_ApprovalRequiredMutationsUseCanonicalFloretDecision(t *testing.T) {
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
			args:        map[string]any{"file_path": "written.txt", "content": "approved write"},
			wantPath:    "written.txt",
			wantContent: "approved write",
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
				"+approved patch",
				"*** End Patch",
			}, "\n")},
			wantPath:    "patched.txt",
			wantContent: "approved patch\n",
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

			outcome := runBuiltinToolCall(t, r, "tool_approval_"+tc.name, tc.toolName, tc.args)
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
		})
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

func TestPermissionPolicy_SubagentPermissionDowngradeRejectsStaleAllow(t *testing.T) {
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
	})

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
			outcome := runBuiltinToolCall(t, r, "tool_full_"+tc.name, tc.toolName, tc.args)
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
