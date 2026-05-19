package codexbridge

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
)

type appServerProcess struct {
	log *slog.Logger

	cmd   *exec.Cmd
	stdin io.WriteCloser
	path  string

	writeMu sync.Mutex

	mu      sync.Mutex
	pending map[string]chan rpcEnvelope
	stderr  []string

	onEnvelope func(rpcEnvelope)
	done       chan error
}

type rpcMethodError struct {
	Method  string
	Code    int
	Message string
	Data    json.RawMessage
}

func (e *rpcMethodError) Error() string {
	if e == nil {
		return ""
	}
	method := strings.TrimSpace(e.Method)
	message := strings.TrimSpace(e.Message)
	if method == "" {
		return message
	}
	if message == "" {
		return method
	}
	return fmt.Sprintf("%s: %s", method, message)
}

func asRPCMethodError(err error) (*rpcMethodError, bool) {
	var target *rpcMethodError
	if !errors.As(err, &target) {
		return nil, false
	}
	return target, true
}

func buildAppServerCommand(shell string, binaryPath string) (*exec.Cmd, error) {
	plan, err := buildAppServerLaunchPlan(shell, binaryPath)
	if err != nil {
		return nil, err
	}
	return commandFromLaunchPlan(plan), nil
}

type appServerLaunchPlan struct {
	BinaryPath string
	Args       []string
	Env        []string
	PATH       string
}

type loginShellEnvSnapshot struct {
	Env  []string
	PATH string
}

func buildAppServerLaunchPlan(shell string, binaryPath string) (*appServerLaunchPlan, error) {
	resolved, err := sanitizeExecutablePath(binaryPath)
	if err != nil {
		return nil, err
	}
	if resolved == "" {
		return nil, errors.New("missing codex binary")
	}
	snapshot, err := captureLoginShellEnvironment(shell)
	if err != nil {
		return nil, err
	}
	env, pathValue := composeAppServerEnv(snapshot.Env, filepath.Dir(resolved))
	if err := validateAppServerRuntime(resolved, pathValue); err != nil {
		return nil, err
	}
	return &appServerLaunchPlan{
		BinaryPath: resolved,
		Args:       []string{resolved, "app-server", "--listen", "stdio://"},
		Env:        env,
		PATH:       pathValue,
	}, nil
}

func commandFromLaunchPlan(plan *appServerLaunchPlan) *exec.Cmd {
	cmd := exec.Command(plan.BinaryPath, plan.Args[1:]...)
	cmd.Env = plan.Env
	return cmd
}

func startAppServerProcess(logger *slog.Logger, shell string, binaryPath string, onEnvelope func(rpcEnvelope)) (*appServerProcess, error) {
	plan, err := buildAppServerLaunchPlan(shell, binaryPath)
	if err != nil {
		return nil, err
	}
	cmd := commandFromLaunchPlan(plan)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return nil, err
	}
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	if err := cmd.Start(); err != nil {
		return nil, errors.Join(ErrUnavailable, fmt.Errorf("start codex app-server: %w", err))
	}
	p := &appServerProcess{
		log:        logger,
		cmd:        cmd,
		stdin:      stdin,
		path:       plan.PATH,
		pending:    make(map[string]chan rpcEnvelope),
		onEnvelope: onEnvelope,
		done:       make(chan error, 1),
	}
	go p.readLoop(stdout)
	go p.stderrLoop(stderr)
	go p.waitLoop()
	return p, nil
}

func (p *appServerProcess) call(ctx context.Context, id string, method string, params any, out any) error {
	if p == nil {
		return errors.New("process not ready")
	}
	respCh := make(chan rpcEnvelope, 1)
	p.mu.Lock()
	p.pending[id] = respCh
	p.mu.Unlock()
	defer func() {
		p.mu.Lock()
		delete(p.pending, id)
		p.mu.Unlock()
	}()

	if err := p.send(rpcEnvelope{
		ID:     json.RawMessage(id),
		Method: method,
		Params: mustJSONRaw(params),
	}); err != nil {
		return err
	}

	select {
	case <-ctx.Done():
		return ctx.Err()
	case err := <-p.done:
		return err
	case resp := <-respCh:
		if resp.Error != nil {
			return &rpcMethodError{
				Method:  method,
				Code:    resp.Error.Code,
				Message: strings.TrimSpace(resp.Error.Message),
				Data:    append(json.RawMessage(nil), resp.Error.Data...),
			}
		}
		if out == nil || len(resp.Result) == 0 {
			return nil
		}
		if err := json.Unmarshal(resp.Result, out); err != nil {
			return err
		}
		return nil
	}
}

func (p *appServerProcess) runtimePATH() string {
	if p == nil {
		return ""
	}
	return strings.TrimSpace(p.path)
}

func (p *appServerProcess) lastStderr() string {
	if p == nil {
		return ""
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	return strings.Join(p.stderr, "\n")
}

func (p *appServerProcess) notify(method string, params any) error {
	return p.send(rpcEnvelope{
		Method: method,
		Params: mustJSONRaw(params),
	})
}

func (p *appServerProcess) respond(id json.RawMessage, result any) error {
	return p.send(rpcEnvelope{
		ID:     id,
		Result: mustJSONRaw(result),
	})
}

func (p *appServerProcess) close() error {
	if p == nil {
		return nil
	}
	_ = p.stdin.Close()
	if p.cmd.Process != nil {
		_ = p.cmd.Process.Kill()
	}
	return nil
}

func (p *appServerProcess) send(msg rpcEnvelope) error {
	if p == nil {
		return errors.New("process not ready")
	}
	b, err := json.Marshal(msg)
	if err != nil {
		return err
	}
	b = append(b, '\n')
	p.writeMu.Lock()
	defer p.writeMu.Unlock()
	if _, err := p.stdin.Write(b); err != nil {
		return err
	}
	return nil
}

func (p *appServerProcess) readLoop(r io.Reader) {
	reader := bufio.NewReader(r)
	for {
		line, err := reader.ReadBytes('\n')
		if len(line) > 0 {
			var env rpcEnvelope
			if uerr := json.Unmarshal(bytesTrimSpace(line), &env); uerr != nil {
				p.log.Warn("codex app-server stdout decode failed", "error", uerr)
			} else {
				p.dispatchEnvelope(env)
			}
		}
		if err != nil {
			if !errors.Is(err, io.EOF) {
				p.signalDone(fmt.Errorf("codex app-server stdout: %w", err))
			}
			return
		}
	}
}

func (p *appServerProcess) stderrLoop(r io.Reader) {
	scanner := bufio.NewScanner(r)
	buf := make([]byte, 0, 64*1024)
	scanner.Buffer(buf, 1024*1024)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		p.appendStderr(line)
		p.log.Warn("codex app-server", "stderr", line)
	}
}

func (p *appServerProcess) appendStderr(line string) {
	if p == nil {
		return
	}
	line = strings.TrimSpace(line)
	if line == "" {
		return
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	const maxLines = 20
	p.stderr = append(p.stderr, line)
	if len(p.stderr) > maxLines {
		p.stderr = append([]string(nil), p.stderr[len(p.stderr)-maxLines:]...)
	}
}

func (p *appServerProcess) waitLoop() {
	err := p.cmd.Wait()
	if err != nil {
		p.signalDone(errors.Join(ErrUnavailable, fmt.Errorf("codex app-server exited: %w", err)))
		return
	}
	p.signalDone(errors.New("codex app-server exited"))
}

func (p *appServerProcess) dispatchEnvelope(env rpcEnvelope) {
	if len(env.ID) > 0 && strings.TrimSpace(env.Method) == "" {
		key := pendingResponseKey(env.ID)
		p.mu.Lock()
		ch := p.pending[key]
		p.mu.Unlock()
		if ch != nil {
			select {
			case ch <- env:
			default:
			}
		}
		return
	}
	if p.onEnvelope != nil {
		p.onEnvelope(env)
	}
}

func (p *appServerProcess) signalDone(err error) {
	select {
	case p.done <- err:
	default:
	}
}

func mustJSONRaw(v any) json.RawMessage {
	if v == nil {
		return nil
	}
	b, _ := json.Marshal(v)
	return b
}

func bytesTrimSpace(b []byte) []byte {
	return []byte(strings.TrimSpace(string(b)))
}

func sanitizeExecutablePath(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", nil
	}
	for _, candidate := range strings.Split(raw, "\n") {
		if path, ok := resolveExecutableCandidate(candidate); ok {
			return path, nil
		}
	}
	return "", fmt.Errorf("codex binary path is not executable: %q", raw)
}

func resolveExecutableCandidate(candidate string) (string, bool) {
	candidate = strings.TrimSpace(candidate)
	if candidate == "" || strings.Contains(candidate, "=") || strings.Contains(candidate, "'") || strings.Contains(candidate, "\"") {
		return "", false
	}
	var path string
	var err error
	if filepath.IsAbs(candidate) || strings.ContainsRune(candidate, filepath.Separator) {
		path = candidate
	} else {
		path, err = exec.LookPath(candidate)
		if err != nil {
			return "", false
		}
	}
	info, err := os.Stat(path)
	if err != nil || info.IsDir() || info.Mode().Perm()&0o111 == 0 {
		return "", false
	}
	return path, true
}

func captureLoginShellEnvironment(shell string) (*loginShellEnvSnapshot, error) {
	shellPath, err := resolveInteractiveLoginShell(shell)
	if err != nil {
		return nil, err
	}
	out, err := exec.Command(shellPath, "-l", "-i", "-c", loginShellEnvCaptureCommand).Output()
	if err != nil {
		return nil, fmt.Errorf("capture login shell environment: %w", err)
	}
	snapshot, err := parseLoginShellEnvironmentOutput(out)
	if err != nil {
		return nil, err
	}
	return snapshot, nil
}

const (
	loginShellEnvBeginMarker    = "__REDEVEN_CODEX_ENV_BEGIN__"
	loginShellEnvEndMarker      = "__REDEVEN_CODEX_ENV_END__"
	loginShellEnvCaptureCommand = `printf '%s\0' '__REDEVEN_CODEX_ENV_BEGIN__'; env -0; printf '%s\0' '__REDEVEN_CODEX_ENV_END__'`
)

func parseLoginShellEnvironmentOutput(out []byte) (*loginShellEnvSnapshot, error) {
	beginIndex := bytes.Index(out, []byte(loginShellEnvBeginMarker))
	if beginIndex < 0 {
		return nil, errors.New("login shell environment marker not found")
	}
	envStart := beginIndex + len(loginShellEnvBeginMarker)
	if envStart >= len(out) || out[envStart] != 0 {
		return nil, errors.New("login shell environment marker is malformed")
	}
	envStart++
	tokens := bytes.Split(out[envStart:], []byte{0})
	env := make([]string, 0, len(tokens))
	foundEnd := false
	for _, token := range tokens {
		value := string(token)
		if value == loginShellEnvEndMarker {
			foundEnd = true
			break
		}
		if value == "" {
			continue
		}
		if !strings.Contains(value, "=") {
			return nil, errors.New("login shell environment contained malformed entry")
		}
		env = append(env, value)
	}
	if !foundEnd {
		return nil, errors.New("login shell environment end marker not found")
	}
	return &loginShellEnvSnapshot{
		Env:  env,
		PATH: envValue(env, "PATH"),
	}, nil
}

func composeAppServerEnv(baseEnv []string, binaryDir string) ([]string, string) {
	pathValue := composeAppServerPath(binaryDir, envValue(baseEnv, "PATH"))
	out := make([]string, 0, len(baseEnv)+1)
	replaced := false
	for _, kv := range baseEnv {
		if envName(kv) == "PATH" {
			out = append(out, "PATH="+pathValue)
			replaced = true
			continue
		}
		out = append(out, kv)
	}
	if !replaced {
		out = append(out, "PATH="+pathValue)
	}
	return out, pathValue
}

func composeAppServerPath(binaryDir string, shellPath string) string {
	binaryDir = strings.TrimSpace(binaryDir)
	shellPath = strings.TrimSpace(shellPath)
	if binaryDir == "" {
		return shellPath
	}
	if shellPath == "" {
		return binaryDir
	}
	return binaryDir + string(os.PathListSeparator) + shellPath
}

func validateAppServerRuntime(binaryPath string, pathValue string) error {
	if !isNodeEnvShim(binaryPath) {
		return nil
	}
	if lookPathInPath("node", pathValue) != "" {
		return nil
	}
	return errors.Join(
		ErrUnavailable,
		errors.New("host codex binary is a Node.js shim, but `node` is not available in the app-server PATH"),
	)
}

func isNodeEnvShim(binaryPath string) bool {
	f, err := os.Open(binaryPath)
	if err != nil {
		return false
	}
	defer f.Close()
	reader := bufio.NewReader(f)
	line, err := reader.ReadString('\n')
	if err != nil && !errors.Is(err, io.EOF) {
		return false
	}
	line = strings.TrimSpace(line)
	return strings.HasPrefix(line, "#!") &&
		strings.Contains(line, "/env") &&
		strings.Contains(line, "node")
}

func lookPathInPath(binaryName string, pathValue string) string {
	binaryName = strings.TrimSpace(binaryName)
	pathValue = strings.TrimSpace(pathValue)
	if binaryName == "" || pathValue == "" {
		return ""
	}
	for _, dir := range filepath.SplitList(pathValue) {
		dir = strings.TrimSpace(dir)
		if dir == "" {
			continue
		}
		candidate := filepath.Join(dir, binaryName)
		info, err := os.Stat(candidate)
		if err != nil || info.IsDir() || info.Mode().Perm()&0o111 == 0 {
			continue
		}
		return candidate
	}
	return ""
}

func resolveInteractiveLoginShell(shell string) (string, error) {
	if shellPath, ok := resolveShellPath(strings.TrimSpace(shell)); ok {
		return shellPath, nil
	}
	if shellPath, ok := resolveShellPath(strings.TrimSpace(os.Getenv("SHELL"))); ok {
		return shellPath, nil
	}
	shellPath, err := exec.LookPath("bash")
	if err != nil {
		return "", fmt.Errorf("resolve login shell: %w", err)
	}
	return shellPath, nil
}

func resolveShellPath(shell string) (string, bool) {
	if shell == "" {
		return "", false
	}
	shellPath, err := exec.LookPath(shell)
	if err != nil {
		return "", false
	}
	return shellPath, true
}

func envValue(env []string, name string) string {
	name = strings.TrimSpace(name)
	if name == "" {
		return ""
	}
	for _, kv := range env {
		if envName(kv) == name {
			return strings.TrimPrefix(kv, name+"=")
		}
	}
	return ""
}

func envName(kv string) string {
	if index := strings.Index(kv, "="); index >= 0 {
		return kv[:index]
	}
	return kv
}
