package codexbridge

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os/exec"
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

func startAppServerProcess(logger *slog.Logger, binaryPath string, onEnvelope func(rpcEnvelope)) (*appServerProcess, error) {
	if strings.TrimSpace(binaryPath) == "" {
		return nil, errors.New("missing codex binary")
	}
	cmd := exec.Command(binaryPath, "app-server", "--listen", "stdio://")
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
