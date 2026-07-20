package ai

import (
	"context"
	"errors"
	"fmt"
	"strings"

	flruntime "github.com/floegence/floret/runtime"
	"github.com/floegence/redeven/internal/ai/threadstore"
	"github.com/floegence/redeven/internal/config"
)

const subAgentPublicationReplayBatchSize = 100

func (s *Service) replayPendingSubAgentPublications(ctx context.Context) (int, error) {
	if s == nil || s.threadsDB == nil {
		return 0, errors.New("SubAgent publication recovery store is unavailable")
	}
	return drainPendingSubAgentPublicationBatches(
		ctxOrBackground(ctx),
		s.threadsDB.ListPendingSubAgentPublications,
		s.replayPendingSubAgentPublication,
	)
}

func drainPendingSubAgentPublicationBatches(
	ctx context.Context,
	list func(context.Context, int) ([]threadstore.SubAgentPublicationOperation, error),
	replay func(context.Context, threadstore.SubAgentPublicationOperation) error,
) (int, error) {
	if list == nil || replay == nil {
		return 0, errors.New("SubAgent publication recovery coordinator is incomplete")
	}
	completed := 0
	for {
		operations, err := list(ctxOrBackground(ctx), subAgentPublicationReplayBatchSize)
		if err != nil {
			return completed, err
		}
		if len(operations) == 0 {
			return completed, nil
		}
		for _, operation := range operations {
			if err := replay(ctxOrBackground(ctx), operation); err != nil {
				return completed, fmt.Errorf("replay SubAgent publication %q: %w", operation.PublicationID, err)
			}
			completed++
		}
	}
}

func (s *Service) replayPendingSubAgentPublication(ctx context.Context, operation threadstore.SubAgentPublicationOperation) error {
	parent, err := s.newSubAgentPublicationRecoveryRun(ctx, operation)
	if err != nil {
		return err
	}
	runtime := newFloretSubagentRuntimeWithExecutionOwner(parent, s.bindSubagentExecutionForParent)
	host, err := runtime.ensureHost(ctxOrBackground(ctx))
	if err != nil {
		return err
	}
	request, err := decodePendingSubAgentPublicationRequest(operation)
	if err != nil {
		return err
	}
	snapshot, err := host.SpawnSubAgent(ctxOrBackground(ctx), request)
	if err != nil {
		return err
	}
	if err := validateSubAgentPublicationSnapshot(request, snapshot); err != nil {
		return err
	}
	return finalizeSubAgentPublication(parent, operation.PublicationID, operation.ChildThreadID, operation.ChildRunID, operation.ChildSnapshotID)
}

func (s *Service) newSubAgentPublicationRecoveryRun(ctx context.Context, operation threadstore.SubAgentPublicationOperation) (*run, error) {
	if s == nil || s.threadsDB == nil {
		return nil, errors.New("SubAgent publication recovery service is unavailable")
	}
	request, err := decodePendingSubAgentPublicationRequest(operation)
	if err != nil {
		return nil, err
	}
	meta, err := unmarshalQueuedTurnSessionMeta(operation.SessionMetaJSON)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(meta.EndpointID) != strings.TrimSpace(operation.EndpointID) {
		return nil, errors.New("SubAgent publication recovery session endpoint mismatch")
	}
	settings, err := s.threadsDB.GetThreadSettings(ctxOrBackground(ctx), operation.EndpointID, operation.ParentThreadID)
	if err != nil {
		return nil, err
	}
	if settings == nil {
		return nil, errors.New("SubAgent publication recovery parent settings are missing")
	}
	workingDir, err := threadWorkingDir(settings)
	if err != nil {
		return nil, err
	}
	childAudit, ok, err := s.threadsDB.GetChildPermissionSnapshotBySpawnToolCall(ctxOrBackground(ctx), operation.EndpointID, operation.SpawnToolCallID)
	if err != nil {
		return nil, err
	}
	if !ok || childAudit.State != "provisional" || childAudit.ChildSnapshotID != operation.ChildSnapshotID ||
		childAudit.ParentThreadID != operation.ParentThreadID || childAudit.ParentRunID != operation.ParentRunID ||
		childAudit.ChildThreadID != operation.ChildThreadID || childAudit.ChildRunID != operation.ChildRunID {
		return nil, errors.New("SubAgent publication recovery permission audit mismatch")
	}
	parentRecord, ok, err := s.threadsDB.GetPermissionSnapshot(ctxOrBackground(ctx), operation.EndpointID, childAudit.ParentSnapshotID)
	if err != nil {
		return nil, err
	}
	if !ok || strings.TrimSpace(parentRecord.OwnerThreadID) != operation.ParentThreadID || strings.TrimSpace(parentRecord.OwnerRunID) != operation.ParentRunID {
		return nil, errors.New("SubAgent publication recovery parent permission snapshot mismatch")
	}
	parentSnapshot, err := decodePermissionSnapshot(parentRecord.SnapshotJSON)
	if err != nil {
		return nil, err
	}
	var reasoning config.AIReasoningSelection
	if raw := strings.TrimSpace(operation.ReasoningSelectionJSON); raw != "" {
		if err := decodeStrictJSON(raw, &reasoning); err != nil {
			return nil, err
		}
	}
	runtimeCapabilities, err := s.bindFloretSubAgentRecoveryRuntime(request.ParentThreadID)
	if err != nil {
		return nil, err
	}
	hostCapabilities, err := s.bindRunHostCapabilities(operation.EndpointID, operation.ParentThreadID)
	if err != nil {
		return nil, err
	}
	productCapabilities, err := bindRootRunProductCapabilities(s.threadsDB, operation.EndpointID, operation.ParentThreadID, operation.ParentRunID)
	if err != nil {
		return nil, err
	}
	parent := newRun(runOptions{
		Log:                       s.log,
		StateDir:                  s.stateDir,
		AgentHomeDir:              s.agentHomeDir,
		WorkingDir:                workingDir,
		FilesystemScope:           s.scope,
		Shell:                     s.shell,
		HostCapabilities:          hostCapabilities,
		AIConfig:                  s.cfg,
		SessionMeta:               &meta,
		ResolveProviderKey:        s.resolveProviderKey,
		ResolveWebSearchKey:       s.resolveWebSearchKey,
		DesktopModelSource:        s.desktopModelSource,
		RunID:                     operation.ParentRunID,
		ChannelID:                 strings.TrimSpace(meta.ChannelID),
		EndpointID:                operation.EndpointID,
		ThreadID:                  operation.ParentThreadID,
		UserPublicID:              strings.TrimSpace(meta.UserPublicID),
		MessageID:                 operation.ParentTurnID,
		UploadsDir:                s.uploadsDir,
		ProductCapabilities:       productCapabilities,
		FloretSubagentHostFactory: runtimeCapabilities.SubAgent,
		PersistOpTimeout:          s.persistTimeout(),
		ToolApprovalTimeout:       s.approvalTimeout,
		SkillManager:              s.skillManager,
		ToolTargetPolicy:          s.toolTargetPolicy,
		TargetToolExecutor:        s.targetToolExecutor,
	})
	parent.currentModelID = strings.TrimSpace(operation.ModelID)
	parent.currentReasoning = config.NormalizeAIReasoningSelection(reasoning)
	parent.setPermissionState(parentSnapshot.PermissionType, parentSnapshot)
	parent.toolAllowlist = stringSet(parentSnapshot.VisibleToolNames...)
	return parent, nil
}

func (s *Service) bindFloretSubAgentRecoveryRuntime(threadID flruntime.ThreadID) (floretThreadRuntimeCapabilities, error) {
	if s == nil || s.floretRuntime == nil {
		return floretThreadRuntimeCapabilities{}, errors.New("Floret runtime binder is unavailable")
	}
	threadIDValue := strings.TrimSpace(string(threadID))
	if threadIDValue == "" {
		return floretThreadRuntimeCapabilities{}, errors.New("Floret runtime binder identity is incomplete")
	}
	capabilities, err := s.floretRuntime.bindThread(threadIDValue)
	if err != nil {
		return floretThreadRuntimeCapabilities{}, fmt.Errorf("bind Floret recovery runtime %q: %w", threadIDValue, err)
	}
	return capabilities, nil
}
