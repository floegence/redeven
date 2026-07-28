package ai

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	flruntime "github.com/floegence/floret/runtime"
	"github.com/floegence/redeven/internal/ai/threadstore"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/session"
)

func TestDrainPendingSubAgentPublicationBatchesProcessesEveryBatch(t *testing.T) {
	t.Parallel()

	operations := make([]threadstore.SubAgentPublicationOperation, 205)
	for index := range operations {
		operations[index].PublicationID = fmt.Sprintf("publication_%03d", index)
	}
	cursor := 0
	var replayed []string
	completed, err := drainPendingSubAgentPublicationBatches(
		context.Background(),
		func(_ context.Context, limit int) ([]threadstore.SubAgentPublicationOperation, error) {
			if limit != subAgentPublicationReplayBatchSize {
				t.Fatalf("limit=%d, want %d", limit, subAgentPublicationReplayBatchSize)
			}
			if cursor >= len(operations) {
				return nil, nil
			}
			end := cursor + limit
			if end > len(operations) {
				end = len(operations)
			}
			batch := append([]threadstore.SubAgentPublicationOperation(nil), operations[cursor:end]...)
			cursor = end
			return batch, nil
		},
		func(_ context.Context, operation threadstore.SubAgentPublicationOperation) error {
			replayed = append(replayed, operation.PublicationID)
			return nil
		},
	)
	if err != nil {
		t.Fatalf("drainPendingSubAgentPublicationBatches: %v", err)
	}
	if completed != len(operations) || len(replayed) != len(operations) {
		t.Fatalf("completed=%d replayed=%d, want %d", completed, len(replayed), len(operations))
	}
	for index, operation := range operations {
		if replayed[index] != operation.PublicationID {
			t.Fatalf("replay[%d]=%q, want %q", index, replayed[index], operation.PublicationID)
		}
	}
}

func TestSubAgentPublicationRecoveryRebuildsPersistedRunConfiguration(t *testing.T) {
	t.Parallel()

	store, err := threadstore.Open(t.TempDir() + "/threads.sqlite")
	if err != nil {
		t.Fatalf("threadstore.Open: %v", err)
	}
	defer func() { _ = store.Close() }()
	const (
		endpointID     = "env_recovery"
		parentThreadID = "thread_parent_recovery"
		parentTurnID   = "turn_parent_recovery"
		parentRunID    = "run_parent_recovery"
		childThreadID  = "thread_child_recovery"
		childRunID     = "run_child_recovery"
		toolCallID     = "spawn_recovery"
		modelID        = "provider/persisted-model"
	)
	if err := store.CreateThreadSettings(context.Background(), threadstore.ThreadSettings{
		ThreadID: parentThreadID, EndpointID: endpointID, PermissionType: config.AIPermissionApprovalRequired,
		WorkingDir: t.TempDir(), SettingsCreatedAtUnixMs: 1, SettingsUpdatedAtUnixMs: 1,
	}); err != nil {
		t.Fatalf("CreateThreadSettings: %v", err)
	}
	meta := &session.Meta{EndpointID: endpointID, ChannelID: "channel_persisted", UserPublicID: "user_persisted"}
	parent := newRunWithProductStoreForTest(t, runOptions{
		RunID: parentRunID, EndpointID: endpointID, ThreadID: parentThreadID, MessageID: parentTurnID,
		SessionMeta: meta, PersistOpTimeout: time.Second,
	}, store)
	parent.currentModelID = modelID
	parent.currentReasoning = config.AIReasoningSelection{Level: config.AIReasoningLevelHigh}
	parentSnapshot := permissionSnapshotWithOwnerIdentity(
		buildPermissionSnapshot(FlowerPermissionApprovalRequired, nil, nil),
		endpointID,
		parentThreadID,
		parentRunID,
	)
	if err := parent.persistPermissionSnapshot(parentSnapshot); err != nil {
		t.Fatalf("persistPermissionSnapshot: %v", err)
	}
	parent.setPermissionState(parentSnapshot.PermissionType, parentSnapshot)
	childSnapshot := permissionSnapshotWithOwnerIdentity(
		buildPermissionSnapshot(FlowerPermissionApprovalRequired, nil, nil),
		endpointID,
		childThreadID,
		childRunID,
	)
	request := flruntime.SpawnSubAgentRequest{
		PublicationID:  "publication_recovery",
		ParentThreadID: parentThreadID,
		ParentTurnID:   parentTurnID,
		ThreadID:       childThreadID,
		ForkMode:       flruntime.SubAgentForkNone,
		TaskName:       "Recovery Check",
		Message:        "recover the persisted publication",
		Labels: flruntime.RunLabels{Host: map[string]string{
			subagentToolHostContextChildRunIDKey: childRunID,
		}},
	}
	if err := prepareSubAgentPublication(parent, toolCallID, parentSnapshot, childSnapshot, request); err != nil {
		t.Fatalf("prepareSubAgentPublication: %v", err)
	}
	operations, err := store.ListPendingSubAgentPublications(context.Background(), 10)
	if err != nil || len(operations) != 1 {
		t.Fatalf("pending operations=%#v err=%v", operations, err)
	}
	canonicalStore := flruntime.NewMemoryStore()
	t.Cleanup(func() { _ = canonicalStore.Close() })
	canonicalRuntime := testFloretBootstrap(t, canonicalStore)
	create, err := canonicalRuntime.newThreadCreate(parentThreadID, "create-"+parentThreadID)
	if err != nil {
		t.Fatalf("bind canonical parent creation: %v", err)
	}
	if _, err := create.CreateThread(context.Background(), flruntime.CreateThreadRequest{ThreadID: parentThreadID, CreateIntentID: "create-" + parentThreadID}); err != nil {
		t.Fatalf("create canonical parent: %v", err)
	}
	canonicalCapabilities, err := canonicalRuntime.bindThreadRuntime(parentThreadID)
	if err != nil {
		t.Fatalf("bind canonical parent runtime: %v", err)
	}
	recoveredHost := &recordingFloretHost{}
	recoveredOptionsAccepted := false
	svc := &Service{
		threadsDB:         store,
		persistOpTO:       time.Second,
		terminalProcesses: newTerminalProcessManager(),
		cfg: &config.AIConfig{
			CurrentModelID: modelID,
			Providers: []config.AIProvider{{
				ID: "provider", Type: "openai", BaseURL: "https://example.test/v1", Models: []config.AIProviderModel{{ModelName: "persisted-model"}},
			}},
		},
		resolveProviderKey: func(providerID string) (string, bool, error) {
			return "sk-test", strings.TrimSpace(providerID) == "provider", nil
		},
		pendingToolRecovery: testPendingToolRecoveryCoordinator{owner: &terminalProcessTestOwner{}},
		floretRuntime: &floretRuntimeCapabilityIssuer{bind: func(threadID flruntime.ThreadID) (floretThreadRuntimeCapabilities, error) {
			capabilities := floretThreadRuntimeCapabilities{}
			if strings.TrimSpace(string(threadID)) == parentThreadID {
				capabilities.SubAgent = func(ctx context.Context, options flruntime.SubAgentHostOptions) (floretSubagentHost, error) {
					if _, err := canonicalCapabilities.SubAgent(ctx, options); err != nil {
						return nil, fmt.Errorf("validate recovered SubAgent host options: %w", err)
					}
					recoveredOptionsAccepted = true
					return recoveredHost, nil
				}
			}
			return capabilities, nil
		}},
	}
	svc.threadMgr = newThreadManager(svc)
	defer svc.threadMgr.Close()
	recovered, err := svc.newSubAgentPublicationRecoveryRun(context.Background(), operations[0])
	if err != nil {
		t.Fatalf("newSubAgentPublicationRecoveryRun: %v", err)
	}
	if recovered.currentModelID != modelID || recovered.currentReasoning.Level != config.AIReasoningLevelHigh {
		t.Fatalf("recovered model=%q reasoning=%#v", recovered.currentModelID, recovered.currentReasoning)
	}
	if recovered.sessionMeta == nil || recovered.sessionMeta.ChannelID != meta.ChannelID || recovered.sessionMeta.UserPublicID != meta.UserPublicID {
		t.Fatalf("recovered session meta=%#v", recovered.sessionMeta)
	}
	if recovered.currentPermissionSnapshot().SnapshotID != parentSnapshot.SnapshotID {
		t.Fatalf("recovered permission snapshot=%q, want %q", recovered.currentPermissionSnapshot().SnapshotID, parentSnapshot.SnapshotID)
	}
	if err := svc.replayPendingSubAgentPublication(context.Background(), operations[0]); err != nil {
		t.Fatalf("replayPendingSubAgentPublication: %v", err)
	}
	if !recoveredOptionsAccepted {
		t.Fatal("recovered SubAgent host options were not accepted by the canonical Floret factory")
	}
	committed, ok, err := store.GetSubAgentPublication(context.Background(), string(request.PublicationID))
	if err != nil || !ok || committed.State != threadstore.SubAgentPublicationCommitted {
		t.Fatalf("recovered publication=%#v ok=%v err=%v", committed, ok, err)
	}
}
