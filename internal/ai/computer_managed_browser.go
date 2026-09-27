package ai

import (
	"bufio"
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/floegence/redeven/internal/session"
)

type ComputerManagedProfile struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// The Runtime owns one browser process per managed profile. Tab executors only
// attach to an explicit page, so creating a tab never duplicates a profile lock.
type managedBrowserReply struct {
	ID    string               `json:"id"`
	Error string               `json:"error"`
	Tabs  []ComputerBrowserTab `json:"tabs"`
	Tab   *ComputerBrowserTab  `json:"tab"`
}
type managedBrowserPending struct {
	result chan managedBrowserReply
	timer  *time.Timer
}
type managedBrowserProfile struct {
	cmd       *exec.Cmd
	input     io.WriteCloser
	reader    *bufio.Reader
	output    io.Closer
	endpoint  string
	done      chan struct{}
	mu        sync.Mutex
	writeMu   sync.Mutex
	readOnce  sync.Once
	closeOnce sync.Once
	retired   bool
	sequence  uint64
	ready     chan []byte
	pending   map[string]*managedBrowserPending
	onFailure func()
}

func (p *managedBrowserProfile) fault() {
	p.mu.Lock()
	unexpected := !p.retired
	callback := p.onFailure
	p.retired = true
	p.mu.Unlock()
	if unexpected && callback != nil {
		callback()
	}
	p.close()
}

// A failed startup belongs to installation readiness, not the shared service.
// Arm service failure handling only after a valid successful handshake.
func (p *managedBrowserProfile) establish(onFailure func()) bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.retired {
		return false
	}
	select {
	case <-p.done:
		return false
	default:
	}
	p.onFailure = onFailure
	return true
}

func (p *managedBrowserProfile) stopped() bool {
	p.mu.Lock()
	retired := p.retired
	p.mu.Unlock()
	if retired {
		return true
	}
	select {
	case <-p.done:
		return true
	default:
		return false
	}
}

func (p *managedBrowserProfile) close() {
	p.closeOnce.Do(func() {
		p.mu.Lock()
		p.retired = true
		for _, request := range p.pending {
			request.timer.Stop()
		}
		clear(p.pending)
		p.mu.Unlock()
		_ = p.input.Close()
		select {
		case <-p.done:
		case <-time.After(2 * time.Second):
			_ = p.cmd.Process.Kill()
			<-p.done
		}
	})
}

// One process-owned reader drains every response, including abandoned requests.
// Only the process health deadline can retire an unresponsive helper.
func (p *managedBrowserProfile) startReader() {
	p.readOnce.Do(func() {
		p.ready = make(chan []byte, 1)
		p.pending = make(map[string]*managedBrowserPending)
		go func() {
			defer p.fault()
			if p.output != nil {
				defer p.output.Close()
			}
			defer close(p.ready)
			receivedReady := false
			for {
				body, err := readComputerLine(p.reader, 262144)
				if err != nil {
					return
				}
				var envelope struct {
					ID   string
					Type string
				}
				if json.Unmarshal(body, &envelope) != nil {
					return
				}
				if envelope.ID == "" {
					if receivedReady || envelope.Type != "ready" {
						return
					}
					receivedReady = true
					p.ready <- body
					continue
				}
				var reply managedBrowserReply
				if json.Unmarshal(body, &reply) != nil || len(reply.Tabs) > 128 {
					return
				}
				p.mu.Lock()
				request := p.pending[reply.ID]
				if request != nil {
					delete(p.pending, reply.ID)
					request.timer.Stop()
				}
				p.mu.Unlock()
				if request == nil {
					return
				}
				request.result <- reply
				if reply.Error == "MANAGED_BROWSER_DISCONNECTED" {
					return
				}
			}
		}()
	})
}
func (p *managedBrowserProfile) receive(ctx context.Context, destination any) error {
	p.startReader()
	timer := time.NewTimer(20 * time.Second)
	defer timer.Stop()
	select {
	case body, ok := <-p.ready:
		if !ok {
			return errors.New("managed browser disconnected")
		}
		return json.Unmarshal(body, destination)
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return context.DeadlineExceeded
	}
}
func (p *managedBrowserProfile) call(ctx context.Context, command string) ([]ComputerBrowserTab, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	p.startReader()
	p.writeMu.Lock()
	p.mu.Lock()
	if p.retired || len(p.pending) >= 32 {
		p.mu.Unlock()
		p.writeMu.Unlock()
		return nil, errors.New("managed browser unavailable")
	}
	p.sequence++
	id := fmt.Sprint(p.sequence)
	request := &managedBrowserPending{result: make(chan managedBrowserReply, 1)}
	request.timer = time.AfterFunc(20*time.Second, func() {
		p.mu.Lock()
		expired := p.pending[id] == request
		p.mu.Unlock()
		if expired {
			p.fault()
		}
	})
	p.pending[id] = request
	p.mu.Unlock()
	body, _ := json.Marshal(map[string]string{"id": id, "command": command})
	_, err := p.input.Write(append(body, '\n'))
	p.writeMu.Unlock()
	if err != nil {
		p.close()
		return nil, err
	}
	var reply managedBrowserReply
	select {
	case reply = <-request.result:
	case <-ctx.Done():
		if command == "new_tab" {
			return nil, errors.Join(errBrowserOutcomeUnknown, ctx.Err())
		}
		return nil, ctx.Err()
	case <-p.done:
		if command == "new_tab" {
			return nil, errBrowserOutcomeUnknown
		}
		return nil, errors.New("managed browser disconnected")
	}
	if reply.Error != "" {
		return nil, errors.New("managed browser command failed")
	}
	if reply.Tab != nil {
		return []ComputerBrowserTab{*reply.Tab}, nil
	}
	return reply.Tabs, nil
}
func (r *ComputerUseRuntime) managedResources() (*PlaywrightTargetExecutor, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	if r.closed {
		return nil, errors.New("computer runtime closed")
	}
	executor, ok := r.executors["browser-main"].(*PlaywrightTargetExecutor)
	if !ok {
		return nil, &TargetStartupError{Code: "TARGET_SETUP_REQUIRED", Reason: "browser_adapter_unavailable"}
	}
	if !filepath.IsAbs(executor.ProfileDir) || !filepath.IsAbs(executor.NodeBinary) || !filepath.IsAbs(executor.HelperPath) {
		return nil, &TargetStartupError{Code: "TARGET_SETUP_REQUIRED", Reason: "browser_paths_not_absolute"}
	}
	return executor, nil
}
func (r *ComputerUseRuntime) managedProfilesLocked() ([]ComputerManagedProfile, error) {
	resources, err := r.managedResources()
	if err != nil {
		return nil, err
	}
	profiles := []ComputerManagedProfile{{ID: "browser-main", Name: "Default"}}
	entries, err := os.ReadDir(resources.ProfileDir)
	if errors.Is(err, os.ErrNotExist) {
		return profiles, nil
	}
	if err != nil {
		return nil, err
	}
	for _, entry := range entries {
		if !strings.HasPrefix(entry.Name(), "profile-") {
			continue
		}
		if !entry.IsDir() || entry.Type()&os.ModeSymlink != 0 || len(entry.Name()) != 40 {
			return nil, errors.New("invalid managed profile directory")
		}
		if _, err := hex.DecodeString(strings.TrimPrefix(entry.Name(), "profile-")); err != nil {
			return nil, errors.New("invalid managed profile identity")
		}
		filename := filepath.Join(resources.ProfileDir, entry.Name(), "flower-profile.json")
		info, err := os.Lstat(filename)
		if err != nil || !info.Mode().IsRegular() || info.Size() > 1024 {
			return nil, errors.New("invalid managed profile metadata")
		}
		file, err := os.Open(filename)
		if err != nil {
			return nil, err
		}
		body, readErr := io.ReadAll(io.LimitReader(file, 1025))
		_ = file.Close()
		var profile ComputerManagedProfile
		decoder := json.NewDecoder(bytes.NewReader(body))
		decoder.DisallowUnknownFields()
		if readErr != nil || len(body) > 1024 || decoder.Decode(&profile) != nil || decoder.Decode(new(any)) != io.EOF || profile.ID != entry.Name() || strings.TrimSpace(profile.Name) != profile.Name || profile.Name == "" || len(profile.Name) > 120 {
			return nil, errors.New("invalid managed profile")
		}
		profiles = append(profiles, profile)
		if len(profiles) > 16 {
			return nil, errors.New("managed profile limit")
		}
	}
	return profiles, nil
}
func (r *ComputerUseRuntime) managedProfileLocked(ctx context.Context, profileID string) (*managedBrowserProfile, error) {
	executable, err := r.requireManagedBrowser()
	if err != nil {
		return nil, err
	}
	status := r.browserServiceSnapshot()
	if status.State == "failed" || status.State == "recovering" {
		return nil, errBrowserHostFailed
	}
	profiles, err := r.managedProfilesLocked()
	if err != nil {
		return nil, err
	}
	if !slices.ContainsFunc(profiles, func(p ComputerManagedProfile) bool { return p.ID == profileID }) {
		return nil, errors.New("select an available managed profile")
	}
	if profile := r.managedProfiles[profileID]; profile != nil {
		if profile.stopped() {
			delete(r.managedProfiles, profileID)
		} else {
			return profile, nil
		}
	}
	resources, err := r.managedResources()
	if err != nil {
		return nil, err
	}
	directory := filepath.Join(resources.ProfileDir, profileID)
	if err := os.MkdirAll(directory, 0700); err != nil {
		return nil, err
	}
	if info, err := os.Lstat(directory); err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return nil, errors.New("invalid managed profile directory")
	}
	cmd := exec.Command(resources.NodeBinary, filepath.Join(filepath.Dir(resources.HelperPath), "redevenManagedBrowser.mjs"), directory, executable)
	input, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	output, writer, err := os.Pipe()
	if err != nil {
		_ = input.Close()
		return nil, err
	}
	// Own the pipe separately: exec.Cmd.Wait closes StdoutPipe before a fast
	// failing process's structured startup result has necessarily been drained.
	cmd.Stdout = writer
	if err := cmd.Start(); err != nil {
		_ = input.Close()
		_ = output.Close()
		_ = writer.Close()
		return nil, err
	}
	_ = writer.Close()
	profile := &managedBrowserProfile{cmd: cmd, input: input, reader: bufio.NewReader(output), output: output, done: make(chan struct{})}
	go func() { _ = cmd.Wait(); close(profile.done) }()
	var ready struct {
		Type     string `json:"type"`
		Version  int    `json:"protocol_version"`
		Error    string `json:"error"`
		Endpoint string `json:"endpoint"`
		Reason   string `json:"reason"`
	}
	if err := profile.receive(ctx, &ready); err != nil {
		profile.close()
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, &TargetStartupError{Code: "TARGET_SETUP_REQUIRED", Reason: "browser_handshake_missing"}
	}
	if ready.Type != "ready" || ready.Version != 2 {
		profile.close()
		return nil, &TargetStartupError{Code: "TARGET_SETUP_REQUIRED", Reason: "browser_handshake_invalid"}
	}
	if ready.Error != "" {
		profile.close()
		reason := "browser_launch_failed"
		if ready.Reason == "browser_dependency_missing" || ready.Reason == "browser_sandbox_unavailable" {
			reason = ready.Reason
		}
		if reason == "browser_sandbox_unavailable" {
			r.browserInstallation.RequireSystemPreparation()
		}
		return nil, &TargetStartupError{Code: "TARGET_SETUP_REQUIRED", Reason: reason}
	}
	if !strings.HasPrefix(ready.Endpoint, "http://127.0.0.1:") {
		profile.close()
		return nil, &TargetStartupError{Code: "TARGET_SETUP_REQUIRED", Reason: "browser_handshake_invalid"}
	}

	if !profile.establish(func() { r.browserHostStopped(status.Generation) }) {
		profile.close()
		return nil, &TargetStartupError{Code: "TARGET_SETUP_REQUIRED", Reason: "browser_launch_failed"}
	}
	profile.endpoint = ready.Endpoint
	if r.managedProfiles == nil {
		r.managedProfiles = make(map[string]*managedBrowserProfile)
	}
	r.managedProfiles[profileID] = profile
	return profile, nil
}
func (r *ComputerUseRuntime) connectManagedBrowserLocked(ctx context.Context, connection ComputerBrowserConnection, targetID string) (TargetDescriptor, error) {
	profile, err := r.managedProfileLocked(ctx, connection.ManagedProfileID)
	if err != nil {
		return TargetDescriptor{}, err
	}
	command := "inventory"
	if connection.NewTab {
		command = "new_tab"
	}
	tabs, err := profile.call(ctx, command)
	if err != nil {
		return TargetDescriptor{}, err
	}
	tabs, err = r.browserInventoryPrivacy(ctx, profile.endpoint, tabs)
	if err != nil {
		return TargetDescriptor{}, err
	}
	var chosen *ComputerBrowserTab
	for i := range tabs {
		if connection.NewTab || tabs[i].ID == connection.TabID {
			chosen = &tabs[i]
			break
		}
	}
	if chosen == nil || chosen.Private && !connection.privatePopup {
		return TargetDescriptor{}, errors.New("select an available managed tab")
	}
	if !connection.NewTab && connection.TabURL != "" && (chosen.URL != connection.TabURL || chosen.Title != connection.TabTitle) {
		return TargetDescriptor{}, &targetToolPolicyError{code: "target_selection_stale"}
	}
	if existing := r.managedTabTargetID(profile.endpoint, chosen.ID); existing != "" {
		return r.registry.ResolveTarget(ctx, existing)
	}
	if targetID == "" {
		targetID = "managed-" + chosen.ID
	}
	resources, err := r.managedResources()
	if err != nil {
		return TargetDescriptor{}, err
	}
	executor := NewPlaywrightTargetExecutor(resources.NodeBinary, resources.HelperPath, resources.ProfileDir)
	executor.CDPURL, executor.TabID, executor.BrowserContextID, executor.ManagedAttachment = profile.endpoint, chosen.ID, chosen.ProfileID, true
	executor.DownloadDir = filepath.Join(resources.ProfileDir, connection.ManagedProfileID, "downloads")
	executor.sourceHost, err = r.browserSourceHostLocked(ctx)
	if err != nil {
		return TargetDescriptor{}, err
	}
	profiles, err := r.managedProfilesLocked()
	if err != nil {
		_ = executor.Close()
		return TargetDescriptor{}, err
	}
	profileName := connection.ManagedProfileID
	for _, item := range profiles {
		if item.ID == connection.ManagedProfileID {
			profileName = item.Name
		}
	}
	target := TargetDescriptor{ID: targetID, Kind: "browser.managed", DisplayName: computerBrowserDisplayName(computerBrowserProfile{kind: "browser.managed", name: profileName, connection: connection}), Locality: "local", Capabilities: []string{"observe", "interaction"}, State: "ready", PermissionState: "granted", Ready: true}
	if err := executor.EnsureTargetReady(ctx, target.ID); err != nil {
		_ = executor.Close()
		return TargetDescriptor{}, err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if prior := r.executors[target.ID]; prior != nil && targetID != "browser-main" {
		_ = executor.Close()
		return r.registry.ResolveTarget(ctx, targetID)
	}
	r.executors[target.ID] = executor
	return target, r.registry.Register(target)
}
func (s *Service) ManagedBrowserProfiles(ctx context.Context, meta *session.Meta, name string) ([]ComputerManagedProfile, error) {
	host, ok := s.targetToolExecutor.(*ComputerUseRuntime)
	if !ok {
		return nil, errors.New("computer runtime unavailable")
	}
	return host.ManagedBrowserProfiles(ctx, meta, name)
}

func (host *ComputerUseRuntime) ManagedBrowserProfiles(ctx context.Context, meta *session.Meta, name string) ([]ComputerManagedProfile, error) {
	if err := requireRWX(meta); err != nil {
		return nil, err
	}
	if host == nil {
		return nil, errors.New("computer runtime unavailable")
	}
	host.connectMu.Lock()
	defer host.connectMu.Unlock()
	profiles, err := host.managedProfilesLocked()
	if err != nil {
		return nil, err
	}
	if name == "" {
		return profiles, nil
	}
	name = strings.TrimSpace(name)
	if name == "" || len(name) > 120 || len(profiles) >= 16 {
		return nil, errors.New("invalid managed profile name")
	}
	seed := make([]byte, 16)
	if _, err := rand.Read(seed); err != nil {
		return nil, err
	}
	profile := ComputerManagedProfile{ID: "profile-" + hex.EncodeToString(seed), Name: name}
	resources, err := host.managedResources()
	if err != nil {
		return nil, err
	}
	directory := filepath.Join(resources.ProfileDir, profile.ID)
	if err := os.MkdirAll(directory, 0700); err != nil {
		return nil, err
	}
	body, _ := json.Marshal(profile)
	if err := os.WriteFile(filepath.Join(directory, "flower-profile.json"), append(body, '\n'), 0600); err != nil {
		_ = os.Remove(directory)
		return nil, err
	}
	return append(profiles, profile), nil
}
func (s *Service) ManagedBrowserTabs(ctx context.Context, meta *session.Meta, profileID string) ([]ComputerBrowserTab, error) {
	host, ok := s.targetToolExecutor.(*ComputerUseRuntime)
	if !ok {
		return nil, errors.New("computer runtime unavailable")
	}
	return host.ManagedBrowserTabs(ctx, meta, profileID)
}

func (host *ComputerUseRuntime) ManagedBrowserTabs(ctx context.Context, meta *session.Meta, profileID string) ([]ComputerBrowserTab, error) {
	if err := requireRWX(meta); err != nil {
		return nil, err
	}
	if host == nil {
		return nil, errors.New("computer runtime unavailable")
	}
	host.connectMu.Lock()
	defer host.connectMu.Unlock()
	profile, err := host.managedProfileLocked(ctx, profileID)
	if err != nil {
		return nil, err
	}
	tabs, err := profile.call(ctx, "inventory")
	if err != nil {
		return nil, err
	}
	tabs, err = host.browserInventoryPrivacy(ctx, profile.endpoint, tabs)
	return slices.DeleteFunc(tabs, func(tab ComputerBrowserTab) bool { return tab.Private }), err
}
