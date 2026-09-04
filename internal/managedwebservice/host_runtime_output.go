package managedwebservice

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"

	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
)

const hostOpenSessionSchemaVersion = 1

type hostOpenSessionState struct {
	SchemaVersion     int    `json:"schema_version"`
	ServiceID         string `json:"service_id"`
	RuntimeSpecSHA256 string `json:"runtime_spec_sha256"`
	RuntimeIdentity   string `json:"runtime_identity"`
	AppPath           string `json:"app_path"`
}

type hostStartupTargetResult struct {
	appPath string
	err     error
}

type hostStartupTargetCapture struct {
	prefix   string
	endpoint WebEndpointSpec
	port     int
	once     sync.Once
	result   chan hostStartupTargetResult
}

func newHostStartupTargetCapture(target *HostOpenTargetSpec, endpoint WebEndpointSpec, port int) *hostStartupTargetCapture {
	if target == nil {
		return nil
	}
	return &hostStartupTargetCapture{
		prefix: target.LinePrefix, endpoint: endpoint, port: port,
		result: make(chan hostStartupTargetResult, 1),
	}
}

func (c *hostStartupTargetCapture) observe(line string) {
	if c == nil || !strings.HasPrefix(line, c.prefix) {
		return
	}
	c.once.Do(func() {
		appPath, err := parseHostStartupTarget(strings.TrimPrefix(line, c.prefix), c.endpoint, c.port)
		c.result <- hostStartupTargetResult{appPath: appPath, err: err}
	})
}

func parseHostStartupTarget(value string, endpoint WebEndpointSpec, runtimePort int) (string, error) {
	if value == "" || len(value) > operationOutputLineMax || value != strings.TrimSpace(value) || strings.ContainsAny(value, "\t\r\n ") {
		return "", serviceError("HOST_OPEN_TARGET_INVALID", "The Host service emitted an invalid startup URL.", 502, true, nil)
	}
	parsed, err := url.Parse(value)
	if err != nil || !parsed.IsAbs() || parsed.Opaque != "" || parsed.User != nil || parsed.Fragment != "" {
		return "", serviceError("HOST_OPEN_TARGET_INVALID", "The Host service emitted an invalid startup URL.", 502, true, err)
	}
	expectedScheme := strings.ToLower(strings.TrimSpace(endpoint.Scheme))
	if expectedScheme == "" {
		expectedScheme = "http"
	}
	if strings.ToLower(parsed.Scheme) != expectedScheme {
		return "", serviceError("HOST_OPEN_TARGET_INVALID", "The Host service startup URL uses an unexpected protocol.", 502, true, nil)
	}
	host := parsed.Hostname()
	ip := net.ParseIP(host)
	if !strings.EqualFold(host, "localhost") && (ip == nil || !ip.IsLoopback()) {
		return "", serviceError("HOST_OPEN_TARGET_INVALID", "The Host service startup URL is not bound to loopback.", 502, true, nil)
	}
	port, err := strconv.Atoi(parsed.Port())
	if err != nil || port != runtimePort {
		return "", serviceError("HOST_OPEN_TARGET_INVALID", "The Host service startup URL uses an unexpected port.", 502, true, err)
	}
	appPath := parsed.EscapedPath()
	if appPath == "" {
		appPath = "/"
	}
	if parsed.RawQuery != "" {
		appPath += "?" + parsed.RawQuery
	}
	return appPath, nil
}

type hostOutputCollector struct {
	logFile   io.Writer
	reporter  *operationReporter
	commandID string
	capture   *hostStartupTargetCapture
	mu        sync.Mutex
}

func (c *hostOutputCollector) scan(stream string, source io.Reader, wait *sync.WaitGroup) {
	wait.Add(1)
	go func() {
		defer wait.Done()
		_ = readOperationOutputLines(source, func(line string) {
			c.capture.observe(line)
			redacted := redactLogLine(line)
			if c.reporter != nil {
				redacted = c.reporter.Redact(line)
				c.reporter.Output(c.commandID, stream, redacted)
			}
			if c.logFile != nil {
				c.mu.Lock()
				_, _ = io.WriteString(c.logFile, redacted+"\n")
				c.mu.Unlock()
			}
		})
	}()
}

func (d *hostScriptDriver) openSessionPath(service *pfregistry.ManagedService) string {
	return filepath.Join(d.instanceRoot(service), "open-session.json")
}

func (d *hostScriptDriver) writeOpenSession(service *pfregistry.ManagedService, runtimeIdentity, appPath string) error {
	state := hostOpenSessionState{SchemaVersion: hostOpenSessionSchemaVersion, ServiceID: service.ServiceID, RuntimeSpecSHA256: service.RuntimeSpecSHA256, RuntimeIdentity: runtimeIdentity, AppPath: appPath}
	raw, err := json.Marshal(state)
	if err != nil {
		return err
	}
	path := d.openSessionPath(service)
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	temporary := path + ".tmp"
	if err := os.WriteFile(temporary, raw, 0o600); err != nil {
		return err
	}
	if err := os.Chmod(temporary, 0o600); err != nil {
		_ = os.Remove(temporary)
		return err
	}
	if err := os.Rename(temporary, path); err != nil {
		_ = os.Remove(temporary)
		return err
	}
	return nil
}

func (d *hostScriptDriver) readOpenSession(service *pfregistry.ManagedService, runtimeIdentity string) (string, error) {
	path := d.openSessionPath(service)
	info, err := os.Lstat(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return "", serviceError("HOST_OPEN_TARGET_UNAVAILABLE", "The Host service startup URL is unavailable. Restart the service to capture a new session.", 409, true, nil)
		}
		return "", serviceError("HOST_OPEN_TARGET_UNAVAILABLE", "The Host service startup URL could not be read.", 500, true, err)
	}
	if !info.Mode().IsRegular() || info.Mode().Perm()&0o077 != 0 {
		return "", serviceError("HOST_OPEN_TARGET_INVALID", "The saved Host service startup URL identity is invalid.", 409, true, nil)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return "", serviceError("HOST_OPEN_TARGET_UNAVAILABLE", "The Host service startup URL could not be read.", 500, true, err)
	}
	var state hostOpenSessionState
	if err := decodeStrictJSON(raw, &state); err != nil || state.SchemaVersion != hostOpenSessionSchemaVersion ||
		state.ServiceID != service.ServiceID || state.RuntimeSpecSHA256 != service.RuntimeSpecSHA256 ||
		state.RuntimeIdentity != strings.TrimSpace(runtimeIdentity) || !validHostOpenSessionPath(state.AppPath) {
		return "", serviceError("HOST_OPEN_TARGET_INVALID", "The saved Host service startup URL identity is invalid.", 409, true, err)
	}
	return state.AppPath, nil
}

func validHostOpenSessionPath(value string) bool {
	if value == "" || len(value) > operationOutputLineMax || value != strings.TrimSpace(value) || !strings.HasPrefix(value, "/") || strings.HasPrefix(value, "//") || strings.ContainsAny(value, "\r\n\t ") {
		return false
	}
	parsed, err := url.Parse(value)
	return err == nil && parsed.IsAbs() == false && parsed.Host == "" && parsed.Fragment == ""
}

func (d *hostScriptDriver) removeOpenSession(service *pfregistry.ManagedService) {
	if service == nil {
		return
	}
	_ = os.Remove(d.openSessionPath(service))
}

func (d *hostScriptDriver) removeOpenSessionForIdentity(service *pfregistry.ManagedService, runtimeIdentity string) {
	if service == nil {
		return
	}
	if _, err := d.readOpenSession(service, runtimeIdentity); err == nil {
		d.removeOpenSession(service)
	}
}

func (d *hostScriptDriver) resolveOpenSession(service *pfregistry.ManagedService) (string, error) {
	if service == nil || strings.TrimSpace(service.RuntimeIdentity) == "" {
		return "", serviceError("HOST_OPEN_TARGET_UNAVAILABLE", "The Host service startup URL is unavailable. Restart the service to capture a new session.", 409, true, nil)
	}
	d.processMu.Lock()
	process, ok := d.processes[service.ServiceID]
	d.processMu.Unlock()
	if ok {
		if process.identity != service.RuntimeIdentity || !managedProcessRunning(process.pid) {
			return "", serviceError("HOST_PROCESS_IDENTITY_MISMATCH", "The Host service process identity no longer matches.", 409, false, nil)
		}
	} else {
		if _, recovered, err := d.recoverPersistedProcess(service); err != nil {
			return "", err
		} else if !recovered {
			return "", serviceError("HOST_OPEN_TARGET_UNAVAILABLE", "The Host service process is not running. Restart it to capture a new session.", 409, true, nil)
		}
	}
	return d.readOpenSession(service, service.RuntimeIdentity)
}

func hostCommandDisplay(phase string) string {
	return fmt.Sprintf("<managed-shell> -eu -c <template-%s-script>", strings.TrimSpace(phase))
}
