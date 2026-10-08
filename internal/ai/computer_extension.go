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
	"sync"
	"time"

	"github.com/floegence/redeven/internal/browserbridge"
	"github.com/floegence/redeven/internal/session"
)

type ComputerExtensionSetup struct {
	InstallationID    string   `json:"installation_id"`
	BrowserName       string   `json:"browser_name"`
	NativeHost        string   `json:"native_host"`
	ExtensionID       string   `json:"extension_id"`
	ExtensionPath     string   `json:"extension_path"`
	ExtensionHomePath []string `json:"extension_home_path"`
	Platform          string   `json:"platform"`
}
type ComputerExtensionProfile struct {
	InstallationID string `json:"installation_id"`
	LibraryID      string `json:"library_id"`
	ID             string `json:"id"`
	Name           string `json:"name"`
}
type ComputerExtensionStatus struct {
	Installations    []browserbridge.Installation `json:"installations"`
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
	owner         *ComputerUseRuntime
	mu            sync.Mutex
	registrations map[string]*computerExtensionRegistration
	profiles      map[string]*computerExtensionClient
	closed        bool
	wait          sync.WaitGroup
}
type computerExtensionClient struct {
	hub               *computerExtensionHub
	conn              net.Conn
	profile           ComputerExtensionProfile
	mu                sync.Mutex
	sequence          uint64
	done              chan struct{}
	writeMu           sync.Mutex
	pending           map[string]chan json.RawMessage
	sources           map[string]*extensionSourcePipe
	directoryRevision uint64
	directoryTabs     []ComputerBrowserTab
}

// Initial setup is an explicit local user command. Later Runtime starts restore
// that registration; neither path binds a tab or creates a thread grant.
func (s *Service) SetupComputerExtension(ctx context.Context, meta *session.Meta, installation string) (ComputerExtensionSetup, error) {
	if err := requireRWX(meta); err != nil {
		return ComputerExtensionSetup{}, err
	}
	host, ok := s.targetToolExecutor.(*ComputerUseRuntime)
	if !ok {
		return ComputerExtensionSetup{}, errors.New("computer runtime unavailable")
	}
	return host.setupComputerExtension(ctx, installation)
}
func (r *ComputerUseRuntime) setupComputerExtension(ctx context.Context, installation string) (result ComputerExtensionSetup, failure error) {
	selected, err := browserbridge.ResolveInstallation(installation)
	if err != nil {
		return result, extensionFailure("prepare", "browser_not_installed", err)
	}
	defer func() {
		if failure != nil {
			failure = extensionFailure("prepare", "extension_setup_failed", failure)
			r.recordExtensionFailure(installation, failure)
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
	setup := computerExtensionLocation(userHome, managed.ProfileDir, selected)
	if err := stageComputerExtension(resources, setup.ExtensionPath); err != nil {
		return result, err
	}
	if hub == nil {
		hub = &computerExtensionHub{owner: r, profiles: make(map[string]*computerExtensionClient), registrations: make(map[string]*computerExtensionRegistration)}
		r.mu.Lock()
		r.extension = hub
		r.mu.Unlock()
	}
	if err := hub.register(selected, setup); err != nil {
		return result, err
	}
	hub.mu.Lock()
	hub.registrations[selected.ID].diagnostic = nil
	hub.registrations[selected.ID].launchGeneration++
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
	installations, err := browserbridge.Installations()
	if err != nil {
		return err
	}
	return r.restoreComputerInstallations(ctx, userHome, managed.ProfileDir, installations)
}

func (r *ComputerUseRuntime) restoreComputerInstallations(ctx context.Context, home, profile string, installations []browserbridge.Installation) error {
	var failures []error
	for _, installation := range installations {
		if err := ctx.Err(); err != nil {
			return errors.Join(append(failures, err)...)
		}
		setup := computerExtensionLocation(home, profile, installation)
		info, err := os.Lstat(filepath.Join(setup.ExtensionPath, "manifest.json"))
		if os.IsNotExist(err) {
			continue
		}
		if err == nil && !info.Mode().IsRegular() {
			err = errors.New("invalid browser extension installation manifest")
		}
		if err == nil {
			_, err = r.setupComputerExtension(ctx, installation.ID)
		}
		if err != nil {
			failure := extensionFailure("prepare", "extension_setup_failed", err)
			r.recordExtensionFailure(installation.ID, failure)
			failures = append(failures, failure)
		}
	}
	return errors.Join(failures...)
}

func computerExtensionInstallLocation(userHome, profileDir string) ComputerExtensionSetup {
	digest := sha256.Sum256([]byte(profileDir))
	identity := hex.EncodeToString(digest[:8])
	parts := []string{"Redeven", "Flower Browser " + identity}
	return ComputerExtensionSetup{NativeHost: "dev.floegence.redeven.r" + identity,
		ExtensionID: browserbridge.ExtensionID, ExtensionPath: filepath.Join(userHome, parts[0], parts[1]),
		ExtensionHomePath: parts, Platform: runtime.GOOS}
}

func (h *computerExtensionHub) accept(registration *computerExtensionRegistration) {
	defer h.wait.Done()
	for {
		conn, err := registration.listener.Accept()
		if err != nil {
			return
		}
		h.wait.Add(1)
		go func() { defer h.wait.Done(); h.admit(conn, registration.installationID) }()
	}
}
func (h *computerExtensionHub) admit(conn net.Conn, installationID string) {
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
		if registration := h.registrations[installationID]; registration != nil {
			registration.diagnostic = &ComputerExtensionDiagnostic{Stage: "check", Reason: "extension_update_required"}
		}
		h.mu.Unlock()
		slog.Info("browser extension connection rejected", "reason", "extension_update_required", "protocol", hello.Protocol, "required_protocol", browserbridge.ProtocolVersion)
		_ = browserbridge.WriteMessage(conn, map[string]any{"type": "connection_error", "code": "extension_update_required"}, 1<<20)
		return
	}
	token := make([]byte, 16)
	if _, err := rand.Read(token); err != nil {
		return
	}
	libraryDigest := sha256.Sum256([]byte(installationID + "\x00" + hello.ProfileID))
	client := &computerExtensionClient{hub: h, conn: conn, profile: ComputerExtensionProfile{ID: hex.EncodeToString(token), Name: hello.Name, InstallationID: installationID, LibraryID: "chrome-" + hex.EncodeToString(libraryDigest[:])}, done: make(chan struct{}), pending: make(map[string]chan json.RawMessage)}
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
	if registration := h.registrations[installationID]; registration != nil {
		registration.diagnostic = nil
	}
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
			Reason   string `json:"reason"`
		}
		if json.Unmarshal(raw, &envelope) != nil {
			return
		}
		if envelope.Type == "tabs_changed" && envelope.ID == "" {
			if !c.applyDirectory(raw) {
				return
			}
			continue
		}
		if envelope.Type == "tabs_unavailable" && envelope.ID == "" {
			slog.Warn("browser native directory unavailable", "stage", "native_directory", "profile_id", c.profile.ID)
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
			if _, err := strconv.ParseUint(envelope.TabID, 10, 32); err != nil || len(envelope.Binding) != 36 {
				return
			}
			if c.hub.owner != nil {
				c.hub.owner.retireExtensionBinding(c, envelope.TabID, envelope.Binding)
				slog.Info("browser source binding retired", "stage", "native_detach", "binding", envelope.Binding, "reason", browserDetachReason(envelope.Reason))
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
	r.retireExtensionBinding(client, tabID, "")
}

func (r *ComputerUseRuntime) retireExtensionBinding(client *computerExtensionClient, tabID, binding string) {
	retired := make(map[string]bool)
	var pipes []*extensionSourcePipe
	r.mu.Lock()
	for id, executor := range r.executors {
		if extension, ok := executor.(*extensionTargetExecutor); ok && extension.client == client && (tabID == "" || extension.tabID == tabID) && (binding == "" || extension.pipe != nil && extension.pipe.binding == binding) {
			retired[id] = true
			pipes = append(pipes, extension.pipe)
			delete(r.executors, id)
			if control := r.controls[id]; control != nil {
				control.mu.Lock()
				if control.browser != nil {
					control.browser.revoke()
				}
				control.mu.Unlock()
			}
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
	for _, registration := range h.registrations {
		if registration.listener != nil {
			_ = registration.listener.Close()
		}
	}
	for _, client := range h.profiles {
		_ = client.conn.Close()
	}
	clear(h.profiles)
	h.mu.Unlock()
	h.wait.Wait()
	// Remove only the exact registration written by this Runtime. Another
	// process may have explicitly replaced it while this one was shutting down.
	for _, registration := range h.registrations {
		if body, err := os.ReadFile(registration.manifestPath); err == nil && string(body) == string(registration.manifestBytes) {
			_ = os.Remove(registration.manifestPath)
		}
		if registration.directory != "" {
			_ = os.RemoveAll(registration.directory)
		}
	}
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
	installations, _ := browserbridge.Installations()
	status := ComputerExtensionStatus{Profiles: []ComputerExtensionProfile{}, Platform: runtime.GOOS, Installations: installations}
	status.Hostname, _ = os.Hostname()
	if runtime.GOOS == "linux" {
		installed := false
		for _, item := range installations {
			installed = installed || item.Installed
		}
		status.BrowserInstalled = &installed
	}
	if hub != nil {
		hub.mu.Lock()
		for i := range status.Installations {
			item := &status.Installations[i]
			registration := hub.registrations[item.ID]
			item.Prepared = !hub.closed && registration != nil && registration.listener != nil
			status.Prepared = status.Prepared || item.Prepared
			if registration != nil && registration.diagnostic != nil {
				item.Reason = registration.diagnostic.Reason
				diagnostic := *registration.diagnostic
				item.Diagnostic = &diagnostic
			}
		}
		for _, client := range hub.profiles {
			status.Profiles = append(status.Profiles, client.profile)
			for i := range status.Installations {
				if status.Installations[i].ID == client.profile.InstallationID {
					status.Installations[i].Connected = true
				}
			}
		}
		hub.mu.Unlock()
	}
	if _, err := r.extensionResources(); err != nil {
		diagnostic := ComputerExtensionDiagnosticForError(err, "prepare")
		diagnostic.DiagnosticID = ""
		status.Diagnostic = &diagnostic
	}
	for i := range status.Installations {
		item := &status.Installations[i]
		if item.Connected {
			item.Reason = ""
			item.Diagnostic = nil
			continue
		}
		if item.Reason != "" {
			continue
		}
		if err := checkComputerExtensionOpen(runtime.GOOS, "connect", *item, os.Getenv, exec.LookPath); err != nil {
			item.Reason = ComputerExtensionDiagnosticForError(err, "open").Reason
		} else {
			item.Reason = "connection_required"
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

func (r *ComputerUseRuntime) connectExtensionBrowser(ctx context.Context, connection ComputerBrowserConnection, targetID string) (_ TargetDescriptor, resultErr error) {
	stage, generation := "profile_lookup", ""
	traceID := browserTraceRequest(ctx)
	ctx = context.WithValue(ctx, browserTraceRequestKey{}, traceID)
	started := time.Now()
	transition := func(next string) {
		slog.Debug("browser source trace", "stage", stage, "target_id", targetID, "binding", generation, "request", traceID, "phase", "completed", "duration_ms", time.Since(started).Milliseconds())
		stage, started = next, time.Now()
		slog.Debug("browser source trace", "stage", stage, "target_id", targetID, "binding", generation, "request", traceID, "phase", "started")
	}
	defer func() {
		if resultErr == nil {
			transition("source_available")
			return
		}
		reason := "failed"
		if errors.Is(resultErr, context.Canceled) {
			reason = "cancelled"
		} else if errors.Is(resultErr, context.DeadlineExceeded) {
			reason = "timed_out"
		}
		slog.Warn("browser source connection failed", "stage", stage, "reason", reason, "target_id", targetID, "binding", generation, "request", traceID, "duration_ms", time.Since(started).Milliseconds())
	}()
	r.mu.RLock()
	closedRuntime := r.closed
	r.mu.RUnlock()
	if closedRuntime {
		return TargetDescriptor{}, errors.New("computer runtime closed")
	}
	client, err := r.extensionClient(connection.ExtensionProfileID)
	if err != nil {
		return TargetDescriptor{}, err
	}
	// Global ownership is captured once; native and helper I/O run outside the
	// directory lock. A replacement helper/profile is fenced at publication.
	if err := r.connectMu.LockContext(ctx); err != nil {
		return TargetDescriptor{}, err
	}
	host, err := r.browserSourceHostLocked(ctx)
	r.connectMu.Unlock()
	if err != nil {
		return TargetDescriptor{}, err
	}
	if connection.NewTab {
		transition("native_create")
		raw, err := client.call(ctx, "new_tab", nil)
		if err != nil {
			return TargetDescriptor{}, errBrowserOutcomeUnknown
		}
		var created struct {
			TabID  string `json:"tab_id"`
			Native string `json:"native_target_id"`
		}
		if json.Unmarshal(raw, &created) != nil || created.TabID == "" || created.Native == "" {
			return TargetDescriptor{}, errBrowserOutcomeUnknown
		}
		connection.TabID, connection.nativeTargetID = created.TabID, created.Native
	}
	if connection.TabID == "" {
		return TargetDescriptor{}, errors.New("select a browser tab")
	}
	transition("target_wait")
	release, err := r.lockExtensionAdmission(ctx, client, connection.TabID)
	if err != nil {
		return TargetDescriptor{}, err
	}
	defer release()
	if !connection.NewTab {
		transition("native_inventory")
		tabs, err := client.tabs(ctx)
		if err != nil {
			return TargetDescriptor{}, err
		}
		transition("inventory_privacy")
		tabs, err = r.browserInventoryPrivacyAtHost(ctx, host, "extension:"+client.profile.LibraryID, tabs)
		if err != nil {
			return TargetDescriptor{}, err
		}
		found := false
		for _, tab := range tabs {
			if tab.ID != connection.TabID {
				continue
			}
			if tab.Private || connection.nativeTargetID != "" && connection.nativeTargetID != tab.NativeTargetID {
				return TargetDescriptor{}, errBrowserSourceUnavailable
			}
			connection.nativeTargetID = tab.NativeTargetID
			found = true
		}
		if !found {
			return TargetDescriptor{}, errBrowserSourceUnavailable
		}
	}
	if targetID == "" && connection.nativeTargetID != "" {
		if err := r.connectMu.LockContext(ctx); err != nil {
			return TargetDescriptor{}, err
		}
		targetID = r.extensionWorkspaceTargetID(client, connection.nativeTargetID)
		r.connectMu.Unlock()
	}
	r.mu.RLock()
	previousSource, _ := r.executors[targetID].(*extensionTargetExecutor)
	r.mu.RUnlock()
	transition("source_retirement")
	if previousSource != nil {
		if previousSource.client != client || previousSource.tabID != connection.TabID {
			return TargetDescriptor{}, errors.New("browser source identity changed")
		}
		if previousSource.pipe.ctx.Err() != nil || previousSource.sourceHost.call(ctx, "source.ready", map[string]string{"target": targetID}, nil) != nil {
			if err := ctx.Err(); err != nil {
				return TargetDescriptor{}, err
			}
			if err := previousSource.Close(); err != nil {
				return TargetDescriptor{}, err
			}
			r.retireExtensionBinding(client, previousSource.tabID, previousSource.pipe.binding)
		}
	} else if targetID != "" {
		// Complete the prior helper owner's disposal before the same stable
		// identity can acquire a fresh native binding and source socket.
		if err := host.call(ctx, "source.remove", map[string]string{"target": targetID}, nil); err != nil {
			return TargetDescriptor{}, err
		}
	}
	// Reuse still passes through Chrome's current-selection validation. An
	// existing source cannot authorize a stale Flower candidate.
	transition("native_bind")
	raw, err := client.call(ctx, "bind", map[string]any{"tab_id": connection.TabID, "tab_title": connection.TabTitle, "tab_url": connection.TabURL, "native_target_id": connection.nativeTargetID})
	if err != nil {
		return TargetDescriptor{}, err
	}
	var binding struct {
		TabID   string `json:"tab_id"`
		Title   string `json:"title"`
		Binding string `json:"binding"`
		Native  string `json:"native_target_id"`
		Created bool   `json:"created"`
	}
	if json.Unmarshal(raw, &binding) != nil || binding.TabID == "" || len(binding.Binding) != 36 || len(binding.Native) != 32 {
		return TargetDescriptor{}, errors.New("invalid browser binding")
	}
	generation = binding.Binding
	var ownedPipe *extensionSourcePipe
	defer func() {
		if resultErr == nil {
			return
		}
		cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), 3*time.Second)
		defer cancel()
		if ownedPipe != nil {
			resultErr = errors.Join(resultErr, ownedPipe.drain(cleanup))
		} else if binding.Created {
			_, cleanupErr := client.call(cleanup, "unbind", map[string]string{"tab_id": binding.TabID, "binding": binding.Binding})
			resultErr = errors.Join(resultErr, cleanupErr)
		}
	}()
	transition("binding_identity")
	if err := r.connectMu.LockContext(ctx); err != nil {
		return TargetDescriptor{}, err
	}
	stable := r.extensionWorkspaceTargetID(client, binding.Native)
	r.connectMu.Unlock()
	if targetID == "" {
		targetID = stable
	}
	if targetID != stable && !connection.NewTab {
		return TargetDescriptor{}, errors.New("browser source identity changed")
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
		transition("source_carrier")
		pipe, err := host.attachExtension(ctx, client, targetID, binding.TabID, binding.Binding)
		if err != nil {
			return TargetDescriptor{}, err
		}
		ownedPipe = pipe
		transition("source_admission")
		if err = host.call(ctx, "source.admit", map[string]any{"id": targetID, "extension": targetID, "extensionProfile": client.profile.LibraryID, "binding": binding.Binding, "tab": binding.TabID}, nil); err != nil {
			return TargetDescriptor{}, err
		}
		previous = &extensionTargetExecutor{client: client, tabID: binding.TabID, targetID: targetID, nativeTargetID: binding.Native, sourceHost: host, pipe: pipe}
	}
	target := TargetDescriptor{ID: targetID, Kind: "browser.connected", DisplayName: client.profile.Name + " — " + binding.Title, Locality: "local", Capabilities: []string{"observe", "interaction"}, State: "ready", PermissionState: "granted", Ready: true}
	if err := r.connectMu.LockContext(ctx); err != nil {
		return TargetDescriptor{}, err
	}
	defer r.connectMu.Unlock()
	currentClient, clientErr := r.extensionClient(connection.ExtensionProfileID)
	if clientErr != nil || currentClient != client || r.browserHost != host || ctx.Err() != nil {
		return TargetDescriptor{}, errBrowserSourceUnavailable
	}
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
	client                          *computerExtensionClient
	tabID, targetID, nativeTargetID string
	sourceHost                      *browserSourceHost
	pipe                            *extensionSourcePipe
}

func (e *extensionTargetExecutor) setBrowserPrivacy(ctx context.Context, target string, private bool) error {
	if e.sourceHost == nil {
		return errors.New("extension source unavailable")
	}
	return e.sourceHost.call(ctx, "source.privacy", map[string]any{"target": target, "private": private}, nil)
}

func (r *ComputerUseRuntime) extensionWorkspaceTargetID(client *computerExtensionClient, native string) string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	for id, executor := range r.executors {
		if source, ok := executor.(*extensionTargetExecutor); ok && source.client == client && source.nativeTargetID == native {
			return id
		}
	}
	return extensionNativeTargetID(client, native)
}

func extensionNativeTargetID(client *computerExtensionClient, native string) string {
	digest := sha256.Sum256([]byte(client.profile.LibraryID + "\x00" + native))
	return "chrome-" + hex.EncodeToString(digest[:])
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
	err := e.sourceHost.call(ctx, "source.tool", map[string]any{"target": e.targetID, "request": map[string]any{"target_id": e.targetID, "tool_name": call.ToolName, "args": args, "full_access": call.fullAccess, "allowed_origins": call.allowedOrigins, "script_operation": call.scriptOperation, "recovery_observation": call.recoveryObservation, "user_control": private}}, &raw)
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
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	var err error
	if e.sourceHost != nil {
		err = e.sourceHost.call(ctx, "source.remove", map[string]string{"target": e.targetID}, nil)
	}
	return errors.Join(err, e.pipe.drain(ctx))
}

// Browser source setup and status do not require an AI provider or service.
func (r *ComputerUseRuntime) BrowserExtensionSetup(ctx context.Context, meta *session.Meta, installation string) (ComputerExtensionSetup, error) {
	if err := requireRWX(meta); err != nil {
		return ComputerExtensionSetup{}, err
	}
	return r.setupComputerExtension(ctx, installation)
}
func (r *ComputerUseRuntime) BrowserExtensionStatus(meta *session.Meta) (ComputerExtensionStatus, error) {
	if err := requireRWX(meta); err != nil {
		return ComputerExtensionStatus{}, err
	}
	return r.extensionStatus(), nil
}
func browserDetachReason(reason string) string {
	switch reason {
	case "source_disconnected", "target_closed", "tab_closed", "canceled_by_user", "replaced_with_devtools", "debugger_detached", "native_backpressure":
		return reason
	}
	return "source_disconnected"
}
