package ai

import (
	"context"
	"errors"
	"strings"
	"time"

	fltools "github.com/floegence/floret/v5/tools"
	"github.com/floegence/redeven/internal/logsafe"
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
	s.logTerminalOutputEncodingRepair(snapshot, "read")
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
	if s == nil || s.threadsDB == nil {
		return nil, errors.New("terminal process write authority is unavailable")
	}
	before = proc.Snapshot()
	if err := validateTerminalProcessAccess(meta, strings.TrimSpace(runID), before); err != nil {
		return nil, err
	}
	if err := s.threadsDB.RequireThreadSettingsWritable(ctxOrBackground(ctx), before.EndpointID, before.ThreadID); err != nil {
		return nil, err
	}
	snapshot, err := proc.Write(input)
	s.logTerminalOutputEncodingRepair(snapshot, "write")
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
	s.logTerminalOutputEncodingRepair(snapshot, "terminate")
	if err != nil {
		return &snapshot, err
	}
	return &snapshot, nil
}

func (s *Service) logTerminalOutputEncodingRepair(snapshot terminalProcessSnapshot, source string) {
	if s == nil || s.log == nil || !snapshot.outputUTF8Repaired {
		return
	}
	s.log.Debug(
		"ai: normalized invalid UTF-8 in terminal output",
		"source", logsafe.Text(source, 32),
		"endpoint_id", logsafe.Text(snapshot.EndpointID, 256),
		"thread_id", logsafe.Text(snapshot.ThreadID, 256),
		"run_id", logsafe.Text(snapshot.RunID, 256),
		"process_id", logsafe.Text(snapshot.ProcessID, 256),
		"first_seq", snapshot.FirstSeq,
		"last_seq", snapshot.LastSeq,
		"total_bytes", snapshot.TotalBytes,
	)
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

func (s *Service) persistTimeout() time.Duration {
	if s == nil || s.persistOpTO <= 0 {
		return defaultPersistOpTimeout
	}
	return s.persistOpTO
}

func terminalProcessActivity(snapshot terminalProcessSnapshot, payload map[string]any) *fltools.ActivityPresentation {
	label := activityPresentationLabel(snapshot.Command)
	if label == "" {
		label = "terminal.exec"
	}
	return contractSafeActivityPresentationForTool("terminal.exec", &fltools.ActivityPresentation{
		Label:    label,
		Renderer: fltools.ActivityRendererTerminal,
		Chips: []fltools.ActivityChip{
			{Kind: "tool", Label: "shell", Tone: "neutral"},
			{Kind: "process", Label: "process", Value: snapshot.ProcessID, Tone: "quiet"},
		},
		Payload: activityPayloadForRenderer(fltools.ActivityRendererTerminal, payload),
	})
}
