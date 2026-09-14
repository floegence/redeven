//go:build !linux

package ai

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"strings"
	"sync"
)

// Xvfb is Linux-only. This compatibility type keeps non-Linux builds and
// package fixtures explicit: it cannot claim a desktop adapter exists.
type XvfbTargetExecutor struct {
	Display string
	Screen  string
	Inner   TargetToolExecutor
	mu      sync.Mutex
	process *exec.Cmd
}

func (e *XvfbTargetExecutor) Start(ctx context.Context) error {
	if e.Inner == nil {
		return errors.New("virtual desktop target executor is unavailable")
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.process != nil {
		return nil
	}
	path, err := exec.LookPath("Xvfb")
	if err != nil {
		return &TargetStartupError{Code: "TARGET_SETUP_REQUIRED", Reason: "xvfb_missing"}
	}
	display := e.Display
	if display == "" {
		display = ":99"
	}
	screen := e.Screen
	if screen == "" {
		screen = "1280x800x24"
	}
	cmd := exec.Command(path, display, "-screen", "0", screen, "-nolisten", "tcp")
	cmd.Env = append(os.Environ(), "DISPLAY="+display)
	if err := cmd.Start(); err != nil {
		return &TargetStartupError{Code: "TARGET_SETUP_REQUIRED", Reason: "xvfb_start_failed"}
	}
	e.process = cmd
	return nil
}
func (e *XvfbTargetExecutor) EnsureTargetReady(ctx context.Context, id string) error {
	return e.Start(ctx)
}
func (e *XvfbTargetExecutor) ExecuteTargetTool(ctx context.Context, call TargetToolCall) (TargetToolResult, error) {
	e.mu.Lock()
	started := e.process != nil
	e.mu.Unlock()
	if !started {
		return TargetToolResult{}, errors.New("TARGET_UNAVAILABLE: Xvfb target is not started")
	}
	return e.Inner.ExecuteTargetTool(ctx, call)
}
func (e *XvfbTargetExecutor) ResolveTargetToolAttachment(context.Context, string) ([]byte, error) {
	return nil, errors.New("target attachment resolver unavailable")
}
func (e *XvfbTargetExecutor) Close() error {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.process != nil {
		_ = e.process.Process.Kill()
		_, _ = e.process.Process.Wait()
		e.process = nil
	}
	_ = os.Setenv("DISPLAY", strings.TrimSpace(os.Getenv("DISPLAY")))
	return nil
}
