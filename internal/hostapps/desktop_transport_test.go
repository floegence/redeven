package hostapps

import (
	"testing"

	nativeapps "github.com/floegence/floe-native-apps"
)

func TestDesktopTopLevelWindowIDs(t *testing.T) {
	got := desktopTopLevelWindowIDs([]nativeapps.DesktopWindow{
		{Window: 0, Parent: 0},
		{Window: 11, Parent: 0},
		{Window: 12, Parent: 11},
		{Window: 13, Parent: 0},
	})
	if len(got) != 2 || got[0] != 11 || got[1] != 13 {
		t.Fatalf("top-level window IDs = %#v, want [11 13]", got)
	}
}
