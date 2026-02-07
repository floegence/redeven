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
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

type RunnerOptions struct {
	Logger   *slog.Logger
	StateDir string

	PortMin int
	PortMax int

	// ReconnectionGrace controls VSCODE_RECONNECTION_GRACE_TIME for code-server.
	// When <= 0, code-server keeps its upstream default.
	ReconnectionGrace time.Duration
}

type Runner struct {
	log               *slog.Logger
	stateDir          string
	portMin           int
	portMax           int
	reconnectionGrace time.Duration

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
		log:               logger,
		stateDir:          strings.TrimSpace(opts.StateDir),
		portMin:           opts.PortMin,
		portMax:           opts.PortMax,
		reconnectionGrace: normalizePositiveDuration(opts.ReconnectionGrace),
		instances:         make(map[string]*Instance),
		startLocks:        make(map[string]*sync.Mutex),
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
	sessionSocketPath := r.sessionSocketPathForCodeSpace(id)

	if ins == nil || ins.cmd == nil || ins.cmd.Process == nil {
		_, _ = r.killStaleCodeServerProcessesBySessionSocket(sessionSocketPath)
		return nil
	}

	// Hard stop: code-server is behind E2EE, so we can keep process management simple for MVP.
	_ = killCmdProcessGroup(ins.cmd)
	_, _ = ins.cmd.Process.Wait()
	_, _ = r.killStaleCodeServerProcessesBySessionSocket(sessionSocketPath)
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
	startupTimeout := 20 * time.Second
	if v := strings.TrimSpace(os.Getenv("REDEVEN_CODE_SERVER_STARTUP_TIMEOUT")); v != "" {
		if d, err := time.ParseDuration(v); err != nil {
			r.log.Warn("invalid REDEVEN_CODE_SERVER_STARTUP_TIMEOUT; using default", "value", v, "err", err)
		} else if d <= 0 {
			r.log.Warn("invalid REDEVEN_CODE_SERVER_STARTUP_TIMEOUT; using default", "value", v)
		} else {
			startupTimeout = d
		}
	}
	reconnectionGrace := r.resolveReconnectionGrace()

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
	sessionSocketPath := r.sessionSocketPathForCodeSpace(codeSpaceID)
	sessionSocketDir := filepath.Dir(sessionSocketPath)
	if err := os.MkdirAll(sessionSocketDir, 0o700); err != nil {
		return nil, err
	}
	_ = os.Remove(sessionSocketPath) // best-effort cleanup of a stale socket

	if killed, err := r.killStaleCodeServerProcessesBySessionSocket(sessionSocketPath); err != nil {
		r.log.Warn("failed to cleanup stale code-server processes", "code_space_id", codeSpaceID, "session_socket", sessionSocketPath, "error", err)
	} else if killed > 0 {
		r.log.Warn("killed stale code-server process(es)", "code_space_id", codeSpaceID, "session_socket", sessionSocketPath, "count", killed)
	}
	workspaceStoragePath := filepath.Join(userDataDir, "User", "workspaceStorage")
	if removed, err := cleanupWorkspaceStorageLocks(workspaceStoragePath); err != nil {
		r.log.Warn("failed to cleanup workspace storage locks", "code_space_id", codeSpaceID, "path", workspaceStoragePath, "error", err)
	} else if removed > 0 {
		r.log.Info("cleaned workspace storage lock(s)", "code_space_id", codeSpaceID, "path", workspaceStoragePath, "count", removed)
	}

	stdoutPath := filepath.Join(spaceDir, "stdout.log")
	stderrPath := filepath.Join(spaceDir, "stderr.log")
	stdout, _ := os.OpenFile(stdoutPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	stderr, _ := os.OpenFile(stderrPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)

	args := append([]string{}, prefixArgs...)
	args = append(args,
		"--bind-addr", fmt.Sprintf("127.0.0.1:%d", port),
		"--auth", "none",
		// The codespace is only reachable via the agent gateway (localhost) and/or Flowersec E2EE proxy.
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
	if reconnectionGrace > 0 {
		env = append(env, "VSCODE_RECONNECTION_GRACE_TIME="+formatReconnectionGraceMilliseconds(reconnectionGrace))
	}
	cmd.Env = env

	attrs := []any{
		"code_space_id", codeSpaceID,
		"port", port,
		"workspace", filepath.Base(workspacePath),
		"session_socket", sessionSocketPath,
	}
	if reconnectionGrace > 0 {
		attrs = append(attrs, "reconnection_grace", formatReconnectionGraceMilliseconds(reconnectionGrace))
	}
	r.log.Info("starting code-server", attrs...)
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

	if err := waitForPort("127.0.0.1", port, startupTimeout); err != nil {
		_ = killCmdProcessGroup(cmd)
		_, _ = cmd.Process.Wait()
		return nil, enrichStartError(err, stdoutPath, stderrPath, execPath, prefixArgs)
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

func normalizePositiveDuration(v time.Duration) time.Duration {
	if v <= 0 {
		return 0
	}
	return v
}

func formatReconnectionGraceMilliseconds(v time.Duration) string {
	d := normalizePositiveDuration(v)
	if d <= 0 {
		return ""
	}
	ms := d.Milliseconds()
	if ms <= 0 {
		ms = 1
	}
	return fmt.Sprintf("%dms", ms)
}

func (r *Runner) resolveReconnectionGrace() time.Duration {
	grace := normalizePositiveDuration(r.reconnectionGrace)
	raw := strings.TrimSpace(os.Getenv("REDEVEN_CODE_SERVER_RECONNECTION_GRACE_TIME"))
	if raw == "" {
		return grace
	}

	v, err := time.ParseDuration(raw)
	if err != nil {
		if r != nil && r.log != nil {
			r.log.Warn("invalid REDEVEN_CODE_SERVER_RECONNECTION_GRACE_TIME; using default", "value", raw, "err", err)
		}
		return grace
	}
	v = normalizePositiveDuration(v)
	if v <= 0 {
		if r != nil && r.log != nil {
			r.log.Warn("invalid REDEVEN_CODE_SERVER_RECONNECTION_GRACE_TIME; using default", "value", raw)
		}
		return grace
	}
	return v
}

func cleanupWorkspaceStorageLocks(workspaceStorageDir string) (int, error) {
	root := strings.TrimSpace(workspaceStorageDir)
	if root == "" {
		return 0, nil
	}

	entries, err := os.ReadDir(root)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return 0, nil
		}
		return 0, err
	}

	removed := 0
	for _, entry := range entries {
		if entry == nil || !entry.IsDir() {
			continue
		}
		lockPath := filepath.Join(root, entry.Name(), "vscode.lock")
		if err := os.Remove(lockPath); err != nil {
			if errors.Is(err, os.ErrNotExist) {
				continue
			}
			return removed, err
		}
		removed++
	}

	return removed, nil
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
	return fmt.Errorf("code-server did not start listening on %s:%d (waited %s)", host, port, timeout)
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

func enrichStartError(startErr error, stdoutPath string, stderrPath string, execPath string, prefixArgs []string) error {
	msg := strings.TrimSpace(startErr.Error())

	stderrTail, _ := tailFile(stderrPath, 8*1024)
	stdoutTail, _ := tailFile(stdoutPath, 8*1024)

	var b strings.Builder
	b.WriteString(msg)
	b.WriteString("\n")
	b.WriteString("Check logs:\n")
	b.WriteString("- stdout: ")
	b.WriteString(stdoutPath)
	b.WriteString("\n")
	b.WriteString("- stderr: ")
	b.WriteString(stderrPath)
	b.WriteString("\n")

	// If code-server was a Node.js script, a broken/missing node binary is a common cause.
	if len(prefixArgs) > 0 {
		b.WriteString("\n")
		b.WriteString("Hint: your code-server looks like a Node.js script. Ensure `node` works, or set REDEVEN_CODE_SERVER_NODE_BIN to a working node binary.\n")
	}

	// Include a small tail snippet to surface common failures (unknown flags, missing libs, etc.)
	if stderrTail != "" {
		b.WriteString("\n")
		b.WriteString("stderr (tail):\n")
		b.WriteString(stderrTail)
		b.WriteString("\n")
	}
	if stdoutTail != "" {
		b.WriteString("\n")
		b.WriteString("stdout (tail):\n")
		b.WriteString(stdoutTail)
		b.WriteString("\n")
	}

	// Provide the resolved entrypoint to help debugging wrapper scripts.
	execPath = strings.TrimSpace(execPath)
	if execPath != "" {
		b.WriteString("\n")
		b.WriteString("Entrypoint: ")
		b.WriteString(execPath)
		b.WriteString("\n")
	}

	return errors.New(strings.TrimSpace(b.String()))
}

func tailFile(path string, maxBytes int64) (string, error) {
	path = strings.TrimSpace(path)
	if path == "" {
		return "", errors.New("empty path")
	}
	if maxBytes <= 0 {
		maxBytes = 4 * 1024
	}

	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()

	st, err := f.Stat()
	if err != nil {
		return "", err
	}
	size := st.Size()
	if size <= 0 {
		return "", nil
	}

	start := int64(0)
	if size > maxBytes {
		start = size - maxBytes
	}
	if _, err := f.Seek(start, io.SeekStart); err != nil {
		return "", err
	}
	b, err := io.ReadAll(f)
	if err != nil {
		return "", err
	}

	s := string(b)
	// If we started in the middle of a line, skip until the first newline.
	if start > 0 {
		if i := strings.IndexByte(s, '\n'); i >= 0 && i+1 < len(s) {
			s = s[i+1:]
		}
	}
	return strings.TrimSpace(s), nil
}

func (r *Runner) sessionSocketPathForCodeSpace(codeSpaceID string) string {
	id := strings.TrimSpace(codeSpaceID)
	id = strings.ReplaceAll(id, "/", "_")
	id = strings.ReplaceAll(id, "\\", "_")
	sessionSocketDir := filepath.Join(strings.TrimSpace(r.stateDir), "socks")
	return filepath.Join(sessionSocketDir, fmt.Sprintf("cs-%s.sock", id))
}

func (r *Runner) killStaleCodeServerProcessesBySessionSocket(sessionSocketPath string) (int, error) {
	path := strings.TrimSpace(sessionSocketPath)
	if path == "" {
		return 0, nil
	}
	pids, err := listCodeServerPIDsBySessionSocket(path)
	if err != nil {
		return 0, err
	}

	killed := 0
	var firstErr error
	for _, pid := range pids {
		if err := killProcessGroupByPID(pid); err != nil {
			if firstErr == nil {
				firstErr = err
			}
			continue
		}
		killed++
	}
	return killed, firstErr
}

func listCodeServerPIDsBySessionSocket(sessionSocketPath string) ([]int, error) {
	path := strings.TrimSpace(sessionSocketPath)
	if path == "" {
		return nil, nil
	}
	out, err := exec.Command("ps", "-ax", "-o", "pid=,command=").Output()
	if err != nil {
		return nil, err
	}
	return parseCodeServerPIDsFromPSOutput(string(out), path), nil
}

func parseCodeServerPIDsFromPSOutput(raw string, sessionSocketPath string) []int {
	path := strings.TrimSpace(sessionSocketPath)
	if strings.TrimSpace(raw) == "" || path == "" {
		return nil
	}

	seen := make(map[int]struct{})
	lines := strings.Split(raw, "\n")
	for _, line := range lines {
		v := strings.TrimSpace(line)
		if v == "" {
			continue
		}
		fields := strings.Fields(v)
		if len(fields) < 2 {
			continue
		}
		pid, err := strconv.Atoi(strings.TrimSpace(fields[0]))
		if err != nil || pid <= 0 {
			continue
		}
		cmd := strings.TrimSpace(strings.TrimPrefix(v, fields[0]))
		if cmd == "" {
			continue
		}
		if !strings.Contains(strings.ToLower(cmd), "code-server") {
			continue
		}
		if !strings.Contains(cmd, path) {
			continue
		}
		seen[pid] = struct{}{}
	}

	out := make([]int, 0, len(seen))
	for pid := range seen {
		out = append(out, pid)
	}
	sort.Ints(out)
	return out
}
