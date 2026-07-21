package ai

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/floegence/floret/observation"
	flruntime "github.com/floegence/floret/runtime"
	"github.com/floegence/redeven/internal/session"
)

func (s *Service) terminalProcessManager() *terminalProcessManager {
	if s == nil {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.terminalProcesses
}

func (s *Service) ReadTerminalProcess(ctx context.Context, meta *session.Meta, runID string, processID string, afterSeq int64) (*terminalProcessSnapshot, error) {
	if err := requireRWX(meta); err != nil {
		return nil, err
	}
	manager := s.terminalProcessManager()
	if manager == nil {
		return nil, errors.New("terminal process manager unavailable")
	}
	proc, ok := manager.Get(processID)
	if !ok || proc == nil {
		return nil, errors.New("terminal process not found")
	}
	snapshot, err := proc.ReadAfter(terminalProcessReadRequest{
		ProcessID: strings.TrimSpace(processID),
		AfterSeq:  afterSeq,
		WaitMS:    terminalProcessUIReadWaitMS,
		MaxBytes:  terminalProcessUIReadBytes,
	})
	if err != nil {
		return nil, err
	}
	if err := validateTerminalProcessAccess(meta, strings.TrimSpace(runID), snapshot); err != nil {
		return nil, err
	}
	return &snapshot, nil
}

func (s *Service) WriteTerminalProcess(ctx context.Context, meta *session.Meta, runID string, processID string, input string) (*terminalProcessSnapshot, error) {
	if err := requireRWX(meta); err != nil {
		return nil, err
	}
	if len(input) > 200_000 {
		return nil, errors.New("input too large")
	}
	manager := s.terminalProcessManager()
	if manager == nil {
		return nil, errors.New("terminal process manager unavailable")
	}
	proc, ok := manager.Get(processID)
	if !ok || proc == nil {
		return nil, errors.New("terminal process not found")
	}
	before := proc.Snapshot()
	if err := validateTerminalProcessAccess(meta, strings.TrimSpace(runID), before); err != nil {
		return nil, err
	}
	if s == nil || s.threadMgr == nil || s.threadsDB == nil {
		return nil, errors.New("terminal process write authority is unavailable")
	}
	unlock, err := s.threadMgr.lockThreadEffect(before.EndpointID, before.ThreadID, before.ThreadID, threadEffectJoin{})
	if err != nil {
		return nil, err
	}
	defer unlock()
	before = proc.Snapshot()
	if err := validateTerminalProcessAccess(meta, strings.TrimSpace(runID), before); err != nil {
		return nil, err
	}
	if err := s.threadsDB.RequireThreadSettingsWritable(ctxOrBackground(ctx), before.EndpointID, before.ThreadID); err != nil {
		return nil, err
	}
	snapshot, err := proc.Write(input)
	if err != nil {
		return &snapshot, err
	}
	return &snapshot, nil
}

func (s *Service) TerminateTerminalProcess(ctx context.Context, meta *session.Meta, runID string, processID string) (*terminalProcessSnapshot, error) {
	if err := requireRWX(meta); err != nil {
		return nil, err
	}
	manager := s.terminalProcessManager()
	if manager == nil {
		return nil, errors.New("terminal process manager unavailable")
	}
	proc, ok := manager.Get(processID)
	if !ok || proc == nil {
		return nil, errors.New("terminal process not found")
	}
	before := proc.Snapshot()
	if err := validateTerminalProcessAccess(meta, strings.TrimSpace(runID), before); err != nil {
		return nil, err
	}
	snapshot, err := proc.Terminate(ctx)
	if err != nil {
		return &snapshot, err
	}
	return &snapshot, nil
}

func validateTerminalProcessAccess(meta *session.Meta, runID string, snapshot terminalProcessSnapshot) error {
	if meta == nil {
		return errors.New("invalid session")
	}
	if strings.TrimSpace(snapshot.EndpointID) != strings.TrimSpace(meta.EndpointID) {
		return errors.New("terminal process not found")
	}
	if runID != "" && strings.TrimSpace(snapshot.RunID) != runID {
		return errors.New("terminal process not found")
	}
	return nil
}

func (s *Service) finalizeTerminalProcess(ctx context.Context, owner floretPendingToolSettler, target flruntime.PendingToolSettlementTarget, snapshot terminalProcessSnapshot) error {
	if s == nil {
		return errors.New("terminal process service unavailable")
	}
	if owner == nil {
		return errors.New("terminal process settlement owner unavailable")
	}
	if strings.TrimSpace(snapshot.EndpointID) == "" ||
		strings.TrimSpace(snapshot.ThreadID) == "" ||
		strings.TrimSpace(snapshot.RunID) == "" ||
		strings.TrimSpace(snapshot.TurnID) == "" ||
		strings.TrimSpace(snapshot.ToolID) == "" {
		return errors.New("terminal process settlement identity incomplete")
	}
	if strings.TrimSpace(string(target.ThreadID)) == "" ||
		strings.TrimSpace(string(target.RunID)) == "" ||
		strings.TrimSpace(string(target.TurnID)) == "" ||
		strings.TrimSpace(target.ToolCallID) == "" ||
		strings.TrimSpace(target.ToolName) == "" ||
		strings.TrimSpace(target.Handle) == "" ||
		strings.TrimSpace(target.EffectAttemptID) == "" {
		return errors.New("terminal process settlement target incomplete")
	}
	if strings.TrimSpace(target.ToolCallID) != strings.TrimSpace(snapshot.ToolID) ||
		strings.TrimSpace(target.ToolName) != strings.TrimSpace(snapshot.ToolName) ||
		strings.TrimSpace(target.Handle) != strings.TrimSpace(snapshot.ProcessID) {
		return errors.New("terminal process settlement target mismatch")
	}

	resultPayload := terminalProcessResultPayload(snapshot)
	settlementReq, err := terminalProcessSettlementRequest(target, snapshot, resultPayload)
	if err != nil {
		return err
	}
	if ctx == nil {
		ctx = context.Background()
	}
	settleCtx, settleCancel := context.WithTimeout(ctx, s.persistTimeout())
	settled, err := owner.SettlePendingTool(settleCtx, settlementReq)
	settleCancel()
	if err != nil {
		if s.log != nil {
			s.log.Warn("ai: settle terminal process failed", "run_id", snapshot.RunID, "tool_id", snapshot.ToolID, "error", err)
		}
		return err
	}
	if err := settled.Validate(); err != nil {
		if active := s.activeRunForFloretProjection(snapshot.EndpointID, snapshot.ThreadID, snapshot.RunID); active != nil {
			active.rejectFloretContract("pending_tool_settlement_projection_outcome", err)
		}
		return fmt.Errorf("invalid Floret pending tool settlement projection outcome: %w", err)
	}
	if err := s.applyFloretPendingToolSettlementProjection(ctx, snapshot.EndpointID, snapshot.ThreadID, snapshot.RunID, snapshot.TurnID, settled); err != nil {
		if s.log != nil {
			s.log.Warn("ai: apply terminal settlement projection failed", "run_id", snapshot.RunID, "tool_id", snapshot.ToolID, "error", err)
		}
		return err
	}
	return nil
}

func (s *Service) persistTimeout() time.Duration {
	if s == nil || s.persistOpTO <= 0 {
		return defaultPersistOpTimeout
	}
	return s.persistOpTO
}

func terminalProcessSettlementRequest(target flruntime.PendingToolSettlementTarget, snapshot terminalProcessSnapshot, resultPayload map[string]any) (flruntime.PendingToolSettlementRequest, error) {
	status, err := terminalSettlementStatus(snapshot.Status)
	if err != nil {
		return flruntime.PendingToolSettlementRequest{}, err
	}
	return flruntime.PendingToolSettlementRequest{
		Target:   target,
		Status:   status,
		Summary:  terminalSettlementSummary(snapshot),
		Output:   strings.TrimRight(snapshot.Output, "\n"),
		Activity: terminalProcessActivity(snapshot, resultPayload),
	}, nil
}

func terminalSettlementStatus(status string) (flruntime.PendingToolSettlementStatus, error) {
	switch strings.TrimSpace(status) {
	case terminalProcessStatusSuccess:
		return flruntime.PendingToolSettlementCompleted, nil
	case terminalProcessStatusCanceled:
		return flruntime.PendingToolSettlementCanceled, nil
	case terminalProcessStatusError:
		return flruntime.PendingToolSettlementFailed, nil
	default:
		return "", fmt.Errorf("terminal process has non-terminal or unknown status %q", status)
	}
}

func terminalSettlementSummary(snapshot terminalProcessSnapshot) string {
	switch strings.TrimSpace(snapshot.Status) {
	case terminalProcessStatusCanceled:
		return "Terminal process canceled"
	case terminalProcessStatusError:
		return "Terminal process failed"
	default:
		return "Terminal process completed"
	}
}

func terminalProcessActivity(snapshot terminalProcessSnapshot, payload map[string]any) *observation.ActivityPresentation {
	label := activityPresentationLabel(snapshot.Command)
	if label == "" {
		label = "terminal.exec"
	}
	return contractSafeActivityPresentationForTool("terminal.exec", &observation.ActivityPresentation{
		Label:    label,
		Renderer: observation.ActivityRendererTerminal,
		Chips: []observation.ActivityChip{
			{Kind: "tool", Label: "shell", Tone: "neutral"},
			{Kind: "process", Label: "process", Value: snapshot.ProcessID, Tone: "quiet"},
		},
		Payload: payload,
	})
}
