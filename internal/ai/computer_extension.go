package ai

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/floegence/redeven/internal/browserbridge"
	"github.com/floegence/redeven/internal/session"
)

type ComputerExtensionSetup struct {
	NativeHost        string   `json:"native_host"`
	ExtensionID       string   `json:"extension_id"`
	ExtensionPath     string   `json:"extension_path"`
	ExtensionHomePath []string `json:"extension_home_path"`
	Platform          string   `json:"platform"`
}
type ComputerExtensionProfile struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}
type ComputerExtensionStatus struct {
	RuntimeVersion   string                       `json:"runtime_version,omitempty"`
	Hostname         string                       `json:"hostname,omitempty"`
	Platform         string                       `json:"platform,omitempty"`
	BrowserInstalled *bool                        `json:"browser_installed,omitempty"`
	Diagnostic       *ComputerExtensionDiagnostic `json:"diagnostic,omitempty"`
	Profiles         []ComputerExtensionProfile   `json:"profiles"`
	Prepared         bool                         `json:"prepared,omitempty"`
	Error            string                       `json:"error,omitempty"`
}

type computerExtensionHub struct {
	diagnostic       *ComputerExtensionDiagnostic
	launchGeneration uint64
	owner            *ComputerUseRuntime
	mu               sync.Mutex
	listener         net.Listener
	directory        string
	profiles         map[string]*computerExtensionClient
	closed           bool
	manifestPath     string
	manifestBytes    []byte
	wait             sync.WaitGroup
}
type computerExtensionClient struct {
	hub      *computerExtensionHub
	conn     net.Conn
	profile  ComputerExtensionProfile
	mu       sync.Mutex
	sequence uint64
	done     chan struct{}
	writeMu  sync.Mutex
	pending  map[string]chan json.RawMessage
	sources  map[string]*extensionSourcePipe
}

// Initial setup is an explicit local user command. Later Runtime starts restore
// that registration; neither path binds a tab or creates a thread grant.
func (s *Service) SetupComputerExtension(ctx context.Context, meta *session.Meta) (ComputerExtensionSetup, error) {
	if err := requireRWX(meta); err != nil {
		return ComputerExtensionSetup{}, err
	}
	host, ok := s.targetToolExecutor.(*ComputerUseRuntime)
	if !ok {
		return ComputerExtensionSetup{}, errors.New("computer runtime unavailable")
	}
	return host.setupComputerExtension(ctx)
}
func (r *ComputerUseRuntime) setupComputerExtension(ctx context.Context) (result ComputerExtensionSetup, failure error) {
	defer func() {
		if failure != nil {
			failure = extensionFailure("prepare", "extension_setup_failed", failure)
		}
	}()
	r.connectMu.Lock()
	defer r.connectMu.Unlock()
	if err := ctx.Err(); err != nil {
		return ComputerExtensionSetup{}, err
	}
	if runtime.GOOS != "darwin" && runtime.GOOS != "linux" {
		return ComputerExtensionSetup{}, errors.New("browser extension platform unavailable")
	}
	r.mu.RLock()
	closed := r.closed
	hub := r.extension
	r.mu.RUnlock()
	if closed {
		return ComputerExtensionSetup{}, errors.New("computer runtime closed")
	}
	managed, err := r.extensionResources()
	if err != nil {
		return ComputerExtensionSetup{}, err
	}
	resources := filepath.Join(filepath.Dir(managed.HelperPath), "extension")
	userHome, err := os.UserHomeDir()
	if err != nil {
		return ComputerExtensionSetup{}, err
	}
	setup := computerExtensionInstallLocation(userHome, managed.ProfileDir)
	if err := stageComputerExtension(resources, setup.ExtensionPath); err != nil {
		return ComputerExtensionSetup{}, err
	}
	if hub == nil {
		directory, err := os.MkdirTemp("/tmp", "redeven-chrome-")
		if err != nil {
			return ComputerExtensionSetup{}, err
		}
		socket := filepath.Join(directory, "bridge")
		listener, err := net.Listen("unix", socket)
		if err != nil {
			_ = os.RemoveAll(directory)
			return ComputerExtensionSetup{}, err
		}
		hub = &computerExtensionHub{owner: r, listener: listener, directory: directory, profiles: make(map[string]*computerExtensionClient)}
		r.mu.Lock()
		r.extension = hub
		r.mu.Unlock()
		hub.wait.Add(1)
		go hub.accept()
	}
	executable, err := os.Executable()
	if err != nil {
		return ComputerExtensionSetup{}, err
	}
	manifestDirectory := filepath.Join(userHome, ".config", "google-chrome", "NativeMessagingHosts")
	if runtime.GOOS == "darwin" {
		manifestDirectory = filepath.Join(userHome, "Library", "Application Support", "Google", "Chrome", "NativeMessagingHosts")
	}
	wrapper := filepath.Join(hub.directory, "native-host")
	quote := func(value string) string { return "'" + strings.ReplaceAll(value, "'", "'\\''") + "'" }
	script := "#!/bin/sh\nexec " + quote(executable) + " browser-bridge " + quote(filepath.Join(hub.directory, "bridge")) + " \"$@\"\n"
	if err := os.WriteFile(wrapper, []byte(script), 0700); err != nil {
		return ComputerExtensionSetup{}, err
	}
	manifest, _ := json.MarshalIndent(map[string]any{"name": setup.NativeHost, "description": "Flower browser connection", "path": wrapper, "type": "stdio", "allowed_origins": []string{"chrome-extension://" + browserbridge.ExtensionID + "/"}}, "", "  ")
	if err := os.MkdirAll(manifestDirectory, 0700); err != nil {
		return ComputerExtensionSetup{}, err
	}
	manifestPath := filepath.Join(manifestDirectory, setup.NativeHost+".json")
	manifest = append(manifest, '\n')
	if err := os.WriteFile(manifestPath, manifest, 0600); err != nil {
		return ComputerExtensionSetup{}, err
	}
	hub.mu.Lock()
	hub.manifestPath, hub.manifestBytes = manifestPath, manifest
	hub.diagnostic = nil
	hub.launchGeneration++
	hub.mu.Unlock()
	return setup, nil
}

// The stable staged package records prior setup, not Chrome installation or a
// live connection. Chrome must still confirm a protocol-compatible native hello.
func (r *ComputerUseRuntime) restoreComputerExtension(ctx context.Context) error {
	if runtime.GOOS != "darwin" && runtime.GOOS != "linux" {
		return nil
	}
	managed, ok := r.executors["browser-main"].(*PlaywrightTargetExecutor)
	if !ok {
		return nil
	}
	userHome, err := os.UserHomeDir()
	if err != nil {
		return err
	}
	setup := computerExtensionInstallLocation(userHome, managed.ProfileDir)
	info, err := os.Lstat(filepath.Join(setup.ExtensionPath, "manifest.json"))
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return errors.New("invalid browser extension installation manifest")
	}
	_, err = r.setupComputerExtension(ctx)
	return err
}

func computerExtensionInstallLocation(userHome, profileDir string) ComputerExtensionSetup {
	digest := sha256.Sum256([]byte(profileDir))
	identity := hex.EncodeToString(digest[:8])
	parts := []string{"Redeven", "Flower Browser " + identity}
	return ComputerExtensionSetup{NativeHost: "dev.floegence.redeven.r" + identity,
		ExtensionID: browserbridge.ExtensionID, ExtensionPath: filepath.Join(userHome, parts[0], parts[1]),
		ExtensionHomePath: parts, Platform: runtime.GOOS}
}

func (h *computerExtensionHub) accept() {
	defer h.wait.Done()
	for {
		conn, err := h.listener.Accept()
		if err != nil {
			return
		}
		h.wait.Add(1)
		go func() { defer h.wait.Done(); h.admit(conn) }()
	}
}
func (h *computerExtensionHub) admit(conn net.Conn) {
	admitted := false
	defer func() {
		if !admitted {
			_ = conn.Close()
		}
	}()
	_ = conn.SetDeadline(time.Now().Add(5 * time.Second))
	raw, err := browserbridge.ReadMessage(conn, 1<<20)
	if err != nil {
		return
	}
	var native struct {
		Type        string `json:"type"`
		Protocol    int    `json:"protocol_version"`
		ExtensionID string `json:"extension_id"`
	}
	if json.Unmarshal(raw, &native) != nil || native.Type != "native_host" || native.Protocol != browserbridge.ProtocolVersion || native.ExtensionID != browserbridge.ExtensionID {
		return
	}
	raw, err = browserbridge.ReadMessage(conn, 1<<20)
	if err != nil {
		return
	}
	var hello struct {
		Type      string `json:"type"`
		Protocol  int    `json:"protocol_version"`
		ProfileID string `json:"profile_id"`
		Name      string `json:"profile_name"`
	}
	if json.Unmarshal(raw, &hello) != nil || hello.Type != "hello" || len(hello.ProfileID) != 36 || len(hello.Name) == 0 || len(hello.Name) > 120 {
		return
	}
	if hello.Protocol != browserbridge.ProtocolVersion {
		h.mu.Lock()
		h.diagnostic = &ComputerExtensionDiagnostic{Stage: "check", Reason: "extension_update_required"}
		h.mu.Unlock()
		slog.Info("browser extension connection rejected", "reason", "extension_update_required", "protocol", hello.Protocol, "required_protocol", browserbridge.ProtocolVersion)
		_ = browserbridge.WriteMessage(conn, map[string]any{"type": "connection_error", "code": "extension_update_required"}, 1<<20)
		return
	}
	token := make([]byte, 16)
	if _, err := rand.Read(token); err != nil {
		return
	}
	client := &computerExtensionClient{hub: h, conn: conn, profile: ComputerExtensionProfile{ID: hex.EncodeToString(token), Name: hello.Name}, done: make(chan struct{}), pending: make(map[string]chan json.RawMessage)}
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.closed || len(h.profiles) >= 16 {
		return
	}
	if browserbridge.WriteMessage(conn, map[string]any{"type": "ready", "protocol_version": browserbridge.ProtocolVersion}, 1<<20) != nil {
		return
	}
	_ = conn.SetDeadline(time.Time{})
	h.profiles[client.profile.ID] = client
	h.diagnostic = nil
	admitted = true
	h.wait.Add(1)
	go client.read()
}
func (c *computerExtensionClient) read() {
	defer c.hub.wait.Done()
	defer func() {
		_ = c.conn.Close()
		c.hub.mu.Lock()
		delete(c.hub.profiles, c.profile.ID)
		c.hub.mu.Unlock()
		close(c.done)
		c.mu.Lock()
		pipes := make([]*extensionSourcePipe, 0, len(c.sources))
		for _, pipe := range c.sources {
			pipes = append(pipes, pipe)
		}
		c.mu.Unlock()
		for _, pipe := range pipes {
			pipe.close()
		}
		if c.hub.owner != nil {
			c.hub.owner.retireExtensionTargets(c, "")
		}
	}()
	for {
		raw, err := browserbridge.ReadMessage(c.conn, browserbridge.MaxMessageBytes)
		if err != nil {
			return
		}
		var envelope struct {
			ID       string `json:"id"`
			Type     string `json:"type"`
			TabID    string `json:"tab_id"`
			Binding  string `json:"binding"`
			Sequence uint64 `json:"sequence"`
		}
		if json.Unmarshal(raw, &envelope) != nil {
			return
		}
		if envelope.Type == "cdp_event" && envelope.ID == "" {
			c.mu.Lock()
			pipe := c.sources[envelope.Binding]
			c.mu.Unlock()
			if pipe == nil || pipe.tab != envelope.TabID || !pipe.enqueue(raw) {
				_ = c.write(map[string]any{"type": "cdp_ack", "sequence": envelope.Sequence})
			}
			continue
		}
		if envelope.Type == "target_unavailable" && envelope.ID == "" {
			if _, err := strconv.ParseUint(envelope.TabID, 10, 32); err != nil {
				return
			}
			if c.hub.owner != nil {
				c.hub.owner.retireExtensionTargets(c, envelope.TabID)
			}
			continue
		}
		if envelope.ID == "" || envelope.Type != "" {
			return
		}
		c.mu.Lock()
		response, exists := c.pending[envelope.ID]
		delete(c.pending, envelope.ID)
		c.mu.Unlock()
		if !exists {
			return
		}
		response <- raw
	}
}

func (r *ComputerUseRuntime) retireExtensionTargets(client *computerExtensionClient, tabID string) {
	retired := make(map[string]bool)
	var pipes []*extensionSourcePipe
	r.mu.Lock()
	for id, executor := range r.executors {
		if extension, ok := executor.(*extensionTargetExecutor); ok && extension.client == client && (tabID == "" || extension.tabID == tabID) {
			retired[id] = true
			pipes = append(pipes, extension.pipe)
			delete(r.executors, id)
			delete(r.controls, id)
			r.registry.remove(id)
			if sampler := r.liveFrames[id]; sampler != nil {
				sampler.cancel()
			}
		}
	}
	r.mu.Unlock()
	for _, pipe := range pipes {
		pipe.close()
	}
	r.releaseScripts(func(key computerScriptKey) bool { return retired[key.target] })
}
func (c *computerExtensionClient) write(message any) error {
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	_ = c.conn.SetWriteDeadline(time.Now().Add(2 * time.Second))
	defer func() { _ = c.conn.SetWriteDeadline(time.Time{}) }()
	err := browserbridge.WriteMessage(c.conn, message, 1<<20)
	if err != nil {
		_ = c.conn.Close()
	}
	return err
}
func (c *computerExtensionClient) call(ctx context.Context, kind string, arguments any) (json.RawMessage, error) {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	c.mu.Lock()
	select {
	case <-c.done:
		c.mu.Unlock()
		return nil, errors.New("extension disconnected")
	default:
	}
	if len(c.pending) >= 64 {
		c.mu.Unlock()
		return nil, errors.New("extension command limit")
	}
	c.sequence++
	id := fmt.Sprint(c.sequence)
	response := make(chan json.RawMessage, 1)
	c.pending[id] = response
	c.mu.Unlock()
	if err := c.write(map[string]any{"id": id, "command": kind, "arguments": arguments}); err != nil {
		return nil, err
	}
	var raw json.RawMessage
	select {
	case <-ctx.Done():
		// Cancellation belongs to this command, never to another tab sharing
		// the native profile connection. The eventual reply retires its slot.
		_ = c.write(map[string]any{"type": "cancel", "id": id})
		return nil, ctx.Err()
	case <-c.done:
		return nil, errors.New("extension disconnected")
	case raw = <-response:
	}
	// CDP replies retain their credit until the source helper has consumed
	// the frame. A read into the Runtime queue is not delivery acknowledgement.
	if kind == "cdp" {
		return raw, nil
	}
	var result struct {
		Result json.RawMessage `json:"result"`
		Error  string          `json:"error"`
	}
	if json.Unmarshal(raw, &result) != nil {
		_ = c.conn.Close()
		return nil, errors.New("invalid extension response")
	}
	if result.Error != "" {
		return nil, errors.New("extension command rejected")
	}
	return result.Result, nil
}

func (h *computerExtensionHub) close() {
	h.mu.Lock()
	h.closed = true
	_ = h.listener.Close()
	for _, client := range h.profiles {
		_ = client.conn.Close()
	}
	clear(h.profiles)
	h.mu.Unlock()
	h.wait.Wait()
	// Remove only the exact registration written by this Runtime. Another
	// process may have explicitly replaced it while this one was shutting down.
	if body, err := os.ReadFile(h.manifestPath); err == nil && string(body) == string(h.manifestBytes) {
		_ = os.Remove(h.manifestPath)
	}
	_ = os.RemoveAll(h.directory)
}
func (r *ComputerUseRuntime) extensionClient(profileID string) (*computerExtensionClient, error) {
	r.mu.RLock()
	hub := r.extension
	r.mu.RUnlock()
	if hub == nil {
		return nil, errors.New("browser extension is not connected")
	}
	hub.mu.Lock()
	defer hub.mu.Unlock()
	client := hub.profiles[profileID]
	if client == nil {
		return nil, errors.New("browser profile is not connected")
	}
	return client, nil
}
func (s *Service) ComputerExtensionConnectionStatus(ctx context.Context, meta *session.Meta) (ComputerExtensionStatus, error) {
	if err := requireRWX(meta); err != nil {
		return ComputerExtensionStatus{}, err
	}
	host, ok := s.targetToolExecutor.(*ComputerUseRuntime)
	if !ok {
		return ComputerExtensionStatus{}, errors.New("computer runtime unavailable")
	}
	status := host.extensionStatus()
	status.RuntimeVersion = s.buildVersion
	return status, nil
}

// One bounded Runtime snapshot owns connection inventory and handshake failure.
// It contains no browser content and does not create a conversation interaction.
func (r *ComputerUseRuntime) extensionStatus() ComputerExtensionStatus {
	r.mu.RLock()
	hub := r.extension
	r.mu.RUnlock()
	status := ComputerExtensionStatus{Profiles: []ComputerExtensionProfile{}, Platform: runtime.GOOS}
	status.Hostname, _ = os.Hostname()
	if runtime.GOOS == "linux" {
		installed := chromeExecutableAvailable()
		status.BrowserInstalled = &installed
	}
	if hub != nil {
		hub.mu.Lock()
		status.Prepared = !hub.closed && hub.manifestPath != ""
		status.Diagnostic = hub.diagnostic
		if hub.diagnostic != nil && hub.diagnostic.Reason == "extension_update_required" {
			status.Error = hub.diagnostic.Reason
			status.Diagnostic = nil
		}
		for _, client := range hub.profiles {
			status.Profiles = append(status.Profiles, client.profile)
		}
		hub.mu.Unlock()
	}
	if len(status.Profiles) == 0 && status.Diagnostic == nil && status.Error == "" {
		if _, err := r.extensionResources(); err != nil {
			diagnostic := ComputerExtensionDiagnosticForError(err, "prepare")
			diagnostic.DiagnosticID = ""
			status.Diagnostic = &diagnostic
		} else if err := checkComputerExtensionOpen(runtime.GOOS, "extensions", os.Getenv, exec.LookPath); err != nil {
			diagnostic := ComputerExtensionDiagnosticForError(err, "open")
			diagnostic.DiagnosticID = ""
			status.Diagnostic = &diagnostic
		}
	}
	sort.Slice(status.Profiles, func(i, j int) bool { return status.Profiles[i].ID < status.Profiles[j].ID })
	return status
}

func (s *Service) ComputerExtensionTabs(ctx context.Context, meta *session.Meta, profileID string) ([]ComputerBrowserTab, error) {
	if err := requireRWX(meta); err != nil {
		return nil, err
	}
	host, ok := s.targetToolExecutor.(*ComputerUseRuntime)
	if !ok {
		return nil, errors.New("computer runtime unavailable")
	}
	return host.extensionTabs(ctx, profileID)
}

func (client *computerExtensionClient) tabs(ctx context.Context) ([]ComputerBrowserTab, error) {
	profileID := client.profile.ID
	raw, err := client.call(ctx, "inventory", nil)
	if err != nil {
		return nil, err
	}
	var tabs []ComputerBrowserTab
	if json.Unmarshal(raw, &tabs) != nil || len(tabs) > 128 {
		return nil, errors.New("invalid browser inventory")
	}
	for i := range tabs {
		tabs[i].ProfileID = profileID
	}
	return tabs, nil
}

func (r *ComputerUseRuntime) connectExtensionBrowser(ctx context.Context, connection ComputerBrowserConnection, targetID string) (TargetDescriptor, error) {
	client, err := r.extensionClient(connection.ExtensionProfileID)
	if err != nil {
		return TargetDescriptor{}, err
	}
	if !connection.NewTab {
		tabs, err := client.tabs(ctx)
		if err != nil {
			return TargetDescriptor{}, err
		}
		tabs, err = r.browserInventoryPrivacy(ctx, "extension:"+client.profile.ID, tabs)
		if err != nil {
			return TargetDescriptor{}, err
		}
		for _, tab := range tabs {
			if tab.ID == connection.TabID && tab.Private {
				return TargetDescriptor{}, errBrowserViewUnavailable
			}
		}
	}
	command := "bind"
	if connection.NewTab {
		command = "new_tab"
	} else if connection.TabID == "" {
		return TargetDescriptor{}, errors.New("select a browser tab")
	}
	raw, err := client.call(ctx, command, map[string]any{"tab_id": connection.TabID, "tab_title": connection.TabTitle, "tab_url": connection.TabURL})
	if err != nil {
		if connection.NewTab {
			return TargetDescriptor{}, errBrowserOutcomeUnknown
		}
		return TargetDescriptor{}, err
	}
	var binding struct {
		TabID   string `json:"tab_id"`
		Title   string `json:"title"`
		Binding string `json:"binding"`
	}
	if json.Unmarshal(raw, &binding) != nil || binding.TabID == "" || len(binding.Binding) != 36 {
		if connection.NewTab {
			return TargetDescriptor{}, errBrowserOutcomeUnknown
		}
		return TargetDescriptor{}, errors.New("invalid browser binding")
	}
	if targetID == "" {
		targetID = r.extensionTabTargetID(client.profile.ID, binding.TabID)
	}
	if targetID == "" {
		// A later explicit binding of the same native tab cannot inherit old
		// observation grants or be removed by its delayed close notification.
		targetID = "chrome-" + client.profile.ID + "-" + binding.Binding
	}
	r.mu.RLock()
	previous, exists := r.executors[targetID].(*extensionTargetExecutor)
	closed := r.closed
	r.mu.RUnlock()
	if closed {
		return TargetDescriptor{}, errors.New("computer runtime closed")
	}
	if exists && (previous.client != client || previous.tabID != binding.TabID || previous.pipe.binding != binding.Binding) {
		return TargetDescriptor{}, errors.New("browser source identity changed")
	}
	if !exists {
		host, err := r.browserSourceHostLocked(ctx)
		if err != nil {
			return TargetDescriptor{}, err
		}
		pipe, err := host.attachExtension(ctx, client, targetID, binding.TabID, binding.Binding)
		if err != nil {
			return TargetDescriptor{}, err
		}
		if err = host.call(ctx, "source.admit", map[string]any{"id": targetID, "extension": targetID, "extensionProfile": client.profile.ID, "tab": binding.TabID}, nil); err != nil {
			pipe.close()
			return TargetDescriptor{}, err
		}
		previous = &extensionTargetExecutor{client: client, tabID: binding.TabID, targetID: targetID, sourceHost: host, pipe: pipe}
	}
	target := TargetDescriptor{ID: targetID, Kind: "browser.connected", DisplayName: client.profile.Name + " — " + binding.Title, Locality: "local", Capabilities: []string{"observe", "interaction"}, State: "ready", PermissionState: "granted", Ready: true}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closed {
		previous.pipe.close()
		return TargetDescriptor{}, errors.New("computer runtime closed")
	}
	r.executors[targetID] = previous
	return target, r.registry.Register(target)
}

type extensionTargetExecutor struct {
	client          *computerExtensionClient
	tabID, targetID string
	sourceHost      *browserSourceHost
	pipe            *extensionSourcePipe
}

func (e *extensionTargetExecutor) setBrowserPrivacy(ctx context.Context, target string, private bool) error {
	if e.sourceHost == nil {
		return errors.New("extension source unavailable")
	}
	var owner any
	if private {
		owner = ""
	}
	return e.sourceHost.call(ctx, "view.privacy", map[string]any{"target": target, "view": owner}, nil)
}

func (e *extensionTargetExecutor) ExecuteTargetTool(ctx context.Context, call TargetToolCall) (TargetToolResult, error) {
	return e.execute(ctx, call, false)
}
func (e *extensionTargetExecutor) ExecuteComputerUserInput(ctx context.Context, call TargetToolCall) ([]byte, error) {
	if err := e.setBrowserPrivacy(ctx, call.TargetID, true); err != nil {
		return nil, err
	}
	result, err := e.execute(ctx, call, true)
	return result.frameBytes, err
}
func (e *extensionTargetExecutor) execute(ctx context.Context, call TargetToolCall, private bool) (TargetToolResult, error) {
	var out TargetToolResult
	var args map[string]any
	if len(call.Arguments) > 0 && json.Unmarshal(call.Arguments, &args) != nil {
		return out, computerTargetFailure(call, "INVALID_REQUEST")
	}
	if e.sourceHost == nil || call.TargetID != e.targetID {
		return out, computerTargetFailure(call, "TARGET_CONNECTION_REQUIRED")
	}
	failedExchange := func(err error) (TargetToolResult, error) {
		return TargetToolResult{}, computerBrowserExchangeFailure(call, private, err)
	}
	var raw json.RawMessage
	err := e.sourceHost.call(ctx, "source.tool", map[string]any{"target": e.targetID, "request": map[string]any{"target_id": e.targetID, "tool_name": call.ToolName, "args": args, "full_access": call.fullAccess, "allowed_origins": call.allowedOrigins, "script_operation": call.scriptOperation, "return_control": call.controlReturn, "user_control": private}}, &raw)
	if err != nil {
		cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		drained := e.sourceHost.call(cleanup, "source.cancel", map[string]string{"target": e.targetID}, nil)
		cancel()
		if drained != nil && e.pipe != nil {
			e.pipe.close()
		}
		return failedExchange(err)
	}

	var response struct {
		Result       map[string]any             `json:"result"`
		Safety       *InteractionSafetyDecision `json:"safety"`
		Error        string                     `json:"error"`
		Acknowledged bool                       `json:"acknowledged"`
		Screenshot   *struct {
			MIME string `json:"mime"`
			Data string `json:"data"`
		} `json:"screenshot"`
	}
	if json.Unmarshal(raw, &response) != nil {
		return failedExchange(errors.New("invalid extension result"))
	}
	if response.Error != "" {
		result, err, _ := computerBrowserFailure(call, private, response.Error, response.Result, "connected_browser")
		return result, err
	}
	out = TargetToolResult{TargetID: call.TargetID, ExecutionLocation: "connected_browser", Result: response.Result, Safety: response.Safety}
	if !private && response.Safety != nil && !response.Safety.SafeToSendToModel {
		return out, nil
	}
	if private && call.ToolName != "computer.screenshot" {
		if !response.Acknowledged || response.Screenshot != nil {
			return failedExchange(errors.New("invalid private input acknowledgement"))
		}
		return out, nil
	}
	if response.Screenshot != nil {
		body, err := base64.StdEncoding.DecodeString(response.Screenshot.Data)
		if err != nil || len(body) > maxComputerFrameBytes || response.Screenshot.MIME != "image/png" {
			return failedExchange(errors.New("invalid extension screenshot"))
		}
		out.frameBytes = body
		if !private {
			sum := sha256.Sum256(body)
			hash := hex.EncodeToString(sum[:])
			ref := "computer://" + call.TargetID + "/" + hash
			out.Attachments = []TargetToolAttachment{{ResourceRef: ref, Name: "browser-screenshot.png", MIMEType: "image/png", SizeBytes: int64(len(body)), SHA256: hash}}
			if out.Result == nil {
				out.Result = map[string]any{}
			}
			out.Result.(map[string]any)["after_frame"] = ref
		}
	}
	return out, nil
}

func (e *extensionTargetExecutor) EnsureTargetReady(ctx context.Context, target string) error {
	if e.sourceHost == nil || target != e.targetID || e.sourceHost.call(ctx, "source.ready", map[string]string{"target": target}, nil) != nil {
		return &TargetStartupError{Code: "TARGET_CONNECTION_REQUIRED", Reason: "browser_tab_disconnected"}
	}
	return nil
}
func (e *extensionTargetExecutor) Close() error {
	if e.sourceHost == nil {
		e.pipe.close()
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	err := e.sourceHost.call(ctx, "source.remove", map[string]string{"target": e.targetID}, nil)
	e.pipe.close()
	return err
}

// Browser source setup and inventory do not require an AI provider or service.
func (r *ComputerUseRuntime) BrowserExtensionSetup(ctx context.Context, meta *session.Meta) (ComputerExtensionSetup, error) {
	if err := requireRWX(meta); err != nil {
		return ComputerExtensionSetup{}, err
	}
	return r.setupComputerExtension(ctx)
}
func (r *ComputerUseRuntime) BrowserExtensionStatus(meta *session.Meta) (ComputerExtensionStatus, error) {
	if err := requireRWX(meta); err != nil {
		return ComputerExtensionStatus{}, err
	}
	return r.extensionStatus(), nil
}
func (r *ComputerUseRuntime) BrowserExtensionTabs(ctx context.Context, meta *session.Meta, profile string) ([]ComputerBrowserTab, error) {
	if err := requireRWX(meta); err != nil {
		return nil, err
	}
	return r.extensionTabs(ctx, profile)
}
