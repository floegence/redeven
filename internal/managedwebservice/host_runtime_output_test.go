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
		{name: "oversized", value: "http://127.0.0.1:39191/?token=" + strings.Repeat("x", hostOpenResultLimit), wantCode: "HOST_OPEN_TARGET_INVALID"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := parseHostOpenURL(test.value, endpoint, 39191)
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
			OutputMode:       "private_file",
			AfterStartScript: testOutputOpeningScript, OpenScript: `cat "$REDEVEN_SERVICE_RUN_DIR/open-url"`,
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

	raw, readErr := os.ReadFile(filepath.Join(first.runDirectory(service), "output"))
	if readErr != nil || len(raw) != 0 {
		t.Fatalf("private output was not truncated: size=%d, err=%v", len(raw), readErr)
	}
	if raw, _ := os.ReadFile(first.logPath(service)); strings.Contains(string(raw), token) {
		t.Fatal("private token leaked to ordinary logs")
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

const testOutputOpeningScript = `umask 077
while :; do
  url=$(awk 'index($0, "ready: ")==1 { print substr($0,8); exit }' "$REDEVEN_SERVICE_OUTPUT_FILE")
  if [ -n "$url" ]; then
    printf '%s\n' "$url" > "$REDEVEN_SERVICE_RUN_DIR/open-url.tmp"
    mv "$REDEVEN_SERVICE_RUN_DIR/open-url.tmp" "$REDEVEN_SERVICE_RUN_DIR/open-url"
    exit 0
  fi
  sleep 0.1
done`

func TestHostOpeningFailurePreservesApplication(t *testing.T) {
	for _, test := range []struct{ name, hook, code string }{
		{"external URL", `printf 'http://example.com:39191/'`, "HOST_OPEN_TARGET_INVALID"},
		{"secret failure", `echo secret-on-stdout; echo secret-on-stderr >&2; exit 1`, "HOST_OPEN_HOOK_FAILED"},
		{"multiline", `printf 'http://localhost:39191/\nsecret'`, "HOST_OPEN_TARGET_INVALID"},
		{"oversized", `head -c 20000 /dev/zero`, "HOST_OPEN_TARGET_INVALID"},
	} {
		t.Run(test.name, func(t *testing.T) {
			spec := TemplateSpec{SchemaVersion: templateSpecSchemaVersion, Kind: DeploymentHost, Endpoint: WebEndpointSpec{Scheme: "http"}, Host: &HostTemplateSpec{StartScript: "exec sleep 60", OpenScript: test.hook}}
			manager, service := hostTestService(t, t.TempDir(), spec)
			driver := &hostScriptDriver{manager: manager, processes: map[string]hostProcess{}}
			identity, err := driver.Start(context.Background(), service)
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = killManagedProcessPID(hostPIDFromIdentity(identity)) })
			state, err := driver.readRunState(service)
			if err != nil || state.OpenErrorCode != test.code {
				t.Fatalf("opening state=%+v, err=%v", state, err)
			}
			if !managedProcessRunning(hostPIDFromIdentity(identity)) {
				t.Fatal("opening failure stopped the application")
			}
			if strings.Contains(state.OpenErrorMessage, "secret") {
				t.Fatal("hook output leaked")
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
		"/\\example.com":                 false,
		"/%2fexample.com":                false,
		"/%5cexample.com":                false,
		"/private#fragment":              false,
		"/private trailing":              false,
	} {
		if got := validHostOpenSessionPath(value); got != want {
			t.Errorf("validHostOpenSessionPath(%q) = %v, want %v", value, got, want)
		}
	}
}

func TestHostOpeningFromApplicationConfigurationWithoutOutputCapture(t *testing.T) {
	spec := TemplateSpec{SchemaVersion: templateSpecSchemaVersion, Kind: DeploymentHost, Endpoint: WebEndpointSpec{Scheme: "http"}, Host: &HostTemplateSpec{
		StartScript:      `umask 077; printf 'http://127.0.0.1:%s/settings?key=from-config\n' "$REDEVEN_SERVICE_PORT" > "$REDEVEN_SERVICE_DATA_DIR/application-url"; exec sleep 60`,
		AfterStartScript: `while [ ! -s "$REDEVEN_SERVICE_DATA_DIR/application-url" ]; do sleep 0.1; done`,
		OpenScript:       `cat "$REDEVEN_SERVICE_DATA_DIR/application-url"`,
	}}
	manager, service := hostTestService(t, t.TempDir(), spec)
	driver := &hostScriptDriver{manager: manager, processes: map[string]hostProcess{}}
	identity, err := driver.Start(context.Background(), service)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = killManagedProcessPID(hostPIDFromIdentity(identity)) })
	if path, err := driver.resolveOpenSession(service); err != nil || path != "/settings?key=from-config" {
		t.Fatalf("configuration opening failed: %v", err)
	}
	if _, err := os.Stat(filepath.Join(driver.runDirectory(service), "output")); !os.IsNotExist(err) {
		t.Fatal("configuration template acquired output capture")
	}
	if err := os.WriteFile(filepath.Join(driver.runDirectory(service), "run.json"), []byte(`{"schema_version":99}`), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := driver.prepareOpening(context.Background(), service, spec); managedErrorCode(err) != "HOST_OPEN_TARGET_UNAVAILABLE" {
		t.Fatal("corrupt launch record was accepted")
	}
	if !managedProcessRunning(hostPIDFromIdentity(identity)) {
		t.Fatal("corrupt opening record stopped the application")
	}
}
