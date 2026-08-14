package ai

import (
	"context"
	"errors"
	"strings"

	"github.com/floegence/floret/v4/identity"
	"github.com/floegence/redeven/internal/config"
)

// runHostCapabilities is the complete host capability set available to one
// exact root-thread runtime. It intentionally contains no Service, Floret
// bootstrap, lifecycle coordinator, or capability binder.
type runHostCapabilities struct {
	authorityThreadID         string
	broadcastThreadState      func(string, string, string, string)
	broadcastThreadSummary    func() error
	lastVisibleTimelineAnchor func(context.Context) (FlowerTimelineAnchor, error)
	resolveRunModel           func(context.Context, *config.AIConfig, string, string, *run) (resolvedRunModel, error)
	publishSubagentsPatch     func(context.Context)
	openLiveAttachment        func(context.Context, UploadOwner, string) (openedCanonicalAttachment, error)
	terminal                  runTerminalHost
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
	host, err := s.bindExactRunExecutionCapabilities(endpointID, threadID, threadID)
	if err != nil {
		return runHostCapabilities{}, err
	}
	host.broadcastThreadState = func(runID string, status string, errCode string, runErr string) {
		if s.threadRuntime == nil {
			return
		}
		if current, err := s.threadRuntime.View(context.Background(), identity.ThreadID(threadID)); err == nil {
			s.publishFlowerRuntimeCurrent(endpointID, current)
		}
	}
	host.broadcastThreadSummary = func() error {
		return s.broadcastThreadSummary(endpointID, threadID)
	}
	host.lastVisibleTimelineAnchor = func(ctx context.Context) (FlowerTimelineAnchor, error) {
		return FlowerTimelineAnchor{}, nil
	}
	host.resolveRunModel = s.resolveRunModel
	host.publishSubagentsPatch = func(ctx context.Context) {
		s.publishFlowerSubagentsPatch(ctx, endpointID, threadID)
	}
	host.openLiveAttachment = func(ctx context.Context, owner UploadOwner, attachmentID string) (openedCanonicalAttachment, error) {
		if owner.EndpointID != endpointID {
			return openedCanonicalAttachment{}, errors.New("attachment authority mismatch")
		}
		return s.openCanonicalLiveAttachment(ctx, owner, threadID, attachmentID)
	}
	return host, nil
}

// bindExactRunExecutionCapabilities exposes only effect dispatch and concrete
// resources for one execution thread. A child capability keeps its parent as
// the permission authority but cannot derive another child or mutate root
// admission and presentation state.
func (s *Service) bindExactRunExecutionCapabilities(endpointID string, executionThreadID string, effectAuthorityThreadID string) (runHostCapabilities, error) {
	if s == nil {
		return runHostCapabilities{}, errors.New("run effect adapter is unavailable")
	}
	endpointID = strings.TrimSpace(endpointID)
	executionThreadID = strings.TrimSpace(executionThreadID)
	effectAuthorityThreadID = strings.TrimSpace(effectAuthorityThreadID)
	if endpointID == "" || executionThreadID == "" || effectAuthorityThreadID == "" {
		return runHostCapabilities{}, errors.New("run execution authority identity is incomplete")
	}
	s.mu.Lock()
	terminalProcesses := s.terminalProcesses
	s.mu.Unlock()
	terminal, err := newBoundRunTerminalHost(
		terminalProcesses,
		endpointID,
		executionThreadID,
		effectAuthorityThreadID,
	)
	if err != nil {
		return runHostCapabilities{}, err
	}
	return runHostCapabilities{
		authorityThreadID: effectAuthorityThreadID,
		terminal:          terminal,
	}, nil
}

type runTerminalHost interface {
	Start(terminalProcessStartRequest) (*terminalProcess, error)
	Get(string) (*terminalProcess, error)
	ProcessesForRun(string) []*terminalProcess
}

type boundRunTerminalHost struct {
	manager           *terminalProcessManager
	endpointID        string
	threadID          string
	authorityThreadID string
}

func newBoundRunTerminalHost(
	manager *terminalProcessManager,
	endpointID string,
	threadID string,
	authorityThreadID string,
) (runTerminalHost, error) {
	if manager == nil {
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
		authorityThreadID: authorityThreadID,
	}, nil
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
