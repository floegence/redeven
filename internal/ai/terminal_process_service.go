package ai

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	flconfig "github.com/floegence/floret/config"
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
	snapshot, err := manager.Read(terminalProcessReadRequest{
		ProcessID: strings.TrimSpace(processID),
		AfterSeq:  afterSeq,
		WaitMS:    waitMS,
		MaxBytes:  maxBytes,
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
	before, err := manager.Read(terminalProcessReadRequest{ProcessID: strings.TrimSpace(processID)})
	if err != nil {
		return nil, err
	}
	if err := validateTerminalProcessAccess(meta, strings.TrimSpace(runID), before); err != nil {
		return nil, err
	}
	snapshot, err := manager.Write(processID, input)
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
	before, err := manager.Read(terminalProcessReadRequest{ProcessID: strings.TrimSpace(processID)})
	if err != nil {
		return nil, err
	}
	if err := validateTerminalProcessAccess(meta, strings.TrimSpace(runID), before); err != nil {
		return nil, err
	}
	snapshot, err := manager.Terminate(processID)
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

func (s *Service) handleTerminalProcessDone(snapshot terminalProcessSnapshot) {
	if s == nil {
		return
	}
	db := s.threadsDB
	if db == nil {
		return
	}
	if strings.TrimSpace(snapshot.EndpointID) == "" ||
		strings.TrimSpace(snapshot.ThreadID) == "" ||
		strings.TrimSpace(snapshot.RunID) == "" ||
		strings.TrimSpace(snapshot.TurnID) == "" ||
		strings.TrimSpace(snapshot.ToolID) == "" {
		return
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
	err := db.UpsertToolCall(ctx, threadstore.ToolCallRecord{
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
		return
	}
	s.appendTerminalProcessRunEvent(snapshot, status, resultPayload, toolErr)
	settled, err := s.settleTerminalProcess(snapshot, resultPayload)
	if err != nil {
		if s.log != nil {
			s.log.Warn("ai: settle terminal process failed", "run_id", snapshot.RunID, "tool_id", snapshot.ToolID, "error", err)
		}
		return
	}
	if err := s.persistTerminalSettlementProjection(snapshot, settled.Projection); err != nil && s.log != nil {
		s.log.Warn("ai: persist terminal settlement projection failed", "run_id", snapshot.RunID, "tool_id", snapshot.ToolID, "error", err)
	}
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

func (s *Service) settleTerminalProcess(snapshot terminalProcessSnapshot, resultPayload map[string]any) (flruntime.PendingToolSettlementResult, error) {
	storePath, err := floretThreadStorePath(s.stateDir)
	if err != nil {
		return flruntime.PendingToolSettlementResult{}, err
	}
	store, err := flruntime.OpenSQLiteStore(storePath)
	if err != nil {
		return flruntime.PendingToolSettlementResult{}, err
	}
	host, err := flruntime.NewHost(flruntime.HostOptions{
		Config: flconfig.Config{
			Provider:     flconfig.ProviderFake,
			Model:        "redeven-terminal-settlement",
			SystemPrompt: "Record terminal process settlement.",
		},
		Store: store,
	})
	if err != nil {
		_ = store.Close()
		return flruntime.PendingToolSettlementResult{}, err
	}
	defer func() { _ = host.Close() }()
	return host.SettlePendingTool(context.Background(), flruntime.PendingToolSettlementRequest{
		ThreadID:   flruntime.ThreadID(snapshot.ThreadID),
		TurnID:     flruntime.TurnID(snapshot.TurnID),
		RunID:      flruntime.RunID(snapshot.RunID),
		ToolCallID: snapshot.ToolID,
		ToolName:   "terminal.exec",
		Handle:     snapshot.PendingHandle,
		Status:     terminalSettlementStatus(snapshot.Status),
		Summary:    terminalSettlementSummary(snapshot),
		Output:     strings.TrimRight(snapshot.Output, "\n"),
		Activity:   terminalProcessActivity(snapshot, resultPayload),
	})
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

func (s *Service) persistTerminalSettlementProjection(snapshot terminalProcessSnapshot, projection flruntime.ThreadTurnProjection) error {
	if s == nil || s.threadsDB == nil {
		return errors.New("threads store not ready")
	}
	ctx, cancel := context.WithTimeout(context.Background(), s.persistTimeout())
	rowID, raw, err := s.threadsDB.GetTranscriptMessageRowIDAndJSONByMessageID(ctx, snapshot.EndpointID, snapshot.ThreadID, snapshot.TurnID)
	cancel()
	if err != nil {
		return err
	}
	createdAt := persistedMessageTimestamp(raw)
	if createdAt <= 0 {
		createdAt = time.Now().UnixMilli()
	}
	projectionRun := &run{
		id:                       snapshot.RunID,
		endpointID:               snapshot.EndpointID,
		threadID:                 snapshot.ThreadID,
		messageID:                snapshot.TurnID,
		service:                  s,
		assistantCreatedAtUnixMs: createdAt,
	}
	blocks := projectionRun.flowerBlocksFromFloretThreadProjection(projection)
	if len(blocks) == 0 {
		return errors.New("empty terminal settlement projection")
	}
	projectionRun.assistantBlocks = blocks
	rawJSON, _, at, err := projectionRun.snapshotAssistantMessageJSONWithStatus("complete")
	if err != nil {
		return err
	}
	if at <= 0 {
		at = createdAt
	}
	ctx, cancel = context.WithTimeout(context.Background(), s.persistTimeout())
	err = s.threadsDB.UpdateTranscriptMessageJSONByRowID(ctx, snapshot.EndpointID, rowID, rawJSON, at)
	cancel()
	if err != nil {
		return err
	}
	s.broadcastTranscriptMessage(snapshot.EndpointID, snapshot.ThreadID, snapshot.RunID, rowID, rawJSON, at)
	s.broadcastThreadSummary(snapshot.EndpointID, snapshot.ThreadID)
	if s.threadMgr != nil {
		s.threadMgr.Wake(snapshot.EndpointID, snapshot.ThreadID)
	}
	return nil
}

func persistedMessageTimestamp(raw string) int64 {
	var msg persistedMessage
	if err := json.Unmarshal([]byte(strings.TrimSpace(raw)), &msg); err != nil {
		return 0
	}
	return msg.Timestamp
}
