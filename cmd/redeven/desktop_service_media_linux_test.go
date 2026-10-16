package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestDesktopServiceMediaAcceptsRootSSHIdentity(t *testing.T) {
	if os.Geteuid() != 0 {
		t.Skip("requires the isolated root SSH fixture identity")
	}
	// /dev/null cannot become a cache directory. This fails before acquisition,
	// while distinguishing a valid root request from rejected CLI arguments.
	output := filepath.Join(t.TempDir(), "media.tar.gz")
	code, _, _ := runCLITest(t, "desktop-service-media", "--cache", "/dev/null", "--output", output)
	if code != 1 {
		t.Fatalf("root media request was rejected before preparation: %d", code)
	}
	if _, err := os.Stat(output); !os.IsNotExist(err) {
		t.Fatal("failed preparation published an archive")
	}
}
