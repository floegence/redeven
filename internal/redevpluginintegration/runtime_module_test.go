package redevpluginintegration

import "testing"

func TestOfficialRuntimeVersionMatchesReleasedPlatform(t *testing.T) {
	if officialRuntimeVersion != "0.7.17" {
		t.Fatalf("official runtime version = %q, want 0.7.17", officialRuntimeVersion)
	}
}
