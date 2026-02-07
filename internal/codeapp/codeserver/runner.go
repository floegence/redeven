package codeserver

import (
	"bufio"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type RunnerOptions struct {
	Logger   *slog.Logger
	StateDir string

	PortMin int
	PortMax int
}

type Runner struct {
	log      *slog.Logger
	stateDir string
	portMin  int
	portMax  int

	mu        sync.Mutex
	instances map[string]*Instance // code_space_id -> instance

	// startLocks prevents concurrent double-starts for the same code_space_id.
	// It intentionally grows with ids and is never pruned to avoid lock lifecycle races.
	startLocks map[string]*sync.Mutex
}

type Instance struct {
	CodeSpaceID   string    `json:"code_space_id"`
	WorkspacePath string    `json:"workspace_path"`
	Port          int       `json:"port"`
	PID           int       `json:"pid"`
	StartedAt     time.Time `json:"started_at"`

	cmd *exec.Cmd
}

func NewRunner(opts RunnerOptions) *Runner {
	logger := opts.Logger
	if logger == nil {
		logger = slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	}
	return &Runner{
		log:        logger,
		stateDir:   strings.TrimSpace(opts.StateDir),
		portMin:    opts.PortMin,
		portMax:    opts.PortMax,
		instances:  make(map[string]*Instance),
		startLocks: make(map[string]*sync.Mutex),
	}
}

func (r *Runner) Get(codeSpaceID string) (*Instance, bool) {
	if r == nil {
		return nil, false
	}
	id := strings.TrimSpace(codeSpaceID)
	r.mu.Lock()
	defer r.mu.Unlock()
	ins, ok := r.instances[id]
	if !ok || ins == nil {
		return nil, false
	}
	if ins.cmd == nil || ins.cmd.Process == nil {
		return nil, false
	}
	// Best-effort liveness check.
	if !isPortListening(ins.Port) {
		return nil, false
	}
	return ins, true
}

func (r *Runner) EnsureRunning(codeSpaceID string, workspacePath string, desiredPort int) (*Instance, error) {
	if r == nil {
		return nil, errors.New("nil runner")
	}
	id := strings.TrimSpace(codeSpaceID)
	workspacePath = strings.TrimSpace(workspacePath)
	if id == "" || workspacePath == "" {
		return nil, errors.New("invalid args")
	}

	// Prevent concurrent double-starts for the same code_space_id.
	lk := r.lockStart(id)
	defer lk.Unlock()

	r.mu.Lock()
	if ins, ok := r.instances[id]; ok && ins != nil && ins.cmd != nil && ins.cmd.Process != nil && isPortListening(ins.Port) {
		r.mu.Unlock()
		return ins, nil
	}
	r.mu.Unlock()

	port := desiredPort
	if port <= 0 || port > 65535 || !isPortFree(port) {
		p, err := pickFreePortInRange(r.portMin, r.portMax)
		if err != nil {
			return nil, err
		}
		port = p
	}

	ins, err := r.start(id, workspacePath, port)
	if err != nil {
		return nil, err
	}

	r.mu.Lock()
	r.instances[id] = ins
	r.mu.Unlock()

	return ins, nil
}

func (r *Runner) lockStart(codeSpaceID string) *sync.Mutex {
	id := strings.TrimSpace(codeSpaceID)
	if id == "" {
		// Fallback lock for invalid ids; should not happen because callers validate.
		id = "_"
	}

	r.mu.Lock()
	lk := r.startLocks[id]
	if lk == nil {
		lk = &sync.Mutex{}
		r.startLocks[id] = lk
	}
	r.mu.Unlock()

	lk.Lock()
	return lk
}

func (r *Runner) Stop(codeSpaceID string) error {
	if r == nil {
		return nil
	}
	id := strings.TrimSpace(codeSpaceID)
	if id == "" {
		return errors.New("missing codeSpaceID")
	}

	lk := r.lockStart(id)
	defer lk.Unlock()

	r.mu.Lock()
	ins := r.instances[id]
	delete(r.instances, id)
	r.mu.Unlock()

	if ins == nil || ins.cmd == nil || ins.cmd.Process == nil {
		return nil
	}

	// Hard stop: code-server is behind E2EE, so we can keep process management simple for MVP.
	_ = killCmdProcessGroup(ins.cmd)
	_, _ = ins.cmd.Process.Wait()
	return nil
}

func (r *Runner) StopAll() error {
	if r == nil {
		return nil
	}
	r.mu.Lock()
	ids := make([]string, 0, len(r.instances))
	for id := range r.instances {
		ids = append(ids, id)
	}
	r.mu.Unlock()

	for _, id := range ids {
		_ = r.Stop(id)
	}
	return nil
}

func (r *Runner) start(codeSpaceID string, workspacePath string, port int) (*Instance, error) {
	if port <= 0 || port > 65535 {
		return nil, errors.New("invalid port")
	}
	if err := validateWorkspacePath(workspacePath); err != nil {
		return nil, err
	}

	bin, err := ResolveBinary()
	if err != nil {
		return nil, err
	}
	execPath, prefixArgs, err := resolveCodeServerExec(bin)
	if err != nil {
		return nil, err
	}

	spaceDir := filepath.Join(strings.TrimSpace(r.stateDir), "apps", "code", "spaces", codeSpaceID, "codeserver")
	userDataDir := filepath.Join(spaceDir, "user-data")
	extensionsDir := filepath.Join(spaceDir, "extensions")
	xdgConfigDir := filepath.Join(spaceDir, "xdg-config")
	xdgCacheDir := filepath.Join(spaceDir, "xdg-cache")
	xdgDataDir := filepath.Join(spaceDir, "xdg-data")

	for _, dir := range []string{userDataDir, extensionsDir, xdgConfigDir, xdgCacheDir, xdgDataDir} {
		if err := os.MkdirAll(dir, 0o700); err != nil {
			return nil, err
		}
	}

	// code-server defaults the session socket to:
	//   <user-data-dir>/code-server-ipc.sock
	// That path can easily exceed the OS limit for Unix domain sockets (notably on macOS),
	// causing EINVAL and making the extension host unstable. Keep it short and stable.
	safeID := strings.TrimSpace(codeSpaceID)
	safeID = strings.ReplaceAll(safeID, "/", "_")
	safeID = strings.ReplaceAll(safeID, "\\", "_")
	sessionSocketDir := filepath.Join(strings.TrimSpace(r.stateDir), "socks")
	if err := os.MkdirAll(sessionSocketDir, 0o700); err != nil {
		return nil, err
	}
	sessionSocketPath := filepath.Join(sessionSocketDir, fmt.Sprintf("cs-%s.sock", safeID))
	_ = os.Remove(sessionSocketPath) // best-effort cleanup of a stale socket

	stdoutPath := filepath.Join(spaceDir, "stdout.log")
	stderrPath := filepath.Join(spaceDir, "stderr.log")
	stdout, _ := os.OpenFile(stdoutPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	stderr, _ := os.OpenFile(stderrPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)

	args := append([]string{}, prefixArgs...)
	args = append(args,
		"--bind-addr", fmt.Sprintf("127.0.0.1:%d", port),
		"--auth", "none",
		// The codespace is only reachable via the agent gateway (localhost) and/or Flowersec E2EE proxy.
		// Disable the VS Code server connection token to avoid cookie/Service Worker edge cases in sandbox origins.
		// (code-server itself documents this flag as safe when the connection is secured by other means.)
		"--without-connection-token",
		"--disable-telemetry",
		"--disable-update-check",
		"--user-data-dir", userDataDir,
		"--extensions-dir", extensionsDir,
		"--session-socket", sessionSocketPath,
		workspacePath,
	)
	cmd := exec.Command(execPath, args...)
	cmd.Dir = workspacePath
	if stdout != nil {
		cmd.Stdout = stdout
	}
	if stderr != nil {
		cmd.Stderr = stderr
	}

	env := os.Environ()
	env = append(env,
		"XDG_CONFIG_HOME="+xdgConfigDir,
		"XDG_CACHE_HOME="+xdgCacheDir,
		"XDG_DATA_HOME="+xdgDataDir,
	)
	cmd.Env = env

	r.log.Info("starting code-server", "code_space_id", codeSpaceID, "port", port, "workspace", filepath.Base(workspacePath), "session_socket", sessionSocketPath)
	// Put the child in its own process group so we can reliably stop code-server and its children.
	setCmdProcessGroup(cmd)
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	// The child process has its own FD, so close ours to avoid FD leaks in the long-running agent.
	if stdout != nil {
		_ = stdout.Close()
	}
	if stderr != nil {
		_ = stderr.Close()
	}

	if err := waitForPort("127.0.0.1", port, 2*time.Second); err != nil {
		_ = killCmdProcessGroup(cmd)
		_, _ = cmd.Process.Wait()
		return nil, err
	}

	return &Instance{
		CodeSpaceID:   codeSpaceID,
		WorkspacePath: workspacePath,
		Port:          port,
		PID:           cmd.Process.Pid,
		StartedAt:     time.Now(),
		cmd:           cmd,
	}, nil
}

func validateWorkspacePath(p string) error {
	p = strings.TrimSpace(p)
	if p == "" {
		return errors.New("missing workspace path")
	}
	fi, err := os.Stat(p)
	if err != nil {
		return err
	}
	if !fi.IsDir() {
		return errors.New("workspace path is not a directory")
	}
	_, err = os.ReadDir(p)
	if err != nil {
		return err
	}
	return nil
}

func waitForPort(host string, port int, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if isPortListening(port) {
			return nil
		}
		time.Sleep(200 * time.Millisecond)
	}
	return fmt.Errorf("code-server did not start listening on %s:%d", host, port)
}

func resolveCodeServerExec(bin string) (execPath string, prefixArgs []string, err error) {
	bin = strings.TrimSpace(bin)
	if bin == "" {
		return "", nil, errors.New("missing code-server binary")
	}
	// Default: execute the resolved binary directly.
	execPath = bin

	// Homebrew and some distributions install code-server as a Node.js script with a shebang that
	// points to a specific node binary. When that interpreter is missing/broken, executing the
	// script directly will fail. To make the agent robust, we detect node shebangs and run the
	// script through `node` (or an explicit override).
	f, err := os.Open(bin)
	if err != nil {
		return "", nil, err
	}
	defer f.Close()

	rd := bufio.NewReader(f)
	line, err := rd.ReadString('\n')
	if err != nil && !errors.Is(err, io.EOF) {
		return "", nil, err
	}
	line = strings.TrimSpace(line)
	if !strings.HasPrefix(line, "#!") {
		return execPath, nil, nil
	}

	raw := strings.TrimSpace(strings.TrimPrefix(line, "#!"))
	fields := strings.Fields(raw)
	if len(fields) == 0 {
		return execPath, nil, nil
	}

	interpBase := strings.ToLower(filepath.Base(fields[0]))
	isNodeShebang := strings.Contains(interpBase, "node")
	if interpBase == "env" && len(fields) >= 2 {
		isNodeShebang = isNodeShebang || strings.Contains(strings.ToLower(fields[1]), "node")
	}
	if !isNodeShebang {
		return execPath, nil, nil
	}

	nodeBin := strings.TrimSpace(os.Getenv("REDEVEN_CODE_SERVER_NODE_BIN"))
	if nodeBin == "" {
		p, err := exec.LookPath("node")
		if err != nil {
			return "", nil, errors.New("code-server is a node script but node is not found in PATH (set REDEVEN_CODE_SERVER_NODE_BIN)")
		}
		nodeBin = p
	}
	if !filepath.IsAbs(nodeBin) {
		if a, err := filepath.Abs(nodeBin); err == nil {
			nodeBin = a
		}
	}

	return nodeBin, []string{bin}, nil
}
