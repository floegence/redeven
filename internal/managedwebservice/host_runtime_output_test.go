package managedwebservice

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestParseHostStartupTargetAcceptsOnlyExactLoopbackEndpoint(t *testing.T) {
	t.Parallel()
	endpoint := WebEndpointSpec{Scheme: "http"}
	tests := []struct {
		name     string
		value    string
		wantPath string
		wantCode string
	}{
		{name: "ipv4 with token", value: "http://127.0.0.1:39191/app?token=private", wantPath: "/app?token=private"},
		{name: "localhost", value: "http://localhost:39191/", wantPath: "/"},
		{name: "ipv6", value: "http://[::1]:39191/auth?key=value", wantPath: "/auth?key=value"},
		{name: "wrong scheme", value: "https://127.0.0.1:39191/", wantCode: "HOST_OPEN_TARGET_INVALID"},
		{name: "remote host", value: "http://example.com:39191/", wantCode: "HOST_OPEN_TARGET_INVALID"},
		{name: "wrong port", value: "http://127.0.0.1:39192/", wantCode: "HOST_OPEN_TARGET_INVALID"},
		{name: "missing port", value: "http://127.0.0.1/", wantCode: "HOST_OPEN_TARGET_INVALID"},
		{name: "userinfo", value: "http://user@127.0.0.1:39191/", wantCode: "HOST_OPEN_TARGET_INVALID"},
		{name: "fragment", value: "http://127.0.0.1:39191/#private", wantCode: "HOST_OPEN_TARGET_INVALID"},
		{name: "extra text", value: "http://127.0.0.1:39191/ ready", wantCode: "HOST_OPEN_TARGET_INVALID"},
		{name: "relative", value: "/app?token=private", wantCode: "HOST_OPEN_TARGET_INVALID"},
		{name: "oversized", value: "http://127.0.0.1:39191/?token=" + strings.Repeat("x", operationOutputLineMax), wantCode: "HOST_OPEN_TARGET_INVALID"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := parseHostStartupTarget(test.value, endpoint, 39191)
			if test.wantCode != "" {
				if code := managedErrorCode(err); code != test.wantCode {
					t.Fatalf("parse error = %v, code=%q", err, code)
				}
				return
			}
			if err != nil || got != test.wantPath {
				t.Fatalf("parse result = %q, err=%v, want %q", got, err, test.wantPath)
			}
		})
	}
}

func TestHostDynamicOpenTargetPersistsPrivateRedactedSessionAndRecovers(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Host lifecycle is Unix-only")
	}
	root := t.TempDir()
	const token = "must-not-leak-token"
	manager, service := hostTestService(t, root, TemplateSpec{
		SchemaVersion: templateSpecSchemaVersion,
		Kind:          DeploymentHost,
		Endpoint:      WebEndpointSpec{Scheme: "http", HealthPath: "/", StartupTimeout: 2},
		Host: &HostTemplateSpec{
			OpenTarget:  &HostOpenTargetSpec{Mode: "startup_output_url", LinePrefix: "ready: "},
			StartScript: fmt.Sprintf("printf \"ready: http://127.0.0.1:$REDEVEN_SERVICE_PORT/app?token=%s\\n\"; exec sleep 60", token),
		},
	})
	first := &hostScriptDriver{manager: manager, processes: map[string]hostProcess{}}
	identity, err := first.Start(context.Background(), service)
	if err != nil {
		t.Fatal(err)
	}
	service.RuntimeIdentity = identity
	t.Cleanup(func() { _ = killManagedProcessPID(hostPIDFromIdentity(identity)) })

	appPath, err := first.resolveOpenSession(service)
	if err != nil || appPath != "/app?token="+token {
		t.Fatalf("open session = %q, err=%v", appPath, err)
	}
	statePath := first.openSessionPath(service)
	info, err := os.Lstat(statePath)
	if err != nil || !info.Mode().IsRegular() || info.Mode().Perm() != 0o600 {
		t.Fatalf("private open-session state mode = %v, err=%v", info, err)
	}

	logPath := first.logPath(service)
	deadline := time.Now().Add(2 * time.Second)
	for {
		raw, readErr := os.ReadFile(logPath)
		if readErr == nil && len(raw) > 0 {
			if strings.Contains(string(raw), token) || !strings.Contains(string(raw), "REDACTED") {
				t.Fatalf("service log was not safely redacted: %s", raw)
			}
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("service log was not written: %v", readErr)
		}
		time.Sleep(10 * time.Millisecond)
	}

	second := &hostScriptDriver{manager: manager, processes: map[string]hostProcess{}}
	recovered, err := second.Start(context.Background(), service)
	if err != nil || recovered != identity {
		t.Fatalf("recovered identity = %q, err=%v, want %q", recovered, err, identity)
	}
	if err := second.Stop(context.Background(), service); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Lstat(statePath); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("open-session state remained after stop: %v", err)
	}
	second.processMu.Lock()
	_, retained := second.processes[service.ServiceID]
	second.processMu.Unlock()
	if retained {
		t.Fatal("stopped recovered process remained in the process controller")
	}
}

func TestHostDynamicOpenTargetRejectsInvalidOrMissingOutput(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Host lifecycle is Unix-only")
	}
	tests := []struct {
		name     string
		script   string
		wantCode string
	}{
		{name: "invalid remote URL", script: "printf 'ready: http://example.com:$REDEVEN_SERVICE_PORT/\\n'; exec sleep 60", wantCode: "HOST_OPEN_TARGET_INVALID"},
		{name: "process exits first", script: "exit 0", wantCode: "HOST_OPEN_TARGET_MISSING"},
		{name: "startup timeout", script: "exec sleep 60", wantCode: "HOST_OPEN_TARGET_MISSING"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			root := t.TempDir()
			manager, service := hostTestService(t, root, TemplateSpec{
				SchemaVersion: templateSpecSchemaVersion,
				Kind:          DeploymentHost,
				Endpoint:      WebEndpointSpec{Scheme: "http", HealthPath: "/", StartupTimeout: 1},
				Host: &HostTemplateSpec{
					OpenTarget: &HostOpenTargetSpec{Mode: "startup_output_url", LinePrefix: "ready: "}, StartScript: test.script,
				},
			})
			driver := &hostScriptDriver{manager: manager, processes: map[string]hostProcess{}}
			if _, err := driver.Start(context.Background(), service); managedErrorCode(err) != test.wantCode {
				t.Fatalf("Start() error = %v, want code %s", err, test.wantCode)
			}
			deadline := time.Now().Add(2 * time.Second)
			for {
				driver.processMu.Lock()
				remaining := len(driver.processes)
				driver.processMu.Unlock()
				if remaining == 0 {
					break
				}
				if time.Now().After(deadline) {
					t.Fatal("rejected Host process was not cleaned up")
				}
				time.Sleep(10 * time.Millisecond)
			}
			if _, err := os.Lstat(filepath.Join(root, "instances", service.ServiceID, "open-session.json")); !errors.Is(err, os.ErrNotExist) {
				t.Fatalf("rejected startup retained an open session: %v", err)
			}
		})
	}
}

func TestValidHostOpenSessionPathRejectsAbsoluteAndFragmentValues(t *testing.T) {
	t.Parallel()
	for value, want := range map[string]bool{
		"/?token=private":                true,
		"/nested/path?token=private":     true,
		"http://127.0.0.1:39191/private": false,
		"//example.com/private":          false,
		"/private#fragment":              false,
		"/private trailing":              false,
	} {
		if got := validHostOpenSessionPath(value); got != want {
			t.Errorf("validHostOpenSessionPath(%q) = %v, want %v", value, got, want)
		}
	}
}
