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

const (
	codexHomeEnvKey     = "CODEX_HOME"
	codexDefaultDirName = ".codex"
	codexDesktopDirName = ".codex-cc"
	codexAuthFileName   = "auth.json"
)

func buildAppServerCommand(binaryPath string) (*exec.Cmd, error) {
	if strings.TrimSpace(binaryPath) == "" {
		return nil, errors.New("missing codex binary")
	}
	codexHomeDir, err := resolveCodexHomeDir()
	if err != nil {
		return nil, err
	}
	cmd := exec.Command("bash", "-lc", `exec "$0" app-server --listen stdio://`, binaryPath)
	cmd.Env = upsertEnv(os.Environ(), codexHomeEnvKey, codexHomeDir)
	return cmd, nil
}

func startAppServerProcess(logger *slog.Logger, binaryPath string, onEnvelope func(rpcEnvelope)) (*appServerProcess, error) {
	cmd, err := buildAppServerCommand(binaryPath)
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
		return nil, err
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
			return fmt.Errorf("%s: %s", method, strings.TrimSpace(resp.Error.Message))
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
		p.signalDone(fmt.Errorf("codex app-server exited: %w", err))
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

func resolveCodexHomeDir() (string, error) {
	if explicit, ok := lookupEnv(os.Environ(), codexHomeEnvKey); ok {
		return explicit, nil
	}
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("resolve %s: %w", codexHomeEnvKey, err)
	}
	defaultHome := filepath.Join(homeDir, codexDefaultDirName)
	if codexHomeHasAuth(defaultHome) {
		return defaultHome, nil
	}
	desktopHome := filepath.Join(homeDir, codexDesktopDirName)
	if codexHomeHasAuth(desktopHome) {
		return desktopHome, nil
	}
	return defaultHome, nil
}

func lookupEnv(env []string, key string) (string, bool) {
	prefix := key + "="
	for _, entry := range env {
		if !strings.HasPrefix(entry, prefix) {
			continue
		}
		value := strings.TrimSpace(strings.TrimPrefix(entry, prefix))
		if value == "" {
			return "", false
		}
		return value, true
	}
	return "", false
}

func upsertEnv(env []string, key string, value string) []string {
	prefix := key + "="
	next := make([]string, 0, len(env)+1)
	replaced := false
	for _, entry := range env {
		if strings.HasPrefix(entry, prefix) {
			if !replaced {
				next = append(next, prefix+value)
				replaced = true
			}
			continue
		}
		next = append(next, entry)
	}
	if !replaced {
		next = append(next, prefix+value)
	}
	return next
}

func codexHomeHasAuth(dir string) bool {
	info, err := os.Stat(filepath.Join(dir, codexAuthFileName))
	if err != nil {
		return false
	}
	return !info.IsDir()
}
