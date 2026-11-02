//go:build darwin || linux

package ai

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/shirou/gopsutil/v4/process"
)

// The Go owner starts Chromium; helpers only attach. Helper exit is never
// evidence that Chromium or its process group has been reaped.
type managedBrowserProcess struct {
	cmd         *exec.Cmd
	lock        *os.File
	started     int64
	done        chan struct{}
	endpoint    string
	receiptPath string
	once        sync.Once
	closeErr    error
}
type browserProcessReceipt struct {
	PID          int
	Started      int64
	OwnerPID     int
	OwnerStarted int64
	Executable   string
	Profile      string
}

func browserProcessStart(pid int) (int64, error) {
	p, err := process.NewProcess(int32(pid))
	if err != nil {
		return 0, err
	}
	return p.CreateTime()
}
func browserProcessMatches(receipt browserProcessReceipt) bool {
	p, err := process.NewProcess(int32(receipt.PID))
	if err != nil {
		return false
	}
	started, err := p.CreateTime()
	if err != nil || started != receipt.Started {
		return false
	}
	exe, err := p.Exe()
	if err != nil {
		return false
	}
	exe, _ = filepath.EvalSymlinks(exe)
	args, err := p.CmdlineSlice()
	if err != nil {
		return false
	}
	found := false
	for _, arg := range args {
		if arg == "--user-data-dir="+receipt.Profile {
			found = true
		}
	}
	group, err := syscall.Getpgid(receipt.PID)
	return found && exe == receipt.Executable && err == nil && group == receipt.PID
}
func browserGroupExists(pid int) bool {
	err := syscall.Kill(-pid, 0)
	return !errors.Is(err, syscall.ESRCH)
}
func waitBrowserGroup(pid int, timeout time.Duration) bool {
	deadline := time.Now().Add(timeout)
	for browserGroupExists(pid) {
		if time.Now().After(deadline) {
			return false
		}
		time.Sleep(20 * time.Millisecond)
	}
	return true
}

// Receipts are profile-scoped. Never scan or kill by executable name. Ambiguous
// or recycled identities fail closed and retain evidence for inspection.
func recoverBrowserProcess(filename, executable, profile string) error {
	fd, err := syscall.Open(filename, syscall.O_RDONLY|syscall.O_NOFOLLOW|syscall.O_NONBLOCK, 0)
	if errors.Is(err, syscall.ENOENT) {
		return nil
	}
	if err != nil {
		return err
	}
	syscall.CloseOnExec(fd)
	file := os.NewFile(uintptr(fd), filename)
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() || info.Size() > 8192 {
		return errors.New("invalid managed browser process receipt")
	}
	body, err := io.ReadAll(io.LimitReader(file, 8193))
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	var receipt browserProcessReceipt
	if len(body) > 8192 || json.Unmarshal(body, &receipt) != nil || receipt.PID <= 1 || receipt.OwnerPID <= 1 || receipt.Started <= 0 || receipt.OwnerStarted <= 0 || receipt.Executable != executable || receipt.Profile != profile {
		return errors.New("managed browser process identity unavailable")
	}
	if !browserGroupExists(receipt.PID) {
		return os.Remove(filename)
	}
	ownerStart, err := browserProcessStart(receipt.OwnerPID)
	if err != nil {
		exists, inspectErr := process.PidExists(int32(receipt.OwnerPID))
		if inspectErr != nil || exists {
			return errors.New("managed browser owner identity unavailable")
		}
	}
	if err == nil && ownerStart == receipt.OwnerStarted {
		return errors.New("managed browser profile is owned by a running environment")
	}
	if !browserProcessMatches(receipt) {
		return errors.New("managed browser process identity changed; inspect the stopped environment")
	}
	_ = syscall.Kill(-receipt.PID, syscall.SIGTERM)
	if !waitBrowserGroup(receipt.PID, 2*time.Second) {
		if err := syscall.Kill(-receipt.PID, syscall.SIGKILL); err != nil && !errors.Is(err, syscall.ESRCH) {
			return err
		}
		if !waitBrowserGroup(receipt.PID, 2*time.Second) {
			return errors.New("managed browser process cleanup incomplete")
		}
	}
	return os.Remove(filename)
}

type browserLaunchOutput struct {
	mu       sync.Mutex
	body     string
	endpoint chan string
}

func (o *browserLaunchOutput) Write(data []byte) (int, error) {
	o.mu.Lock()
	defer o.mu.Unlock()
	o.body += string(data)
	if len(o.body) > 16384 {
		o.body = o.body[len(o.body)-16384:]
	}
	for _, line := range strings.Split(o.body, "\n") {
		if at := strings.Index(line, "DevTools listening on "); at >= 0 {
			address := strings.TrimSpace(line[at+len("DevTools listening on "):])
			u, err := url.Parse(address)
			if err == nil && u.Scheme == "ws" && u.Hostname() == "127.0.0.1" && u.Port() != "" && strings.HasPrefix(u.Path, "/devtools/browser/") {
				select {
				case o.endpoint <- "http://" + u.Host:
				default:
				}
			}
		}
	}
	return len(data), nil
}
func (o *browserLaunchOutput) reason() string {
	o.mu.Lock()
	defer o.mu.Unlock()
	if strings.Contains(o.body, "No usable sandbox") || strings.Contains(o.body, "without --no-sandbox") || strings.Contains(o.body, "Failed to move to new namespace") {
		return "browser_sandbox_unavailable"
	}
	if strings.Contains(o.body, "error while loading shared libraries") {
		return "browser_dependency_missing"
	}
	return "browser_launch_failed"
}
func startManagedBrowserProcess(ctx context.Context, executable, directory string) (owner *managedBrowserProcess, resultErr error) {
	executable, err := filepath.EvalSymlinks(executable)
	if err != nil {
		return nil, err
	}
	directory, err = filepath.EvalSymlinks(directory)
	if err != nil {
		return nil, err
	}
	filename := filepath.Join(directory, ".flower-browser-process.json")
	lockFD, err := syscall.Open(filepath.Join(directory, ".flower-browser-owner.lock"), syscall.O_CREAT|syscall.O_RDWR|syscall.O_NOFOLLOW|syscall.O_NONBLOCK, 0600)
	if err != nil {
		return nil, err
	}
	syscall.CloseOnExec(lockFD)
	lock := os.NewFile(uintptr(lockFD), "browser owner lock")
	lockTransferred := false
	defer func() {
		if !lockTransferred {
			_ = lock.Close()
		}
	}()
	if info, err := lock.Stat(); err != nil || !info.Mode().IsRegular() {
		return nil, errors.New("invalid managed browser owner lock")
	}
	if err = syscall.Flock(int(lock.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		return nil, errors.New("managed browser profile is being prepared")
	}
	if err = recoverBrowserProcess(filename, executable, directory); err != nil {
		return nil, err
	}
	if err = ctx.Err(); err != nil {
		return nil, err
	}
	output := &browserLaunchOutput{endpoint: make(chan string, 1)}
	// Preserve Playwright's existing managed-profile credential isolation. These
	// profiles must never consult or prompt for the user's OS keychain.
	cmd := exec.Command(executable, "--headless", "--password-store=basic", "--use-mock-keychain", "--disable-breakpad", "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows", "--no-startup-window", "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--disable-component-update", "--disable-sync", "--disable-popup-blocking", "--disable-blink-features=AutomationControlled", "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0", "--user-data-dir="+directory)
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.Stderr = output
	cmd.Stdout = output
	cmd.WaitDelay = time.Second
	if err = cmd.Start(); err != nil {
		return nil, &TargetStartupError{Code: "TARGET_SETUP_REQUIRED", Reason: "browser_launch_failed"}
	}
	p := &managedBrowserProcess{cmd: cmd, done: make(chan struct{}), receiptPath: filename, lock: lock}
	lockTransferred = true
	go func() { _ = cmd.Wait(); close(p.done) }()
	defer func() {
		if resultErr != nil {
			resultErr = errors.Join(resultErr, p.close())
		}
	}()
	started, err := browserProcessStart(cmd.Process.Pid)
	if err != nil {
		return nil, &TargetStartupError{Code: "TARGET_SETUP_REQUIRED", Reason: output.reason()}
	}
	p.started = started
	ownerStarted, err := browserProcessStart(os.Getpid())
	if err != nil {
		return nil, err
	}
	receipt := browserProcessReceipt{PID: cmd.Process.Pid, Started: started, OwnerPID: os.Getpid(), OwnerStarted: ownerStarted, Executable: executable, Profile: directory}
	body, _ := json.Marshal(receipt)
	if err = writeBrowserProcessReceipt(filename, body); err != nil {
		return nil, err
	}
	timer := time.NewTimer(20 * time.Second)
	defer timer.Stop()
	select {
	case p.endpoint = <-output.endpoint:
		return p, nil
	case <-p.done:
		return nil, &TargetStartupError{Code: "TARGET_SETUP_REQUIRED", Reason: output.reason()}
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-timer.C:
		return nil, &TargetStartupError{Code: "TARGET_SETUP_REQUIRED", Reason: "browser_launch_timeout"}
	}
}
func (p *managedBrowserProcess) close() error {
	if p == nil {
		return nil
	}
	p.once.Do(func() {
		if p.lock != nil {
			defer p.lock.Close()
		}
		pid := p.cmd.Process.Pid
		if browserGroupExists(pid) {
			if started, err := browserProcessStart(pid); err == nil && p.started != 0 && started != p.started {
				p.closeErr = errors.New("managed browser process identity changed")
				return
			}
			err := syscall.Kill(-pid, syscall.SIGTERM)
			if err != nil && !errors.Is(err, syscall.ESRCH) {
				p.closeErr = err
				return
			}
			if !waitBrowserGroup(pid, 3*time.Second) {
				if err = syscall.Kill(-pid, syscall.SIGKILL); err != nil && !errors.Is(err, syscall.ESRCH) {
					p.closeErr = err
					return
				}
				if !waitBrowserGroup(pid, 2*time.Second) {
					p.closeErr = errors.New("managed browser process cleanup incomplete")
					return
				}
			}
		}
		select {
		case <-p.done:
		case <-time.After(time.Second):
			p.closeErr = errors.New("managed browser wait incomplete")
			return
		}
		if err := os.Remove(p.receiptPath); err != nil && !errors.Is(err, os.ErrNotExist) {
			p.closeErr = err
		}
	})
	return p.closeErr
}

// Publish the complete identity atomically before reporting readiness. A killed
// writer cannot turn a later cleanup into a partially decoded PID decision.
func writeBrowserProcessReceipt(filename string, body []byte) error {
	file, err := os.CreateTemp(filepath.Dir(filename), ".flower-browser-receipt-*")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	if _, err = file.Write(body); err != nil {
		file.Close()
		return err
	}
	if err = file.Sync(); err != nil {
		file.Close()
		return err
	}
	if err = file.Close(); err != nil {
		return err
	}
	return os.Rename(file.Name(), filename)
}
