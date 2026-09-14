package ai

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"strings"
	"sync"
)

// XvfbTargetExecutor supplies the same typed contract to GUI programs on a
// headless Linux host. The wrapped executor is responsible for X11 input and
// screenshots; this type owns the display lifecycle and clear availability
// failure.
type XvfbTargetExecutor struct {
	Display string
	Screen  string
	Inner   TargetToolExecutor
	mu      sync.Mutex
	process *exec.Cmd
}

func (e *XvfbTargetExecutor) Start(ctx context.Context) error {
	if e == nil || e.Inner == nil {
		return errors.New("virtual desktop target executor is unavailable")
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.process != nil {
		return nil
	}
	display := strings.TrimSpace(e.Display)
	if display == "" {
		display = ":99"
	}
	screen := strings.TrimSpace(e.Screen)
	if screen == "" {
		screen = "1280x800x24"
	}
	path, err := exec.LookPath("Xvfb")
	if err != nil {
		return &TargetStartupError{Code: "TARGET_SETUP_REQUIRED", Reason: "xvfb_missing"}
	}
	cmd := exec.CommandContext(ctx, path, display, "-screen", "0", screen, "-nolisten", "tcp")
	cmd.Env = append(os.Environ(), "DISPLAY="+display)
	if err := cmd.Start(); err != nil {
		return &TargetStartupError{Code: "TARGET_SETUP_REQUIRED", Reason: "xvfb_start_failed"}
	}
	e.process = cmd
	return nil
}

// EnsureTargetReady starts Xvfb and then performs the wrapped adapter
// handshake. Starting a display alone is not readiness: the inner target must
// prove that it can capture and accept input.
func (e *XvfbTargetExecutor) EnsureTargetReady(ctx context.Context, targetID string) error {
	if err := e.Start(ctx); err != nil {
		return &TargetStartupError{Code: "TARGET_SETUP_REQUIRED", Reason: "xvfb_unavailable"}
	}
	if checker, ok := e.Inner.(targetReadinessChecker); ok {
		if err := checker.EnsureTargetReady(ctx, targetID); err != nil {
			return err
		}
	}
	return nil
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

func (e *XvfbTargetExecutor) ResolveTargetToolAttachment(ctx context.Context, ref string) ([]byte, error) {
	resolver, ok := e.Inner.(TargetToolAttachmentResolver)
	if !ok {
		return nil, errors.New("target attachment resolver is unavailable")
	}
	return resolver.ResolveTargetToolAttachment(ctx, ref)
}

func (e *XvfbTargetExecutor) Close() error {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.process == nil {
		return nil
	}
	_ = e.process.Process.Kill()
	_ = e.process.Wait()
	e.process = nil
	if closer, ok := e.Inner.(interface{ Close() error }); ok {
		return closer.Close()
	}
	return nil
}
