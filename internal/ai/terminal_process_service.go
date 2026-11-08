package ai

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/floegence/floret/v7/identity"
	fltools "github.com/floegence/floret/v7/tools"
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

func (s *Service) ReadTerminalProcess(ctx context.Context, meta *session.Meta, runID string, processID string, afterSeq int64, threadIDs ...string) (*terminalProcessSnapshot, error) {
	if err := requireRWX(meta); err != nil {
		return nil, err
	}
	manager := s.terminalProcessManager()
	if manager == nil {
		return nil, errors.New("terminal process manager unavailable")
	}
	proc, ok := manager.Get(processID)
	if !ok || proc == nil {
		if len(threadIDs) != 1 || strings.TrimSpace(threadIDs[0]) == "" {
			return nil, errors.New("terminal process not found")
		}
		settings, err := s.threadSettingsForRead(ctx, meta, threadIDs[0])
		if err != nil || settings == nil {
			return nil, errors.New("terminal process not found")
		}
		snapshot, err := readSealedTerminal(ctx, s.threadRuntime, identity.ThreadID(threadIDs[0]), processID, afterSeq, terminalProcessUIReadBytes)
		if err != nil {
			return nil, err
		}
		// The authorized product thread supplies endpoint ownership when a crash
		// left only Floret's pre-dispatch identity, without inventing an exit.
		if snapshot.EndpointID == "" {
			snapshot.EndpointID = settings.EndpointID
		}
		if err := validateTerminalProcessAccess(meta, strings.TrimSpace(runID), snapshot); err != nil {
			return nil, err
		}
		return &snapshot, nil
	}
	snapshot, err := proc.ReadAfter(ctx, terminalProcessReadRequest{
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

// Callers select a complete-chunk output frame before projecting Activity.
// Display text is bounded separately without changing execution arguments.
func terminalProcessActivity(snapshot terminalProcessSnapshot) *fltools.ActivityPresentation {
	snapshot.Command, _ = contractSafeString(snapshot.Command, activityPayloadStringLimit)
	payload := terminalProcessResultPayload(snapshot)
	return contractSafeActivityPresentationForTool("terminal_exec", &fltools.ActivityPresentation{
		Renderer: fltools.ActivityRendererTerminal,
		Chips: []fltools.ActivityChip{
			{Kind: "tool", Label: "shell", Tone: "neutral"},
			{Kind: "process", Label: "process", Value: snapshot.ProcessID, Tone: "quiet"},
		},
		Payload: activityPayloadForRenderer(fltools.ActivityRendererTerminal, payload),
	})
}
