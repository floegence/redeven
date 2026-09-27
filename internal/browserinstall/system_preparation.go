package browserinstall

import (
	"bufio"
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"io"
	"net"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/floegence/floe-native-apps/artifactcache"
)

// PrepareSystem shares the installation operation and upload/download consent.
// A short-lived private stream carries the pinned archive to the authorized
// command and reports phases back. It carries no browser input or credentials.
func (m *Manager) PrepareSystem(packageID, source string) (Status, error) {
	if runtime.GOOS != "linux" {
		return m.Snapshot(), errors.New("system preparation is unavailable")
	}
	return m.start(packageID, source, true)
}

func (m *Manager) archivePath() string { return filepath.Join(m.status.Directory, ".archive.zip") }

func (m *Manager) systemPreparation(ctx context.Context) {
	failure := func(reason string) {
		m.mu.Lock()
		defer m.mu.Unlock()
		if ctx.Err() != nil {
			m.finishLocked("cancelled", "")
		} else {
			m.finishLocked("failed", reason)
		}
	}
	if err := artifactcache.Verify(ctx, m.archivePath(), ArchiveSpec(m.status.Package)); err != nil {
		failure("invalid_archive")
		return
	}
	directory, err := os.MkdirTemp("/tmp", "rv-system-")
	if err != nil {
		failure("system_preparation_failed")
		return
	}
	defer os.RemoveAll(directory)
	socket := filepath.Join(directory, "authorize")
	listener, err := net.Listen("unix", socket)
	if err != nil {
		failure("system_preparation_failed")
		return
	}
	defer listener.Close()
	lifetime, cancel := context.WithTimeout(ctx, 15*time.Minute)
	defer cancel()
	stop := context.AfterFunc(lifetime, func() { _ = listener.Close() })
	defer stop()
	executable, err := os.Executable()
	if err != nil {
		failure("system_preparation_failed")
		return
	}
	quote := func(s string) string { return "'" + strings.ReplaceAll(s, "'", "'\\''") + "'" }
	m.mu.Lock()
	m.status.State = "awaiting_authorization"
	m.status.AuthorizationCommand = quote(executable) + " browser-system-authorize " + quote(socket)
	m.mu.Unlock()
	connection, err := listener.Accept()
	if err != nil {
		failure("system_authorization_expired")
		return
	}
	defer connection.Close()
	stopConnection := context.AfterFunc(lifetime, func() { _ = connection.Close() })
	defer stopConnection()
	if err = json.NewEncoder(connection).Encode(map[string]string{"package_id": m.status.Package.ID}); err != nil {
		failure("system_preparation_failed")
		return
	}
	file, err := os.Open(m.archivePath())
	if err != nil {
		failure("invalid_archive")
		return
	}
	defer file.Close()
	sent := make(chan error, 1)
	go func() { _, err := io.CopyN(connection, file, m.status.Package.SizeBytes); sent <- err }()
	// The privileged command emits only fixed phase names. A reported success is
	// not trusted until the system installation and policy pass readiness checks.
	scanner := bufio.NewScanner(connection)
	scanner.Buffer(make([]byte, 1024), 4096)
	ready := false
	for scanner.Scan() {
		var status struct {
			Phase string `json:"phase"`
		}
		if json.Unmarshal(scanner.Bytes(), &status) != nil {
			break
		}
		switch status.Phase {
		case "verifying_system", "preparing_system":
			m.mu.Lock()
			m.status.State = status.Phase
			m.mu.Unlock()
		case "ready":
			ready = true
		default:
			ready = false
		}
		if ready {
			break
		}
	}
	_ = connection.Close()
	if err = <-sent; err != nil || !ready {
		failure("system_preparation_failed")
		return
	}
	if _, err = systemBrowserExecutable(m.status.Package, m.status.Directory); err != nil {
		failure("system_preparation_failed")
		return
	}
	m.mu.Lock()
	m.sandboxUnavailable = false
	m.dependenciesUntil = time.Time{}
	m.finishLocked("installed", "")
	m.mu.Unlock()
}

func newBrowserOperationID() string { return rand.Text() }
