package codeserver

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestResolveNodeFromShebangFieldsAbsolute(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	nodePath := filepath.Join(root, "node-bin")
	if err := os.WriteFile(nodePath, []byte("#!/bin/sh\nexit 0\n"), 0o755); err != nil {
		t.Fatalf("write node bin: %v", err)
	}

	got, ok := resolveNodeFromShebangFields([]string{nodePath})
	if !ok {
		t.Fatal("resolveNodeFromShebangFields() returned ok=false")
	}
	if got != nodePath {
		t.Fatalf("resolveNodeFromShebangFields() = %q, want %q", got, nodePath)
	}
}

func TestResolveNodeFromShebangFieldsEnvLookup(t *testing.T) {
	root := t.TempDir()
	nodePath := filepath.Join(root, "node")
	if err := os.WriteFile(nodePath, []byte("#!/bin/sh\nexit 0\n"), 0o755); err != nil {
		t.Fatalf("write node: %v", err)
	}
	t.Setenv("PATH", root)

	got, ok := resolveNodeFromShebangFields([]string{"/usr/bin/env", "node"})
	if !ok {
		t.Fatal("resolveNodeFromShebangFields() returned ok=false")
	}
	if got != nodePath {
		t.Fatalf("resolveNodeFromShebangFields() = %q, want %q", got, nodePath)
	}
}

func TestResolveNodeFromShebangFieldsInvalid(t *testing.T) {
	t.Parallel()

	if got, ok := resolveNodeFromShebangFields([]string{"/usr/bin/env", "-S", "node"}); ok || got != "" {
		t.Fatalf("resolveNodeFromShebangFields() = (%q, %v), want empty/false", got, ok)
	}
}

func TestResolveCodeServerExecPrefersShebangInterpreter(t *testing.T) {
	root := t.TempDir()
	nodeFromShebang := filepath.Join(root, "node-shebang")
	nodeFromPath := filepath.Join(root, "node")
	script := filepath.Join(root, "code-server")

	if err := os.WriteFile(nodeFromShebang, []byte("#!/bin/sh\nexit 0\n"), 0o755); err != nil {
		t.Fatalf("write shebang node: %v", err)
	}
	if err := os.WriteFile(nodeFromPath, []byte("#!/bin/sh\nexit 0\n"), 0o755); err != nil {
		t.Fatalf("write PATH node: %v", err)
	}
	if err := os.WriteFile(script, []byte("#!"+nodeFromShebang+"\n"), 0o755); err != nil {
		t.Fatalf("write code-server script: %v", err)
	}

	t.Setenv("PATH", root)
	t.Setenv("REDEVEN_CODE_SERVER_NODE_BIN", "")

	execPath, prefixArgs, err := resolveCodeServerExec(script)
	if err != nil {
		t.Fatalf("resolveCodeServerExec() error = %v", err)
	}
	if execPath != nodeFromShebang {
		t.Fatalf("resolveCodeServerExec() execPath = %q, want %q", execPath, nodeFromShebang)
	}
	if !reflect.DeepEqual(prefixArgs, []string{script}) {
		t.Fatalf("resolveCodeServerExec() prefixArgs = %#v, want %#v", prefixArgs, []string{script})
	}
}

func TestResolveCodeServerExecPrefersExplicitOverride(t *testing.T) {
	root := t.TempDir()
	nodeOverride := filepath.Join(root, "node-override")
	nodeFromShebang := filepath.Join(root, "node-shebang")
	script := filepath.Join(root, "code-server")

	if err := os.WriteFile(nodeOverride, []byte("#!/bin/sh\nexit 0\n"), 0o755); err != nil {
		t.Fatalf("write override node: %v", err)
	}
	if err := os.WriteFile(nodeFromShebang, []byte("#!/bin/sh\nexit 0\n"), 0o755); err != nil {
		t.Fatalf("write shebang node: %v", err)
	}
	if err := os.WriteFile(script, []byte("#!"+nodeFromShebang+"\n"), 0o755); err != nil {
		t.Fatalf("write code-server script: %v", err)
	}

	t.Setenv("REDEVEN_CODE_SERVER_NODE_BIN", nodeOverride)

	execPath, prefixArgs, err := resolveCodeServerExec(script)
	if err != nil {
		t.Fatalf("resolveCodeServerExec() error = %v", err)
	}
	if execPath != nodeOverride {
		t.Fatalf("resolveCodeServerExec() execPath = %q, want %q", execPath, nodeOverride)
	}
	if !reflect.DeepEqual(prefixArgs, []string{script}) {
		t.Fatalf("resolveCodeServerExec() prefixArgs = %#v, want %#v", prefixArgs, []string{script})
	}
}
