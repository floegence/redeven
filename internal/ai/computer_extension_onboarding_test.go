package ai

import (
	"context"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestExtensionOnboardingOpensOnlyFixedDestinations(t *testing.T) {
	setup := ComputerExtensionSetup{NativeHost: "dev.floegence.redeven.r123456789abcdef0", ExtensionID: "mgfbpkkmocckooenpdfpefknffjanjce", ExtensionPath: "/fixture/extension"}
	for _, action := range []string{"extensions", "folder", "connect"} {
		name, args, err := computerExtensionOpenCommand("darwin", action, setup)
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
	name, args, err := computerExtensionOpenCommand("linux", "folder", setup)
	if err != nil || name != "xdg-open" || !reflect.DeepEqual(args, []string{filepath.Dir(setup.ExtensionPath)}) {
		t.Fatalf("linux reveal: %s %v %v", name, args, err)
	}
	for _, action := range []string{"", "https://example.com", "../folder", "--args", "file:///tmp"} {
		if _, _, err := computerExtensionOpenCommand("darwin", action, setup); err == nil {
			t.Fatalf("accepted %q", action)
		}
	}
	if _, _, err := computerExtensionOpenCommand("windows", "connect", setup); err == nil {
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
	create := func() *ComputerUseRuntime {
		registry := NewTargetRegistry()
		if err := registry.Register(TargetDescriptor{ID: "browser-main", Kind: "browser.managed"}); err != nil {
			t.Fatal(err)
		}
		host := NewComputerUseRuntime(registry, map[string]TargetToolExecutor{"browser-main": NewPlaywrightTargetExecutor("/fixture/node", filepath.Join(resources, "helper.mjs"), filepath.Join(root, "profiles"))}, filepath.Join(root, "media"))
		t.Cleanup(func() { _ = host.Close() })
		return host
	}
	host := create()
	setup, err := host.setupComputerExtension(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	manifest := host.extension.manifestPath
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
	host.extension.connectionError = "extension_update_required"
	host.extension.mu.Unlock()
	repaired, err := host.setupComputerExtension(context.Background())
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
	resumed, err := restarted.setupComputerExtension(context.Background())
	if err != nil || !reflect.DeepEqual(resumed, setup) {
		t.Fatalf("restart: %+v %v", resumed, err)
	}
	if _, err := os.Stat(restarted.extension.manifestPath); err != nil {
		t.Fatal(err)
	}
	if len(restarted.extensionStatus().Profiles) != 0 {
		t.Fatal("restart implicitly connected Chrome")
	}
}
