package agent

import "testing"

func TestResolveUpgradeInstallScriptURLDefault(t *testing.T) {
	t.Setenv(upgradeInstallScriptURLEnvKey, "")

	if got := resolveUpgradeInstallScriptURL(); got != "https://redeven.com/install.sh" {
		t.Fatalf("resolveUpgradeInstallScriptURL() = %q, want %q", got, "https://redeven.com/install.sh")
	}
}

func TestResolveUpgradeInstallScriptURLOverride(t *testing.T) {
	t.Setenv(upgradeInstallScriptURLEnvKey, "https://example.test/install.sh")

	if got := resolveUpgradeInstallScriptURL(); got != "https://example.test/install.sh" {
		t.Fatalf("resolveUpgradeInstallScriptURL() = %q, want %q", got, "https://example.test/install.sh")
	}
}

func TestCompactUserFacingOutputLimitsNoise(t *testing.T) {
	got := compactUserFacingOutput("\nline one\n\nline two\nline three\nline four\n")
	want := "line one | line two | line three"
	if got != want {
		t.Fatalf("compactUserFacingOutput() = %q, want %q", got, want)
	}
}
