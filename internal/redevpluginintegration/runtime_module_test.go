package redevpluginintegration

import "testing"

func TestOfficialRuntimeVersionMatchesReleasedPlatform(t *testing.T) {
	if officialRuntimeVersion != "0.6.7" {
		t.Fatalf("official runtime version = %q, want 0.6.7", officialRuntimeVersion)
	}
}
