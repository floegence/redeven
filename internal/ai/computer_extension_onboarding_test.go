package ai

import (
	"context"
	"encoding/json"
	"net"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/browserbridge"
)

func TestExtensionOnboardingOpensOnlyFixedDestinations(t *testing.T) {
	setup := ComputerExtensionSetup{NativeHost: "dev.floegence.redeven.r123456789abcdef0", ExtensionID: "mgfbpkkmocckooenpdfpefknffjanjce", ExtensionPath: "/fixture/extension"}
	for _, action := range []string{"extensions", "folder", "connect"} {
		name, args, err := computerExtensionOpenCommand("darwin", action, setup, browserbridge.Installation{Installed: true, Executable: "/snap/bin/chromium"})
		if err != nil || name != "/usr/bin/open" {
			t.Fatalf("%s: %s %v %v", action, name, args, err)
		}
		if action == "extensions" && !reflect.DeepEqual(args, []string{"-b", "com.google.Chrome", "chrome://extensions/"}) {
			t.Fatal(args)
		}
		if action == "folder" && !reflect.DeepEqual(args, []string{"-R", setup.ExtensionPath}) {
			t.Fatal(args)
		}
		for _, arg := range args {
			if arg == "--no-sandbox" {
				t.Fatal("browser sandbox disabled")
			}
		}
	}
	name, args, err := computerExtensionOpenCommand("linux", "folder", setup, browserbridge.Installation{Installed: true})
	if err != nil || name != "xdg-open" || !reflect.DeepEqual(args, []string{filepath.Dir(setup.ExtensionPath)}) {
		t.Fatalf("linux reveal: %s %v %v", name, args, err)
	}
	for _, action := range []string{"", "https://example.com", "../folder", "--args", "file:///tmp"} {
		if _, _, err := computerExtensionOpenCommand("darwin", action, setup, browserbridge.Installation{Installed: true, Executable: "/snap/bin/chromium"}); err == nil {
			t.Fatalf("accepted %q", action)
		}
	}
	if _, _, err := computerExtensionOpenCommand("windows", "connect", setup, browserbridge.Installation{Installed: true}); err == nil {
		t.Fatal("unsupported platform accepted")
	}
}

func TestExtensionInstallLocationIsVisibleAndRuntimeScoped(t *testing.T) {
	root := t.TempDir()
	home := filepath.Join(root, "Personal Files")
	first := computerExtensionInstallLocation(home, filepath.Join(root, ".runtime-one", "profiles"))
	second := computerExtensionInstallLocation(home, filepath.Join(root, ".runtime-two", "profiles"))
	if first.ExtensionPath == second.ExtensionPath || first.NativeHost == second.NativeHost {
		t.Fatal("runtime installations overlap")
	}
	for _, setup := range []ComputerExtensionSetup{first, second} {
		for _, part := range setup.ExtensionHomePath {
			if strings.HasPrefix(part, ".") || strings.ContainsAny(part, `/\\`) {
				t.Fatalf("unbrowsable folder: %q", part)
			}
		}
		if filepath.Join(append([]string{home}, setup.ExtensionHomePath...)...) != setup.ExtensionPath {
			t.Fatal("displayed route differs from installation")
		}
		source := t.TempDir()
		if err := os.WriteFile(filepath.Join(source, "manifest.json"), []byte("fixture"), 0600); err != nil {
			t.Fatal(err)
		}
		if err := stageComputerExtension(source, setup.ExtensionPath); err != nil {
			t.Fatal(err)
		}
		if _, err := os.Stat(filepath.Join(setup.ExtensionPath, "manifest.json")); err != nil {
			t.Fatal(err)
		}
	}
	if !reflect.DeepEqual(first, computerExtensionInstallLocation(home, filepath.Join(root, ".runtime-one", "profiles"))) {
		t.Fatal("installation changed across setup calls")
	}
}

func TestExtensionInstallPathSurvivesBuildChangesAndRemovesRetiredAssets(t *testing.T) {
	root := t.TempDir()
	source := filepath.Join(root, "bundle")
	target := filepath.Join(root, "installed")
	if err := os.Mkdir(source, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(source, "manifest.json"), []byte("first"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := stageComputerExtension(source, target); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(target, "retired.js"), []byte("old"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(source, "manifest.json"), []byte("second"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := stageComputerExtension(source, target); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(filepath.Join(target, "manifest.json"))
	if err != nil || string(raw) != "second" {
		t.Fatalf("%s %v", raw, err)
	}
	if _, err := os.Stat(filepath.Join(target, "retired.js")); !os.IsNotExist(err) {
		t.Fatal("retired asset remains")
	}
	if err := os.Symlink(root, filepath.Join(source, "escape")); err != nil {
		t.Fatal(err)
	}
	if err := stageComputerExtension(source, target); err == nil {
		t.Fatal("accepted bundle symlink")
	}
	raw, _ = os.ReadFile(filepath.Join(target, "manifest.json"))
	if string(raw) != "second" {
		t.Fatal("failed staging changed installed bytes")
	}
}

func TestExtensionStagingRejectsLinkedInstallDirectory(t *testing.T) {
	root := t.TempDir()
	source, outside := filepath.Join(root, "bundle"), filepath.Join(root, "outside")
	for _, directory := range []string{source, outside} {
		if err := os.Mkdir(directory, 0700); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(source, "manifest.json"), []byte("fixture"), 0600); err != nil {
		t.Fatal(err)
	}
	linked := filepath.Join(root, "Redeven")
	if err := os.Symlink(outside, linked); err != nil {
		t.Fatal(err)
	}
	if err := stageComputerExtension(source, filepath.Join(linked, "Flower")); err == nil {
		t.Fatal("followed linked installation directory")
	}
	entries, err := os.ReadDir(outside)
	if err != nil || len(entries) != 0 {
		t.Fatalf("changed unrelated directory: %v %v", entries, err)
	}
}

func TestExtensionSetupRepairsRegistrationAndAssetsAfterRestart(t *testing.T) {
	root := t.TempDir()
	t.Setenv("HOME", filepath.Join(root, "user"))
	resources := filepath.Join(root, "resources")
	if err := os.MkdirAll(filepath.Join(resources, "extension"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(resources, "extension", "manifest.json"), []byte("current-package"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(resources, "helper.mjs"), []byte("fixture"), 0600); err != nil {
		t.Fatal(err)
	}
	create := func() *ComputerUseRuntime {
		registry := NewTargetRegistry()
		if err := registry.Register(TargetDescriptor{ID: "browser-main", Kind: "browser.managed"}); err != nil {
			t.Fatal(err)
		}
		host := NewComputerUseRuntime(registry, map[string]TargetToolExecutor{"browser-main": NewPlaywrightTargetExecutor("/bin/sh", filepath.Join(resources, "helper.mjs"), filepath.Join(root, "profiles"))}, filepath.Join(root, "media"))
		t.Cleanup(func() { _ = host.Close() })
		return host
	}
	installations, err := browserbridge.Installations()
	if err != nil || len(installations) == 0 {
		t.Fatal("browser discovery unavailable", err)
	}
	installationID := installations[0].ID
	host := create()
	if host.extension != nil || host.extensionStatus().Prepared {
		t.Fatal("fresh runtime prepared Chrome without a previous setup")
	}
	setup, err := host.setupComputerExtension(context.Background(), installationID)
	if err != nil {
		t.Fatal(err)
	}
	manifest := host.extension.registrations[installationID].manifestPath
	if _, err := os.Stat(manifest); err != nil {
		t.Fatal(err)
	}
	// A deleted registration and a damaged package must both be repaired by the
	// same explicit preparation path, even while the in-process hub exists.
	if err := os.Remove(manifest); err != nil {
		t.Fatal(err)
	}
	if err := os.RemoveAll(setup.ExtensionPath); err != nil {
		t.Fatal(err)
	}
	host.extension.mu.Lock()
	host.extension.registrations[installationID].diagnostic = &ComputerExtensionDiagnostic{Stage: "check", Reason: "extension_update_required"}
	host.extension.mu.Unlock()
	repaired, err := host.setupComputerExtension(context.Background(), installationID)
	if err != nil || !reflect.DeepEqual(repaired, setup) {
		t.Fatalf("repair: %+v %v", repaired, err)
	}
	if body, err := os.ReadFile(filepath.Join(repaired.ExtensionPath, "manifest.json")); err != nil || string(body) != "current-package" {
		t.Fatalf("package: %s %v", body, err)
	}
	if host.extensionStatus().Error != "" || len(host.extensionStatus().Profiles) != 0 {
		t.Fatal("preparation retained failure or granted a connection")
	}
	if err := host.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(manifest); !os.IsNotExist(err) {
		t.Fatalf("closed registration remains: %v", err)
	}
	restarted := create()
	if restarted.extension == nil || !restarted.extensionStatus().Prepared {
		t.Fatal("restart did not restore the previously prepared native registration")
	}
	if len(restarted.extensionStatus().Profiles) != 0 {
		t.Fatal("restart implicitly connected Chrome")
	}
	// A previously confirmed extension can handshake on the restored socket
	// before any user repeats setup. Preparation alone cannot admit a profile.
	peer, err := net.Dial("unix", restarted.extension.registrations[installationID].listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	defer peer.Close()
	if err := peer.SetDeadline(time.Now().Add(3 * time.Second)); err != nil {
		t.Fatal(err)
	}
	for _, message := range []map[string]any{
		{"type": "native_host", "protocol_version": browserbridge.ProtocolVersion, "extension_id": browserbridge.ExtensionID},
		{"type": "hello", "protocol_version": browserbridge.ProtocolVersion, "profile_id": "12345678-1234-1234-1234-123456789abc", "profile_name": "Work"},
	} {
		if err := browserbridge.WriteMessage(peer, message, 1<<20); err != nil {
			t.Fatal(err)
		}
	}
	raw, err := browserbridge.ReadMessage(peer, 1<<20)
	if err != nil {
		t.Fatal(err)
	}
	var ready struct {
		Type string `json:"type"`
	}
	if err := json.Unmarshal(raw, &ready); err != nil || ready.Type != "ready" {
		t.Fatalf("restored handshake: %s %v", raw, err)
	}
	if profiles := restarted.extensionStatus().Profiles; len(profiles) != 1 || profiles[0].Name != "Work" {
		t.Fatalf("restored connection not admitted: %+v", profiles)
	}
	resumed, err := restarted.setupComputerExtension(context.Background(), installationID)
	if err != nil || !reflect.DeepEqual(resumed, setup) {
		t.Fatalf("restart: %+v %v", resumed, err)
	}
	if _, err := os.Stat(restarted.extension.registrations[installationID].manifestPath); err != nil {
		t.Fatal(err)
	}
	if len(restarted.extensionStatus().Profiles) != 1 {
		t.Fatal("repeated setup retired the restored connection")
	}
}

func TestExtensionLaunchUsesSelectedHostInstallation(t *testing.T) {
	setup := ComputerExtensionSetup{NativeHost: "dev.floegence.redeven.fixture", ExtensionID: browserbridge.ExtensionID}
	for _, executable := range []string{"/snap/bin/chromium", "/usr/bin/chromium", "/usr/bin/google-chrome-stable"} {
		installation := browserbridge.Installation{Installed: true, Executable: executable}
		name, args, err := computerExtensionOpenCommand("linux", "connect", setup, installation)
		if err != nil || name != executable || len(args) != 1 || !strings.HasPrefix(args[0], "chrome-extension://") {
			t.Fatalf("selected installation lost: %s %v %v", name, args, err)
		}
	}
}

func TestExtensionInstallationsShareProtocolButKeepRegistrationsSeparate(t *testing.T) {
	root := t.TempDir()
	chrome := computerExtensionLocation(root, "/fixture/profile", browserbridge.Installation{ID: "chrome", Kind: "google_chrome", Name: "Google Chrome"})
	native := computerExtensionLocation(root, "/fixture/profile", browserbridge.Installation{ID: "native", Kind: "chromium", Name: "Chromium"})
	snap := computerExtensionLocation(root, "/fixture/profile", browserbridge.Installation{ID: "snap", Kind: "chromium_snap", PrivateRoot: filepath.Join(root, "snap/chromium/common"), Name: "Chromium (Snap)"})
	legacy := computerExtensionInstallLocation(root, "/fixture/profile")
	if chrome.NativeHost != legacy.NativeHost || chrome.ExtensionPath != legacy.ExtensionPath {
		t.Fatal("existing pairing changed")
	}
	if chrome.ExtensionPath == native.ExtensionPath || native.ExtensionPath == snap.ExtensionPath {
		t.Fatal("installation setup overlaps")
	}
	if snap.NativeHost != chrome.NativeHost || !strings.HasPrefix(snap.ExtensionPath, filepath.Join(root, "snap/chromium/common")+"/") {
		t.Fatal("Snap protocol or placement differs")
	}
}

func TestExtensionNativeBridgeVerifiesAndRepairsExactBuild(t *testing.T) {
	root := t.TempDir()
	source := filepath.Join(root, "source")
	if err := os.WriteFile(source, []byte("trusted build"), 0700); err != nil {
		t.Fatal(err)
	}
	installed, err := stageComputerNativeBridge(source, root)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(installed, []byte("corruption"), 0700); err != nil {
		t.Fatal(err)
	}
	repaired, err := stageComputerNativeBridge(source, root)
	if err != nil || repaired != installed {
		t.Fatal(repaired, err)
	}
	body, err := os.ReadFile(repaired)
	if err != nil || string(body) != "trusted build" {
		t.Fatal("corrupted bridge reused", err)
	}
}

func TestExtensionRestoreKeepsOtherInstallationsAvailable(t *testing.T) {
	root := t.TempDir()
	t.Setenv("HOME", filepath.Join(root, "user"))
	resources := filepath.Join(root, "resources")
	if err := os.MkdirAll(filepath.Join(resources, "extension"), 0700); err != nil {
		t.Fatal(err)
	}
	for name, body := range map[string]string{"extension/manifest.json": "current-package", "helper.mjs": "fixture"} {
		if err := os.WriteFile(filepath.Join(resources, name), []byte(body), 0600); err != nil {
			t.Fatal(err)
		}
	}
	registry := NewTargetRegistry()
	if err := registry.Register(TargetDescriptor{ID: "browser-main", Kind: "browser.managed"}); err != nil {
		t.Fatal(err)
	}
	profile := filepath.Join(root, "profiles")
	host := NewComputerUseRuntime(registry, map[string]TargetToolExecutor{"browser-main": NewPlaywrightTargetExecutor("/bin/sh", filepath.Join(resources, "helper.mjs"), profile)}, filepath.Join(root, "media"))
	defer host.Close()
	installations, err := browserbridge.Installations()
	if err != nil || len(installations) == 0 {
		t.Fatal("discovery unavailable", err)
	}
	good := installations[0]
	bad := browserbridge.Installation{ID: "browser-bbbbbbbbbbbbbbbbbbbbbbbb", Kind: "chromium"}
	for _, installation := range []browserbridge.Installation{bad, good} {
		setup := computerExtensionLocation(filepath.Join(root, "user"), profile, installation)
		if err := os.MkdirAll(filepath.Dir(filepath.Join(setup.ExtensionPath, "manifest.json")), 0700); err != nil {
			t.Fatal(err)
		}
		if installation.ID == bad.ID {
			if err := os.Mkdir(filepath.Join(setup.ExtensionPath, "manifest.json"), 0700); err != nil {
				t.Fatal(err)
			}
		} else if err := os.WriteFile(filepath.Join(setup.ExtensionPath, "manifest.json"), []byte("old-package"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	if err := host.restoreComputerInstallations(t.Context(), filepath.Join(root, "user"), profile, []browserbridge.Installation{bad, good}); err == nil {
		t.Fatal("lost failed installation diagnostic")
	}
	hub := host.extension
	if hub == nil || hub.registrations[good.ID] == nil || hub.registrations[good.ID].listener == nil {
		t.Fatal("one failed installation prevented another from restoring")
	}
	if failed := hub.registrations[bad.ID]; failed == nil || failed.listener != nil || failed.diagnostic == nil {
		t.Fatal("failed installation was reported as prepared")
	}
}

func TestExtensionSetupRejectsUnknownInstallationWithoutRetainingState(t *testing.T) {
	host := NewComputerUseRuntime(NewTargetRegistry(), nil, t.TempDir())
	defer host.Close()
	if _, err := host.setupComputerExtension(t.Context(), "untrusted-installation"); err == nil {
		t.Fatal("accepted a caller-supplied installation")
	}
	if host.extension != nil {
		t.Fatal("retained state for an undiscovered installation")
	}
}
