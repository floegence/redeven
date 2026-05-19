package codexbridge

import (
	"bufio"
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

	writeMu sync.Mutex

	mu      sync.Mutex
	pending map[string]chan rpcEnvelope

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
	resolved, err := sanitizeExecutablePath(binaryPath)
	if err != nil {
		return nil, err
	}
	if resolved == "" {
		return nil, errors.New("missing codex binary")
	}
	cmd := exec.Command(resolved, "app-server", "--listen", "stdio://")
	cmd.Env = environWithPath(composeAppServerPath(filepath.Dir(resolved), loginShellPath(shell)))
	return cmd, nil
}

func startAppServerProcess(logger *slog.Logger, shell string, binaryPath string, onEnvelope func(rpcEnvelope)) (*appServerProcess, error) {
	cmd, err := buildAppServerCommand(shell, binaryPath)
	if err != nil {
		return nil, err
	}
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
		p.log.Warn("codex app-server", "stderr", line)
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

func loginShellPath(shell string) string {
	shellPath, err := resolveInteractiveLoginShell(shell)
	if err != nil {
		return ""
	}
	out, err := exec.Command(shellPath, "-l", "-i", "-c", `printf '__REDEVEN_CODEX_ENV_PATH__%s\n' "$PATH"`).Output()
	if err != nil {
		return ""
	}
	const marker = "__REDEVEN_CODEX_ENV_PATH__"
	for _, line := range strings.Split(string(out), "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, marker) {
			return strings.TrimSpace(strings.TrimPrefix(line, marker))
		}
	}
	return ""
}

func composeAppServerPath(binaryDir string, shellPath string) string {
	binaryDir = strings.TrimSpace(binaryDir)
	shellPath = strings.TrimSpace(shellPath)
	if binaryDir == "" {
		return shellPath
	}
	if shellPath == "" {
		shellPath = os.Getenv("PATH")
	}
	if shellPath == "" {
		return binaryDir
	}
	return binaryDir + string(os.PathListSeparator) + shellPath
}

func environWithPath(pathValue string) []string {
	pathValue = strings.TrimSpace(pathValue)
	if pathValue == "" {
		return nil
	}
	env := os.Environ()
	out := make([]string, 0, len(env)+1)
	replaced := false
	for _, kv := range env {
		if strings.HasPrefix(kv, "PATH=") {
			out = append(out, "PATH="+pathValue)
			replaced = true
			continue
		}
		out = append(out, kv)
	}
	if !replaced {
		out = append(out, "PATH="+pathValue)
	}
	return out
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
