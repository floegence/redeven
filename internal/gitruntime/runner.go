package gitruntime

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/floegence/redeven/internal/processenv"
)

const (
	MaxGitStdoutBytes      = 1 << 20
	MaxGitStderrBytes      = 64 << 10
	processTerminateGrace  = 250 * time.Millisecond
	processPipeDrainGrace  = 2 * time.Second
	processCleanupDeadline = 2 * time.Second
)

var errProcessPipeDrain = errors.New("git subprocess pipes remained open after direct process exit")

type CommandKind uint8

const (
	CommandRead CommandKind = iota
	CommandMutation
)

type CommandResult struct {
	Stdout         []byte
	Stderr         []byte
	ExitCode       int
	UnknownOutcome bool
}

type CommandError struct {
	ExitCode       int
	UnknownOutcome bool
	BudgetExceeded bool
	Cause          error
}

// StreamCapture acquires the capture reservation in addition to read-process
// admission. Callers that retain the reservation through cache publication
// should acquire it explicitly and use StreamRead instead.
func (r *Runtime) StreamCapture(ctx context.Context, repoRoot string, env []string, consume func(io.Reader) error, args ...string) (CommandResult, error) {
	if r == nil || consume == nil {
		return CommandResult{}, ErrResourceLimit
	}
	captureAdmission, err := r.AcquireCapture(ctx)
	if err != nil {
		return CommandResult{}, err
	}
	defer captureAdmission.Release()
	return r.StreamRead(ctx, repoRoot, env, consume, args...)
}

// StreamRead runs a read-only Git command with bounded process admission and
// containment while the caller incrementally consumes stdout.
func (r *Runtime) StreamRead(ctx context.Context, repoRoot string, env []string, consume func(io.Reader) error, args ...string) (CommandResult, error) {
	if r == nil || consume == nil {
		return CommandResult{}, ErrResourceLimit
	}
	releaseProcess, err := r.readProcesses.acquire(ctx)
	if err != nil {
		return CommandResult{}, err
	}
	defer releaseProcess()

	cmd, stdout, stderr, err := newGitProcess(repoRoot, env, args...)
	if err != nil {
		return CommandResult{}, err
	}
	if err := cmd.Start(); err != nil {
		_ = stdout.Close()
		_ = stderr.Close()
		return CommandResult{}, err
	}
	monitor := startProcessMonitor(cmd.Process)
	defer monitor.stop()
	type streamResult struct {
		stderr []byte
		err    error
	}
	consumeDone := make(chan error, 1)
	stderrDone := make(chan streamResult, 1)
	trackedStdout := &eofTrackingReader{reader: stdout}
	go func() { consumeDone <- consume(trackedStdout) }()
	go func() {
		data, readErr := readBounded(stderr, MaxGitStderrBytes)
		stderrDone <- streamResult{stderr: data, err: readErr}
	}()

	var result CommandResult
	var consumeErr error
	var stderrErr error
	consumeFinished := false
	stderrFinished := false
	var exit processExit
	directCompleted := false
	for (!consumeFinished || !stderrFinished) && !directCompleted {
		select {
		case consumeErr = <-consumeDone:
			consumeFinished = true
			if consumeErr == nil && !trackedStdout.eof {
				consumeErr = ErrResponseBudget
			}
			if consumeErr != nil {
				goto abort
			}
		case got := <-stderrDone:
			stderrFinished = true
			result.Stderr = got.stderr
			stderrErr = got.err
			if stderrErr != nil {
				goto abort
			}
		case <-ctx.Done():
			consumeErr = ctx.Err()
			goto abort
		case <-monitor.done:
			directCompleted = true
			if observeErr := monitor.observationError(); observeErr != nil {
				consumeErr = observeErr
				goto abort
			}
		}
	}
	if directCompleted && (!consumeFinished || !stderrFinished) {
		drainTimer := time.NewTimer(processPipeDrainGrace)
		defer drainTimer.Stop()
		for !consumeFinished || !stderrFinished {
			select {
			case consumeErr = <-consumeDone:
				consumeFinished = true
				if consumeErr == nil && !trackedStdout.eof {
					consumeErr = ErrResponseBudget
				}
			case got := <-stderrDone:
				stderrFinished = true
				result.Stderr = got.stderr
				stderrErr = got.err
			case <-ctx.Done():
				consumeErr = ctx.Err()
				goto abort
			case <-drainTimer.C:
				consumeErr = errProcessPipeDrain
				goto abort
			}
		}
	}
	if consumeErr != nil || stderrErr != nil {
		goto abort
	}
	{
		var completed bool
		exit, completed = monitor.wait(ctx)
		if !completed {
			consumeErr = exit.err
			goto abort
		}
		result.ExitCode = exit.code
		if exit.err != nil || exit.code != 0 {
			return result, &CommandError{ExitCode: result.ExitCode, Cause: exit.err}
		}
		return result, nil
	}

abort:
	result.UnknownOutcome = true
	cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), processCleanupDeadline)
	defer cleanupCancel()
	monitor.cleanupProcessGroupBeforeReap(cmd.Process.Pid)
	_ = stdout.Close()
	_ = stderr.Close()
	for !consumeFinished || !stderrFinished {
		select {
		case err := <-consumeDone:
			consumeFinished = true
			if consumeErr == nil {
				consumeErr = err
			}
		case got := <-stderrDone:
			stderrFinished = true
			result.Stderr = got.stderr
			if stderrErr == nil {
				stderrErr = got.err
			}
		case <-cleanupCtx.Done():
			consumeFinished = true
			stderrFinished = true
		}
	}
	var completed bool
	exit, completed = monitor.wait(cleanupCtx)
	directCompleted = completed
	if directCompleted {
		result.ExitCode = exit.code
	} else {
		result.ExitCode = -1
		monitor.releaseUnreaped()
	}
	cause := consumeErr
	if cause == nil {
		cause = stderrErr
	}
	return result, &CommandError{
		ExitCode:       result.ExitCode,
		UnknownOutcome: true,
		BudgetExceeded: errors.Is(cause, ErrResponseBudget),
		Cause:          cause,
	}
}

type eofTrackingReader struct {
	reader io.Reader
	eof    bool
}

func (r *eofTrackingReader) Read(p []byte) (int, error) {
	n, err := r.reader.Read(p)
	if errors.Is(err, io.EOF) {
		r.eof = true
	}
	return n, err
}

func (e *CommandError) Error() string {
	switch {
	case e == nil:
		return "git command failed"
	case e.BudgetExceeded:
		return "git command output exceeds resource budget"
	case e.UnknownOutcome:
		return "git command outcome is unknown"
	case e.ExitCode >= 0:
		return fmt.Sprintf("git command exited with code %d", e.ExitCode)
	default:
		return "git command failed"
	}
}

func (e *CommandError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.Cause
}

func (r *Runtime) RunRead(ctx context.Context, repoRoot string, env []string, args ...string) (CommandResult, error) {
	return r.run(ctx, CommandRead, repoRoot, env, nil, args...)
}

func (r *Runtime) RunReadAllowExitCodes(ctx context.Context, repoRoot string, env []string, allowedExitCodes []int, args ...string) (CommandResult, error) {
	return r.run(ctx, CommandRead, repoRoot, env, allowedExitCodes, args...)
}

func (r *Runtime) RunMutation(ctx context.Context, repoRoot string, env []string, args ...string) (CommandResult, error) {
	return r.run(ctx, CommandMutation, repoRoot, env, nil, args...)
}

func (r *Runtime) RunCapture(ctx context.Context, repoRoot string, env []string, args ...string) (CommandResult, error) {
	admission, err := r.AcquireCapture(ctx)
	if err != nil {
		return CommandResult{}, err
	}
	defer admission.Release()
	return r.RunRead(ctx, repoRoot, env, args...)
}

func (r *Runtime) run(ctx context.Context, kind CommandKind, repoRoot string, env []string, allowedExitCodes []int, args ...string) (CommandResult, error) {
	if r == nil {
		return CommandResult{}, ErrResourceLimit
	}
	if ctx == nil {
		ctx = context.Background()
	}
	repoRoot = filepath.Clean(repoRoot)
	if repoRoot == "." || repoRoot == "" || !filepath.IsAbs(repoRoot) {
		return CommandResult{}, errors.New("git repository root must be absolute")
	}
	limiter := r.readProcesses
	if kind == CommandMutation {
		limiter = r.mutationProcesses
	}
	release, err := limiter.acquire(ctx)
	if err != nil {
		return CommandResult{}, err
	}
	defer release()

	cmd, stdout, stderr, err := newGitProcess(repoRoot, env, args...)
	if err != nil {
		return CommandResult{}, err
	}
	if err := cmd.Start(); err != nil {
		_ = stdout.Close()
		_ = stderr.Close()
		return CommandResult{}, err
	}
	monitor := startProcessMonitor(cmd.Process)
	defer monitor.stop()

	type readResult struct {
		name string
		data []byte
		err  error
	}
	readDone := make(chan readResult, 2)
	go func() {
		data, readErr := readBounded(stdout, MaxGitStdoutBytes)
		readDone <- readResult{name: "stdout", data: data, err: readErr}
	}()
	go func() {
		data, readErr := readBounded(stderr, MaxGitStderrBytes)
		readDone <- readResult{name: "stderr", data: data, err: readErr}
	}()

	var result CommandResult
	readers := 0
	var abortErr error
	var exit processExit
	directCompleted := false
	for readers < 2 && abortErr == nil && !directCompleted {
		select {
		case <-ctx.Done():
			abortErr = ctx.Err()
		case got := <-readDone:
			readers++
			if got.name == "stdout" {
				result.Stdout = got.data
			} else {
				result.Stderr = got.data
			}
			if got.err != nil {
				abortErr = got.err
			}
		case <-monitor.done:
			directCompleted = true
			if observeErr := monitor.observationError(); observeErr != nil {
				abortErr = observeErr
			}
		}
	}
	if directCompleted && readers < 2 && abortErr == nil {
		drainTimer := time.NewTimer(processPipeDrainGrace)
		defer drainTimer.Stop()
		for readers < 2 && abortErr == nil {
			select {
			case <-ctx.Done():
				abortErr = ctx.Err()
			case got := <-readDone:
				readers++
				if got.name == "stdout" {
					result.Stdout = got.data
				} else {
					result.Stderr = got.data
				}
				if got.err != nil {
					abortErr = got.err
				}
			case <-drainTimer.C:
				abortErr = errProcessPipeDrain
			}
		}
	}

	completed := false
	if abortErr == nil {
		exit, completed = monitor.wait(ctx)
		if !completed {
			abortErr = exit.err
		}
		if completed {
			result.ExitCode = exit.code
		}
	}
	if abortErr == nil && (exit.err != nil || exit.code != 0) {
		for _, allowed := range allowedExitCodes {
			if result.ExitCode == allowed {
				return result, nil
			}
		}
		return result, &CommandError{ExitCode: result.ExitCode, Cause: exit.err}
	}
	if abortErr != nil {
		result.UnknownOutcome = true
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), processCleanupDeadline)
		defer cleanupCancel()
		monitor.cleanupProcessGroupBeforeReap(cmd.Process.Pid)
		_ = stdout.Close()
		_ = stderr.Close()
		for readers < 2 {
			select {
			case got := <-readDone:
				readers++
				if got.name == "stdout" && result.Stdout == nil {
					result.Stdout = got.data
				}
				if got.name == "stderr" && result.Stderr == nil {
					result.Stderr = got.data
				}
			case <-cleanupCtx.Done():
				readers = 2
			}
		}
		exit, completed = monitor.wait(cleanupCtx)
		if completed {
			result.ExitCode = exit.code
		} else {
			result.ExitCode = -1
			monitor.releaseUnreaped()
		}
		return result, &CommandError{
			ExitCode:       result.ExitCode,
			UnknownOutcome: true,
			BudgetExceeded: errors.Is(abortErr, ErrResponseBudget),
			Cause:          abortErr,
		}
	}
	return result, nil
}

func newGitProcess(repoRoot string, env []string, args ...string) (*exec.Cmd, io.ReadCloser, io.ReadCloser, error) {
	repoRoot = filepath.Clean(repoRoot)
	if repoRoot == "." || repoRoot == "" || !filepath.IsAbs(repoRoot) {
		return nil, nil, nil, errors.New("git repository root must be absolute")
	}
	cmdArgs := append([]string{"-C", repoRoot, "--no-pager", "-c", "color.ui=never", "-c", "core.quotepath=false"}, args...)
	cmd := exec.Command("git", cmdArgs...)
	if err := prepareProcessGroup(cmd); err != nil {
		return nil, nil, nil, err
	}
	cmd.Env = commandEnvironment(env)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, nil, nil, err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		_ = stdout.Close()
		return nil, nil, nil, err
	}
	return cmd, stdout, stderr, nil
}

func commandEnvironment(overrides []string) []string {
	environment := processenv.Current()
	index := make(map[string]int, len(environment))
	for i, item := range environment {
		name, _, ok := strings.Cut(item, "=")
		if ok {
			index[strings.ToUpper(name)] = i
		}
	}
	for _, item := range processenv.Filter(overrides) {
		name, _, ok := strings.Cut(item, "=")
		if !ok {
			continue
		}
		key := strings.ToUpper(name)
		if i, exists := index[key]; exists {
			environment[i] = item
		} else {
			index[key] = len(environment)
			environment = append(environment, item)
		}
	}
	for _, fixed := range []string{"GIT_TERMINAL_PROMPT=0", "GCM_INTERACTIVE=never"} {
		name, _, _ := strings.Cut(fixed, "=")
		key := strings.ToUpper(name)
		if i, exists := index[key]; exists {
			environment[i] = fixed
		} else {
			environment = append(environment, fixed)
		}
	}
	return environment
}

func readBounded(reader io.Reader, limit int) ([]byte, error) {
	if limit < 0 {
		return nil, ErrResponseBudget
	}
	buffer := make([]byte, 0, min(limit, 64<<10))
	chunk := make([]byte, 32<<10)
	for {
		n, err := reader.Read(chunk)
		if n > 0 {
			if len(buffer) > limit-n {
				return nil, ErrResponseBudget
			}
			buffer = append(buffer, chunk[:n]...)
		}
		if err != nil {
			if errors.Is(err, io.EOF) {
				return buffer, nil
			}
			return nil, err
		}
	}
}

// cleanupProcessGroup performs every PGID operation before the leader is
// reaped. processMonitor serializes this function with its non-blocking wait.
func cleanupProcessGroup(pid int) {
	_ = signalProcessGroup(pid, syscall.SIGTERM)
	timer := time.NewTimer(processTerminateGrace)
	<-timer.C
	if processGroupAlive(pid) {
		_ = signalProcessGroup(pid, syscall.SIGKILL)
	}
	_ = processGroupAlive(pid)
}

type processExit struct {
	code int
	err  error
}

type processMonitor struct {
	process  *os.Process
	observer *processExitObserver
	cancel   context.CancelFunc
	done     chan struct{}

	mu         sync.Mutex
	observeErr error
	reaped     bool
	released   bool
}

func startProcessMonitor(process *os.Process) *processMonitor {
	ctx, cancel := context.WithCancel(context.Background())
	observer, err := newProcessExitObserver(process)
	monitor := &processMonitor{process: process, observer: observer, cancel: cancel, done: make(chan struct{}), observeErr: err}
	go monitor.run(ctx)
	return monitor
}

func (m *processMonitor) run(ctx context.Context) {
	ticker := time.NewTicker(5 * time.Millisecond)
	defer ticker.Stop()
	defer close(m.done)
	if m.observer == nil {
		return
	}
	defer m.observer.close()
	for {
		exited, err := m.observer.exited()
		if err != nil {
			m.mu.Lock()
			m.observeErr = err
			m.mu.Unlock()
			return
		}
		if exited {
			return
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (m *processMonitor) observationError() error {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.observeErr
}

func (m *processMonitor) wait(ctx context.Context) (processExit, bool) {
	if ctx == nil {
		ctx = context.Background()
	}
	select {
	case <-m.done:
	case <-ctx.Done():
		return processExit{code: -1, err: ctx.Err()}, false
	}
	ticker := time.NewTicker(5 * time.Millisecond)
	defer ticker.Stop()
	for {
		m.mu.Lock()
		if m.released {
			m.mu.Unlock()
			return processExit{code: -1, err: errors.New("process handle released before reap")}, false
		}
		done, code, err := reapProcessExit(m.process)
		if done {
			m.reaped = true
		}
		m.mu.Unlock()
		if done {
			if err == nil && code != 0 {
				err = fmt.Errorf("process exited with code %d", code)
			}
			return processExit{code: code, err: err}, true
		}
		select {
		case <-ctx.Done():
			err := ctx.Err()
			if observeErr := m.observationError(); observeErr != nil {
				err = observeErr
			}
			return processExit{code: -1, err: err}, false
		case <-ticker.C:
		}
	}
}

func (m *processMonitor) cleanupProcessGroupBeforeReap(pid int) {
	if m == nil {
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.reaped || m.released {
		return
	}
	cleanupProcessGroup(pid)
}

func (m *processMonitor) releaseUnreaped() {
	if m == nil {
		return
	}
	m.cancel()
	<-m.done
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.reaped || m.released {
		return
	}
	_ = m.process.Release()
	m.released = true
}

func (m *processMonitor) stop() {
	if m != nil {
		m.cancel()
	}
}
