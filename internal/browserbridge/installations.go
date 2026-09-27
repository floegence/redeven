package browserbridge

import (
	"crypto/sha256"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
)

// Diagnostic exposes stable recovery facts without platform error output.
type Diagnostic struct {
	Stage        string `json:"stage"`
	Reason       string `json:"reason"`
	DiagnosticID string `json:"diagnostic_id,omitempty"`
}

// Installation is a host-discovered browser, never a caller-selected path.
// Platform differences stop at launch and Native Messaging file placement.
type Installation struct {
	ID                string      `json:"id"`
	Kind              string      `json:"kind"`
	Name              string      `json:"name"`
	Installed         bool        `json:"installed"`
	Prepared          bool        `json:"prepared"`
	Connected         bool        `json:"connected"`
	Reason            string      `json:"reason,omitempty"`
	Diagnostic        *Diagnostic `json:"diagnostic,omitempty"`
	Executable        string      `json:"-"`
	ManifestDirectory string      `json:"-"`
	PrivateRoot       string      `json:"-"`
}

func Installations() ([]Installation, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil, err
	}
	return discoverInstallations(runtime.GOOS, home, exec.LookPath, func(name string) bool { _, err := os.Stat(name); return err == nil }), nil
}

func discoverInstallations(platform, home string, lookup func(string) (string, error), exists func(string) bool) []Installation {
	items := []Installation{}
	add := func(kind, name, executable, manifest, private string, installed bool) {
		digest := sha256.Sum256([]byte(kind + "\x00" + home))
		items = append(items, Installation{ID: fmt.Sprintf("browser-%x", digest[:12]), Kind: kind, Name: name, Executable: executable, ManifestDirectory: manifest, PrivateRoot: private, Installed: installed})
	}
	if platform == "darwin" {
		add("google_chrome", "Google Chrome", "/usr/bin/open", filepath.Join(home, "Library/Application Support/Google/Chrome/NativeMessagingHosts"), "", exists("/Applications/Google Chrome.app") || exists(filepath.Join(home, "Applications/Google Chrome.app")))
		return items
	}
	if platform != "linux" {
		return items
	}
	chrome, err := lookup("google-chrome")
	if err != nil {
		chrome, err = lookup("google-chrome-stable")
	}
	add("google_chrome", "Google Chrome", chrome, filepath.Join(home, ".config/google-chrome/NativeMessagingHosts"), "", err == nil)
	snap := exists("/snap/chromium/current/meta/snap.yaml") && exists("/snap/bin/chromium")
	native, nativeErr := lookup("chromium")
	if nativeErr != nil && !snap {
		native, nativeErr = lookup("chromium-browser")
	}
	nativePresent := nativeErr == nil && native != "/snap/bin/chromium" && !(snap && native == "/usr/bin/chromium-browser")
	add("chromium", "Chromium", native, filepath.Join(home, ".config/chromium/NativeMessagingHosts"), "", nativePresent)
	common := filepath.Join(home, "snap/chromium/common")
	add("chromium_snap", "Chromium (Snap)", "/snap/bin/chromium", filepath.Join(common, "chromium/NativeMessagingHosts"), common, snap)
	return items
}

func ResolveInstallation(id string) (Installation, error) {
	items, err := Installations()
	if err != nil {
		return Installation{}, err
	}
	for _, item := range items {
		if item.ID == id {
			return item, nil
		}
	}
	return Installation{}, fmt.Errorf("browser installation is unavailable")
}
