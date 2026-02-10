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
	"strconv"
	"strings"
	"sync"

	sidecarfs "github.com/floegence/redeven-agent/internal/ai/sidecar"
)

type sidecarProcess struct {
	log *slog.Logger

	closeOnce sync.Once

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
	p.closeOnce.Do(func() {
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
	})
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

const (
	aiSidecarNodeEnvVar   = "REDEVEN_AI_NODE_BIN"
	aiSidecarNodeMinMajor = 20
)

func resolveAISidecarNodeBin(stateDir string) (string, error) {
	candidates := aiSidecarNodeCandidates(stateDir)
	failures := make([]string, 0, len(candidates))

	for _, candidate := range candidates {
		raw := strings.TrimSpace(candidate)
		if raw == "" {
			continue
		}

		resolved := raw
		if !filepath.IsAbs(resolved) {
			p, err := exec.LookPath(resolved)
			if err != nil {
				failures = append(failures, fmt.Sprintf("%s: not found", raw))
				continue
			}
			resolved = p
		}

		version, major, err := probeNodeVersionMajor(resolved)
		if err != nil {
			failures = append(failures, fmt.Sprintf("%s: %v", resolved, err))
			continue
		}
		if major < aiSidecarNodeMinMajor {
			failures = append(failures, fmt.Sprintf("%s: unsupported version %s", resolved, version))
			continue
		}
		return resolved, nil
	}

	detail := "no node candidate found"
	if len(failures) > 0 {
		detail = strings.Join(failures, "; ")
	}
	return "", fmt.Errorf("node >= %d is required for AI sidecar (%s)", aiSidecarNodeMinMajor, detail)
}

func aiSidecarNodeCandidates(stateDir string) []string {
	out := make([]string, 0, 6)
	seen := make(map[string]struct{}, 6)
	appendUnique := func(path string) {
		p := strings.TrimSpace(path)
		if p == "" {
			return
		}
		if _, ok := seen[p]; ok {
			return
		}
		seen[p] = struct{}{}
		out = append(out, p)
	}

	appendUnique(os.Getenv(aiSidecarNodeEnvVar))

	if p, err := exec.LookPath("node"); err == nil {
		appendUnique(p)
	}

	trimmedStateDir := strings.TrimSpace(stateDir)
	if trimmedStateDir != "" {
		appendUnique(filepath.Join(trimmedStateDir, "runtime", "node", "current", "bin", "node"))

		parent := filepath.Dir(trimmedStateDir)
		if filepath.Base(parent) == "envs" {
			rootStateDir := filepath.Dir(parent)
			appendUnique(filepath.Join(rootStateDir, "runtime", "node", "current", "bin", "node"))
		}
	}

	if home, err := os.UserHomeDir(); err == nil && strings.TrimSpace(home) != "" {
		appendUnique(filepath.Join(home, ".redeven", "runtime", "node", "current", "bin", "node"))
	}

	return out
}

func probeNodeVersionMajor(nodeBin string) (string, int, error) {
	trimmed := strings.TrimSpace(nodeBin)
	if trimmed == "" {
		return "", 0, errors.New("empty node path")
	}

	st, err := os.Stat(trimmed)
	if err != nil {
		return "", 0, err
	}
	if st.IsDir() {
		return "", 0, errors.New("path is a directory")
	}
	if st.Mode()&0o111 == 0 {
		return "", 0, errors.New("path is not executable")
	}

	out, err := exec.Command(trimmed, "-v").Output()
	if err != nil {
		return "", 0, fmt.Errorf("probe failed: %w", err)
	}
	version := strings.TrimSpace(string(out))
	major, ok := parseNodeMajor(version)
	if !ok {
		return "", 0, fmt.Errorf("invalid version output %q", version)
	}
	return version, major, nil
}

func parseNodeMajor(version string) (int, bool) {
	trimmed := strings.TrimSpace(version)
	if trimmed == "" {
		return 0, false
	}
	trimmed = strings.TrimPrefix(trimmed, "v")

	majorPart := trimmed
	if idx := strings.IndexByte(trimmed, '.'); idx >= 0 {
		majorPart = trimmed[:idx]
	}
	if majorPart == "" {
		return 0, false
	}

	major, err := strconv.Atoi(majorPart)
	if err != nil || major <= 0 {
		return 0, false
	}
	return major, true
}

func startSidecar(ctx context.Context, log *slog.Logger, stateDir string, env []string, scriptPathOverride string) (*sidecarProcess, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	if log == nil {
		log = slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	}

	scriptPath := strings.TrimSpace(scriptPathOverride)
	if scriptPath == "" {
		var err error
		scriptPath, err = materializeSidecar(stateDir)
		if err != nil {
			return nil, err
		}
	}

	nodeBin, err := resolveAISidecarNodeBin(stateDir)
	if err != nil {
		return nil, err
	}
	log.Debug("ai sidecar node resolved", "component", "ai_sidecar", "node_bin", nodeBin)

	cmd := exec.CommandContext(ctx, nodeBin, scriptPath)
	if len(env) > 0 {
		cmd.Env = env
	}
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
			attrs := []any{"component", "ai_sidecar", "line", line}
			if runID := parseRunIDFromSidecarLog(line); runID != "" {
				attrs = append(attrs, "run_id", runID)
			}
			log.Debug("ai sidecar", attrs...)
		}
		if err := r.Err(); err != nil {
			log.Warn("ai sidecar stderr scan failed", "component", "ai_sidecar", "error", err)
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

func parseRunIDFromSidecarLog(line string) string {
	line = strings.TrimSpace(line)
	if line == "" {
		return ""
	}
	const key = "run_id="
	idx := strings.Index(line, key)
	if idx < 0 {
		return ""
	}
	rest := line[idx+len(key):]
	if rest == "" {
		return ""
	}
	end := len(rest)
	for i, r := range rest {
		switch r {
		case ' ', '\t', ',', ';', '"', '\'', ']':
			end = i
			goto DONE
		}
	}
DONE:
	return strings.TrimSpace(rest[:end])
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
