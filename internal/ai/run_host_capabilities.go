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
	broadcastThreadState                  func(string, string, string, string)
	broadcastThreadSummary                func() error
	replaceLiveDraftWithCanonicalTimeline func(context.Context, string, string, string, string) error
	lastVisibleTimelineAnchor             func(context.Context) (FlowerTimelineAnchor, error)
	reconcilePendingTurnCommand           func(context.Context, string, string, []string) (bool, error)
	commitPendingTurnCommandAdmission     func(context.Context, string, string, []string) error
	releasePendingTurnCommandAdmission    func(context.Context, string, string, string, string) error
	lockEffectAuthority                   func(threadEffectJoin) (func(), error)
	resolveRunModel                       func(context.Context, *config.AIConfig, string, string, *run) (resolvedRunModel, error)
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
	host.broadcastThreadState = func(runID string, status string, errCode string, runErr string) {
		s.broadcastThreadState(endpointID, threadID, runID, status, errCode, runErr)
	}
	host.broadcastThreadSummary = func() error {
		return s.broadcastThreadSummaryChecked(endpointID, threadID)
	}
	host.replaceLiveDraftWithCanonicalTimeline = func(ctx context.Context, runID string, turnID string, messageID string, reason string) error {
		return s.replaceFlowerLiveDraftWithCanonicalTimeline(ctx, endpointID, threadID, runID, turnID, messageID, reason)
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
	if s.pendingToolRecovery == nil {
		return runHostCapabilities{}, errors.New("Floret pending tool recovery coordinator is unavailable")
	}
	terminal, err := newBoundRunTerminalHost(
		s.terminalProcesses,
		endpointID,
		executionThreadID,
		effectAuthorityThreadID,
		s.pendingToolRecovery,
		s.finalizeTerminalProcess,
	)
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

type runTerminalHost interface {
	Start(terminalProcessStartRequest) (*terminalProcess, error)
	Get(string) (*terminalProcess, error)
	ProcessesForRun(string) []*terminalProcess
	Finalize(context.Context, floretPendingToolSettler, flruntime.PendingToolSettlementTarget, terminalProcessSnapshot) error
}

type boundRunTerminalHost struct {
	manager           *terminalProcessManager
	endpointID        string
	threadID          string
	authorityThreadID string
	recovery          floretPendingToolRecoveryCoordinator
	finalize          terminalProcessFinalizeFunc
}

func newBoundRunTerminalHost(
	manager *terminalProcessManager,
	endpointID string,
	threadID string,
	authorityThreadID string,
	recovery floretPendingToolRecoveryCoordinator,
	finalize terminalProcessFinalizeFunc,
) (runTerminalHost, error) {
	if manager == nil || recovery == nil || finalize == nil {
		return nil, errors.New("terminal process authority is unavailable")
	}
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	authorityThreadID = strings.TrimSpace(authorityThreadID)
	if endpointID == "" || threadID == "" || authorityThreadID == "" {
		return nil, errors.New("terminal process authority identity is incomplete")
	}
	return boundRunTerminalHost{
		manager: manager, endpointID: endpointID, threadID: threadID,
		authorityThreadID: authorityThreadID, recovery: recovery, finalize: finalize,
	}, nil
}

func (h boundRunTerminalHost) Start(req terminalProcessStartRequest) (*terminalProcess, error) {
	if strings.TrimSpace(req.EndpointID) != h.endpointID || strings.TrimSpace(req.ThreadID) != h.threadID {
		return nil, errors.New("terminal process start authority mismatch")
	}
	req.RecoveryCoordinator = h.recovery
	req.RecoveryAuthorityThreadID = h.authorityThreadID
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

func (h boundRunTerminalHost) Finalize(ctx context.Context, owner floretPendingToolSettler, target flruntime.PendingToolSettlementTarget, snapshot terminalProcessSnapshot) error {
	if strings.TrimSpace(snapshot.EndpointID) != h.endpointID || strings.TrimSpace(snapshot.ThreadID) != h.threadID {
		return errors.New("terminal process finalize authority mismatch")
	}
	return h.finalize(ctx, owner, target, snapshot)
}
