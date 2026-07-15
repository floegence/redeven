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
	aitools "github.com/floegence/redeven/internal/ai/tools"
	"github.com/floegence/redeven/internal/processenv"
)

const (
	terminalProcessDefaultYieldMS   = 1000
	terminalProcessMaxYieldMS       = 30_000
	terminalProcessDefaultReadWait  = 1000
	terminalProcessMaxReadWait      = 30_000
	terminalProcessDefaultReadBytes = 200_000
	terminalProcessMaxReadBytes     = 1_000_000
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
	onDone    func(terminalProcessSnapshot) error
}

type terminalProcessStartRequest struct {
	EndpointID         string
	ThreadID           string
	RunID              string
	TurnID             string
	SettlementThreadID string
	SettlementRunID    string
	SettlementTurnID   string
	ToolID             string
	ToolName           string
	Command            string
	Stdin              string
	CwdAbs             string
	Shell              string
	Env                []string
}

type terminalProcessReadRequest struct {
	ProcessID string
	AfterSeq  int64
	WaitMS    int64
	MaxBytes  int64
}

type terminalProcessSnapshot struct {
	ProcessID  string `json:"process_id"`
	EndpointID string `json:"endpoint_id,omitempty"`
	ThreadID   string `json:"thread_id,omitempty"`
	RunID      string `json:"run_id,omitempty"`
	TurnID     string `json:"turn_id,omitempty"`
	// Settlement*ID is the Floret execution target for host-owned pending work.
	// It is intentionally internal-only and must not fall back at settlement time.
	SettlementThreadID string             `json:"-"`
	SettlementRunID    string             `json:"-"`
	SettlementTurnID   string             `json:"-"`
	ToolID             string             `json:"tool_id,omitempty"`
	ToolName           string             `json:"tool_name,omitempty"`
	Command            string             `json:"command"`
	Cwd                string             `json:"cwd"`
	Status             string             `json:"status"`
	Output             string             `json:"output"`
	LatestOutput       string             `json:"latest_output,omitempty"`
	FirstSeq           int64              `json:"first_seq"`
	LastSeq            int64              `json:"last_seq"`
	TotalBytes         int64              `json:"total_bytes"`
	Truncated          bool               `json:"truncated"`
	StartedAtUnixMs    int64              `json:"started_at_ms"`
	EndedAtUnixMs      int64              `json:"ended_at_ms,omitempty"`
	DurationMS         int64              `json:"duration_ms,omitempty"`
	ExitCode           int                `json:"exit_code,omitempty"`
	ExecutionLocation  string             `json:"execution_location"`
	Error              *aitools.ToolError `json:"error,omitempty"`
}

type terminalProcess struct {
	mu                     sync.Mutex
	cond                   *sync.Cond
	manager                *terminalProcessManager
	id                     string
	endpointID             string
	threadID               string
	runID                  string
	turnID                 string
	settlementThreadID     string
	settlementRunID        string
	settlementTurnID       string
	toolID                 string
	toolName               string
	command                string
	cwd                    string
	cmd                    *exec.Cmd
	tty                    *os.File
	readDone               chan struct{}
	startedAt              time.Time
	endedAt                time.Time
	status                 string
	exitCode               int
	err                    *aitools.ToolError
	buf                    []byte
	firstSeq               int64
	lastSeq                int64
	total                  int64
	truncated              bool
	pending                bool
	settlementAcknowledged bool
	settlementInFlight     bool
}

func newTerminalProcessManager(onDone func(terminalProcessSnapshot) error) *terminalProcessManager {
	return &terminalProcessManager{
		processes: make(map[string]*terminalProcess),
		onDone:    onDone,
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
	settlementThreadID := strings.TrimSpace(req.SettlementThreadID)
	settlementRunID := strings.TrimSpace(req.SettlementRunID)
	settlementTurnID := strings.TrimSpace(req.SettlementTurnID)
	if settlementThreadID == "" || settlementRunID == "" || settlementTurnID == "" {
		return nil, errors.New("terminal process settlement target incomplete")
	}
	id, err := newTerminalProcessID()
	if err != nil {
		return nil, err
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
		manager:            m,
		id:                 id,
		endpointID:         strings.TrimSpace(req.EndpointID),
		threadID:           strings.TrimSpace(req.ThreadID),
		runID:              strings.TrimSpace(req.RunID),
		turnID:             strings.TrimSpace(req.TurnID),
		settlementThreadID: settlementThreadID,
		settlementRunID:    settlementRunID,
		settlementTurnID:   settlementTurnID,
		toolID:             strings.TrimSpace(req.ToolID),
		toolName:           firstNonEmptyString(req.ToolName, "terminal.exec"),
		command:            command,
		cwd:                cwd,
		cmd:                cmd,
		tty:                tty,
		readDone:           make(chan struct{}),
		startedAt:          time.Now(),
		status:             terminalProcessStatusRunning,
		exitCode:           0,
	}
	proc.cond = sync.NewCond(&proc.mu)

	m.mu.Lock()
	m.processes[id] = proc
	m.mu.Unlock()

	go proc.readLoop()
	go proc.waitLoop()
	go proc.maxRuntimeLoop()

	if req.Stdin != "" {
		if _, err := tty.Write([]byte(req.Stdin)); err != nil {
			_ = terminateTerminalExecProcessTree(cmd)
			_ = tty.Close()
			return nil, err
		}
	}
	return proc, nil
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

func (m *terminalProcessManager) Read(req terminalProcessReadRequest) (terminalProcessSnapshot, error) {
	proc, ok := m.Get(req.ProcessID)
	if !ok {
		return terminalProcessSnapshot{}, errors.New("terminal process not found")
	}
	return proc.Read(req), nil
}

func (m *terminalProcessManager) Write(processID string, input string) (terminalProcessSnapshot, error) {
	proc, ok := m.Get(processID)
	if !ok {
		return terminalProcessSnapshot{}, errors.New("terminal process not found")
	}
	return proc.Write(input)
}

func (m *terminalProcessManager) Terminate(processID string) (terminalProcessSnapshot, error) {
	proc, ok := m.Get(processID)
	if !ok {
		return terminalProcessSnapshot{}, errors.New("terminal process not found")
	}
	return proc.Terminate()
}

func (m *terminalProcessManager) Close() {
	if m == nil {
		return
	}
	m.mu.Lock()
	processes := make([]*terminalProcess, 0, len(m.processes))
	for _, proc := range m.processes {
		if proc != nil {
			processes = append(processes, proc)
		}
	}
	m.mu.Unlock()
	for _, proc := range processes {
		_, _ = proc.Terminate()
		_ = proc.publishDone()
	}
}

func (p *terminalProcess) MarkPending() terminalProcessSnapshot {
	if p == nil {
		return terminalProcessSnapshot{}
	}
	p.mu.Lock()
	p.pending = true
	snapshot := p.snapshotLocked(0)
	p.mu.Unlock()
	_ = p.publishDone()
	return snapshot
}

func (p *terminalProcess) Read(req terminalProcessReadRequest) terminalProcessSnapshot {
	if p == nil {
		return terminalProcessSnapshot{}
	}
	waitMS := req.WaitMS
	if waitMS <= 0 {
		waitMS = terminalProcessDefaultReadWait
	}
	if waitMS > terminalProcessMaxReadWait {
		waitMS = terminalProcessMaxReadWait
	}
	deadline := time.Now().Add(time.Duration(waitMS) * time.Millisecond)
	p.mu.Lock()
	for req.AfterSeq > 0 && p.lastSeq <= req.AfterSeq && p.status == terminalProcessStatusRunning {
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
	snapshot := p.snapshotLocked(req.MaxBytes)
	p.mu.Unlock()
	return snapshot
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
			snapshot, _ := p.Terminate()
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
		snapshot, _ := p.Terminate()
		return snapshot
	}
	snapshot := p.snapshotLocked(0)
	p.mu.Unlock()
	return snapshot
}

func (p *terminalProcess) Write(input string) (terminalProcessSnapshot, error) {
	if p == nil {
		return terminalProcessSnapshot{}, errors.New("terminal process not found")
	}
	p.mu.Lock()
	if p.status != terminalProcessStatusRunning {
		snapshot := p.snapshotLocked(0)
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
	return p.Read(terminalProcessReadRequest{}), nil
}

func (p *terminalProcess) Terminate() (terminalProcessSnapshot, error) {
	if p == nil {
		return terminalProcessSnapshot{}, errors.New("terminal process not found")
	}
	p.mu.Lock()
	if p.status != terminalProcessStatusRunning {
		snapshot := p.snapshotLocked(0)
		p.mu.Unlock()
		return snapshot, nil
	}
	cmd := p.cmd
	p.status = terminalProcessStatusCanceled
	p.err = &aitools.ToolError{Code: aitools.ErrorCodeCanceled, Message: "Terminal process was canceled", Retryable: false}
	p.endedAt = time.Now()
	p.cond.Broadcast()
	p.mu.Unlock()
	err := terminateTerminalExecProcessTree(cmd)
	snapshot := p.Read(terminalProcessReadRequest{})
	return snapshot, err
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
	if p.status == terminalProcessStatusRunning {
		p.status = status
		p.exitCode = exitCode
		p.endedAt = time.Now()
		if toolErr != nil {
			toolErr.Normalize()
			p.err = toolErr
		}
	}
	p.cond.Broadcast()
	p.mu.Unlock()
	p.managerProcessEnded()
	_ = p.publishDone()
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
		_, _ = p.Terminate()
	}
}

func (p *terminalProcess) appendOutput(chunk []byte) {
	if p == nil || len(chunk) == 0 {
		return
	}
	p.mu.Lock()
	p.total += int64(len(chunk))
	p.lastSeq++
	if p.firstSeq == 0 {
		p.firstSeq = p.lastSeq
	}
	p.buf = append(p.buf, chunk...)
	if len(p.buf) > terminalProcessTailCapBytes {
		excess := len(p.buf) - terminalProcessTailCapBytes
		copy(p.buf, p.buf[excess:])
		p.buf = p.buf[:terminalProcessTailCapBytes]
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

func (p *terminalProcess) publishDone() error {
	if p == nil || p.manager == nil {
		return nil
	}
	p.mu.Lock()
	for p.settlementInFlight {
		p.cond.Wait()
	}
	if !p.pending || p.settlementAcknowledged || p.status == terminalProcessStatusRunning {
		p.mu.Unlock()
		return nil
	}
	if p.manager.onDone == nil {
		p.settlementAcknowledged = true
		p.cond.Broadcast()
		p.mu.Unlock()
		return nil
	}
	p.settlementInFlight = true
	snapshot := p.snapshotLocked(0)
	p.cond.Broadcast()
	p.mu.Unlock()
	err := p.manager.onDone(snapshot)
	p.mu.Lock()
	if err == nil {
		p.settlementAcknowledged = true
	}
	p.settlementInFlight = false
	p.cond.Broadcast()
	p.mu.Unlock()
	return err
}

func (p *terminalProcess) settlePendingForRunEnd(ctx context.Context) (bool, error) {
	if p == nil {
		return false, nil
	}
	if ctx == nil {
		ctx = context.Background()
	}
	stopWake := context.AfterFunc(ctx, func() {
		p.mu.Lock()
		p.cond.Broadcast()
		p.mu.Unlock()
	})
	defer stopWake()

	p.mu.Lock()
	if !p.pending {
		p.mu.Unlock()
		return false, nil
	}
	for p.settlementInFlight {
		if err := ctx.Err(); err != nil {
			p.mu.Unlock()
			return true, err
		}
		p.cond.Wait()
	}
	if p.settlementAcknowledged {
		p.mu.Unlock()
		return true, nil
	}
	running := p.status == terminalProcessStatusRunning
	p.mu.Unlock()

	var terminateErr error
	if running {
		_, terminateErr = p.Terminate()
	}
	publishErr := p.publishDone()
	if publishErr != nil {
		if terminateErr != nil {
			return true, errors.Join(terminateErr, publishErr)
		}
		return true, publishErr
	}
	return true, nil
}

func (p *terminalProcess) snapshotLocked(maxBytes int64) terminalProcessSnapshot {
	if p == nil {
		return terminalProcessSnapshot{}
	}
	if maxBytes <= 0 {
		maxBytes = terminalProcessDefaultReadBytes
	}
	if maxBytes > terminalProcessMaxReadBytes {
		maxBytes = terminalProcessMaxReadBytes
	}
	output := string(p.buf)
	truncated := p.truncated
	if int64(len(output)) > maxBytes {
		output = output[len(output)-int(maxBytes):]
		truncated = true
	}
	latest := output
	if len(latest) > 4000 {
		latest = latest[len(latest)-4000:]
	}
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
		ProcessID:          p.id,
		EndpointID:         p.endpointID,
		ThreadID:           p.threadID,
		RunID:              p.runID,
		TurnID:             p.turnID,
		SettlementThreadID: p.settlementThreadID,
		SettlementRunID:    p.settlementRunID,
		SettlementTurnID:   p.settlementTurnID,
		ToolID:             p.toolID,
		ToolName:           p.toolName,
		Command:            p.command,
		Cwd:                p.cwd,
		Status:             p.status,
		Output:             output,
		LatestOutput:       latest,
		FirstSeq:           p.firstSeq,
		LastSeq:            p.lastSeq,
		TotalBytes:         p.total,
		Truncated:          truncated,
		StartedAtUnixMs:    startedAtUnixMs,
		EndedAtUnixMs:      endedAtUnixMs,
		DurationMS:         duration,
		ExitCode:           p.exitCode,
		ExecutionLocation:  ToolTargetModeLocalRuntime,
		Error:              err,
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
		"stdout":             snapshot.Output,
		"stderr":             "",
		"first_seq":          snapshot.FirstSeq,
		"last_seq":           snapshot.LastSeq,
		"total_bytes":        snapshot.TotalBytes,
		"truncated":          snapshot.Truncated,
		"started_at_ms":      snapshot.StartedAtUnixMs,
		"duration_ms":        snapshot.DurationMS,
	}
	if snapshot.LatestOutput != "" {
		out["latest_output"] = snapshot.LatestOutput
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
