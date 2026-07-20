package ai

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"

	flruntime "github.com/floegence/floret/runtime"
	"github.com/floegence/redeven/internal/ai/threadstore"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/session"
)

func TestFloretRunCapabilityShapesAreExact(t *testing.T) {
	type fieldContract struct {
		name   string
		typeOf reflect.Type
	}
	field := func(name string, value any) fieldContract {
		return fieldContract{name: name, typeOf: reflect.TypeOf(value)}
	}
	interfaceField := func(name string, value any) fieldContract {
		return fieldContract{name: name, typeOf: reflect.TypeOf(value).Elem()}
	}
	assertExactCapabilityFields := func(name string, value any, expected []fieldContract) {
		t.Helper()
		typeOf := reflect.TypeOf(value)
		actual := make([]fieldContract, 0, typeOf.NumField())
		for index := 0; index < typeOf.NumField(); index++ {
			actual = append(actual, fieldContract{name: typeOf.Field(index).Name, typeOf: typeOf.Field(index).Type})
		}
		if !reflect.DeepEqual(actual, expected) {
			t.Fatalf("%s fields=%v, want exact allowlist %v", name, actual, expected)
		}
	}
	assertExactCapabilityFields("runHostCapabilities", runHostCapabilities{}, []fieldContract{
		field("authorityThreadID", ""),
		field("hasPendingApprovals", (func() bool)(nil)),
		field("pendingLiveToolApprovals", (func(string) []FlowerApprovalAction)(nil)),
		field("broadcastThreadState", (func(string, string, string, string))(nil)),
		field("broadcastThreadSummary", (func() error)(nil)),
		field("replaceLiveDraftWithCanonicalTimeline", (func(context.Context, string, string, string, string) error)(nil)),
		field("lastVisibleTimelineAnchor", (func(context.Context) (FlowerTimelineAnchor, error))(nil)),
		field("reconcilePendingTurnCommand", (func(context.Context, string, string, []string) (bool, error))(nil)),
		field("commitPendingTurnCommandAdmission", (func(context.Context, string, string, []string) error)(nil)),
		field("releasePendingTurnCommandAdmission", (func(context.Context, string, string, string, string) error)(nil)),
		field("lockEffectAuthority", (func(threadEffectJoin) (func(), error))(nil)),
		field("resolveRunModel", (func(context.Context, *config.AIConfig, string, string, *run) (resolvedRunModel, error))(nil)),
		field("registerDelegatedApproval", (func(*run, *run, flruntime.EffectAuthorizationRequest) (*delegatedApprovalHandle, bool, error))(nil)),
		field("markDelegatedApprovalUnavailable", (func(string, string))(nil)),
		field("subagentRuntime", (func() *floretSubagentRuntime)(nil)),
		field("publishSubagentsPatch", (func(context.Context))(nil)),
		interfaceField("terminal", (*runTerminalHost)(nil)),
	})
	assertExactCapabilityFields("runProductCapabilities", runProductCapabilities{}, []fieldContract{
		field("currentSettings", (func(context.Context) (*threadstore.ThreadSettings, error))(nil)),
		field("requireAuthorityWritable", (func(context.Context) error)(nil)),
		field("permissionSnapshot", (func(context.Context, string) (threadstore.PermissionSnapshotRecord, bool, error))(nil)),
		field("childPermissionSnapshot", (func(context.Context, string, string, string) (threadstore.PermissionSnapshotRecord, bool, error))(nil)),
		field("insertPermissionSnapshot", (func(context.Context, threadstore.PermissionSnapshotRecord) error)(nil)),
		field("finalizedChildSnapshot", (func(context.Context, string) (threadstore.ChildPermissionSnapshotRecord, bool, error))(nil)),
		field("getThreadOwnedUpload", (func(context.Context, string) (*threadstore.UploadRecord, error))(nil)),
		field("getQueuedTurnOwnedUpload", (func(context.Context, string, string) (*threadstore.UploadRecord, error))(nil)),
		field("preparePublication", (func(context.Context, threadstore.SubAgentPublicationOperation, threadstore.ChildPermissionSnapshotRecord) error)(nil)),
		field("finalizePublication", (func(context.Context, string, string, string, string, int64) (bool, error))(nil)),
		field("failPublication", (func(context.Context, string, string, string, string, int64) (bool, error))(nil)),
	})
	assertExactCapabilityFields("subagentExecutionCapabilities", subagentExecutionCapabilities{}, []fieldContract{
		field("host", runHostCapabilities{}),
		field("product", runProductCapabilities{}),
	})
	assertExactCapabilityFields("floretSubagentRuntime", floretSubagentRuntime{}, []fieldContract{
		field("muParent", sync.Mutex{}),
		field("parent", (*run)(nil)),
		field("resolveExactChildExecution", (func(context.Context, string, string) (subagentExecutionCapabilities, error))(nil)),
		field("mu", sync.Mutex{}),
		interfaceField("host", (*floretSubagentHost)(nil)),
		field("hostKey", ""),
		field("closed", false),
		field("subagentsPatchQueued", map[string]struct{}{}),
	})

	assertExactMethods := func(name string, interfaceType reflect.Type, expected map[string]reflect.Type) {
		t.Helper()
		if interfaceType.NumMethod() != len(expected) {
			t.Fatalf("%s method count=%d, want %d", name, interfaceType.NumMethod(), len(expected))
		}
		for methodName, methodType := range expected {
			method, ok := interfaceType.MethodByName(methodName)
			if !ok || method.Type != methodType {
				t.Fatalf("%s.%s type=%v, want %v", name, methodName, method.Type, methodType)
			}
		}
	}
	assertExactMethods("runTerminalHost", reflect.TypeOf((*runTerminalHost)(nil)).Elem(), map[string]reflect.Type{
		"Start":           reflect.TypeOf((func(terminalProcessStartRequest) (*terminalProcess, error))(nil)),
		"Get":             reflect.TypeOf((func(string) (*terminalProcess, error))(nil)),
		"ProcessesForRun": reflect.TypeOf((func(string) []*terminalProcess)(nil)),
		"Finalize":        reflect.TypeOf((func(floretPendingToolSettler, flruntime.PendingToolSettlementTarget, terminalProcessSnapshot) error)(nil)),
	})
	assertExactMethods("subagentRuntime", reflect.TypeOf((*subagentRuntime)(nil)).Elem(), map[string]reflect.Type{
		"manage":    reflect.TypeOf((func(context.Context, string, map[string]any) (map[string]any, error))(nil)),
		"release":   reflect.TypeOf((func())(nil)),
		"snapshots": reflect.TypeOf((func(context.Context) ([]subagentSnapshot, error))(nil)),
	})
}

func deleteCanonicalThreadForTest(t *testing.T, svc *Service, threadID string) floretMaintenanceHost {
	t.Helper()
	host, err := svc.openFloretMaintenanceHost(context.Background(), threadID)
	if err != nil {
		t.Fatalf("openFloretMaintenanceHost: %v", err)
	}
	if err := host.DeleteThread(context.Background(), flruntime.ThreadID(threadID)); err != nil {
		t.Fatalf("DeleteThread canonical journal: %v", err)
	}
	return host
}

func assertCanonicalThreadStillMissing(t *testing.T, host floretMaintenanceHost, threadID string) {
	t.Helper()
	if _, err := host.ReadThread(context.Background(), flruntime.ThreadID(threadID)); !errors.Is(err, flruntime.ErrThreadDeleted) {
		t.Fatalf("ReadThread error=%v, want %v", err, flruntime.ErrThreadDeleted)
	}
}

func TestRunFloretHostedTurnDoesNotRecreateMissingCanonicalThread(t *testing.T) {
	provider := &capturingTurnProvider{}
	r := newFloretRuntimeTestRun(t, runOptions{
		RunID: "run_missing_canonical", EndpointID: "env_missing_canonical_runtime",
		ThreadID: "thread_missing_canonical_runtime", MessageID: "turn_missing_canonical_runtime",
		AIConfig: &config.AIConfig{},
	})
	host, err := testServiceForRun(t, r).openFloretMaintenanceHost(context.Background(), r.threadID)
	if err != nil {
		t.Fatal(err)
	}
	if err := host.DeleteThread(context.Background(), flruntime.ThreadID(r.threadID)); err != nil {
		t.Fatal(err)
	}
	err = r.runFloretHostedTurn(context.Background(), RunRequest{
		Model: "compat/gpt-test", Input: RunInput{Text: "must fail closed"},
		Options: RunOptions{PermissionType: config.AIPermissionFullAccess},
	}, config.AIProvider{ID: "compat", Type: "openai", BaseURL: "https://example.test/v1"}, "sk-test", "must fail closed", provider)
	if !errors.Is(err, flruntime.ErrThreadDeleted) {
		t.Fatalf("runFloretHostedTurn error=%v, want %v", err, flruntime.ErrThreadDeleted)
	}
	if provider.requestCount() != 0 {
		t.Fatalf("provider request count=%d, want 0", provider.requestCount())
	}
	preparedSnapshotID := strings.TrimSpace(r.currentPermissionSnapshot().SnapshotID)
	if preparedSnapshotID == "" {
		t.Fatal("missing prepared permission snapshot identity")
	}
	if _, ok, err := runThreadStoreForTest(t, r).GetPermissionSnapshot(context.Background(), r.endpointID, preparedSnapshotID); err != nil || ok {
		t.Fatalf("permission snapshot persisted before canonical authority validation: ok=%v err=%v", ok, err)
	}
	if _, err := host.ReadThread(context.Background(), flruntime.ThreadID(r.threadID)); !errors.Is(err, flruntime.ErrThreadDeleted) {
		t.Fatalf("canonical thread was recreated: %v", err)
	}
}

func TestServiceOperationsFailWhenSettingsOutliveCanonicalThread(t *testing.T) {
	newMissingCanonical := func(t *testing.T) (*Service, *session.Meta, string, floretMaintenanceHost) {
		t.Helper()
		svc := newSendTurnTestService(t)
		meta := testSendTurnMeta()
		thread, err := svc.CreateThread(context.Background(), meta, "canonical boundary", "", "", "")
		if err != nil {
			t.Fatalf("CreateThread: %v", err)
		}
		host := deleteCanonicalThreadForTest(t, svc, thread.ThreadID)
		return svc, meta, thread.ThreadID, host
	}

	t.Run("send", func(t *testing.T) {
		svc, meta, threadID, host := newMissingCanonical(t)
		_, err := svc.SendUserTurn(context.Background(), meta, SendUserTurnRequest{
			ThreadID: threadID, Input: RunInput{Text: "must not start"},
		})
		if !errors.Is(err, flruntime.ErrThreadDeleted) {
			t.Fatalf("SendUserTurn error=%v, want %v", err, flruntime.ErrThreadDeleted)
		}
		if queued, countErr := svc.threadsDB.CountFollowupsByLane(context.Background(), meta.EndpointID, threadID, "queued"); countErr != nil || queued != 0 {
			t.Fatalf("queued count=%d err=%v, want no fallback queue", queued, countErr)
		}
		assertCanonicalThreadStillMissing(t, host, threadID)
	})

	t.Run("queue reconciliation", func(t *testing.T) {
		svc, meta, threadID, host := newMissingCanonical(t)
		command := createPendingCommandForTest(t, svc, meta, threadID, "queue_missing_canonical", "turn_missing_canonical", "run_missing_canonical")
		accepted, err := svc.reconcilePendingTurnCommand(context.Background(), meta.EndpointID, threadID, command.QueueID, command.TurnID, nil)
		if accepted || !errors.Is(err, flruntime.ErrThreadDeleted) {
			t.Fatalf("reconcile accepted=%v error=%v, want canonical not found", accepted, err)
		}
		if stored, getErr := svc.threadsDB.GetQueuedTurn(context.Background(), meta.EndpointID, threadID, command.QueueID); getErr != nil || stored == nil {
			t.Fatalf("pending command changed: %#v err=%v", stored, getErr)
		}
		assertCanonicalThreadStillMissing(t, host, threadID)
	})

	t.Run("queue drain", func(t *testing.T) {
		svc, meta, threadID, host := newMissingCanonical(t)
		command := createPendingCommandForTest(t, svc, meta, threadID, "queue_drain_missing_canonical", "turn_drain_missing_canonical", "run_drain_missing_canonical")
		actor := newThreadActor(svc.threadMgr, runThreadKey(meta.EndpointID, threadID), meta.EndpointID, threadID)
		if err := actor.handleMaybeStartQueuedTurn(context.Background()); !errors.Is(err, flruntime.ErrThreadDeleted) {
			t.Fatalf("handleMaybeStartQueuedTurn error=%v, want %v", err, flruntime.ErrThreadDeleted)
		}
		if stored, getErr := svc.threadsDB.GetQueuedTurn(context.Background(), meta.EndpointID, threadID, command.QueueID); getErr != nil || stored == nil {
			t.Fatalf("pending command changed: %#v err=%v", stored, getErr)
		}
		assertCanonicalThreadStillMissing(t, host, threadID)
	})

	t.Run("compaction", func(t *testing.T) {
		svc, meta, threadID, host := newMissingCanonical(t)
		actor := newThreadActor(svc.threadMgr, runThreadKey(meta.EndpointID, threadID), meta.EndpointID, threadID)
		_, err := actor.handleCompactThreadContext(context.Background(), meta, CompactThreadContextRequest{ThreadID: threadID})
		if !errors.Is(err, flruntime.ErrThreadDeleted) {
			t.Fatalf("handleCompactThreadContext error=%v, want %v", err, flruntime.ErrThreadDeleted)
		}
		assertCanonicalThreadStillMissing(t, host, threadID)
	})

	t.Run("rename and fork", func(t *testing.T) {
		svc, meta, threadID, host := newMissingCanonical(t)
		if err := svc.RenameThread(context.Background(), meta, threadID, "must not recreate"); !errors.Is(err, flruntime.ErrThreadDeleted) {
			t.Fatalf("RenameThread error=%v, want %v", err, flruntime.ErrThreadDeleted)
		}
		if _, err := svc.ForkThread(context.Background(), meta, threadID, "must not fork"); !errors.Is(err, flruntime.ErrThreadDeleted) {
			t.Fatalf("ForkThread error=%v, want %v", err, flruntime.ErrThreadDeleted)
		}
		assertCanonicalThreadStillMissing(t, host, threadID)
	})

	t.Run("live context", func(t *testing.T) {
		svc, meta, threadID, host := newMissingCanonical(t)
		if _, err := svc.flowerLiveCanonicalContextState(context.Background(), meta.EndpointID, threadID); !errors.Is(err, flruntime.ErrThreadDeleted) {
			t.Fatalf("flowerLiveCanonicalContextState error=%v, want %v", err, flruntime.ErrThreadDeleted)
		}
		assertCanonicalThreadStillMissing(t, host, threadID)
	})
}

func TestSubagentHostDoesNotRecreateMissingParentCanonicalThread(t *testing.T) {
	workspace := t.TempDir()
	cfg := &config.AIConfig{
		CurrentModelID: "openai/gpt-5-mini",
		Providers: []config.AIProvider{{
			ID: "openai", Name: "OpenAI", Type: "openai", BaseURL: "https://api.openai.com/v1",
			Models: []config.AIProviderModel{{ModelName: "gpt-5-mini"}},
		}},
	}
	r := newRun(runOptions{
		Log: slog.New(slog.NewTextHandler(io.Discard, nil)), StateDir: workspace, AgentHomeDir: workspace, WorkingDir: workspace,
		Shell: "bash", AIConfig: cfg, RunID: "run_missing_parent", EndpointID: "env_missing_parent",
		ThreadID: "thread_missing_parent", MessageID: "turn_missing_parent", ResolveProviderKey: func(providerID string) (string, bool, error) {
			return "sk-test", strings.TrimSpace(providerID) == "openai", nil
		},
	})
	r.currentModelID = "openai/gpt-5-mini"
	prepareSubagentPermissionSnapshot(t, r)
	host, err := testServiceForRun(t, r).openFloretMaintenanceHost(context.Background(), r.threadID)
	if err != nil {
		t.Fatal(err)
	}
	if err := host.DeleteThread(context.Background(), flruntime.ThreadID(r.threadID)); err != nil {
		t.Fatal(err)
	}
	runtime := &floretSubagentRuntime{parent: r}
	if _, err := runtime.ensureHost(context.Background()); !errors.Is(err, flruntime.ErrThreadDeleted) {
		t.Fatalf("ensureHost error=%v, want %v", err, flruntime.ErrThreadDeleted)
	}
	if runtime.currentHost() != nil {
		t.Fatal("subagent runtime retained a host after canonical parent validation failed")
	}
	if _, err := host.ReadThread(context.Background(), flruntime.ThreadID(r.threadID)); !errors.Is(err, flruntime.ErrThreadDeleted) {
		t.Fatalf("canonical parent was recreated: %v", err)
	}
}

func TestSubagentExecutionCannotDeriveSiblingOrRootResourceAuthority(t *testing.T) {
	manager := newTerminalProcessManager()
	store, err := threadstore.Open(filepath.Join(t.TempDir(), "threads.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	svc := &Service{terminalProcesses: manager, threadsDB: store}
	svc.threadMgr = newThreadManager(svc)
	t.Cleanup(svc.threadMgr.Close)

	root := newRunWithProductStoreForTest(t, runOptions{EndpointID: "env_authority", ThreadID: "root_authority", RunID: "run_authority"}, store)
	execution, err := svc.bindSubagentExecutionForParent(root, "child_authority", "child_run_authority")
	if err != nil {
		t.Fatal(err)
	}
	child := execution.host
	if child.subagentRuntime != nil || child.publishSubagentsPatch != nil {
		t.Fatal("child execution retained parent SubAgent lifecycle or sibling resource capability")
	}
	if child.hasPendingApprovals != nil || child.pendingLiveToolApprovals != nil || child.broadcastThreadState != nil ||
		child.broadcastThreadSummary != nil || child.replaceLiveDraftWithCanonicalTimeline != nil ||
		child.lastVisibleTimelineAnchor != nil || child.reconcilePendingTurnCommand != nil ||
		child.commitPendingTurnCommandAdmission != nil || child.releasePendingTurnCommandAdmission != nil ||
		child.resolveRunModel != nil || child.registerDelegatedApproval != nil || child.markDelegatedApprovalUnavailable != nil {
		t.Fatal("child execution retained root presentation, admission, model, or approval coordination capability")
	}
	if child.authorityThreadID != "root_authority" || child.lockEffectAuthority == nil {
		t.Fatalf("child effect authority=%q, want exact parent authority gate", child.authorityThreadID)
	}
	if execution.product.childPermissionSnapshot != nil || execution.product.finalizedChildSnapshot != nil ||
		execution.product.getQueuedTurnOwnedUpload != nil || execution.product.preparePublication != nil ||
		execution.product.finalizePublication != nil || execution.product.failPublication != nil {
		t.Fatal("child execution retained root permission, queue, or publication coordination capability")
	}
	for _, forbiddenThreadID := range []string{"root_authority", "sibling_authority"} {
		if _, err := child.terminal.Start(terminalProcessStartRequest{
			EndpointID: "env_authority",
			ThreadID:   forbiddenThreadID,
		}); err == nil || !strings.Contains(err.Error(), "authority mismatch") {
			t.Fatalf("terminal start for %q error=%v, want authority mismatch", forbiddenThreadID, err)
		}
	}
}

func TestRunReachableSubagentRuntimeExposesOnlyValidatedChildResolution(t *testing.T) {
	host := &recordingFloretHost{}
	runtime, parent := newBoundSubagentRuntimeForTest(t, "parent_validated_resolution", host, "child_owned")
	childRunID, err := runtime.childRunIDForThread("child_owned")
	if err != nil {
		t.Fatal(err)
	}
	host.snapshots = []flruntime.SubAgentSnapshot{
		{ParentThreadID: flruntime.ThreadID(parent.threadID), ThreadID: "child_owned", Status: flruntime.SubAgentStatusRunning},
		{ParentThreadID: flruntime.ThreadID(parent.threadID), ThreadID: "child_without_audit", Status: flruntime.SubAgentStatusRunning},
	}

	var exposed subagentRuntime = runtime
	concrete, ok := exposed.(*floretSubagentRuntime)
	if !ok {
		t.Fatalf("runtime dynamic type=%T", exposed)
	}
	runtimeType := reflect.TypeOf(concrete).Elem()
	for index := 0; index < runtimeType.NumField(); index++ {
		field := runtimeType.Field(index)
		if strings.Contains(strings.ToLower(field.Name), "bind") {
			t.Fatalf("run-reachable SubAgent runtime retains raw binder field %q", field.Name)
		}
	}
	if _, err := concrete.childExecutionCapabilities(context.Background(), "child_owned", childRunID); err != nil {
		t.Fatalf("resolve exact owned child: %v", err)
	}
	if _, err := concrete.childExecutionCapabilities(context.Background(), "child_owned", "wrong_child_run"); err == nil || !strings.Contains(err.Error(), "finalized permission audit") {
		t.Fatalf("wrong child run error=%v", err)
	}
	if _, err := concrete.childExecutionCapabilities(context.Background(), "sibling_unowned", "sibling_run"); err == nil || !strings.Contains(err.Error(), "not owned") {
		t.Fatalf("sibling resolution error=%v", err)
	}
	if _, err := concrete.childExecutionCapabilities(context.Background(), "child_without_audit", "child_without_audit_run"); err == nil {
		t.Fatal("canonical child without finalized product audit received execution authority")
	}
}

func TestSubagentExecutableRunRejectsMissingExactAuthority(t *testing.T) {
	parent := newRun(runOptions{EndpointID: "env_authority", ThreadID: "root_authority"})
	if child := parent.subagentChildRun(subagentExecutionCapabilities{}); child != nil {
		t.Fatalf("executable child accepted empty authority: %#v", child)
	}
	if policy := parent.subagentPolicyRun(); policy == nil {
		t.Fatal("policy-only SubAgent run is unavailable")
	}
}

func TestRootRunProductCapabilitiesAcceptDurableChildLineageFromEarlierTurn(t *testing.T) {
	store, err := threadstore.Open(filepath.Join(t.TempDir(), "threads.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	parent := newRunWithProductStoreForTest(t, runOptions{
		EndpointID: "env_durable_child", ThreadID: "parent_durable_child", RunID: "parent_run_original",
	}, store)
	if err := store.CreateThreadSettings(context.Background(), threadstore.ThreadSettings{
		EndpointID: parent.endpointID, ThreadID: parent.threadID, PermissionType: config.AIPermissionApprovalRequired,
	}); err != nil {
		t.Fatal(err)
	}
	parent.setPermissionState(FlowerPermissionApprovalRequired, permissionSnapshotWithOwnerIdentity(
		buildPermissionSnapshot(FlowerPermissionApprovalRequired, nil, nil), parent.endpointID, parent.threadID, parent.id,
	))
	insertPermissionPolicyChildSnapshot(t, parent, "child_durable", "terminal.exec")

	currentTurn, err := bindRootRunProductCapabilities(store, parent.endpointID, parent.threadID, "parent_run_current")
	if err != nil {
		t.Fatal(err)
	}
	record, ok, err := currentTurn.loadFinalizedChildSnapshot(context.Background(), "child_durable")
	if err != nil || !ok {
		t.Fatalf("load durable child audit ok=%v err=%v", ok, err)
	}
	if record.ParentRunID != "parent_run_original" || record.ParentThreadID != parent.threadID {
		t.Fatalf("durable child lineage=%#v", record)
	}
}

func TestFloretReadAdaptersDoNotExposeConcreteHostMethodSets(t *testing.T) {
	store := flruntime.NewMemoryStore()
	t.Cleanup(func() { _ = store.Close() })
	bootstrap := testFloretBootstrap(t, store)
	if _, err := bootstrap.threadCreate.CreateThread(context.Background(), "thread_read_adapter", "create_read_adapter"); err != nil {
		t.Fatal(err)
	}
	threadRead, err := bootstrap.newThreadRead(context.Background(), "thread_read_adapter")
	if err != nil {
		t.Fatal(err)
	}
	if _, leaked := threadRead.(*flruntime.ThreadReadHost); leaked {
		t.Fatal("thread read adapter exposed the Floret concrete host through dynamic type assertion")
	}
	subagentRead, err := bootstrap.newSubagentRead(context.Background(), "thread_read_adapter")
	if err != nil {
		t.Fatal(err)
	}
	if _, leaked := subagentRead.(*flruntime.SubAgentReadHost); leaked {
		t.Fatal("SubAgent read adapter exposed the Floret concrete host through dynamic type assertion")
	}
}
