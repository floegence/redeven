package ai

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/floegence/floret/observation"
	flruntime "github.com/floegence/floret/runtime"
	"github.com/floegence/redeven/internal/ai/threadstore"
	aitools "github.com/floegence/redeven/internal/ai/tools"
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

func (s *Service) ReadTerminalProcess(ctx context.Context, meta *session.Meta, runID string, processID string, afterSeq int64, waitMS int64, maxBytes int64) (*terminalProcessSnapshot, error) {
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
	snapshot := proc.Read(terminalProcessReadRequest{
		ProcessID: strings.TrimSpace(processID),
		AfterSeq:  afterSeq,
		WaitMS:    waitMS,
		MaxBytes:  maxBytes,
	})
	if err := validateTerminalProcessAccess(meta, strings.TrimSpace(runID), snapshot); err != nil {
		return nil, err
	}
	proc.publishDone()
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
	before := proc.Read(terminalProcessReadRequest{ProcessID: strings.TrimSpace(processID)})
	if err := validateTerminalProcessAccess(meta, strings.TrimSpace(runID), before); err != nil {
		return nil, err
	}
	proc.publishDone()
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
	before := proc.Read(terminalProcessReadRequest{ProcessID: strings.TrimSpace(processID)})
	if err := validateTerminalProcessAccess(meta, strings.TrimSpace(runID), before); err != nil {
		return nil, err
	}
	proc.publishDone()
	snapshot, err := proc.Terminate()
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

func (s *Service) handleTerminalProcessDone(snapshot terminalProcessSnapshot) error {
	if s == nil {
		return errors.New("terminal process service unavailable")
	}
	db := s.threadsDB
	if db == nil {
		return errors.New("terminal process thread store unavailable")
	}
	if strings.TrimSpace(snapshot.EndpointID) == "" ||
		strings.TrimSpace(snapshot.ThreadID) == "" ||
		strings.TrimSpace(snapshot.RunID) == "" ||
		strings.TrimSpace(snapshot.TurnID) == "" ||
		strings.TrimSpace(snapshot.ToolID) == "" {
		return errors.New("terminal process settlement identity incomplete")
	}

	resultPayload := terminalProcessResultPayload(snapshot)
	status := toolCallStatusSuccess
	var toolErr *aitools.ToolError
	if snapshot.Status == terminalProcessStatusCanceled {
		status = toolCallStatusError
		toolErr = &aitools.ToolError{Code: aitools.ErrorCodeCanceled, Message: "Terminal process was canceled", Retryable: false}
	} else if snapshot.Status == terminalProcessStatusError {
		status = toolCallStatusError
		toolErr = snapshot.Error
		if toolErr == nil {
			toolErr = &aitools.ToolError{Code: aitools.ErrorCodeUnknown, Message: "Terminal process failed", Retryable: false}
		}
	}
	if toolErr != nil {
		toolErr.Normalize()
	}
	settlementReq := terminalProcessSettlementRequest(snapshot, resultPayload)
	settleCtx, settleCancel := context.WithTimeout(context.Background(), s.persistTimeout())
	settled, err := s.settlePendingToolWithActiveFloretRun(settleCtx, snapshot.EndpointID, snapshot.ThreadID, settlementReq)
	settleCancel()
	if err != nil {
		if s.log != nil {
			s.log.Warn("ai: settle terminal process failed", "run_id", snapshot.RunID, "tool_id", snapshot.ToolID, "error", err)
		}
		return err
	}
	if err := s.applyFloretPendingToolSettlementProjection(context.Background(), snapshot.EndpointID, snapshot.ThreadID, snapshot.RunID, snapshot.TurnID, settled.Projection); err != nil {
		if s.log != nil {
			s.log.Warn("ai: apply terminal settlement projection failed", "run_id", snapshot.RunID, "tool_id", snapshot.ToolID, "error", err)
		}
		return err
	}

	startedAt := snapshot.StartedAtUnixMs
	if startedAt <= 0 {
		startedAt = time.Now().UnixMilli()
	}
	endedAt := snapshot.EndedAtUnixMs
	if endedAt <= 0 {
		endedAt = time.Now().UnixMilli()
	}
	argsJSON := marshalPersistJSON(redactToolArgsForPersist("terminal.exec", map[string]any{
		"command": snapshot.Command,
		"cwd":     snapshot.Cwd,
	}), 0)
	errorCode := ""
	errorMessage := ""
	retryable := false
	if toolErr != nil {
		errorCode = string(toolErr.Code)
		errorMessage = toolErr.Message
		retryable = toolErr.Retryable
	}
	ctx, cancel := context.WithTimeout(context.Background(), s.persistTimeout())
	err = db.UpsertToolCall(ctx, threadstore.ToolCallRecord{
		RunID:           snapshot.RunID,
		ToolID:          snapshot.ToolID,
		ToolName:        "terminal.exec",
		Status:          status,
		ArgsJSON:        argsJSON,
		ResultJSON:      marshalPersistJSON(redactAnyForPersist("result", resultPayload, 0), 0),
		ErrorCode:       errorCode,
		ErrorMessage:    errorMessage,
		Retryable:       retryable,
		StartedAtUnixMs: startedAt,
		EndedAtUnixMs:   endedAt,
		LatencyMS:       endedAt - startedAt,
	})
	cancel()
	if err != nil {
		if s.log != nil {
			s.log.Warn("ai: persist terminal process result failed", "run_id", snapshot.RunID, "tool_id", snapshot.ToolID, "error", err)
		}
		return nil
	}
	s.appendTerminalProcessRunEvent(snapshot, status, resultPayload, toolErr)
	return nil
}

func (s *Service) persistTimeout() time.Duration {
	if s == nil || s.persistOpTO <= 0 {
		return defaultPersistOpTimeout
	}
	return s.persistOpTO
}

func (s *Service) appendTerminalProcessRunEvent(snapshot terminalProcessSnapshot, status string, result map[string]any, toolErr *aitools.ToolError) {
	if s == nil || s.threadsDB == nil {
		return
	}
	payload := map[string]any{
		"tool_id":    snapshot.ToolID,
		"tool_name":  "terminal.exec",
		"status":     status,
		"process_id": snapshot.ProcessID,
		"exit_code":  snapshot.ExitCode,
	}
	if toolErr != nil {
		payload["error"] = activityToolErrorPayload(toolErr)
	}
	if latest := strings.TrimSpace(anyToString(result["latest_output"])); latest != "" {
		payload["latest_output"] = latest
	}
	ctx, cancel := context.WithTimeout(context.Background(), s.persistTimeout())
	_ = s.threadsDB.AppendRunEvent(ctx, threadstore.RunEventRecord{
		EndpointID:  snapshot.EndpointID,
		ThreadID:    snapshot.ThreadID,
		RunID:       snapshot.RunID,
		StreamKind:  string(RealtimeStreamKindTool),
		EventType:   "tool.result",
		PayloadJSON: marshalPersistJSON(payload, 6000),
		AtUnixMs:    time.Now().UnixMilli(),
	})
	cancel()
}

func terminalProcessSettlementRequest(snapshot terminalProcessSnapshot, resultPayload map[string]any) flruntime.PendingToolSettlementRequest {
	return flruntime.PendingToolSettlementRequest{
		ThreadID:   flruntime.ThreadID(snapshot.ThreadID),
		TurnID:     flruntime.TurnID(snapshot.TurnID),
		RunID:      flruntime.RunID(snapshot.RunID),
		ToolCallID: snapshot.ToolID,
		ToolName:   "terminal.exec",
		Handle:     snapshot.ProcessID,
		Status:     terminalSettlementStatus(snapshot.Status),
		Summary:    terminalSettlementSummary(snapshot),
		Output:     strings.TrimRight(snapshot.Output, "\n"),
		Activity:   terminalProcessActivity(snapshot, resultPayload),
	}
}

func terminalSettlementStatus(status string) flruntime.PendingToolSettlementStatus {
	switch strings.TrimSpace(status) {
	case terminalProcessStatusCanceled:
		return flruntime.PendingToolSettlementCanceled
	case terminalProcessStatusError:
		return flruntime.PendingToolSettlementFailed
	default:
		return flruntime.PendingToolSettlementCompleted
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
