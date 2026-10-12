package managedwebservice

import (
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

func parseServiceOpeningURL(value string, endpoint WebEndpointSpec, runtimePort int) (string, error) {
	if value == "" || len(value) > hostOpenResultLimit || value != strings.TrimSpace(value) || strings.ContainsAny(value, "\t\r\n ") {
		return "", serviceError("HOST_OPEN_TARGET_INVALID", "The Host service emitted an invalid startup URL.", 502, true, nil)
	}
	parsed, err := url.Parse(value)
	if err != nil || !parsed.IsAbs() || parsed.Opaque != "" || parsed.User != nil || parsed.Fragment != "" {
		return "", serviceError("HOST_OPEN_TARGET_INVALID", "The Host service emitted an invalid startup URL.", 502, true, nil)
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
		return "", serviceError("HOST_OPEN_TARGET_INVALID", "The Host service startup URL uses an unexpected port.", 502, true, nil)
	}
	appPath := parsed.EscapedPath()
	if appPath == "" {
		appPath = "/"
	}
	if parsed.RawQuery != "" {
		appPath += "?" + parsed.RawQuery
	}
	if !validHostOpenSessionPath(appPath) {
		return "", serviceError("HOST_OPEN_TARGET_INVALID", "The opening hook returned an invalid service path.", 502, true, nil)
	}
	return appPath, nil
}

type hostOutputCollector struct {
	logFile   io.Writer
	reporter  *operationReporter
	commandID string
	mu        sync.Mutex
}

func (c *hostOutputCollector) scan(stream string, source io.Reader, wait *sync.WaitGroup) {
	wait.Add(1)
	go func() {
		defer wait.Done()
		_ = readOperationOutputLines(source, func(line string) {
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
	if parseHostIdentity(service.RuntimeIdentity).version == "v3" {
		return filepath.Join(d.runDirectory(service), "open-session.json")
	}
	return filepath.Join(d.instanceRoot(service), "open-session.json")
}

// readLegacyOpenSession is used only by the frozen native identity upgrade.
func (d *hostScriptDriver) readLegacyOpenSession(service *pfregistry.ManagedService, runtimeIdentity string) (string, error) {
	launch := *service
	launch.RuntimeIdentity = runtimeIdentity
	path := d.openSessionPath(&launch)
	return readLegacyHostOpening(path, service, runtimeIdentity)
}

func validHostOpenSessionPath(value string) bool { return validServiceOpeningPath(value, false) }

func validServiceOpeningPath(value string, allowFragment bool) bool {
	if value == "" || len(value) > hostOpenResultLimit || value != strings.TrimSpace(value) || !strings.HasPrefix(value, "/") || strings.HasPrefix(value, "//") || strings.ContainsAny(value, "\r\n\t ") {
		return false
	}
	parsed, err := url.Parse(value)
	return err == nil && !parsed.IsAbs() && parsed.Host == "" && (allowFragment || parsed.Fragment == "") && !strings.HasPrefix(parsed.Path, "//") && !strings.ContainsAny(parsed.Path, "\\\r\n\t")
}

func (d *hostScriptDriver) removeOpenSession(service *pfregistry.ManagedService) {
	if service == nil {
		return
	}
	_ = os.Remove(d.openSessionPath(service))
}

func hostCommandDisplay(phase string) string {
	return fmt.Sprintf("<managed-shell> -eu -c <template-%s-script>", strings.TrimSpace(phase))
}
