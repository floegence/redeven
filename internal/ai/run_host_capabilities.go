package ai

import (
	"context"
	"errors"
	"strings"

	flruntime "github.com/floegence/floret/runtime"
	"github.com/floegence/redeven/internal/config"
)

// runHostCapabilities is the complete host capability set available to one
// exact root-thread runtime. It intentionally contains no Service, Floret
// bootstrap, lifecycle coordinator, or capability binder.
type runHostCapabilities struct {
	authorityThreadID                     string
	hasPendingApprovals                   func() bool
	pendingLiveToolApprovals              func(string) []FlowerApprovalAction
	broadcastThreadState                  func(string, string, string, string)
	broadcastThreadSummary                func()
	replaceLiveDraftWithCanonicalTimeline func(context.Context, string, string, string) error
	lastVisibleTimelineAnchor             func(context.Context) (FlowerTimelineAnchor, error)
	reconcilePendingTurnCommand           func(context.Context, string, string, []string) (bool, error)
	commitPendingTurnCommandAdmission     func(context.Context, string, string, []string) error
	releasePendingTurnCommandAdmission    func(context.Context, string, string, string, string) error
	lockEffectAuthority                   func(threadEffectJoin) (func(), error)
	resolveRunModel                       func(context.Context, *config.AIConfig, string, string, *run) (resolvedRunModel, error)
	registerDelegatedApproval             func(*run, *run, flruntime.EffectAuthorizationRequest) (*delegatedApprovalHandle, bool, error)
	markDelegatedApprovalUnavailable      func(string, string)
	subagentRuntime                       func() *floretSubagentRuntime
	publishSubagentsPatch                 func(context.Context)
	terminal                              runTerminalHost
}

func (s *Service) bindRunHostCapabilities(endpointID string, threadID string) (runHostCapabilities, error) {
	if s == nil {
		return runHostCapabilities{}, errors.New("run host service is required")
	}
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	if endpointID == "" || threadID == "" {
		return runHostCapabilities{}, errors.New("run host authority identity is incomplete")
	}
	if s.threadMgr == nil {
		return runHostCapabilities{}, errors.New("run lifecycle authority is unavailable")
	}
	host, err := s.bindExactRunExecutionCapabilities(endpointID, threadID, threadID)
	if err != nil {
		return runHostCapabilities{}, err
	}
	host.hasPendingApprovals = func() bool {
		return s.threadHasPendingApprovals(endpointID, threadID)
	}
	host.pendingLiveToolApprovals = func(runID string) []FlowerApprovalAction {
		return s.pendingLiveToolApprovals(endpointID, threadID, runID)
	}
	host.broadcastThreadState = func(runID string, status string, errCode string, runErr string) {
		s.broadcastThreadState(endpointID, threadID, runID, status, errCode, runErr)
	}
	host.broadcastThreadSummary = func() {
		s.broadcastThreadSummary(endpointID, threadID)
	}
	host.replaceLiveDraftWithCanonicalTimeline = func(ctx context.Context, runID string, turnID string, reason string) error {
		return s.replaceFlowerLiveDraftWithCanonicalTimeline(ctx, endpointID, threadID, runID, turnID, reason)
	}
	host.lastVisibleTimelineAnchor = func(ctx context.Context) (FlowerTimelineAnchor, error) {
		return s.lastVisibleFlowerTimelineAnchor(ctx, endpointID, threadID)
	}
	host.reconcilePendingTurnCommand = func(ctx context.Context, commandID string, turnID string, uploadIDs []string) (bool, error) {
		return s.reconcilePendingTurnCommand(ctx, endpointID, threadID, commandID, turnID, uploadIDs)
	}
	host.commitPendingTurnCommandAdmission = func(ctx context.Context, commandID string, turnID string, uploadIDs []string) error {
		return s.commitPendingTurnCommandAdmission(ctx, endpointID, threadID, commandID, turnID, uploadIDs)
	}
	host.releasePendingTurnCommandAdmission = func(ctx context.Context, commandID string, turnID string, runID string, targetLane string) error {
		return s.releasePendingTurnCommandAdmission(ctx, endpointID, threadID, commandID, turnID, runID, targetLane)
	}
	host.resolveRunModel = s.resolveRunModel
	host.registerDelegatedApproval = s.registerDelegatedApproval
	host.markDelegatedApprovalUnavailable = s.markDelegatedApprovalUnavailable
	host.subagentRuntime = func() *floretSubagentRuntime {
		return s.subagentRuntimeForParent(endpointID, threadID)
	}
	host.publishSubagentsPatch = func(ctx context.Context) {
		s.publishFlowerSubagentsPatch(ctx, endpointID, threadID)
	}
	return host, nil
}

// bindExactRunExecutionCapabilities exposes only effect dispatch and concrete
// resources for one execution thread. A child capability keeps its parent as
// the permission authority but cannot derive another child or mutate root
// admission and presentation state.
func (s *Service) bindExactRunExecutionCapabilities(endpointID string, executionThreadID string, effectAuthorityThreadID string) (runHostCapabilities, error) {
	if s == nil || s.threadMgr == nil {
		return runHostCapabilities{}, errors.New("run lifecycle authority is unavailable")
	}
	endpointID = strings.TrimSpace(endpointID)
	executionThreadID = strings.TrimSpace(executionThreadID)
	effectAuthorityThreadID = strings.TrimSpace(effectAuthorityThreadID)
	if endpointID == "" || executionThreadID == "" || effectAuthorityThreadID == "" {
		return runHostCapabilities{}, errors.New("run execution authority identity is incomplete")
	}
	terminal, err := newBoundRunTerminalHost(s.terminalProcesses, endpointID, executionThreadID, s.finalizeTerminalProcess)
	if err != nil {
		return runHostCapabilities{}, err
	}
	return runHostCapabilities{
		authorityThreadID: effectAuthorityThreadID,
		lockEffectAuthority: func(join threadEffectJoin) (func(), error) {
			return s.threadMgr.lockThreadEffect(endpointID, effectAuthorityThreadID, executionThreadID, join)
		},
		terminal: terminal,
	}, nil
}

func (s *Service) pendingLiveToolApprovals(endpointID string, threadID string, runID string) []FlowerApprovalAction {
	if s == nil {
		return nil
	}
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	runID = strings.TrimSpace(runID)
	if endpointID == "" || threadID == "" || runID == "" {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	stream := s.flowerLiveByThread[runThreadKey(endpointID, threadID)]
	if stream == nil || len(stream.State.ApprovalActions) == 0 {
		return nil
	}
	out := make([]FlowerApprovalAction, 0, len(stream.State.ApprovalActions))
	for _, action := range stream.State.ApprovalActions {
		if action.Origin != FlowerApprovalOriginMainTool ||
			strings.TrimSpace(action.RunID) != runID ||
			action.Status != FlowerApprovalStatusPending ||
			action.State != FlowerApprovalStateRequested {
			continue
		}
		out = append(out, action)
	}
	return out
}

type runTerminalHost interface {
	Start(terminalProcessStartRequest) (*terminalProcess, error)
	Get(string) (*terminalProcess, error)
	ProcessesForRun(string) []*terminalProcess
	Finalize(floretPendingToolSettler, flruntime.PendingToolSettlementTarget, terminalProcessSnapshot) error
}

type boundRunTerminalHost struct {
	manager    *terminalProcessManager
	endpointID string
	threadID   string
	finalize   func(floretPendingToolSettler, flruntime.PendingToolSettlementTarget, terminalProcessSnapshot) error
}

func newBoundRunTerminalHost(manager *terminalProcessManager, endpointID string, threadID string, finalize func(floretPendingToolSettler, flruntime.PendingToolSettlementTarget, terminalProcessSnapshot) error) (runTerminalHost, error) {
	if manager == nil || finalize == nil {
		return nil, errors.New("terminal process authority is unavailable")
	}
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	if endpointID == "" || threadID == "" {
		return nil, errors.New("terminal process authority identity is incomplete")
	}
	return boundRunTerminalHost{manager: manager, endpointID: endpointID, threadID: threadID, finalize: finalize}, nil
}

func (h boundRunTerminalHost) Start(req terminalProcessStartRequest) (*terminalProcess, error) {
	if strings.TrimSpace(req.EndpointID) != h.endpointID || strings.TrimSpace(req.ThreadID) != h.threadID {
		return nil, errors.New("terminal process start authority mismatch")
	}
	return h.manager.Start(req)
}

func (h boundRunTerminalHost) Get(processID string) (*terminalProcess, error) {
	proc, ok := h.manager.Get(strings.TrimSpace(processID))
	if !ok || proc == nil {
		return nil, errors.New("terminal process not found")
	}
	snapshot := proc.Snapshot()
	if strings.TrimSpace(snapshot.EndpointID) != h.endpointID || strings.TrimSpace(snapshot.ThreadID) != h.threadID {
		return nil, errors.New("terminal process not found")
	}
	return proc, nil
}

func (h boundRunTerminalHost) ProcessesForRun(runID string) []*terminalProcess {
	return h.manager.ProcessesForRun(h.endpointID, h.threadID, strings.TrimSpace(runID))
}

func (h boundRunTerminalHost) Finalize(owner floretPendingToolSettler, target flruntime.PendingToolSettlementTarget, snapshot terminalProcessSnapshot) error {
	if strings.TrimSpace(snapshot.EndpointID) != h.endpointID || strings.TrimSpace(snapshot.ThreadID) != h.threadID {
		return errors.New("terminal process finalize authority mismatch")
	}
	return h.finalize(owner, target, snapshot)
}
