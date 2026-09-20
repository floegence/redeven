package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestHostApplicationPackageRejectsUntrustedInputs(t *testing.T) {
	root := t.TempDir()
	output := filepath.Join(root, "components.zip")
	cases := [][]string{
		{"--arch", "arm64", "--cache", "relative", "--output", output},
		{"--arch", "amd64", "--cache", root, "--output", "relative"},
		{"--arch", "riscv64", "--cache", root, "--output", output},
		{"--arch", "arm64", "--cache", root, "--output", output, "--url", "https://example.test/untrusted.zip"},
	}
	for _, args := range cases {
		code, _, _ := runCLITest(t, append([]string{"host-application-package"}, args...)...)
		if code == 0 {
			t.Fatalf("invalid package request accepted: %v", args)
		}
	}
	if _, err := os.Stat(output); !os.IsNotExist(err) {
		t.Fatalf("invalid request created output: %v", err)
	}
}
