package ai

import (
	"os"
	"strings"
	"testing"
)

func envValue(environment []string, name string) string {
	prefix := name + "="
	for _, item := range environment {
		if strings.HasPrefix(item, prefix) {
			return strings.TrimPrefix(item, prefix)
		}
	}
	return ""
}

func TestPrependRedevenBinToEnvPrefersBundledCLI(t *testing.T) {
	base := []string{
		"HOME=/tmp/flower-home",
		"PATH=/tmp/flower-home/.redeven/bin:/opt/redeven/bin:/usr/bin:/opt/redeven/bin",
		"REDEVEN_CLI_PATH=/opt/redeven/bin/redeven",
	}

	got := envValue(prependRedevenBinToEnv(base), "PATH")
	want := strings.Join([]string{"/opt/redeven/bin", "/tmp/flower-home/.redeven/bin", "/usr/bin"}, string(os.PathListSeparator))
	if got != want {
		t.Fatalf("PATH = %q, want %q", got, want)
	}
}

func TestPrependRedevenBinToEnvFallsBackToUserCLI(t *testing.T) {
	base := []string{"HOME=/tmp/flower-home", "PATH=/usr/bin"}

	got := envValue(prependRedevenBinToEnv(base), "PATH")
	want := strings.Join([]string{"/tmp/flower-home/.redeven/bin", "/usr/bin"}, string(os.PathListSeparator))
	if got != want {
		t.Fatalf("PATH = %q, want %q", got, want)
	}
}
