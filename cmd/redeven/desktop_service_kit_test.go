package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestDesktopServiceKitExtractsPublishedBytesWithoutInstallation(t *testing.T) {
	for _, architecture := range []string{"amd64", "arm64"} {
		directory := filepath.Join(t.TempDir(), "kit")
		var output, failure bytes.Buffer
		if runCLI([]string{"desktop-service-kit", "--arch", architecture, "--output", directory}, nil, &output, &failure) != 0 {
			t.Fatal("service kit extraction failed")
		}
		var manifest struct {
			ServiceSHA256 string `json:"service_sha256"`
			WorkerSHA256  string `json:"worker_sha256"`
		}
		if json.Unmarshal(output.Bytes(), &manifest) != nil {
			t.Fatal("invalid service identity")
		}
		for name, expected := range map[string]string{"floe-host-desktop-service": manifest.ServiceSHA256, "desktop-drm": manifest.WorkerSHA256} {
			data, err := os.ReadFile(filepath.Join(directory, name))
			if err != nil {
				t.Fatal(err)
			}
			hash := sha256.Sum256(data)
			if hex.EncodeToString(hash[:]) != expected {
				t.Fatal("extracted bytes differ from published manifest")
			}
		}
		if runCLI([]string{"desktop-service-kit", "--arch", architecture, "--output", directory}, nil, &output, &failure) != 1 {
			t.Fatal("existing private directory overwritten")
		}
	}
}
