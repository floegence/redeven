package appserver

import (
	"crypto/sha256"
	"encoding/hex"
	"os"
	"regexp"
	"testing"
)

func TestRemoteDesktopExecutingRuntimeIdentity(t *testing.T) {
	identity, err := desktopRuntimeIdentity()
	if err != nil {
		t.Fatal(err)
	}
	if identity["runtime_pid"] != os.Getpid() || identity["runtime_uid"] != os.Geteuid() || identity["runtime_gid"] != os.Getegid() {
		t.Fatal("identity did not name the executing Runtime")
	}
	if !regexp.MustCompile(`^[0-9]+$`).MatchString(identity["runtime_start"].(string)) {
		t.Fatal("invalid kernel process start identity")
	}
	executable, err := os.ReadFile("/proc/self/exe")
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(executable)
	if identity["runtime_sha256"] != hex.EncodeToString(sum[:]) {
		t.Fatal("identity did not hash the live executable")
	}
}
