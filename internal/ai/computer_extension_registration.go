package ai

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net"
	"os"
	"path/filepath"
	"strings"

	"github.com/floegence/redeven/internal/browserbridge"
)

type computerExtensionRegistration struct {
	installationID          string
	diagnostic              *ComputerExtensionDiagnostic
	launchGeneration        uint64
	listener                net.Listener
	directory, manifestPath string
	manifestBytes           []byte
}

func computerExtensionLocation(home, profile string, installation browserbridge.Installation) ComputerExtensionSetup {
	setup := computerExtensionInstallLocation(home, profile)
	setup.InstallationID, setup.BrowserName = installation.ID, installation.Name
	if installation.Kind == "chromium" {
		setup.ExtensionPath += " Chromium"
		setup.ExtensionHomePath[len(setup.ExtensionHomePath)-1] += " Chromium"
	}
	if installation.Kind == "chromium_snap" {
		setup.ExtensionPath = filepath.Join(installation.PrivateRoot, "Redeven", filepath.Base(setup.ExtensionPath))
		relative, _ := filepath.Rel(home, setup.ExtensionPath)
		setup.ExtensionHomePath = strings.Split(relative, string(filepath.Separator))
	}
	return setup
}

func (h *computerExtensionHub) register(installation browserbridge.Installation, setup ComputerExtensionSetup) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.closed {
		return errors.New("browser runtime closed")
	}
	registration := h.registrations[installation.ID]
	fresh := registration == nil || registration.listener == nil
	if fresh {
		parent := "/tmp"
		if installation.PrivateRoot != "" {
			parent = installation.PrivateRoot
		}
		if err := os.MkdirAll(parent, 0700); err != nil {
			return err
		}
		directory, err := os.MkdirTemp(parent, "rv-native-")
		if err != nil {
			return err
		}
		listener, err := net.Listen("unix", filepath.Join(directory, "bridge"))
		if err != nil {
			os.RemoveAll(directory)
			return err
		}
		registration = &computerExtensionRegistration{installationID: installation.ID, listener: listener, directory: directory}
	}
	committed := false
	defer func() {
		if fresh && !committed {
			registration.listener.Close()
			os.RemoveAll(registration.directory)
		}
	}()
	executable, err := os.Executable()
	if err != nil {
		return err
	}
	if installation.PrivateRoot != "" {
		executable, err = stageComputerNativeBridge(executable, registration.directory)
		if err != nil {
			return err
		}
	}
	quote := func(value string) string { return "'" + strings.ReplaceAll(value, "'", "'\\''") + "'" }
	wrapper := filepath.Join(registration.directory, "native-host")
	script := "#!/bin/sh\nexec " + quote(executable) + " browser-bridge " + quote(filepath.Join(registration.directory, "bridge")) + " \"$@\"\n"
	if err = os.WriteFile(wrapper, []byte(script), 0700); err != nil {
		return err
	}
	manifest, _ := json.MarshalIndent(map[string]any{"name": setup.NativeHost, "description": "Redeven browser connection", "path": wrapper, "type": "stdio", "allowed_origins": []string{"chrome-extension://" + browserbridge.ExtensionID + "/"}}, "", "  ")
	manifest = append(manifest, '\n')
	if err = os.MkdirAll(installation.ManifestDirectory, 0700); err != nil {
		return err
	}
	file, err := os.CreateTemp(installation.ManifestDirectory, ".redeven-")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	if _, err = file.Write(manifest); err != nil {
		file.Close()
		return err
	}
	if err = file.Close(); err != nil {
		return err
	}
	manifestPath := filepath.Join(installation.ManifestDirectory, setup.NativeHost+".json")
	if err = os.Rename(file.Name(), manifestPath); err != nil {
		return err
	}
	registration.manifestPath, registration.manifestBytes = manifestPath, manifest
	if fresh {
		h.registrations[installation.ID] = registration
		h.wait.Add(1)
		go h.accept(registration)
	}
	committed = true
	return nil
}

func (r *ComputerUseRuntime) recordExtensionFailure(id string, failure error) {
	if id == "" {
		return
	}
	r.mu.Lock()
	if r.closed {
		r.mu.Unlock()
		return
	}
	if r.extension == nil {
		r.extension = &computerExtensionHub{owner: r, profiles: make(map[string]*computerExtensionClient), registrations: make(map[string]*computerExtensionRegistration)}
	}
	hub := r.extension
	r.mu.Unlock()
	hub.mu.Lock()
	defer hub.mu.Unlock()
	if hub.closed {
		return
	}
	registration := hub.registrations[id]
	if registration == nil {
		registration = &computerExtensionRegistration{installationID: id}
		hub.registrations[id] = registration
	}
	diagnostic := ComputerExtensionDiagnosticForError(failure, "prepare")
	registration.diagnostic = &diagnostic
}

// Snap can execute user-owned files only inside its own data placement. The
// byte-identical, immutable Runtime bridge keeps the same protocol and grants.
func stageComputerNativeBridge(source, directory string) (string, error) {
	input, err := os.Open(source)
	if err != nil {
		return "", err
	}
	defer input.Close()
	hash := sha256.New()
	if _, err = io.Copy(hash, input); err != nil {
		return "", err
	}
	destination := filepath.Join(directory, "runtime-"+hex.EncodeToString(hash.Sum(nil)))
	if info, err := os.Lstat(destination); err == nil && info.Mode().IsRegular() {
		file, err := os.Open(destination)
		if err != nil {
			return "", err
		}
		actual := sha256.New()
		_, err = io.Copy(actual, file)
		file.Close()
		if err == nil && hex.EncodeToString(actual.Sum(nil)) == hex.EncodeToString(hash.Sum(nil)) {
			return destination, nil
		}
	}
	if _, err = input.Seek(0, io.SeekStart); err != nil {
		return "", err
	}
	output, err := os.CreateTemp(directory, ".bridge-")
	if err != nil {
		return "", err
	}
	defer os.Remove(output.Name())
	copied := sha256.New()
	if _, err = io.Copy(io.MultiWriter(output, copied), input); err != nil {
		output.Close()
		return "", err
	}
	if hex.EncodeToString(copied.Sum(nil)) != hex.EncodeToString(hash.Sum(nil)) {
		output.Close()
		return "", errors.New("runtime build changed during bridge deployment")
	}
	if err = output.Sync(); err != nil {
		output.Close()
		return "", err
	}
	if err = output.Chmod(0700); err != nil {
		output.Close()
		return "", err
	}
	if err = output.Close(); err != nil {
		return "", err
	}
	if err = os.Rename(output.Name(), destination); err != nil {
		return "", err
	}
	return destination, nil
}

// Caller holds the hub lock.
func (h *computerExtensionHub) installationConnected(id string) bool {
	for _, client := range h.profiles {
		if client.profile.InstallationID == id {
			return true
		}
	}
	return false
}
