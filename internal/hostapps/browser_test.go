package hostapps

import (
	"testing"

	"github.com/floegence/redeven/internal/browserbridge"
)

func TestRemoteBrowserCatalogRequiresItsPreparingOwner(t *testing.T) {
	m := New(t.TempDir(), t.TempDir(), nil)
	installations, err := browserbridge.Installations()
	if err != nil || len(installations) == 0 {
		t.Fatalf("supported browser installation identity missing: %v", err)
	}
	id := "custom:" + browserbridge.RemoteProfileID(m.state, "alice", installations[0].ID) + ".desktop"
	if !m.browserApplicationAllowed(id, "alice") {
		t.Fatal("owner cannot access the prepared browser")
	}
	for _, other := range []string{"", "bob"} {
		if m.browserApplicationAllowed(id, other) {
			t.Fatal("another user can launch the private browser profile")
		}
	}
	if !m.browserApplicationAllowed("ordinary.desktop", "bob") {
		t.Fatal("ordinary host application discovery changed")
	}
	if m.browserApplicationAllowed("custom:remote-browser-invalid.desktop", "alice") {
		t.Fatal("unrecognized remote browser entry was admitted")
	}
}
