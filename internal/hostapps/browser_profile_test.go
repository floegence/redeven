package hostapps

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestBrowserProfilePersistsWithinOwnerApplicationBoundary(t *testing.T) {
	state := t.TempDir()
	m := &Manager{state: state}
	first, err := m.browserProfileDirectory("alice", "system:chrome")
	if err != nil {
		t.Fatal(err)
	}
	again, err := m.browserProfileDirectory("alice", "system:chrome")
	if err != nil || first != again {
		t.Fatal("profile changed between launches", err)
	}
	for _, pair := range [][2]string{{"bob", "system:chrome"}, {"alice", "system:firefox"}, {"alice", "custom:../chrome"}} {
		other, err := m.browserProfileDirectory(pair[0], pair[1])
		if err != nil || other == first || filepath.Dir(other) != filepath.Dir(first) {
			t.Fatal("profile escaped its owner/application boundary", err)
		}
	}
	link := filepath.Join(t.TempDir(), "state")
	if err := os.Symlink(state, link); err != nil {
		t.Fatal(err)
	}
	m.state = link
	canonical, err := m.browserProfileDirectory("alice", "system:chrome")
	if err != nil || canonical != first {
		t.Fatal("profile path was not canonical", err)
	}
	if strings.Contains(filepath.Base(first), "alice") || strings.Contains(filepath.Base(first), "chrome") {
		t.Fatal("profile exposed caller-selected path bytes")
	}
}
