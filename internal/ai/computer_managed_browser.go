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
	"time"

	"github.com/floegence/redeven/internal/session"
)

type ComputerManagedProfile struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// The Runtime owns one browser process per managed profile. Tab executors only
// attach to an explicit page, so creating a tab never duplicates a profile lock.
type managedBrowserProfile struct {
	cmd      *exec.Cmd
	input    io.WriteCloser
	reader   *bufio.Reader
	endpoint string
	done     chan struct{}
	retired  bool
	sequence uint64
}

func (p *managedBrowserProfile) close() {
	if p.retired {
		return
	}
	p.retired = true
	_ = p.input.Close()
	select {
	case <-p.done:
	case <-time.After(2 * time.Second):
		_ = p.cmd.Process.Kill()
		<-p.done
	}
}
func (p *managedBrowserProfile) receive(ctx context.Context, destination any) error {
	value := make(chan []byte, 1)
	failure := make(chan error, 1)
	go func() {
		body, err := readComputerLine(p.reader, 262144)
		if err != nil {
			failure <- err
		} else {
			value <- body
		}
	}()
	timer := time.NewTimer(20 * time.Second)
	defer timer.Stop()
	select {
	case body := <-value:
		if err := json.Unmarshal(body, destination); err != nil {
			p.close()
			return errors.New("invalid managed browser response")
		}
		return nil
	case <-ctx.Done():
		p.close()
		return ctx.Err()
	case <-timer.C:
		p.close()
		return context.DeadlineExceeded
	case <-failure:
		p.close()
		return errors.New("managed browser disconnected")
	}
}
func (p *managedBrowserProfile) call(ctx context.Context, command string) ([]ComputerBrowserTab, error) {
	select {
	case <-p.done:
		return nil, errors.New("managed browser disconnected")
	default:
	}
	p.sequence++
	id := fmt.Sprint(p.sequence)
	body, _ := json.Marshal(map[string]string{"id": id, "command": command})
	if _, err := p.input.Write(append(body, '\n')); err != nil {
		p.close()
		return nil, err
	}
	var response struct {
		ID    string               `json:"id"`
		Error string               `json:"error"`
		Tabs  []ComputerBrowserTab `json:"tabs"`
		Tab   *ComputerBrowserTab  `json:"tab"`
	}
	if err := p.receive(ctx, &response); err != nil {
		return nil, err
	}
	if response.ID != id || response.Error != "" || len(response.Tabs) > 128 {
		return nil, errors.New("managed browser command failed")
	}
	if response.Tab != nil {
		return []ComputerBrowserTab{*response.Tab}, nil
	}
	return response.Tabs, nil
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
	profiles, err := r.managedProfilesLocked()
	if err != nil {
		return nil, err
	}
	if !slices.ContainsFunc(profiles, func(p ComputerManagedProfile) bool { return p.ID == profileID }) {
		return nil, errors.New("select an available managed profile")
	}
	if profile := r.managedProfiles[profileID]; profile != nil {
		select {
		case <-profile.done:
			delete(r.managedProfiles, profileID)
		default:
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
	cmd := exec.Command(resources.NodeBinary, filepath.Join(filepath.Dir(resources.HelperPath), "redevenManagedBrowser.mjs"), directory)
	input, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	output, err := cmd.StdoutPipe()
	if err != nil {
		_ = input.Close()
		return nil, err
	}
	if err := cmd.Start(); err != nil {
		_ = input.Close()
		return nil, err
	}
	profile := &managedBrowserProfile{cmd: cmd, input: input, reader: bufio.NewReader(output), done: make(chan struct{})}
	go func() { _ = cmd.Wait(); close(profile.done) }()
	var ready struct {
		Type     string `json:"type"`
		Version  int    `json:"protocol_version"`
		Error    string `json:"error"`
		Endpoint string `json:"endpoint"`
		Reason   string `json:"reason"`
	}
	if err := profile.receive(ctx, &ready); err != nil {
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
		if ready.Reason == "browser_dependency_missing" {
			reason = ready.Reason
		}
		return nil, &TargetStartupError{Code: "TARGET_SETUP_REQUIRED", Reason: reason}
	}
	if !strings.HasPrefix(ready.Endpoint, "http://127.0.0.1:") {
		profile.close()
		return nil, &TargetStartupError{Code: "TARGET_SETUP_REQUIRED", Reason: "browser_handshake_invalid"}
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
	var chosen *ComputerBrowserTab
	for i := range tabs {
		if connection.NewTab || tabs[i].ID == connection.TabID {
			chosen = &tabs[i]
			break
		}
	}
	if chosen == nil {
		return TargetDescriptor{}, errors.New("select an available managed tab")
	}
	if !connection.NewTab && connection.TabURL != "" && (chosen.URL != connection.TabURL || chosen.Title != connection.TabTitle) {
		return TargetDescriptor{}, &targetToolPolicyError{code: "target_selection_stale"}
	}
	if targetID == "" {
		targetID = r.managedTabTargetID(profile.endpoint, chosen.ID)
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
	target := TargetDescriptor{ID: targetID, Kind: "browser.managed", DisplayName: "Flower managed browser — " + profileName, Locality: "local", Capabilities: []string{"observe", "interaction"}, State: "ready", PermissionState: "granted", Ready: true}
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
	if err := requireRWX(meta); err != nil {
		return nil, err
	}
	host, ok := s.targetToolExecutor.(*ComputerUseRuntime)
	if !ok {
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
	if err := requireRWX(meta); err != nil {
		return nil, err
	}
	host, ok := s.targetToolExecutor.(*ComputerUseRuntime)
	if !ok {
		return nil, errors.New("computer runtime unavailable")
	}
	host.connectMu.Lock()
	defer host.connectMu.Unlock()
	profile, err := host.managedProfileLocked(ctx, profileID)
	if err != nil {
		return nil, err
	}
	return profile.call(ctx, "inventory")
}
