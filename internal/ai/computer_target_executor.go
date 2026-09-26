package ai

import (
	"bufio"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// PlaywrightTargetExecutor is the headless Linux BrowserTarget. The Node
// helper owns Playwright and browser profiles; this process owns target policy
// and opaque screenshot attachment bytes.
type PlaywrightTargetExecutor struct {
	ManagedAttachment bool
	DownloadDir       string
	NodeBinary        string
	HelperPath        string
	ProfileDir        string
	CDPURL            string
	TabID             string
	BrowserContextID  string
	Timeout           time.Duration
	sourceHost        *browserSourceHost
	runtimeManaged    bool

	shutdown chan struct{}
	stopOnce sync.Once
	mu       sync.Mutex
	closed   bool
	clients  map[string]*playwrightTargetClient
	mediaMu  sync.RWMutex
	media    map[string][]byte
}

type playwrightTargetClient struct {
	host   *browserSourceHost
	target string
	cmd    *exec.Cmd
	stdin  io.WriteCloser
	reader *bufio.Reader
}

type playwrightTargetRequest struct {
	FullAccess      bool           `json:"full_access"`
	AllowedOrigins  []string       `json:"allowed_origins"`
	ScriptOperation bool           `json:"script_operation,omitempty"`
	UserControl     bool           `json:"user_control,omitempty"`
	ReturnControl   bool           `json:"return_control,omitempty"`
	ID              string         `json:"id"`
	TargetID        string         `json:"target_id"`
	ToolName        string         `json:"tool_name"`
	Args            map[string]any `json:"args"`
}

type playwrightTargetResponse struct {
	Acknowledged bool                       `json:"acknowledged,omitempty"`
	Safety       *InteractionSafetyDecision `json:"safety,omitempty"`
	ID           string                     `json:"id"`
	TargetID     string                     `json:"target_id"`
	Location     string                     `json:"execution_location"`
	Result       map[string]any             `json:"result"`
	Error        string                     `json:"error,omitempty"`
	Screenshot   *struct {
		MIME string `json:"mime"`
		Data string `json:"data"`
	} `json:"screenshot,omitempty"`
}

type playwrightTargetReady struct {
	Type            string `json:"type"`
	ProtocolVersion int    `json:"protocol_version"`
	Error           string `json:"error,omitempty"`
	Reason          string `json:"reason,omitempty"`
}

func NewPlaywrightTargetExecutor(nodeBinary, helperPath, profileDir string) *PlaywrightTargetExecutor {
	return &PlaywrightTargetExecutor{shutdown: make(chan struct{}), NodeBinary: nodeBinary, HelperPath: helperPath, ProfileDir: profileDir, Timeout: 30 * time.Second, clients: map[string]*playwrightTargetClient{}, media: map[string][]byte{}}
}

// CheckComputerSetup reports installed entrypoints without launching Chromium.
func (e *PlaywrightTargetExecutor) CheckComputerSetup() error {
	for _, resource := range []struct {
		path, reason string
		executable   bool
	}{
		{e.NodeBinary, "browser_node_missing", true}, {e.HelperPath, "browser_helper_missing", false},
	} {
		info, err := os.Stat(resource.path)
		if !filepath.IsAbs(resource.path) || err != nil || !info.Mode().IsRegular() || (resource.executable && info.Mode()&0111 == 0) {
			return &TargetStartupError{Code: "TARGET_SETUP_REQUIRED", Reason: resource.reason}
		}
	}
	return nil
}

func (e *PlaywrightTargetExecutor) EnsureTargetReady(ctx context.Context, targetID string) error {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.closed {
		return errors.New("browser target executor is closed")
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	_, err := e.clientLocked(ctx, targetID)
	return err
}

func (e *PlaywrightTargetExecutor) ExecuteTargetTool(ctx context.Context, call TargetToolCall) (TargetToolResult, error) {
	return e.executeTargetTool(ctx, call, false)
}

// User input uses the same serialized browser exchange, but its frames and
// inputs never enter model attachments, activity, or the executor media cache.
func (e *PlaywrightTargetExecutor) ExecuteComputerUserInput(ctx context.Context, call TargetToolCall) ([]byte, error) {
	if err := e.setBrowserPrivacy(ctx, call.TargetID, true); err != nil {
		return nil, err
	}
	result, err := e.executeTargetTool(ctx, call, true)
	return result.frameBytes, err
}

// Called by Runtime under the existing target gate. Private Flower input and
// browser windows share the same source observation barrier.
func (e *PlaywrightTargetExecutor) setBrowserPrivacy(ctx context.Context, target string, private bool) error {
	if e.sourceHost == nil {
		return nil
	}
	var owner any
	if private {
		owner = ""
	}
	return e.sourceHost.call(ctx, "view.privacy", map[string]any{"target": target, "view": owner}, nil)
}

func (e *PlaywrightTargetExecutor) executeTargetTool(ctx context.Context, call TargetToolCall, userControl bool) (TargetToolResult, error) {
	if e == nil || strings.TrimSpace(e.HelperPath) == "" {
		return TargetToolResult{}, errors.New("browser target helper is unavailable")
	}
	targetID := strings.TrimSpace(call.TargetID)
	if targetID == "" {
		return TargetToolResult{}, errors.New("target_id is required")
	}
	if strings.ContainsAny(targetID, `/\\`) || targetID == "." || targetID == ".." {
		return TargetToolResult{}, errors.New("invalid target_id")
	}
	args := map[string]any{}
	if len(call.Arguments) > 0 && string(call.Arguments) != "null" {
		if err := json.Unmarshal(call.Arguments, &args); err != nil {
			return TargetToolResult{}, fmt.Errorf("invalid target arguments: %w", err)
		}
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.closed {
		return TargetToolResult{}, errors.New("browser target executor is closed")
	}
	if err := ctx.Err(); err != nil {
		return TargetToolResult{}, err
	}
	client, err := e.clientLocked(ctx, targetID)
	if err != nil {
		return TargetToolResult{}, err
	}
	// A response reader belongs to exactly one action. Once interrupted, retire
	// the session before accepting another action so late replies cannot leak
	// into the next tool result. Never replay an uncertain action automatically.
	healthy := false
	defer func() {
		if !healthy {
			_ = stopPlaywrightClient(client)
			delete(e.clients, targetID)
		}
	}()
	requestID := fmt.Sprintf("%s-%d", strings.TrimSpace(call.ToolCallID), time.Now().UnixNano())
	request := playwrightTargetRequest{FullAccess: call.fullAccess, AllowedOrigins: call.allowedOrigins, ScriptOperation: call.scriptOperation, ID: requestID, TargetID: targetID, ToolName: strings.TrimSpace(call.ToolName), Args: args, UserControl: userControl, ReturnControl: call.controlReturn}
	failedExchange := func(err error) (TargetToolResult, error) {
		return TargetToolResult{}, computerBrowserExchangeFailure(call, userControl, err)
	}
	line, err := e.exchange(ctx, client, request)
	if err != nil {
		return failedExchange(err)
	}
	var response playwrightTargetResponse
	if err := json.Unmarshal(line, &response); err != nil {
		return failedExchange(fmt.Errorf("invalid browser helper response: %w", err))
	}
	if response.ID != requestID || response.TargetID != targetID {
		return failedExchange(errors.New("browser helper response provenance mismatch"))
	}
	if strings.TrimSpace(response.Error) != "" {
		result, err, valid := computerBrowserFailure(call, userControl, response.Error, response.Result, response.Location)
		healthy = valid && !errors.Is(err, errComputerEffectUnknown)
		return result, err
	}
	if userControl && call.ToolName != "computer.screenshot" {
		if !response.Acknowledged || response.Screenshot != nil {
			return failedExchange(errors.New("invalid private input acknowledgement"))
		}
		healthy = true
		return TargetToolResult{}, nil
	}
	result := TargetToolResult{TargetID: targetID, ExecutionLocation: response.Location, Result: response.Result, Safety: response.Safety}
	if response.Result != nil {
		result.ActionSummary = strings.TrimSpace(anyToString(response.Result["summary"]))
	}
	if !userControl && result.Safety != nil && (!result.Safety.SafeToCapture || !result.Safety.SafeToSendToModel) {
		healthy = true
		return result, nil
	}
	if response.Screenshot != nil && strings.TrimSpace(response.Screenshot.Data) != "" {
		body, err := base64.StdEncoding.DecodeString(response.Screenshot.Data)
		if err != nil {
			return failedExchange(fmt.Errorf("decode browser screenshot: %w", err))
		}
		result.frameBytes = body
		if userControl {
			if response.Screenshot.MIME != "image/png" {
				return failedExchange(errors.New("invalid private frame media"))
			}
			healthy = true
			return result, nil
		}
		sum := sha256.Sum256(body)
		ref := "computer://" + targetID + "/" + hex.EncodeToString(sum[:])
		e.mediaMu.Lock()
		e.media[ref] = append([]byte(nil), body...)
		e.mediaMu.Unlock()
		mime := strings.TrimSpace(response.Screenshot.MIME)
		if mime == "" {
			mime = "image/png"
		}
		result.Attachments = []TargetToolAttachment{{ResourceRef: ref, Name: "browser-screenshot.png", MIMEType: mime, SizeBytes: int64(len(body)), SHA256: hex.EncodeToString(sum[:])}}
		if payload, ok := result.Result.(map[string]any); ok {
			payload["before_frame"] = ref
			payload["after_frame"] = ref
			payload["screenshot"] = ref
			result.Result = payload
		}
	}
	healthy = true
	return result, nil
}

func (e *PlaywrightTargetExecutor) clientLocked(ctx context.Context, targetID string) (*playwrightTargetClient, error) {
	if client := e.clients[targetID]; client != nil {
		if client.host != nil {
			if err := client.host.call(ctx, "source.ready", map[string]string{"target": targetID}, nil); err != nil {
				return nil, &TargetStartupError{Code: "TARGET_CONNECTION_REQUIRED", Reason: "browser_connection_failed"}
			}
		}
		return client, nil
	}
	if e.sourceHost != nil {
		descriptor := map[string]any{"id": targetID, "endpoint": e.CDPURL, "tab": e.TabID, "context": e.BrowserContextID, "managed": e.ManagedAttachment}
		if e.ManagedAttachment {
			descriptor["downloadDirectory"] = e.DownloadDir
		}
		var admitted string
		if err := e.sourceHost.call(ctx, "source.admit", descriptor, &admitted); err != nil {
			return nil, &TargetStartupError{Code: "TARGET_CONNECTION_REQUIRED", Reason: "browser_connection_failed"}
		}
		if admitted != targetID {
			return nil, errors.New("browser source admission provenance mismatch")
		}
		client := &playwrightTargetClient{host: e.sourceHost, target: targetID}
		e.clients[targetID] = client
		return client, nil
	}
	if e.runtimeManaged {
		return nil, &TargetStartupError{Code: "TARGET_CONNECTION_REQUIRED", Reason: "browser_connection_failed"}
	}
	if !filepath.IsAbs(e.NodeBinary) || !filepath.IsAbs(e.HelperPath) || !filepath.IsAbs(e.ProfileDir) {
		return nil, &TargetStartupError{Code: "TARGET_SETUP_REQUIRED", Reason: "browser_paths_not_absolute"}
	}
	profile := e.ProfileDir
	profile = filepath.Join(profile, targetID)
	if err := os.MkdirAll(profile, 0o700); err != nil {
		return nil, err
	}
	// The helper is a target-scoped session, so it must outlive the individual
	// tool call that created it. Binding the child to that call's context would
	// terminate the browser immediately after the first action and make every
	// subsequent action fail with a broken pipe.
	args := []string{e.HelperPath, "--profile", profile, "--target-id", targetID}
	if strings.TrimSpace(e.CDPURL) != "" {
		args = append(args, "--cdp-url", e.CDPURL, "--tab-id", e.TabID, "--browser-context-id", e.BrowserContextID)
	}
	if e.ManagedAttachment {
		args = append(args, "--managed-attachment", "--download-dir", e.DownloadDir)
	}
	cmd := exec.Command(e.NodeBinary, args...)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	cmd.Stderr = io.Discard
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	client := &playwrightTargetClient{cmd: cmd, stdin: stdin, reader: bufio.NewReader(stdout)}
	ready := false
	defer func() {
		if !ready {
			_ = stopPlaywrightClient(client)
		}
	}()
	readyCh := make(chan []byte, 1)
	errCh := make(chan error, 1)
	go func() {
		line, readErr := readComputerLine(client.reader, 24<<20)
		if readErr != nil {
			errCh <- readErr
			return
		}
		readyCh <- bytes.TrimSpace(line)
	}()
	readyTimeout := e.Timeout
	if readyTimeout <= 0 {
		readyTimeout = 30 * time.Second
	}
	timer := time.NewTimer(readyTimeout)
	defer timer.Stop()
	select {
	case <-e.shutdown:
		return nil, errors.New("browser target disconnected")
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-timer.C:
		return nil, context.DeadlineExceeded
	case <-errCh:
		return nil, &TargetStartupError{Code: "TARGET_SETUP_REQUIRED", Reason: "browser_handshake_missing"}
	case line := <-readyCh:
		var handshake playwrightTargetReady
		if err := json.Unmarshal(line, &handshake); err != nil || handshake.Type != "ready" || handshake.ProtocolVersion != 6 {
			return nil, &TargetStartupError{Code: "TARGET_SETUP_REQUIRED", Reason: "browser_handshake_invalid"}
		}
		if handshake.Error != "" {
			code := handshake.Error
			if code != "TARGET_CONNECTION_REQUIRED" {
				code = "TARGET_SETUP_REQUIRED"
			}
			reason := "browser_launch_failed"
			switch handshake.Reason {
			case "browser_dependency_missing", "browser_connection_failed", "browser_launch_failed":
				reason = handshake.Reason
			}
			return nil, &TargetStartupError{Code: code, Reason: reason}
		}
	}
	ready = true
	e.clients[targetID] = client
	return client, nil
}

func (e *PlaywrightTargetExecutor) ResolveTargetToolAttachment(_ context.Context, resourceRef string) ([]byte, error) {
	e.mediaMu.RLock()
	body, ok := e.media[strings.TrimSpace(resourceRef)]
	e.mediaMu.RUnlock()
	if !ok {
		return nil, errors.New("unknown target attachment")
	}
	return append([]byte(nil), body...), nil
}

func (e *PlaywrightTargetExecutor) Close() error {
	e.stopOnce.Do(func() {
		if e.shutdown != nil {
			close(e.shutdown)
		}
	})
	e.mu.Lock()
	defer e.mu.Unlock()
	e.closed = true
	var failures []error
	for id, client := range e.clients {
		failures = append(failures, stopPlaywrightClient(client))
		delete(e.clients, id)
	}
	return errors.Join(failures...)
}

func stopPlaywrightClient(client *playwrightTargetClient) error {
	if client.host != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		return client.host.call(ctx, "source.remove", map[string]string{"target": client.target}, nil)
	}
	_ = client.stdin.Close()
	// Give Playwright a chance to close its Chromium children and profile lock.
	done := make(chan struct{})
	go func() { _ = client.cmd.Wait(); close(done) }()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		_ = client.cmd.Process.Kill()
		<-done
	}
	return nil
}

func (e *PlaywrightTargetExecutor) exchange(ctx context.Context, client *playwrightTargetClient, request playwrightTargetRequest) ([]byte, error) {
	timeout := e.Timeout
	if timeout <= 0 {
		timeout = 30 * time.Second
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	type reply struct {
		body []byte
		err  error
	}
	done := make(chan reply, 1)
	go func() {
		if client.host != nil {
			var body json.RawMessage
			err := client.host.call(ctx, "source.tool", map[string]any{"target": client.target, "request": request}, &body)
			done <- reply{body, err}
			return
		}
		payload, err := json.Marshal(request)
		if err == nil {
			_, err = client.stdin.Write(append(payload, '\n'))
		}
		if err != nil {
			done <- reply{err: err}
			return
		}
		line, err := readComputerLine(client.reader, 24<<20)
		done <- reply{bytes.TrimSpace(line), err}
	}()
	select {
	case <-e.shutdown:
		return nil, errors.New("browser target disconnected")
	case <-ctx.Done():
		return nil, ctx.Err()
	case response := <-done:
		return response.body, response.err
	}
}

func (e *PlaywrightTargetExecutor) releaseTargetFrame(ref string) {
	e.mediaMu.Lock()
	defer e.mediaMu.Unlock()
	delete(e.media, ref)
}
