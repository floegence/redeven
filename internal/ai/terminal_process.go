package ai

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"

	"github.com/creack/pty"
	flruntime "github.com/floegence/floret/runtime"
	aitools "github.com/floegence/redeven/internal/ai/tools"
	"github.com/floegence/redeven/internal/processenv"
)

const (
	terminalProcessDefaultYieldMS   = 1000
	terminalProcessMaxYieldMS       = 30_000
	terminalProcessOutputChunkBytes = 4_000
	terminalProcessModelReadWaitMS  = 5_000
	terminalProcessModelReadBytes   = 8_000
	terminalProcessUIReadWaitMS     = 1_000
	terminalProcessUIReadBytes      = 256_000
	terminalProcessTailCapBytes     = 1_000_000
	terminalProcessOutputDrainWait  = 500 * time.Millisecond
	terminalProcessMaxRuntime       = 30 * time.Minute
	terminalProcessMaxActive        = 64
)

const (
	terminalProcessStatusRunning  = "running"
	terminalProcessStatusSuccess  = "success"
	terminalProcessStatusError    = "error"
	terminalProcessStatusCanceled = "canceled"
)

type terminalProcessManager struct {
	mu        sync.Mutex
	processes map[string]*terminalProcess
	active    int
}

type terminalProcessStartRequest struct {
	ProcessID        string
	EndpointID       string
	ThreadID         string
	RunID            string
	TurnID           string
	SettlementOwner  floretPendingToolSettler
	SettlementTarget flruntime.PendingToolSettlementTarget
	Finalize         terminalProcessFinalizeFunc
	ToolID           string
	ToolName         string
	Command          string
	Stdin            string
	CwdAbs           string
	Shell            string
	Env              []string
}

type terminalProcessFinalizeFunc func(floretPendingToolSettler, flruntime.PendingToolSettlementTarget, terminalProcessSnapshot) error

type terminalProcessReadRequest struct {
	ProcessID string
	AfterSeq  int64
	WaitMS    int64
	MaxBytes  int64
}

type terminalProcessOutputChunk struct {
	seq  int64
	data []byte
}

type terminalProcessSnapshot struct {
	ProcessID         string             `json:"process_id"`
	EndpointID        string             `json:"endpoint_id,omitempty"`
	ThreadID          string             `json:"thread_id,omitempty"`
	RunID             string             `json:"run_id,omitempty"`
	TurnID            string             `json:"turn_id,omitempty"`
	ToolID            string             `json:"tool_id,omitempty"`
	ToolName          string             `json:"tool_name,omitempty"`
	Command           string             `json:"command"`
	Cwd               string             `json:"cwd"`
	Status            string             `json:"status"`
	Output            string             `json:"output"`
	FirstSeq          int64              `json:"first_seq"`
	LastSeq           int64              `json:"last_seq"`
	LatestSeq         int64              `json:"latest_seq"`
	HasMore           bool               `json:"has_more"`
	TotalBytes        int64              `json:"total_bytes"`
	Truncated         bool               `json:"truncated"`
	StartedAtUnixMs   int64              `json:"started_at_ms"`
	EndedAtUnixMs     int64              `json:"ended_at_ms,omitempty"`
	DurationMS        int64              `json:"duration_ms,omitempty"`
	ExitCode          int                `json:"exit_code,omitempty"`
	ExecutionLocation string             `json:"execution_location"`
	Error             *aitools.ToolError `json:"error,omitempty"`
}

type terminalProcess struct {
	mu                   sync.Mutex
	cond                 *sync.Cond
	manager              *terminalProcessManager
	id                   string
	endpointID           string
	threadID             string
	runID                string
	turnID               string
	settlementOwner      floretPendingToolSettler
	settlementTarget     flruntime.PendingToolSettlementTarget
	finalize             terminalProcessFinalizeFunc
	toolID               string
	toolName             string
	command              string
	cwd                  string
	cmd                  *exec.Cmd
	tty                  *os.File
	readDone             chan struct{}
	startedAt            time.Time
	endedAt              time.Time
	status               string
	exitCode             int
	err                  *aitools.ToolError
	outputChunks         []terminalProcessOutputChunk
	retainedBytes        int
	lastSeq              int64
	total                int64
	truncated            bool
	pending              bool
	reaped               bool
	terminationRequested bool
	initialInputFailed   bool
	reapedDone           chan struct{}
	finalizeOnce         sync.Once
	finalizationDone     chan struct{}
	finalizationErr      error
}

func newTerminalProcessManager() *terminalProcessManager {
	return &terminalProcessManager{
		processes: make(map[string]*terminalProcess),
	}
}

func (m *terminalProcessManager) Start(req terminalProcessStartRequest) (*terminalProcess, error) {
	if m == nil {
		return nil, errors.New("terminal process manager unavailable")
	}
	command := strings.TrimSpace(req.Command)
	if command == "" {
		return nil, errors.New("missing command")
	}
	if len(req.Stdin) > 200_000 {
		return nil, errors.New("stdin too large")
	}
	shell := strings.TrimSpace(req.Shell)
	if shell == "" {
		shell = "/bin/bash"
	}
	cwd := strings.TrimSpace(req.CwdAbs)
	if cwd == "" {
		return nil, errors.New("missing terminal working directory")
	}
	processID := strings.TrimSpace(req.ProcessID)
	if processID == "" {
		return nil, errors.New("terminal process id is required")
	}
	if req.SettlementOwner == nil {
		return nil, errors.New("terminal process settlement owner is required")
	}
	if req.Finalize == nil {
		return nil, errors.New("terminal process finalizer is required")
	}
	target := req.SettlementTarget
	if strings.TrimSpace(string(target.ThreadID)) == "" ||
		strings.TrimSpace(string(target.TurnID)) == "" ||
		strings.TrimSpace(string(target.RunID)) == "" ||
		strings.TrimSpace(target.ToolCallID) == "" ||
		strings.TrimSpace(target.ToolName) == "" ||
		strings.TrimSpace(target.Handle) == "" ||
		strings.TrimSpace(target.EffectAttemptID) == "" {
		return nil, errors.New("terminal process settlement target incomplete")
	}
	if strings.TrimSpace(target.Handle) != processID ||
		strings.TrimSpace(target.ToolCallID) != strings.TrimSpace(req.ToolID) ||
		strings.TrimSpace(target.ToolName) != firstNonEmptyString(req.ToolName, "terminal.exec") {
		return nil, errors.New("terminal process settlement target mismatch")
	}

	m.mu.Lock()
	if m.active >= terminalProcessMaxActive {
		m.mu.Unlock()
		return nil, fmt.Errorf("terminal process limit reached")
	}
	m.active++
	m.mu.Unlock()

	cmd := exec.Command(shell, "-lc", command)
	cmd.Dir = cwd
	cmd.Env = processenv.Filter(req.Env)
	configureTerminalExecProcessGroup(cmd)
	tty, err := pty.StartWithSize(cmd, &pty.Winsize{Cols: 100, Rows: 30})
	if err != nil {
		m.mu.Lock()
		m.active--
		m.mu.Unlock()
		return nil, err
	}
	proc := &terminalProcess{
		manager:          m,
		id:               processID,
		endpointID:       strings.TrimSpace(req.EndpointID),
		threadID:         strings.TrimSpace(req.ThreadID),
		runID:            strings.TrimSpace(req.RunID),
		turnID:           strings.TrimSpace(req.TurnID),
		settlementOwner:  req.SettlementOwner,
		settlementTarget: target,
		finalize:         req.Finalize,
		toolID:           strings.TrimSpace(req.ToolID),
		toolName:         firstNonEmptyString(req.ToolName, "terminal.exec"),
		command:          command,
		cwd:              cwd,
		cmd:              cmd,
		tty:              tty,
		readDone:         make(chan struct{}),
		reapedDone:       make(chan struct{}),
		finalizationDone: make(chan struct{}),
		startedAt:        time.Now(),
		status:           terminalProcessStatusRunning,
		exitCode:         0,
	}
	proc.cond = sync.NewCond(&proc.mu)

	m.mu.Lock()
	m.processes[processID] = proc
	m.mu.Unlock()

	go proc.readLoop()
	go proc.waitLoop()
	go proc.maxRuntimeLoop()

	return completeTerminalProcessStart(proc, tty, req.Stdin)
}

func completeTerminalProcessStart(proc *terminalProcess, writer io.Writer, initialInput string) (*terminalProcess, error) {
	if proc == nil {
		return nil, errors.New("terminal process is unavailable after dispatch")
	}
	if initialInput == "" {
		return proc, nil
	}
	if writer == nil {
		proc.recordInitialInputFailure(errors.New("terminal process input is unavailable"))
		return proc, nil
	}
	if _, err := writer.Write([]byte(initialInput)); err != nil {
		proc.recordInitialInputFailure(err)
	}
	return proc, nil
}

func (p *terminalProcess) recordInitialInputFailure(cause error) {
	if p == nil || cause == nil {
		return
	}
	toolErr := &aitools.ToolError{
		Code:      aitools.ErrorCodeUnknown,
		Message:   "Failed to write initial terminal input after the process started: " + cause.Error(),
		Retryable: false,
	}
	toolErr.Normalize()
	p.mu.Lock()
	p.initialInputFailed = true
	p.err = toolErr
	cmd := p.cmd
	running := p.status == terminalProcessStatusRunning && cmd != nil
	if running {
		p.terminationRequested = true
	} else {
		p.status = terminalProcessStatusError
		if p.endedAt.IsZero() {
			p.endedAt = time.Now()
		}
	}
	if p.cond != nil {
		p.cond.Broadcast()
	}
	p.mu.Unlock()
	if running && cmd != nil {
		_ = terminateTerminalExecProcessTree(cmd)
	}
}

func (m *terminalProcessManager) Get(processID string) (*terminalProcess, bool) {
	if m == nil {
		return nil, false
	}
	processID = strings.TrimSpace(processID)
	if processID == "" {
		return nil, false
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	proc, ok := m.processes[processID]
	return proc, ok
}

func (m *terminalProcessManager) ProcessesForRun(endpointID string, threadID string, runID string) []*terminalProcess {
	if m == nil {
		return nil
	}
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	runID = strings.TrimSpace(runID)
	if endpointID == "" || threadID == "" || runID == "" {
		return nil
	}
	m.mu.Lock()
	processes := make([]*terminalProcess, 0, len(m.processes))
	for _, proc := range m.processes {
		if proc != nil {
			processes = append(processes, proc)
		}
	}
	m.mu.Unlock()

	matched := make([]*terminalProcess, 0, len(processes))
	for _, proc := range processes {
		proc.mu.Lock()
		ok := proc.endpointID == endpointID && proc.threadID == threadID && proc.runID == runID
		proc.mu.Unlock()
		if ok {
			matched = append(matched, proc)
		}
	}
	return matched
}

func (m *terminalProcessManager) ReadAfter(req terminalProcessReadRequest) (terminalProcessSnapshot, error) {
	proc, ok := m.Get(req.ProcessID)
	if !ok {
		return terminalProcessSnapshot{}, errors.New("terminal process not found")
	}
	return proc.ReadAfter(req)
}

func (m *terminalProcessManager) Write(processID string, input string) (terminalProcessSnapshot, error) {
	proc, ok := m.Get(processID)
	if !ok {
		return terminalProcessSnapshot{}, errors.New("terminal process not found")
	}
	return proc.Write(input)
}

func (m *terminalProcessManager) Terminate(ctx context.Context, processID string) (terminalProcessSnapshot, error) {
	proc, ok := m.Get(processID)
	if !ok {
		return terminalProcessSnapshot{}, errors.New("terminal process not found")
	}
	return proc.Terminate(ctx)
}

func (m *terminalProcessManager) Close(ctx context.Context) error {
	if m == nil {
		return nil
	}
	if ctx == nil {
		ctx = context.Background()
	}
	m.mu.Lock()
	processes := make([]*terminalProcess, 0, len(m.processes))
	for _, proc := range m.processes {
		if proc != nil {
			processes = append(processes, proc)
		}
	}
	m.mu.Unlock()
	var errs []error
	for _, proc := range processes {
		if _, err := proc.Terminate(ctx); err != nil {
			errs = append(errs, err)
		}
	}
	return errors.Join(errs...)
}

func (p *terminalProcess) MarkPending() terminalProcessSnapshot {
	if p == nil {
		return terminalProcessSnapshot{}
	}
	p.mu.Lock()
	p.pending = true
	snapshot := p.snapshotLocked(terminalProcessTailCapBytes)
	p.mu.Unlock()
	p.startFinalizationIfReady()
	return snapshot
}

func (p *terminalProcess) Snapshot() terminalProcessSnapshot {
	if p == nil {
		return terminalProcessSnapshot{}
	}
	p.mu.Lock()
	snapshot := p.snapshotLocked(terminalProcessTailCapBytes)
	p.mu.Unlock()
	return snapshot
}

func (p *terminalProcess) ReadAfter(req terminalProcessReadRequest) (terminalProcessSnapshot, error) {
	if p == nil {
		return terminalProcessSnapshot{}, errors.New("terminal process not found")
	}
	if req.AfterSeq < 0 {
		return terminalProcessSnapshot{}, errors.New("invalid after_seq")
	}
	p.mu.Lock()
	if req.AfterSeq > p.lastSeq {
		p.mu.Unlock()
		return terminalProcessSnapshot{}, errors.New("invalid after_seq: exceeds latest sequence")
	}
	waitMS := req.WaitMS
	if waitMS < 0 {
		p.mu.Unlock()
		return terminalProcessSnapshot{}, errors.New("invalid terminal read wait")
	}
	maxBytes := req.MaxBytes
	if maxBytes < terminalProcessOutputChunkBytes {
		p.mu.Unlock()
		return terminalProcessSnapshot{}, errors.New("invalid terminal read size")
	}
	deadline := time.Now().Add(time.Duration(waitMS) * time.Millisecond)
	for p.lastSeq <= req.AfterSeq && p.status == terminalProcessStatusRunning {
		remaining := time.Until(deadline)
		if remaining <= 0 {
			break
		}
		timer := time.AfterFunc(remaining, func() {
			p.mu.Lock()
			p.cond.Broadcast()
			p.mu.Unlock()
		})
		p.cond.Wait()
		timer.Stop()
	}
	snapshot := p.readAfterLocked(req.AfterSeq, maxBytes)
	p.mu.Unlock()
	return snapshot, nil
}

func (p *terminalProcess) WaitForYield(yieldMS int64) terminalProcessSnapshot {
	return p.WaitForYieldContext(context.Background(), yieldMS)
}

func (p *terminalProcess) WaitForYieldContext(ctx context.Context, yieldMS int64) terminalProcessSnapshot {
	if p == nil {
		return terminalProcessSnapshot{}
	}
	if ctx == nil {
		ctx = context.Background()
	}
	if yieldMS <= 0 {
		yieldMS = terminalProcessDefaultYieldMS
	}
	if yieldMS > terminalProcessMaxYieldMS {
		yieldMS = terminalProcessMaxYieldMS
	}
	deadline := time.Now().Add(time.Duration(yieldMS) * time.Millisecond)
	stopWake := context.AfterFunc(ctx, func() {
		p.mu.Lock()
		p.cond.Broadcast()
		p.mu.Unlock()
	})
	defer stopWake()
	p.mu.Lock()
	for p.status == terminalProcessStatusRunning {
		if ctx.Err() != nil {
			p.mu.Unlock()
			snapshot, _ := p.Terminate(context.Background())
			return snapshot
		}
		remaining := time.Until(deadline)
		if remaining <= 0 {
			break
		}
		timer := time.AfterFunc(remaining, func() {
			p.mu.Lock()
			p.cond.Broadcast()
			p.mu.Unlock()
		})
		p.cond.Wait()
		timer.Stop()
	}
	if ctx.Err() != nil && p.status == terminalProcessStatusRunning {
		p.mu.Unlock()
		snapshot, _ := p.Terminate(context.Background())
		return snapshot
	}
	snapshot := p.snapshotLocked(terminalProcessTailCapBytes)
	p.mu.Unlock()
	return snapshot
}

func (p *terminalProcess) Write(input string) (terminalProcessSnapshot, error) {
	if p == nil {
		return terminalProcessSnapshot{}, errors.New("terminal process not found")
	}
	p.mu.Lock()
	if p.status != terminalProcessStatusRunning {
		snapshot := p.snapshotLocked(terminalProcessTailCapBytes)
		p.mu.Unlock()
		return snapshot, errors.New("terminal process is not running")
	}
	tty := p.tty
	p.mu.Unlock()
	if tty == nil {
		return terminalProcessSnapshot{}, errors.New("terminal process input unavailable")
	}
	if _, err := tty.Write([]byte(input)); err != nil {
		return terminalProcessSnapshot{}, err
	}
	return p.Snapshot(), nil
}

func (p *terminalProcess) Terminate(ctx context.Context) (terminalProcessSnapshot, error) {
	if p == nil {
		return terminalProcessSnapshot{}, errors.New("terminal process not found")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	p.mu.Lock()
	requestTermination := p.status == terminalProcessStatusRunning && !p.terminationRequested
	if requestTermination {
		p.terminationRequested = true
	}
	cmd := p.cmd
	reaped := p.reaped
	p.mu.Unlock()

	var terminateErr error
	if requestTermination && cmd != nil {
		terminateErr = terminateTerminalExecProcessTree(cmd)
	}
	if !reaped {
		select {
		case <-p.reapedDone:
		case <-ctx.Done():
			return p.Snapshot(), errors.Join(terminateErr, ctx.Err())
		}
	}
	p.startFinalizationIfReady()
	p.mu.Lock()
	pending := p.pending
	p.mu.Unlock()
	if pending {
		select {
		case <-p.finalizationDone:
		case <-ctx.Done():
			return p.Snapshot(), errors.Join(terminateErr, ctx.Err())
		}
	}
	p.mu.Lock()
	finalizationErr := p.finalizationErr
	snapshot := p.snapshotLocked(terminalProcessTailCapBytes)
	p.mu.Unlock()
	return snapshot, errors.Join(terminateErr, finalizationErr)
}

func (p *terminalProcess) readLoop() {
	if p == nil || p.tty == nil {
		return
	}
	defer close(p.readDone)
	buf := make([]byte, 16*1024)
	for {
		n, err := p.tty.Read(buf)
		if n > 0 {
			p.appendOutput(buf[:n])
		}
		if err != nil {
			if !errors.Is(err, io.EOF) && !strings.Contains(strings.ToLower(err.Error()), "input/output error") {
				p.mu.Lock()
				if p.err == nil && p.status == terminalProcessStatusRunning {
					p.err = &aitools.ToolError{Code: aitools.ErrorCodeUnknown, Message: err.Error(), Retryable: false}
				}
				p.mu.Unlock()
			}
			return
		}
	}
}

func (p *terminalProcess) waitLoop() {
	if p == nil || p.cmd == nil {
		return
	}
	err := p.cmd.Wait()
	_ = p.tty.Close()
	p.waitForOutputDrain()
	status := terminalProcessStatusSuccess
	exitCode := 0
	var toolErr *aitools.ToolError
	if err != nil {
		if ee := (*exec.ExitError)(nil); errors.As(err, &ee) {
			exitCode = ee.ExitCode()
		} else {
			status = terminalProcessStatusError
			toolErr = &aitools.ToolError{Code: aitools.ErrorCodeUnknown, Message: err.Error(), Retryable: false}
		}
	}
	p.mu.Lock()
	if p.initialInputFailed {
		p.status = terminalProcessStatusError
		p.exitCode = exitCode
		p.endedAt = time.Now()
	} else if p.terminationRequested {
		p.status = terminalProcessStatusCanceled
		p.err = &aitools.ToolError{Code: aitools.ErrorCodeCanceled, Message: "Terminal process was canceled", Retryable: false}
		p.exitCode = exitCode
		p.endedAt = time.Now()
	} else if p.status == terminalProcessStatusRunning {
		p.status = status
		p.exitCode = exitCode
		p.endedAt = time.Now()
		if toolErr != nil {
			toolErr.Normalize()
			p.err = toolErr
		}
	}
	p.reaped = true
	p.cond.Broadcast()
	p.mu.Unlock()
	close(p.reapedDone)
	p.managerProcessEnded()
	p.startFinalizationIfReady()
}

func (p *terminalProcess) waitForOutputDrain() {
	if p == nil || p.readDone == nil {
		return
	}
	timer := time.NewTimer(terminalProcessOutputDrainWait)
	defer timer.Stop()
	select {
	case <-p.readDone:
	case <-timer.C:
	}
}

func (p *terminalProcess) maxRuntimeLoop() {
	if p == nil {
		return
	}
	timer := time.NewTimer(terminalProcessMaxRuntime)
	defer timer.Stop()
	<-timer.C
	p.mu.Lock()
	running := p.status == terminalProcessStatusRunning
	p.mu.Unlock()
	if running {
		_, _ = p.Terminate(context.Background())
	}
}

func (p *terminalProcess) appendOutput(chunk []byte) {
	if p == nil || len(chunk) == 0 {
		return
	}
	p.mu.Lock()
	p.total += int64(len(chunk))
	for len(chunk) > 0 {
		size := min(len(chunk), terminalProcessOutputChunkBytes)
		data := append([]byte(nil), chunk[:size]...)
		p.lastSeq++
		p.outputChunks = append(p.outputChunks, terminalProcessOutputChunk{seq: p.lastSeq, data: data})
		p.retainedBytes += len(data)
		chunk = chunk[size:]
	}
	for p.retainedBytes > terminalProcessTailCapBytes && len(p.outputChunks) > 0 {
		p.retainedBytes -= len(p.outputChunks[0].data)
		p.outputChunks[0].data = nil
		p.outputChunks = p.outputChunks[1:]
		p.truncated = true
	}
	p.cond.Broadcast()
	p.mu.Unlock()
}

func (p *terminalProcess) managerProcessEnded() {
	if p == nil || p.manager == nil {
		return
	}
	p.manager.mu.Lock()
	if p.manager.active > 0 {
		p.manager.active--
	}
	p.manager.mu.Unlock()
}

func (p *terminalProcess) finalizePendingForRunEnd(ctx context.Context) (bool, error) {
	if p == nil {
		return false, nil
	}
	if ctx == nil {
		ctx = context.Background()
	}
	p.mu.Lock()
	if !p.pending {
		p.mu.Unlock()
		return false, nil
	}
	p.mu.Unlock()
	_, err := p.Terminate(ctx)
	return true, err
}

func (p *terminalProcess) startFinalizationIfReady() {
	if p == nil {
		return
	}
	p.mu.Lock()
	ready := p.pending && p.reaped
	p.mu.Unlock()
	if !ready {
		return
	}
	p.finalizeOnce.Do(func() {
		go func() {
			p.mu.Lock()
			owner := p.settlementOwner
			target := p.settlementTarget
			finalize := p.finalize
			snapshot := p.snapshotLocked(terminalProcessTailCapBytes)
			p.mu.Unlock()
			err := finalize(owner, target, snapshot)
			p.mu.Lock()
			p.finalizationErr = err
			p.cond.Broadcast()
			p.mu.Unlock()
			close(p.finalizationDone)
		}()
	})
}

func (p *terminalProcess) snapshotLocked(maxBytes int64) terminalProcessSnapshot {
	if p == nil {
		return terminalProcessSnapshot{}
	}
	if maxBytes <= 0 || maxBytes > terminalProcessTailCapBytes {
		maxBytes = terminalProcessTailCapBytes
	}
	start := len(p.outputChunks)
	selectedBytes := 0
	for start > 0 {
		nextBytes := len(p.outputChunks[start-1].data)
		if selectedBytes > 0 && int64(selectedBytes+nextBytes) > maxBytes {
			break
		}
		selectedBytes += nextBytes
		start--
	}
	selected := p.outputChunks[start:]
	output := joinTerminalOutputChunks(selected)
	truncated := p.truncated
	if start > 0 {
		truncated = true
	}
	firstSeq := int64(0)
	if len(selected) > 0 {
		firstSeq = selected[0].seq
	}
	return p.snapshotWithOutputLocked(output, firstSeq, p.lastSeq, p.lastSeq, false, truncated)
}

func (p *terminalProcess) readAfterLocked(afterSeq int64, maxBytes int64) terminalProcessSnapshot {
	retainedFirstSeq := p.lastSeq + 1
	if len(p.outputChunks) > 0 {
		retainedFirstSeq = p.outputChunks[0].seq
	}
	truncated := afterSeq+1 < retainedFirstSeq
	selected := make([]terminalProcessOutputChunk, 0)
	selectedBytes := 0
	for _, chunk := range p.outputChunks {
		if chunk.seq <= afterSeq {
			continue
		}
		if len(selected) > 0 && int64(selectedBytes+len(chunk.data)) > maxBytes {
			break
		}
		selected = append(selected, chunk)
		selectedBytes += len(chunk.data)
	}
	firstSeq := int64(0)
	lastSeq := afterSeq
	if len(selected) > 0 {
		firstSeq = selected[0].seq
		lastSeq = selected[len(selected)-1].seq
	}
	return p.snapshotWithOutputLocked(
		joinTerminalOutputChunks(selected),
		firstSeq,
		lastSeq,
		p.lastSeq,
		lastSeq < p.lastSeq,
		truncated,
	)
}

func joinTerminalOutputChunks(chunks []terminalProcessOutputChunk) string {
	if len(chunks) == 0 {
		return ""
	}
	var output strings.Builder
	for _, chunk := range chunks {
		_, _ = output.Write(chunk.data)
	}
	return output.String()
}

func (p *terminalProcess) snapshotWithOutputLocked(output string, firstSeq int64, lastSeq int64, latestSeq int64, hasMore bool, truncated bool) terminalProcessSnapshot {
	duration := int64(0)
	if !p.startedAt.IsZero() {
		end := p.endedAt
		if end.IsZero() {
			end = time.Now()
		}
		duration = end.Sub(p.startedAt).Milliseconds()
	}
	startedAtUnixMs := int64(0)
	if !p.startedAt.IsZero() {
		startedAtUnixMs = p.startedAt.UnixMilli()
	}
	endedAtUnixMs := int64(0)
	if !p.endedAt.IsZero() {
		endedAtUnixMs = p.endedAt.UnixMilli()
	}
	err := p.err
	if err != nil {
		cp := *err
		err = &cp
	}
	return terminalProcessSnapshot{
		ProcessID:         p.id,
		EndpointID:        p.endpointID,
		ThreadID:          p.threadID,
		RunID:             p.runID,
		TurnID:            p.turnID,
		ToolID:            p.toolID,
		ToolName:          p.toolName,
		Command:           p.command,
		Cwd:               p.cwd,
		Status:            p.status,
		Output:            output,
		FirstSeq:          firstSeq,
		LastSeq:           lastSeq,
		LatestSeq:         latestSeq,
		HasMore:           hasMore,
		TotalBytes:        p.total,
		Truncated:         truncated,
		StartedAtUnixMs:   startedAtUnixMs,
		EndedAtUnixMs:     endedAtUnixMs,
		DurationMS:        duration,
		ExitCode:          p.exitCode,
		ExecutionLocation: ToolTargetModeLocalRuntime,
		Error:             err,
	}
}

func terminalProcessResultPayload(snapshot terminalProcessSnapshot) map[string]any {
	out := map[string]any{
		"status":             strings.TrimSpace(snapshot.Status),
		"process_id":         strings.TrimSpace(snapshot.ProcessID),
		"command":            strings.TrimSpace(snapshot.Command),
		"cwd":                strings.TrimSpace(snapshot.Cwd),
		"execution_location": strings.TrimSpace(snapshot.ExecutionLocation),
		"output":             snapshot.Output,
		"first_seq":          snapshot.FirstSeq,
		"last_seq":           snapshot.LastSeq,
		"latest_seq":         snapshot.LatestSeq,
		"has_more":           snapshot.HasMore,
		"total_bytes":        snapshot.TotalBytes,
		"truncated":          snapshot.Truncated,
		"started_at_ms":      snapshot.StartedAtUnixMs,
		"duration_ms":        snapshot.DurationMS,
	}
	if snapshot.EndedAtUnixMs > 0 {
		out["ended_at_ms"] = snapshot.EndedAtUnixMs
	}
	if snapshot.Status != terminalProcessStatusRunning {
		out["exit_code"] = snapshot.ExitCode
	}
	return out
}

func newTerminalProcessID() (string, error) {
	var b [12]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	return "tp_" + hex.EncodeToString(b[:]), nil
}
