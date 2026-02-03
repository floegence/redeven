package ai

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	sidecarfs "github.com/floegence/redeven-agent/internal/ai/sidecar"
)

type sidecarProcess struct {
	log *slog.Logger

	cmd    *exec.Cmd
	stdin  io.WriteCloser
	stdout io.ReadCloser
	stderr io.ReadCloser

	scanner *bufio.Scanner
	enc     *json.Encoder
}

func (p *sidecarProcess) close() {
	if p == nil {
		return
	}
	if p.stdin != nil {
		_ = p.stdin.Close()
	}
	if p.stdout != nil {
		_ = p.stdout.Close()
	}
	if p.stderr != nil {
		_ = p.stderr.Close()
	}
	if p.cmd != nil && p.cmd.Process != nil {
		_ = p.cmd.Process.Kill()
		_, _ = p.cmd.Process.Wait()
	}
}

func (p *sidecarProcess) send(method string, params any) error {
	if p == nil || p.enc == nil {
		return errors.New("sidecar not ready")
	}
	msg := map[string]any{
		"jsonrpc": "2.0",
		"method":  method,
		"params":  params,
	}
	return p.enc.Encode(msg)
}

type sidecarInbound struct {
	JSONRPC string          `json:"jsonrpc"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params"`
	ID      any             `json:"id,omitempty"`
	Result  json.RawMessage `json:"result,omitempty"`
	Error   *struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

func (p *sidecarProcess) recv() (*sidecarInbound, error) {
	if p == nil || p.scanner == nil {
		return nil, errors.New("sidecar not ready")
	}
	if !p.scanner.Scan() {
		if err := p.scanner.Err(); err != nil {
			return nil, err
		}
		return nil, io.EOF
	}
	line := strings.TrimSpace(p.scanner.Text())
	if line == "" {
		return nil, errors.New("invalid sidecar frame (empty)")
	}
	var msg sidecarInbound
	if err := json.Unmarshal([]byte(line), &msg); err != nil {
		return nil, fmt.Errorf("invalid sidecar json: %w", err)
	}
	return &msg, nil
}

func startSidecar(ctx context.Context, log *slog.Logger, stateDir string) (*sidecarProcess, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	if log == nil {
		log = slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	}

	scriptPath, err := materializeSidecar(stateDir)
	if err != nil {
		return nil, err
	}

	cmd := exec.CommandContext(ctx, "node", scriptPath)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		_ = stdin.Close()
		return nil, err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		_ = stdin.Close()
		_ = stdout.Close()
		return nil, err
	}

	if err := cmd.Start(); err != nil {
		_ = stdin.Close()
		_ = stdout.Close()
		_ = stderr.Close()
		return nil, err
	}

	// Sidecar logs must go to stderr only.
	go func() {
		r := bufio.NewScanner(stderr)
		for r.Scan() {
			line := strings.TrimSpace(r.Text())
			if line == "" {
				continue
			}
			log.Debug("ai sidecar", "line", line)
		}
	}()

	sc := bufio.NewScanner(stdout)
	// Allow reasonably large frames (tool results / model deltas).
	sc.Buffer(make([]byte, 0, 64<<10), 2<<20)

	enc := json.NewEncoder(stdin)
	enc.SetEscapeHTML(false)

	return &sidecarProcess{
		log:     log,
		cmd:     cmd,
		stdin:   stdin,
		stdout:  stdout,
		stderr:  stderr,
		scanner: sc,
		enc:     enc,
	}, nil
}

func materializeSidecar(stateDir string) (string, error) {
	stateDir = strings.TrimSpace(stateDir)
	if stateDir == "" {
		return "", errors.New("missing stateDir")
	}

	dstDir := filepath.Join(stateDir, "ai", "sidecar")
	if err := os.MkdirAll(dstDir, 0o700); err != nil {
		return "", err
	}
	dst := filepath.Join(dstDir, "sidecar.mjs")

	b, err := fsReadFile(sidecarfs.DistFS(), "sidecar.mjs")
	if err != nil {
		return "", err
	}

	// Best-effort: avoid rewriting when unchanged.
	if existing, err := os.ReadFile(dst); err == nil && bytes.Equal(existing, b) {
		return dst, nil
	}
	tmp := dst + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return "", err
	}
	if err := os.Rename(tmp, dst); err != nil {
		return "", err
	}
	return dst, nil
}

func fsReadFile(fsys fs.FS, name string) ([]byte, error) {
	if fsys == nil {
		return nil, errors.New("nil fs")
	}
	b, err := fs.ReadFile(fsys, name)
	if err != nil {
		return nil, err
	}
	if len(b) == 0 {
		return nil, errors.New("empty sidecar bundle")
	}
	return b, nil
}
