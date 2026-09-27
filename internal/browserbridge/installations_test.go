package browserbridge

import (
	"errors"
	"path/filepath"
	"testing"
)

func TestBrowserDiscoveryRecognizesSnapWithoutClaimingNativeChromium(t *testing.T) {
	lookup := func(name string) (string, error) {
		if name == "chromium" {
			return "/snap/bin/chromium", nil
		}
		if name == "chromium-browser" {
			return "/usr/bin/chromium-browser", nil
		}
		return "", errors.New("missing")
	}
	items := discoverInstallations("linux", "/home/alice", lookup, func(name string) bool {
		return name == "/snap/bin/chromium" || name == "/snap/chromium/current/meta/snap.yaml"
	})
	var installed []Installation
	for _, item := range items {
		if item.Installed {
			installed = append(installed, item)
		}
	}
	if len(installed) != 1 || installed[0].Kind != "chromium_snap" {
		t.Fatalf("installations: %+v", installed)
	}
	item := installed[0]
	if item.ManifestDirectory != "/home/alice/snap/chromium/common/chromium/NativeMessagingHosts" {
		t.Fatal(item.ManifestDirectory)
	}
	if item.ID == item.Executable || !filepath.IsAbs(item.ManifestDirectory) {
		t.Fatal("untrusted installation identity")
	}
}

func TestBrowserDiscoveryKeepsNativeChromiumAlongsideSnap(t *testing.T) {
	lookup := func(name string) (string, error) {
		switch name {
		case "chromium":
			return "/snap/bin/chromium", nil
		case "chromium-browser":
			return "/usr/bin/chromium-browser", nil
		default:
			return "", errors.New("missing")
		}
	}
	items := discoverInstallations("linux", "/home/alice", lookup, func(name string) bool {
		return name == "/snap/bin/chromium" || name == "/snap/chromium/current/meta/snap.yaml" || name == "/usr/lib/chromium-browser/chromium-browser"
	})
	if !items[1].Installed || items[1].Kind != "chromium" || items[1].Executable != "/usr/bin/chromium-browser" {
		t.Fatalf("native Chromium disappeared after Snap installation: %+v", items)
	}
	if !items[2].Installed || items[1].ID == items[2].ID {
		t.Fatalf("coexisting browser installations must remain independently selectable: %+v", items)
	}
}

func TestBrowserInstallationsKeepIdentityAcrossRuntimeBuilds(t *testing.T) {
	lookup := func(name string) (string, error) {
		if name == "google-chrome" {
			return "/usr/bin/google-chrome", nil
		}
		return "", errors.New("missing")
	}
	one := discoverInstallations("linux", "/home/alice", lookup, func(string) bool { return false })
	two := discoverInstallations("linux", "/home/bob", lookup, func(string) bool { return false })
	if one[0].ID == two[0].ID || one[0].Kind != "google_chrome" || !one[0].Installed {
		t.Fatal("browser identity is not user scoped")
	}
}
