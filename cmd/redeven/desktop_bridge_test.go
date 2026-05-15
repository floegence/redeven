package main

import (
	"bytes"
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"

	"github.com/floegence/redeven/internal/desktopbridge"
)

func TestDesktopBridgeKeepsStdoutProtocolPure(t *testing.T) {
	t.Setenv(desktopOwnerIDEnvName, "test-desktop-owner")

	var stdout bytes.Buffer
	var stderr bytes.Buffer
	stateRoot := filepath.Join(t.TempDir(), "state")

	code := runCLI(
		[]string{"desktop-bridge", "--state-root", stateRoot},
		strings.NewReader(""),
		&stdout,
		&stderr,
	)
	if code != 0 {
		t.Fatalf("exit code = %d, want 0; stderr=%q", code, stderr.String())
	}
	out := stdout.Bytes()
	if bytes.HasPrefix(out, []byte("{")) || bytes.Contains(out, []byte("codeapp gateway listening")) {
		t.Fatalf("stdout contains non-protocol log bytes: %q", string(out[:min(len(out), 160)]))
	}

	header, payload, err := desktopbridge.ReadFrame(bytes.NewReader(out))
	if err != nil {
		t.Fatalf("ReadFrame(stdout) error = %v; stdout prefix=%q", err, string(out[:min(len(out), 160)]))
	}
	if header.Type != desktopbridge.FrameTypeHello {
		t.Fatalf("frame type = %q, want %q", header.Type, desktopbridge.FrameTypeHello)
	}
	var hello desktopbridge.Hello
	if err := json.Unmarshal(payload, &hello); err != nil {
		t.Fatalf("hello payload JSON error = %v", err)
	}
	if hello.ProtocolVersion != desktopbridge.ProtocolVersion {
		t.Fatalf("hello protocol = %q, want %q", hello.ProtocolVersion, desktopbridge.ProtocolVersion)
	}
	if !strings.Contains(stderr.String(), "codeapp gateway listening") {
		t.Fatalf("stderr = %q, want gateway startup log", stderr.String())
	}
}
