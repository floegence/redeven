//go:build floeterm_native

package terminal

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	termgo "github.com/floegence/floeterm/terminal-go"
)

func TestRealBashIntegrationPreservesDelimitedPromptCommand(t *testing.T) {
	shellPath := "/bin/bash"
	if _, err := os.Stat(shellPath); err != nil {
		t.Skipf("shell %q unavailable: %v", shellPath, err)
	}

	homeDir := newIsolatedShellHome(t)
	if err := os.WriteFile(
		filepath.Join(homeDir, ".bashrc"),
		[]byte("PROMPT_COMMAND='history -a; '\n"),
		0o644,
	); err != nil {
		t.Fatalf("write Bash configuration: %v", err)
	}
	t.Setenv("HOME", homeDir)

	manager, recorder := newShellLifecycleTestManagerWithRecorder(t, t.TempDir(), shellPath)
	t.Cleanup(manager.Cleanup)
	session, err := manager.createSession("test", "")
	if err != nil {
		t.Fatalf("createSession() error = %v", err)
	}
	activateShellTestSession(t, manager, session)

	time.Sleep(250 * time.Millisecond)
	startSeq := nextHistorySequence(t, session)
	startRevision := session.ToSessionInfo().ForegroundCommand.Revision
	if err := session.WriteData("printf '__REDEVEN_PROMPT_COMMAND_OK__\\n'\n"); err != nil {
		t.Fatalf("WriteData(prompt command probe) error = %v", err)
	}

	output := waitForHistoryContains(
		t,
		session,
		startSeq,
		5*time.Second,
		"__REDEVEN_PROMPT_COMMAND_OK__",
	)
	waitForForegroundCommandAfterRevision(t, recorder, 5*time.Second, session.ID, startRevision, termgo.ForegroundCommandIdle, "")
	if strings.Contains(output, "syntax error near unexpected token") {
		t.Fatalf("Bash integration corrupted the user's PROMPT_COMMAND: %q", output)
	}
	assertSemanticOutputOmitsControlSequences(t, output)
}

func TestRealBashIntegrationRunsUserPromptCommandOncePerPrompt(t *testing.T) {
	shellPath := "/bin/bash"
	if _, err := os.Stat(shellPath); err != nil {
		t.Skipf("shell %q unavailable: %v", shellPath, err)
	}

	const userPromptMarker = "__REDEVEN_USER_PROMPT_HOOK__"
	homeDir := newIsolatedShellHome(t)
	if err := os.WriteFile(
		filepath.Join(homeDir, ".bashrc"),
		[]byte("PROMPT_COMMAND='printf \""+userPromptMarker+"\\n\"; '\n"),
		0o644,
	); err != nil {
		t.Fatalf("write Bash configuration: %v", err)
	}
	t.Setenv("HOME", homeDir)

	manager, recorder := newShellLifecycleTestManagerWithRecorder(t, t.TempDir(), shellPath)
	t.Cleanup(manager.Cleanup)
	session, err := manager.createSession("test", "")
	if err != nil {
		t.Fatalf("createSession() error = %v", err)
	}
	activateShellTestSession(t, manager, session)
	time.Sleep(250 * time.Millisecond)

	for cycle := 1; cycle <= 2; cycle++ {
		beforeOutput := historyTextFromSequence(t, session, 1)
		beforeCount := strings.Count(beforeOutput, userPromptMarker)
		startSeq := nextHistorySequence(t, session)
		startRevision := session.ToSessionInfo().ForegroundCommand.Revision
		if err := session.WriteData(":\n"); err != nil {
			t.Fatalf("WriteData(prompt cycle %d) error = %v", cycle, err)
		}
		waitForHistoryContains(
			t,
			session,
			startSeq,
			5*time.Second,
			userPromptMarker,
		)
		waitForForegroundCommandAfterRevision(t, recorder, 5*time.Second, session.ID, startRevision, termgo.ForegroundCommandIdle, "")
		time.Sleep(100 * time.Millisecond)
		output := historyTextFromSequence(t, session, startSeq)
		if count := strings.Count(output, userPromptMarker); count != beforeCount+1 {
			t.Fatalf("prompt cycle %d user PROMPT_COMMAND count = %d, want %d; output=%q", cycle, count, beforeCount+1, output)
		}
		assertSemanticOutputOmitsControlSequences(t, output)
	}
}

func TestRealShellIntegrationAppliesLifecycleWithoutExposingControlBytes(t *testing.T) {
	for _, shellPath := range []string{"/bin/bash", "/bin/zsh"} {
		shellPath := shellPath
		t.Run(filepath.Base(shellPath), func(t *testing.T) {
			if _, err := os.Stat(shellPath); err != nil {
				t.Skipf("shell %q unavailable: %v", shellPath, err)
			}

			t.Setenv("HOME", newIsolatedShellHome(t))

			root := t.TempDir()
			manager, recorder := newShellLifecycleTestManagerWithRecorder(t, root, shellPath)
			t.Cleanup(func() {
				manager.Cleanup()
			})

			session, err := manager.createSession("test", "")
			if err != nil {
				t.Fatalf("createSession() error = %v", err)
			}
			activateShellTestSession(t, manager, session)

			time.Sleep(250 * time.Millisecond)

			successStartSeq := nextHistorySequence(t, session)
			successStartRevision := session.ToSessionInfo().ForegroundCommand.Revision
			if err := session.WriteData("printf '__REDEVEN_OK__\\n'\n"); err != nil {
				t.Fatalf("WriteData(success) error = %v", err)
			}

			successOutput := waitForHistoryContains(
				t,
				session,
				successStartSeq,
				5*time.Second,
				"__REDEVEN_OK__",
			)
			waitForForegroundCommandAfterRevision(t, recorder, 5*time.Second, session.ID, successStartRevision, termgo.ForegroundCommandRunning, "printf")
			waitForForegroundCommandAfterRevision(t, recorder, 5*time.Second, session.ID, successStartRevision, termgo.ForegroundCommandIdle, "")
			assertSemanticOutputOmitsControlSequences(t, successOutput)

			failureStartSeq := nextHistorySequence(t, session)
			failureStartRevision := session.ToSessionInfo().ForegroundCommand.Revision
			if err := session.WriteData("false\n"); err != nil {
				t.Fatalf("WriteData(false) error = %v", err)
			}

			waitForForegroundCommandAfterRevision(t, recorder, 5*time.Second, session.ID, failureStartRevision, termgo.ForegroundCommandRunning, "false")
			waitForForegroundCommandAfterRevision(t, recorder, 5*time.Second, session.ID, failureStartRevision, termgo.ForegroundCommandIdle, "")
			failureOutput := waitForHistoryContains(t, session, failureStartSeq, 5*time.Second)
			assertSemanticOutputOmitsControlSequences(t, failureOutput)
		})
	}
}

func TestRealShellIntegrationReportsForegroundProgramAndIdleForBashAndZsh(t *testing.T) {
	for _, shellPath := range []string{"/bin/bash", "/bin/zsh"} {
		shellPath := shellPath
		t.Run(filepath.Base(shellPath), func(t *testing.T) {
			if _, err := os.Stat(shellPath); err != nil {
				t.Skipf("shell %q unavailable: %v", shellPath, err)
			}

			t.Setenv("HOME", newIsolatedShellHome(t))
			manager, recorder := newShellLifecycleTestManagerWithRecorder(t, t.TempDir(), shellPath)
			t.Cleanup(manager.Cleanup)
			session, err := manager.createSession("test", "")
			if err != nil {
				t.Fatalf("createSession() error = %v", err)
			}
			activateShellTestSession(t, manager, session)
			time.Sleep(250 * time.Millisecond)

			if err := session.WriteData("sleep 0.5\n"); err != nil {
				t.Fatalf("WriteData(sleep) error = %v", err)
			}
			waitForForegroundCommand(t, recorder, 5*time.Second, session.ID, termgo.ForegroundCommandRunning, "sleep")
			waitForForegroundCommand(t, recorder, 5*time.Second, session.ID, termgo.ForegroundCommandIdle, "")
		})
	}
}

func TestRealPosixShellFallbackOmitsLifecycleMarkers(t *testing.T) {
	shellPath := "/bin/sh"
	if _, err := os.Stat(shellPath); err != nil {
		t.Skipf("shell %q unavailable: %v", shellPath, err)
	}

	t.Setenv("HOME", newIsolatedShellHome(t))

	root := t.TempDir()
	manager := newShellLifecycleTestManager(t, root, shellPath)
	t.Cleanup(func() {
		manager.Cleanup()
	})

	session, err := manager.createSession("test", "")
	if err != nil {
		t.Fatalf("createSession() error = %v", err)
	}
	activateShellTestSession(t, manager, session)

	time.Sleep(150 * time.Millisecond)

	startSeq := nextHistorySequence(t, session)
	if err := session.WriteData("printf '__REDEVEN_SH__\\n'\n"); err != nil {
		t.Fatalf("WriteData(posix) error = %v", err)
	}

	output := waitForHistoryContains(t, session, startSeq, 5*time.Second, "__REDEVEN_SH__")
	if strings.Contains(output, "\x1b]633;") || strings.Contains(output, "\x1b]133;") {
		t.Fatalf("expected posix fallback to omit lifecycle markers, got %q", output)
	}
}

func TestRealShellIntegrationEmitsCwdMarkersAndNameUpdatesForBashAndZsh(t *testing.T) {
	for _, shellPath := range []string{"/bin/bash", "/bin/zsh"} {
		shellPath := shellPath
		t.Run(filepath.Base(shellPath), func(t *testing.T) {
			if _, err := os.Stat(shellPath); err != nil {
				t.Skipf("shell %q unavailable: %v", shellPath, err)
			}

			t.Setenv("HOME", newIsolatedShellHome(t))

			root := t.TempDir()
			childDir := filepath.Join(root, "repo dir")
			if err := os.MkdirAll(childDir, 0o755); err != nil {
				t.Fatalf("MkdirAll(%q): %v", childDir, err)
			}
			expectedChildDir := mustEvalPathForShell(t, childDir)

			manager, recorder := newShellLifecycleTestManagerWithRecorder(t, root, shellPath)
			t.Cleanup(func() {
				manager.Cleanup()
			})

			session, err := manager.createSession("test", "")
			if err != nil {
				t.Fatalf("createSession() error = %v", err)
			}
			activateShellTestSession(t, manager, session)

			time.Sleep(250 * time.Millisecond)

			startSeq := nextHistorySequence(t, session)
			startRevision := session.ToSessionInfo().ForegroundCommand.Revision
			command := "cd " + shellSingleQuote(expectedChildDir) + " && printf '__REDEVEN_CD__\\n'\n"
			if err := session.WriteData(command); err != nil {
				t.Fatalf("WriteData(cd) error = %v", err)
			}

			output := waitForHistoryContains(
				t,
				session,
				startSeq,
				5*time.Second,
				"__REDEVEN_CD__",
			)
			waitForForegroundCommandAfterRevision(t, recorder, 5*time.Second, session.ID, startRevision, termgo.ForegroundCommandIdle, "")
			assertSemanticOutputOmitsControlSequences(t, output)
			waitForNameUpdate(t, recorder, 5*time.Second, session.ID, filepath.Base(expectedChildDir), expectedChildDir)
		})
	}
}

func newShellLifecycleTestManager(t *testing.T, root string, shellPath string) *Manager {
	manager, _ := newShellLifecycleTestManagerWithRecorder(t, root, shellPath)
	return manager
}

func newShellLifecycleTestManagerWithRecorder(t *testing.T, root string, shellPath string) (*Manager, *shellEventRecorder) {
	t.Helper()

	logger := slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{Level: slog.LevelError}))
	shellInitBaseDir := filepath.Join(t.TempDir(), "shell-init")

	manager := &Manager{
		agentHomeAbs:     root,
		scope:            mustTestFilesystemScope(t, root),
		log:              logger,
		sessionLifecycle: make(map[string]SessionLifecycleRecord),
		workloadReleases: make(map[string]func()),
	}

	manager.term = termgo.NewManager(termgo.ManagerConfig{
		Logger:                        slogTerminalLogger{log: logger},
		EnvProvider:                   termgo.DefaultEnvProvider{},
		ShellResolver:                 fixedShellResolver{shell: shellPath},
		ShellArgsProvider:             termgo.DefaultShellArgsProvider{ShellInitBaseDir: shellInitBaseDir, EnableCommandLifecycle: true},
		ShellInitWriter:               termgo.DefaultShellInitWriter{BaseDir: shellInitBaseDir, EnableCommandLifecycle: true},
		InitialResizeSuppressDuration: 10 * time.Millisecond,
		ResizeSuppressDuration:        10 * time.Millisecond,
	})
	manager.activateSessionFunc = manager.term.ActivateSessionContext
	manager.deleteSessionFunc = manager.deleteSessionNow
	recorder := &shellEventRecorder{delegate: &eventHandler{m: manager}}
	manager.term.SetEventHandler(recorder)

	return manager, recorder
}

func activateShellTestSession(t *testing.T, manager *Manager, terminalSession *termgo.Session) {
	t.Helper()
	if err := terminalSession.AttachSemanticView("shell-integration", "local", 1); err != nil {
		t.Fatalf("AttachSemanticView() error = %v", err)
	}
	terminalSession.EnsureSemanticController("shell-integration", "local", 1)
	attachment, err := terminalSession.AttachSemanticLiveConnection("shell-integration", 1, 80, 24, termgo.LiveSubscriber{})
	if err != nil {
		t.Fatalf("AttachSemanticLiveConnection() error = %v", err)
	}
	t.Cleanup(func() {
		attachment.Detach()
		terminalSession.LogicalDetachSemanticView("shell-integration", 1)
	})
	if err := manager.activateSessionFunc(context.Background(), terminalSession.ID, 80, 24); err != nil {
		t.Fatalf("ActivateSessionContext() error = %v", err)
	}
	if _, err := terminalSession.ApplySemanticControllerSize("shell-integration", 80, 24, true); err != nil {
		t.Fatalf("ApplySemanticControllerSize() error = %v", err)
	}
}

func newIsolatedShellHome(t *testing.T) string {
	t.Helper()

	homeDir := t.TempDir()
	for _, relativePath := range []string{
		".bashrc",
		".bash_profile",
		".profile",
		".zshrc",
		".zprofile",
	} {
		path := filepath.Join(homeDir, relativePath)
		if err := os.WriteFile(path, []byte("# isolated test shell config\n"), 0o644); err != nil {
			t.Fatalf("WriteFile(%q): %v", path, err)
		}
	}
	return homeDir
}

func nextHistorySequence(t *testing.T, session *termgo.Session) uint64 {
	t.Helper()
	presentation, ok := session.LatestPresentation()
	if !ok {
		return 1
	}
	return presentation.Sequence + 1
}

func waitForHistoryContains(t *testing.T, session *termgo.Session, fromSeq uint64, timeout time.Duration, needles ...string) string {
	t.Helper()

	deadline := time.Now().Add(timeout)
	lastOutput := ""
	for time.Now().Before(deadline) {
		output := historyTextFromSequence(t, session, fromSeq)
		lastOutput = output
		if containsAll(output, needles...) {
			return output
		}
		time.Sleep(20 * time.Millisecond)
	}

	t.Fatalf("timeout waiting for history from sequence %d to contain %q; last output: %q", fromSeq, needles, lastOutput)
	return ""
}

func historyTextFromSequence(t *testing.T, session *termgo.Session, fromSeq uint64) string {
	t.Helper()
	presentation, ok := session.LatestPresentation()
	if !ok || presentation.Sequence < fromSeq {
		return ""
	}
	chunk, err := session.ReadSemanticHistory("shell-integration", 1, termgo.SemanticHistoryRequest{
		Direction:    termgo.HistoryEnd,
		ViewportRows: presentation.Geometry.Rows,
	})
	if err != nil {
		t.Fatalf("ReadSemanticHistory() error = %v", err)
	}
	payload := append([]byte(nil), chunk.Payload...)
	for chunk.Continuation != "" {
		chunk, err = session.ReadSemanticHistory("shell-integration", 1, termgo.SemanticHistoryRequest{
			Continuation: chunk.Continuation,
		})
		if err != nil {
			t.Fatalf("ReadSemanticHistory(continuation) error = %v", err)
		}
		payload = append(payload, chunk.Payload...)
	}
	var snapshot struct {
		Version int `json:"v"`
		Frame   struct {
			Rows [][][]json.RawMessage `json:"rows"`
		} `json:"frame"`
	}
	if err := json.Unmarshal(payload, &snapshot); err != nil || snapshot.Version != 1 {
		t.Fatalf("decode semantic history snapshot: version=%d error=%v", snapshot.Version, err)
	}
	var builder strings.Builder
	for _, row := range snapshot.Frame.Rows {
		for _, cell := range row {
			if len(cell) == 0 {
				continue
			}
			var text string
			if err := json.Unmarshal(cell[0], &text); err != nil {
				t.Fatalf("decode semantic history cell: %v", err)
			}
			builder.WriteString(text)
		}
		builder.WriteByte('\n')
	}
	return builder.String()
}

func containsAll(output string, needles ...string) bool {
	for _, needle := range needles {
		if !strings.Contains(output, needle) {
			return false
		}
	}
	return true
}

func assertSemanticOutputOmitsControlSequences(t *testing.T, output string) {
	t.Helper()
	if strings.Contains(output, "\x1b]") || strings.Contains(output, "\x1b[") {
		t.Fatalf("semantic frame exposed terminal control bytes: %q", output)
	}
}

type shellNameUpdate struct {
	sessionID  string
	oldName    string
	newName    string
	workingDir string
}

type shellEventRecorder struct {
	delegate termgo.TerminalEventHandler

	mu             sync.Mutex
	nameUpdates    []shellNameUpdate
	commandUpdates []termgo.TerminalSessionInfo
}

func (r *shellEventRecorder) OnTerminalNameChanged(sessionID string, oldName string, newName string, workingDir string) {
	r.mu.Lock()
	r.nameUpdates = append(r.nameUpdates, shellNameUpdate{
		sessionID:  sessionID,
		oldName:    oldName,
		newName:    newName,
		workingDir: workingDir,
	})
	r.mu.Unlock()

	if r.delegate != nil {
		r.delegate.OnTerminalNameChanged(sessionID, oldName, newName, workingDir)
	}
}

func (r *shellEventRecorder) OnTerminalSessionCreated(session *termgo.Session) {
	if r.delegate != nil {
		r.delegate.OnTerminalSessionCreated(session)
	}
}

func (r *shellEventRecorder) OnTerminalSessionClosed(sessionID string) {
	if r.delegate != nil {
		r.delegate.OnTerminalSessionClosed(sessionID)
	}
}

func (r *shellEventRecorder) OnTerminalError(sessionID string, err error) {
	if r.delegate != nil {
		r.delegate.OnTerminalError(sessionID, err)
	}
}

func (r *shellEventRecorder) OnTerminalSessionMetadataChanged(sessionID string, info termgo.TerminalSessionInfo) {
	r.mu.Lock()
	r.commandUpdates = append(r.commandUpdates, info)
	r.mu.Unlock()
	if delegate, ok := r.delegate.(termgo.TerminalSessionMetadataEventHandler); ok {
		delegate.OnTerminalSessionMetadataChanged(sessionID, info)
	}
}

func waitForForegroundCommand(
	t *testing.T,
	recorder *shellEventRecorder,
	timeout time.Duration,
	sessionID string,
	phase termgo.ForegroundCommandPhase,
	displayName string,
) {
	t.Helper()
	waitForForegroundCommandAfterRevision(t, recorder, timeout, sessionID, 0, phase, displayName)
}

func waitForForegroundCommandAfterRevision(
	t *testing.T,
	recorder *shellEventRecorder,
	timeout time.Duration,
	sessionID string,
	minimumRevision uint64,
	phase termgo.ForegroundCommandPhase,
	displayName string,
) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		recorder.mu.Lock()
		matched := false
		for _, update := range recorder.commandUpdates {
			if update.ID == sessionID && update.ForegroundCommand.Revision > minimumRevision &&
				update.ForegroundCommand.Phase == phase && update.ForegroundCommand.DisplayName == displayName {
				matched = true
				break
			}
		}
		recorder.mu.Unlock()
		if matched {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("timeout waiting for foreground command session=%q revision>%d phase=%q displayName=%q", sessionID, minimumRevision, phase, displayName)
}

func waitForNameUpdate(t *testing.T, recorder *shellEventRecorder, timeout time.Duration, sessionID string, newName string, workingDir string) {
	t.Helper()

	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if recorder.hasNameUpdate(sessionID, newName, workingDir) {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}

	t.Fatalf("timeout waiting for name update session=%q newName=%q workingDir=%q", sessionID, newName, workingDir)
}

func (r *shellEventRecorder) hasNameUpdate(sessionID string, newName string, workingDir string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()

	for _, update := range r.nameUpdates {
		if update.sessionID == sessionID && update.newName == newName && update.workingDir == workingDir {
			return true
		}
	}
	return false
}

func shellSingleQuote(path string) string {
	return "'" + strings.ReplaceAll(path, "'", `'\"'\"'`) + "'"
}

func mustEvalPathForShell(t *testing.T, path string) string {
	t.Helper()

	resolved, err := filepath.EvalSymlinks(path)
	if err != nil {
		t.Fatalf("EvalSymlinks(%q): %v", path, err)
	}
	return filepath.Clean(resolved)
}
