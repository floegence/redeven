package ai

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"image/png"
	"io"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

// XvfbTargetExecutor owns a private X11 display, its window manager, and input
// and capture commands. Its children outlive individual tool calls, but never
// the Runtime. BrowserTarget remains an independent, headless adapter.
type XvfbTargetExecutor struct {
	directory        string
	mu               sync.Mutex
	closed           bool
	sessionDirectory string
	display          string
	environment      []string
	processes        []*x11Process
	paths            x11Paths
	atspi            *atspiClient
	ready            bool
}

type x11Paths struct{ xvfb, windowManager, input, capture, auth, properties, dbus, atspi string }
type x11Process struct {
	cmd  *exec.Cmd
	done chan struct{}
}

func NewXvfbTargetExecutor(stateDirectory string) *XvfbTargetExecutor {
	paths := x11Paths{
		xvfb: "/usr/bin/Xvfb", windowManager: "/usr/bin/openbox", input: "/usr/bin/xdotool",
		capture: "/usr/bin/import", auth: "/usr/bin/xauth", properties: "/usr/bin/xprop",
		dbus: "/usr/bin/dbus-daemon", atspi: "/usr/libexec/at-spi-bus-launcher",
	}
	// Packaged Linux runtimes may ship these binaries beside the Runtime. An
	// explicit absolute override keeps that bundle deterministic while avoiding
	// PATH-dependent discovery in production.
	for key, destination := range map[string]*string{"X": &paths.xvfb, "WM": &paths.windowManager, "INPUT": &paths.input, "CAPTURE": &paths.capture, "AUTH": &paths.auth, "XPROP": &paths.properties, "DBUS": &paths.dbus, "ATSPI": &paths.atspi} {
		if value := strings.TrimSpace(os.Getenv("REDEVEN_X11_" + key)); filepath.IsAbs(value) {
			*destination = value
		}
	}
	return &XvfbTargetExecutor{directory: filepath.Join(stateDirectory, "computer", "x11"), paths: paths}
}

// CheckComputerSetup validates configured resources without starting a session.
func (e *XvfbTargetExecutor) CheckComputerSetup() error {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.checkSetupLocked()
}
func (e *XvfbTargetExecutor) checkSetupLocked() error {
	if e.closed {
		return &TargetStartupError{Code: "TARGET_NOT_READY", Reason: "x11_closed"}
	}
	for _, dependency := range []struct{ name, path string }{
		{"xvfb", e.paths.xvfb}, {"window_manager", e.paths.windowManager}, {"x11_input", e.paths.input},
		{"x11_capture", e.paths.capture}, {"xauth", e.paths.auth}, {"x11_properties", e.paths.properties},
		{"private_dbus", e.paths.dbus}, {"atspi", e.paths.atspi},
	} {
		info, err := os.Stat(dependency.path)
		if !filepath.IsAbs(dependency.path) || err != nil || !info.Mode().IsRegular() || info.Mode()&0111 == 0 {
			return &TargetStartupError{Code: "TARGET_SETUP_REQUIRED", Reason: dependency.name + "_missing"}
		}
	}
	if !filepath.IsAbs(e.directory) {
		return &TargetStartupError{Code: "TARGET_SETUP_REQUIRED", Reason: "x11_state_path_not_absolute"}
	}
	return nil
}

func (e *XvfbTargetExecutor) EnsureTargetReady(ctx context.Context, _ string) error {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.ensureLocked(ctx)
}

func (e *XvfbTargetExecutor) ensureLocked(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if e.closed {
		return &TargetStartupError{Code: "TARGET_NOT_READY", Reason: "x11_closed"}
	}
	if len(e.processes) > 0 {
		alive := e.ready && e.atspi != nil && e.atspi.connection.Connected()
		for _, process := range e.processes {
			select {
			case <-process.done:
				alive = false
			default:
			}
		}
		if alive {
			return nil
		}
		if err := e.stopLocked(); err != nil {
			return err
		}
	}
	if err := e.checkSetupLocked(); err != nil {
		return err
	}
	if err := os.MkdirAll(e.directory, 0700); err != nil {
		return err
	}
	// Unix socket paths have a small fixed limit. Active display resources
	// are ephemeral and use a private short directory, independent of the
	// configured persistent state path.
	dir, err := os.MkdirTemp("/tmp", "redeven-x11-")
	if err != nil {
		return err
	}
	e.sessionDirectory = dir
	ok := false
	defer func() {
		if !ok {
			_ = e.stopLocked()
		}
	}()
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	authority := filepath.Join(dir, "Xauthority")
	file, err := os.OpenFile(authority, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	cookie := make([]byte, 16)
	if _, err := rand.Read(cookie); err != nil {
		return err
	}
	e.environment = x11Environment(privateDesktopEnvironment(os.Environ()), map[string]string{"XAUTHORITY": authority,
		"XDG_RUNTIME_DIR": dir, "XDG_CACHE_HOME": filepath.Join(dir, "cache"), "XDG_DATA_HOME": filepath.Join(dir, "data"),
		"NO_AT_BRIDGE": "0", "GTK_A11Y": "atspi", "QT_LINUX_ACCESSIBILITY_ALWAYS_ON": "1"})
	addAuthorization := func(display string) error {
		// The cookie is sent over stdin and never appears in process arguments.
		input := strings.NewReader("add " + display + " MIT-MAGIC-COOKIE-1 " + hex.EncodeToString(cookie) + "\n")
		_, err := e.command(ctx, e.paths.auth, input, 4096, "-f", authority, "source", "-")
		return err
	}
	var randomDisplay [4]byte
	if _, err := rand.Read(randomDisplay[:]); err != nil {
		return err
	}
	displayNumber := 100 + binary.BigEndian.Uint32(randomDisplay[:])%900
	e.display = ":" + strconv.FormatUint(uint64(displayNumber), 10)
	if err := addAuthorization(e.display); err != nil {
		return &TargetStartupError{Code: "TARGET_SETUP_REQUIRED", Reason: "x11_auth_failed"}
	}
	cmd := exec.Command(e.paths.xvfb, e.display, "-screen", "0", "1280x800x24", "-nolisten", "tcp", "-auth", authority)
	process, err := e.startProcess(cmd)
	if err != nil {
		return &TargetStartupError{Code: "TARGET_SETUP_REQUIRED", Reason: "xvfb_start_failed"}
	}
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-process.done:
		return &TargetStartupError{Code: "TARGET_SETUP_REQUIRED", Reason: "xvfb_exited"}
	default:
	}
	e.environment = x11Environment(e.environment, map[string]string{"DISPLAY": e.display})
	// Starting Xvfb does not mean its authenticated socket is accepting clients.
	// Observe readiness within the startup deadline; never retry a user action.
	for {
		if _, err := e.command(ctx, e.paths.input, nil, 4096, "getdisplaygeometry"); err == nil {
			break
		}
		select {
		case <-ctx.Done():
			return &TargetStartupError{Code: "TARGET_SETUP_REQUIRED", Reason: "x11_connection_failed"}
		case <-process.done:
			return &TargetStartupError{Code: "TARGET_SETUP_REQUIRED", Reason: "xvfb_exited"}
		case <-time.After(25 * time.Millisecond):
		}
	}
	// Skip user autostart scripts: only this Runtime's explicit GUI clients may
	// be launched on its display. Openbox itself is an owned process group.
	address := "unix:path=" + filepath.Join(dir, "session-bus")
	configuration := `<busconfig><type>session</type><listen>` + html.EscapeString(address) + `</listen><auth>EXTERNAL</auth><policy context="default"><allow own="*"/><allow send_destination="*"/><allow receive_sender="*"/></policy></busconfig>`
	configPath := filepath.Join(dir, "dbus.conf")
	if err := os.WriteFile(configPath, []byte(configuration), 0600); err != nil {
		return err
	}
	e.environment = x11Environment(e.environment, map[string]string{"DBUS_SESSION_BUS_ADDRESS": address})
	bus, err := e.startProcess(exec.Command(e.paths.dbus, "--nofork", "--nopidfile", "--config-file="+configPath))
	if err != nil {
		return &TargetStartupError{Code: "TARGET_SETUP_REQUIRED", Reason: "private_dbus_start_failed"}
	}
	for {
		if _, err := os.Stat(filepath.Join(dir, "session-bus")); err == nil {
			break
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-bus.done:
			return &TargetStartupError{Code: "TARGET_SETUP_REQUIRED", Reason: "private_dbus_exited"}
		case <-time.After(20 * time.Millisecond):
		}
	}
	launcher, err := e.startProcess(exec.Command(e.paths.atspi, "--launch-immediately"))
	if err != nil {
		return &TargetStartupError{Code: "TARGET_SETUP_REQUIRED", Reason: "atspi_start_failed"}
	}
	for {
		client, err := connectATSPIDesktop(ctx, address, dir)
		if err == nil {
			e.atspi = client
			break
		}
		select {
		case <-ctx.Done():
			return &TargetStartupError{Code: "TARGET_SETUP_REQUIRED", Reason: "atspi_connection_failed"}
		case <-launcher.done:
			return &TargetStartupError{Code: "TARGET_SETUP_REQUIRED", Reason: "atspi_exited"}
		case <-time.After(20 * time.Millisecond):
		}
	}
	wm, err := e.startProcess(exec.Command(e.paths.windowManager, "--sm-disable"))
	if err != nil {
		return &TargetStartupError{Code: "TARGET_SETUP_REQUIRED", Reason: "window_manager_start_failed"}
	}
	if _, err := e.command(ctx, e.paths.input, nil, 4096, "getdisplaygeometry"); err != nil {
		return &TargetStartupError{Code: "TARGET_SETUP_REQUIRED", Reason: "x11_geometry_failed"}
	}
	select {
	case <-wm.done:
		return &TargetStartupError{Code: "TARGET_SETUP_REQUIRED", Reason: "window_manager_exited"}
	default:
	}
	if _, _, err := e.capture(ctx, "x11-readiness"); err != nil {
		return &TargetStartupError{Code: "TARGET_SETUP_REQUIRED", Reason: "x11_capture_failed"}
	}
	ok = true
	e.ready = true
	return nil
}

func privateDesktopEnvironment(base []string) []string {
	result := make([]string, 0, len(base))
	for _, entry := range base {
		key, _, _ := strings.Cut(entry, "=")
		switch key {
		case "DISPLAY", "WAYLAND_DISPLAY", "DBUS_SESSION_BUS_ADDRESS", "DBUS_SYSTEM_BUS_ADDRESS", "DBUS_STARTER_ADDRESS", "DBUS_STARTER_BUS_TYPE", "AT_SPI_BUS_ADDRESS", "XAUTHORITY", "SESSION_MANAGER":
			continue
		}
		result = append(result, entry)
	}
	return result
}

func x11Environment(base []string, updates map[string]string) []string {
	result := make([]string, 0, len(base)+len(updates))
	for _, entry := range base {
		key, _, _ := strings.Cut(entry, "=")
		if _, replace := updates[key]; !replace {
			result = append(result, entry)
		}
	}
	for key, value := range updates {
		result = append(result, key+"="+value)
	}
	return result
}

func (e *XvfbTargetExecutor) startProcess(cmd *exec.Cmd) (*x11Process, error) {
	cmd.Env = e.environment
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true, Pdeathsig: syscall.SIGKILL}
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	process := &x11Process{cmd: cmd, done: make(chan struct{})}
	e.processes = append(e.processes, process)
	go func() { _ = cmd.Wait(); close(process.done) }()
	return process, nil
}

type x11Output struct {
	bytes.Buffer
	limit int
}

func (out *x11Output) Write(body []byte) (int, error) {
	if len(body) > out.limit-out.Len() {
		return 0, errors.New("X11 output exceeds limit")
	}
	return out.Buffer.Write(body)
}

func (e *XvfbTargetExecutor) command(ctx context.Context, path string, input io.Reader, limit int, args ...string) ([]byte, error) {
	cmd := exec.CommandContext(ctx, path, args...)
	cmd.Env, cmd.Stdin = e.environment, input
	cmd.WaitDelay = time.Second
	output := &x11Output{limit: limit}
	cmd.Stdout, cmd.Stderr = output, io.Discard
	err := cmd.Run()
	if ctx.Err() != nil {
		return nil, ctx.Err()
	}
	return output.Bytes(), err
}

func (e *XvfbTargetExecutor) capture(ctx context.Context, targetID string) ([]byte, TargetToolAttachment, error) {
	body, err := e.command(ctx, e.paths.capture, nil, maxComputerFrameBytes, "-silent", "-window", "root", "-depth", "8", "png:-")
	if err != nil {
		return nil, TargetToolAttachment{}, err
	}
	sum := sha256.Sum256(body)
	hash := hex.EncodeToString(sum[:])
	attachment := TargetToolAttachment{ResourceRef: "computer://" + targetID + "/" + hash, Name: "desktop-screenshot.png", MIMEType: "image/png", SizeBytes: int64(len(body)), SHA256: hash}
	return body, attachment, validateComputerFrame(attachment, body)
}

func (e *XvfbTargetExecutor) ExecuteTargetTool(ctx context.Context, call TargetToolCall) (TargetToolResult, error) {
	return e.execute(ctx, call, false)
}

func (e *XvfbTargetExecutor) ExecuteComputerUserInput(ctx context.Context, call TargetToolCall) ([]byte, error) {
	result, err := e.execute(ctx, call, true)
	return result.frameBytes, err
}

func (e *XvfbTargetExecutor) execute(ctx context.Context, call TargetToolCall, private bool) (out TargetToolResult, outErr error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if call.TargetID != "xvfb-main" {
		return TargetToolResult{}, computerTargetFailure(call, "TARGET_NOT_ALLOWED")
	}
	args := map[string]any{}
	if len(call.Arguments) > 0 && json.Unmarshal(call.Arguments, &args) != nil {
		return TargetToolResult{}, computerTargetFailure(call, "INVALID_REQUEST")
	}
	if err := e.ensureLocked(ctx); err != nil {
		return TargetToolResult{}, err
	}
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	result := TargetToolResult{TargetID: call.TargetID, ExecutionLocation: "linux_xvfb_desktop", ActionSummary: call.ToolName}
	if !private {
		safety, err := e.atspi.safety(ctx)
		if err != nil {
			return result, computerTargetFailure(call, "TARGET_NOT_READY")
		}
		result.Safety = safety
		if safety.Level == "takeover" {
			result.Result = map[string]any{"action_executed": false}
			return result, nil
		}
	} else {
		switch call.ToolName {
		case "computer.screenshot", "computer.click", "computer.type", "computer.key", "computer.scroll":
		default:
			return result, computerTargetFailure(call, "TARGET_NOT_ALLOWED")
		}
	}
	if call.controlReturn || private {
		e.atspi.revision.Add(1)
		clear(e.atspi.references)
	}
	payload := map[string]any{"summary": call.ToolName, "action_executed": false, "execution_mode": "background"}
	tool := call.ToolName
	dispatched := false
	defer func() {
		if outErr != nil && !private && dispatched && !computerKnownRejection(outErr) {
			outErr = errComputerEffectUnknown
		}
	}()
	if tool == "computer.observe" {
		observation, err := e.atspi.observe(ctx, args)
		if err != nil {
			return result, computerTargetFailure(call, err.Error())
		}
		payload["observation"] = observation
	} else if tool == "computer.action" && (args["action"] == "read" || args["action"] == "fill" || args["action"] == "click" || args["action"] == "wait") {
		observed, err := e.atspi.action(ctx, args)
		if err != nil {
			if errors.Is(err, errComputerEffectUnknown) {
				return result, err
			}
			return result, computerTargetFailure(call, err.Error())
		}
		for key, value := range observed {
			payload[key] = value
		}
		dispatched = payload["action_executed"] == true
	} else {
		if tool == "computer.action" {
			switch args["action"] {
			case "pointer_click":
				tool = "computer.click"
			case "drag":
				tool = "computer.drag"
			case "key":
				tool = "computer.key"
			case "scroll":
				tool = "computer.scroll"
			default:
				return result, computerTargetFailure(call, "INVALID_REQUEST")
			}
		}
		action, err := x11Action(tool, args)
		if err != nil {
			return result, computerTargetFailure(call, "INVALID_REQUEST")
		}
		if selector, ok := args["selector"].(map[string]any); ok {
			element, err := e.atspi.resolve(ctx, selector)
			if err != nil {
				return result, computerTargetFailure(call, err.Error())
			}
			if tool == "computer.key" {
				dispatched = true
				var focused bool
				if err := e.atspi.call(ctx, element.object, "org.a11y.atspi.Component.GrabFocus").Store(&focused); err != nil || !focused {
					return result, errComputerEffectUnknown
				}
			}
			if tool == "computer.scroll" {
				var rect struct{ X, Y, Width, Height int32 }
				if err := e.atspi.call(ctx, element.object, "org.a11y.atspi.Component.GetExtents", uint32(0)).Store(&rect); err != nil {
					return result, computerTargetFailure(call, "STALE_REFERENCE")
				}
				if rect.Width <= 0 || rect.Height <= 0 {
					return result, computerTargetFailure(call, "ELEMENT_NOT_FOUND")
				}
				dispatched = true
				if _, err := e.command(ctx, e.paths.input, nil, 4096, "mousemove", "--sync", strconv.Itoa(int(rect.X+rect.Width/2)), strconv.Itoa(int(rect.Y+rect.Height/2))); err != nil {
					return result, computerTargetFailure(call, "TARGET_ACTION_FAILED")
				}
			}
		}
		dispatched = tool != "computer.screenshot" && tool != "computer.wait"
		if err := action(ctx, e); err != nil {
			if ctx.Err() != nil {
				return result, ctx.Err()
			}
			return result, computerTargetFailure(call, "TARGET_ACTION_FAILED")
		}
		payload["action_executed"] = dispatched
	}
	if !private {
		safety, err := e.atspi.safety(ctx)
		if err != nil {
			return result, computerTargetFailure(call, "TARGET_NOT_READY")
		}
		result.Safety = safety
		if safety.Level == "takeover" {
			result.Result = map[string]any{"action_executed": dispatched}
			return result, nil
		}
	}
	if tool == "computer.screenshot" || (!private && ((tool == "computer.observe" && args["screenshot"] == true) || (tool != "computer.observe" && !call.scriptOperation))) {
		body, attachment, err := e.capture(ctx, call.TargetID)
		if err != nil {
			return result, computerTargetFailure(call, "FRAME_UNAVAILABLE")
		}
		if private {
			result.frameBytes = body
			return result, nil
		}
		safety, err := e.atspi.safety(ctx)
		if err != nil {
			return result, computerTargetFailure(call, "FRAME_UNAVAILABLE")
		}
		result.Safety = safety
		if safety.Level == "takeover" {
			result.Result = map[string]any{"action_executed": dispatched}
			return result, nil
		}
		geometry, _ := png.DecodeConfig(bytes.NewReader(body))
		result.frameBytes, result.Attachments = body, []TargetToolAttachment{attachment}
		payload["screenshot"], payload["after_frame"] = attachment.ResourceRef, attachment.ResourceRef
		payload["width"], payload["height"], payload["device_pixel_ratio"] = geometry.Width, geometry.Height, 1
	}
	if !private {
		result.Result = payload
	}
	return result, nil
}

func (e *XvfbTargetExecutor) ResolveTargetToolAttachment(ctx context.Context, ref string) ([]byte, error) {
	return nil, errors.New("Xvfb attachments are owned by ComputerUseRuntime")
}

func (e *XvfbTargetExecutor) stopLocked() error {
	e.ready = false
	if e.atspi != nil {
		e.atspi.close()
		e.atspi = nil
	}
	for i := len(e.processes) - 1; i >= 0; i-- {
		process := e.processes[i]
		select {
		case <-process.done:
			continue
		default:
		}
		_ = syscall.Kill(-process.cmd.Process.Pid, syscall.SIGKILL)
		<-process.done
	}
	e.processes = nil
	e.display, e.environment = "", nil
	if e.sessionDirectory == "" {
		return nil
	}
	err := os.RemoveAll(e.sessionDirectory)
	if err == nil {
		e.sessionDirectory = ""
	}
	return err
}

func (e *XvfbTargetExecutor) Close() error {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.closed = true
	return e.stopLocked()
}

type x11ActionFunc func(context.Context, *XvfbTargetExecutor) error

var x11KeyPattern = regexp.MustCompile(`^[A-Za-z0-9_]+(?:\+[A-Za-z0-9_]+)*$`)

func x11Action(tool string, args map[string]any) (x11ActionFunc, error) {
	number := func(name string, fallback, min, max float64) (float64, error) {
		value, exists := args[name]
		if !exists {
			return fallback, nil
		}
		n, ok := value.(float64)
		if !ok || math.IsNaN(n) || math.IsInf(n, 0) || n < min || n > max {
			return 0, fmt.Errorf("invalid X11 %s", name)
		}
		return n, nil
	}
	point := func(xName, yName string) ([]string, error) {
		if args[xName] == nil || args[yName] == nil {
			return nil, errors.New("X11 coordinates are required")
		}
		x, err := number(xName, 0, 0, 1279)
		if err != nil {
			return nil, err
		}
		y, err := number(yName, 0, 0, 799)
		if err != nil {
			return nil, err
		}
		return []string{strconv.Itoa(int(math.Round(x))), strconv.Itoa(int(math.Round(y)))}, nil
	}
	command := func(args ...string) x11ActionFunc {
		return func(ctx context.Context, e *XvfbTargetExecutor) error {
			_, err := e.command(ctx, e.paths.input, nil, 4096, args...)
			return err
		}
	}
	switch tool {
	case "computer.screenshot":
		return func(context.Context, *XvfbTargetExecutor) error { return nil }, nil
	case "computer.click", "computer.double_click":
		p, err := point("x", "y")
		if err != nil {
			return nil, err
		}
		args := append([]string{"mousemove", "--sync"}, p...)
		args = append(args, "click", "--clearmodifiers")
		if tool == "computer.double_click" {
			args = append(args, "--repeat", "2", "--delay", "100")
		}
		return command(append(args, "1")...), nil
	case "computer.type":
		text, ok := args["text"].(string)
		if !ok || len([]rune(text)) > 20000 || strings.ContainsRune(text, 0) {
			return nil, errors.New("invalid X11 text")
		}
		return func(ctx context.Context, e *XvfbTargetExecutor) error {
			_, err := e.command(ctx, e.paths.input, strings.NewReader(text), 4096, "type", "--clearmodifiers", "--delay", "0", "--file", "-")
			return err
		}, nil
	case "computer.key":
		key, ok := args["key"].(string)
		if !ok || len(key) > 80 || !x11KeyPattern.MatchString(key) {
			return nil, errors.New("invalid X11 key chord")
		}
		keys := strings.Split(key, "+")
		aliases := map[string]string{"control": "ctrl", "command": "super", "cmd": "super", "meta": "super", "enter": "Return", "esc": "Escape", "space": "space", "spacebar": "space", "arrowup": "Up", "arrowdown": "Down", "arrowleft": "Left", "arrowright": "Right", "backspace": "BackSpace", "pageup": "Prior", "pagedown": "Next"}
		for i, part := range keys {
			if alias, ok := aliases[strings.ToLower(part)]; ok {
				keys[i] = alias
			}
		}
		return command("key", "--clearmodifiers", "--", strings.Join(keys, "+")), nil
	case "computer.scroll":
		x, err := number("delta_x", 0, -12000, 12000)
		if err != nil {
			return nil, err
		}
		y, err := number("delta_y", 0, -12000, 12000)
		if err != nil {
			return nil, err
		}
		var position []string
		if args["x"] != nil || args["y"] != nil {
			position, err = point("x", "y")
			if err != nil {
				return nil, err
			}
		}
		return func(ctx context.Context, e *XvfbTargetExecutor) error {
			if position != nil {
				if err := command(append([]string{"mousemove", "--sync"}, position...)...)(ctx, e); err != nil {
					return err
				}
			}
			for _, axis := range []struct {
				delta              float64
				negative, positive int
			}{{x, 6, 7}, {y, 4, 5}} {
				if axis.delta == 0 {
					continue
				}
				button := axis.positive
				if axis.delta < 0 {
					button = axis.negative
				}
				if err := command("click", "--clearmodifiers", "--repeat", strconv.Itoa(int(math.Ceil(math.Abs(axis.delta)/120))), "--delay", "10", strconv.Itoa(button))(ctx, e); err != nil {
					return err
				}
			}
			return nil
		}, nil
	case "computer.wait":
		ms, err := number("milliseconds", 0, 0, 30000)
		if err != nil {
			return nil, err
		}
		return func(ctx context.Context, _ *XvfbTargetExecutor) error {
			return x11Wait(ctx, time.Duration(ms)*time.Millisecond)
		}, nil
	case "computer.drag":
		from, err := point("from_x", "from_y")
		if err != nil {
			return nil, err
		}
		to, err := point("to_x", "to_y")
		if err != nil {
			return nil, err
		}
		ms, err := number("duration_ms", 0, 0, 5000)
		if err != nil {
			return nil, err
		}
		return func(ctx context.Context, e *XvfbTargetExecutor) (err error) {
			if err = command(append([]string{"mousemove", "--sync"}, from...)...)(ctx, e); err != nil {
				return err
			}
			defer func() {
				releaseCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
				defer cancel()
				err = errors.Join(err, command("mouseup", "1")(releaseCtx, e))
			}()
			if err = command("mousedown", "1")(ctx, e); err != nil {
				return err
			}
			if err = x11Wait(ctx, time.Duration(ms)*time.Millisecond); err != nil {
				return err
			}
			return command(append([]string{"mousemove", "--sync"}, to...)...)(ctx, e)
		}, nil
	default:
		return nil, errors.New("unsupported X11 tool")
	}
}

func x11Wait(ctx context.Context, duration time.Duration) error {
	timer := time.NewTimer(duration)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}
