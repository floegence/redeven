package main

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/floegence/redeven/internal/browserinstall"
)

func TestBrowserPackageRejectsUnknownAndMismatchedCatalogBeforeAcquisition(t *testing.T) {
	pkg, err := browserinstall.ForPlatform("linux", "arm64")
	if err != nil {
		t.Fatal(err)
	}
	for _, scenario := range []string{"unknown", "digest", "size", "url", "path"} {
		t.Run(scenario, func(t *testing.T) {
			cache := filepath.Join(t.TempDir(), "unused")
			args := []string{"browser-package", "--package-id", pkg.ID, "--sha256", pkg.SHA256, "--size", strconv.FormatInt(pkg.SizeBytes, 10), "--cache", cache}
			switch scenario {
			case "unknown":
				args[2] = "unknown"
			case "digest":
				args[4] = strings.Repeat("0", 64)
			case "size":
				args[6] = "1"
			case "url":
				args = append(args, "--url", "https://example.invalid/package.zip")
			case "path":
				args[8] = "relative"
			}
			code, _, _ := runCLITest(t, args...)
			if code == 0 {
				t.Fatal("accepted untrusted acquisition input")
			}
			if _, err := os.Stat(cache); !os.IsNotExist(err) {
				t.Fatal("created cache before validating catalog", err)
			}
		})
	}
}
