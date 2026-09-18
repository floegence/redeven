package ai

import (
	"os"
	"path/filepath"
	"reflect"
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
		for _, arg := range args {
			if arg == "--no-sandbox" {
				t.Fatal("browser sandbox disabled")
			}
		}
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
