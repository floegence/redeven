package browserinstall

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"sync"
	"time"

	"github.com/floegence/floe-native-apps/artifactcache"
)

var ErrDisabled = errors.New("built-in browser is disabled; do not request installation")
var ErrInstallRequired = errors.New("built-in browser requires user-confirmed installation")

// Status is the single installation observation. It does not own task continuation.
type Status struct {
	Launch               LaunchReadiness `json:"launch"`
	StorageBytes         int64           `json:"storage_bytes"`
	AuthorizationCommand string          `json:"authorization_command,omitempty"`
	Enabled              bool            `json:"enabled"`
	State                string          `json:"state"`
	Package              Package         `json:"package"`
	Directory            string          `json:"directory"`
	OperationID          string          `json:"operation_id,omitempty"`
	ReceivedBytes        int64           `json:"received_bytes"`
	Error                string          `json:"error,omitempty"`
}

type Manager struct {
	mu                 sync.Mutex
	root               string
	status             Status
	client             *http.Client
	cancel             context.CancelFunc
	upload             *os.File
	ctx                context.Context
	done               chan struct{}
	closed             bool
	systemPrepare      bool
	sandboxUnavailable bool
	dependenciesPath   string
	dependenciesUntil  time.Time
	dependenciesError  error
}

func New(root string, pkg Package) (*Manager, error) {
	if !filepath.IsAbs(root) || pkg.ID == "" || len(pkg.SHA256) != 64 || pkg.SizeBytes <= 0 || !filepath.IsLocal(pkg.Executable) {
		return nil, errors.New("invalid browser installation configuration")
	}
	m := &Manager{root: root, client: &http.Client{Timeout: 15 * time.Minute}, status: Status{Enabled: true, State: "not_installed", Package: pkg, Directory: filepath.Join(root, "packages", pkg.SHA256)}}
	data, err := os.ReadFile(filepath.Join(root, "settings.json"))
	if err == nil {
		var saved struct {
			Version int   `json:"version"`
			Enabled *bool `json:"enabled"`
		}
		if json.Unmarshal(data, &saved) != nil || saved.Version != 1 || saved.Enabled == nil {
			return nil, errors.New("invalid browser settings")
		}
		m.status.Enabled = *saved.Enabled
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	// The product Runtime holds the state-directory lease before creating this
	// owner. Interrupted transfers have no consent to restart and can be removed.
	for _, pattern := range []string{".browser-*.zip", ".extract-*", ".settings-*", ".acquire-*"} {
		paths, globErr := filepath.Glob(filepath.Join(root, pattern))
		if globErr != nil {
			return nil, globErr
		}
		for _, name := range paths {
			if err := os.RemoveAll(name); err != nil {
				return nil, err
			}
		}
	}
	if m.installed() {
		m.status.State = "installed"
	}
	return m, nil
}
func (m *Manager) installed() bool {
	data, err := os.ReadFile(filepath.Join(m.status.Directory, ".redeven-browser"))
	if err != nil || string(data) != m.status.Package.SHA256 {
		return false
	}
	info, err := os.Stat(filepath.Join(m.status.Directory, m.status.Package.Executable))
	return err == nil && info.Mode().IsRegular() && info.Mode()&0111 != 0
}
func (m *Manager) Snapshot() Status { m.mu.Lock(); defer m.mu.Unlock(); return m.snapshotLocked() }
func (m *Manager) Executable() (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if !m.status.Enabled {
		return "", ErrDisabled
	}
	if !m.installed() && m.status.State == "installed" {
		m.status.State = "not_installed"
	}
	if m.closed || !m.installed() {
		return "", ErrInstallRequired
	}
	return m.launchExecutableLocked(true)
}
func (m *Manager) SetEnabled(enabled bool) (Status, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.closed {
		return m.snapshotLocked(), errors.New("browser installer closed")
	}
	if err := os.MkdirAll(m.root, 0700); err != nil {
		return m.snapshotLocked(), err
	}
	data, _ := json.Marshal(struct {
		Version int  `json:"version"`
		Enabled bool `json:"enabled"`
	}{1, enabled})
	f, err := os.CreateTemp(m.root, ".settings-")
	if err != nil {
		return m.snapshotLocked(), err
	}
	defer os.Remove(f.Name())
	if _, err = f.Write(data); err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err == nil {
		err = closeErr
	}
	if err == nil {
		err = os.Rename(f.Name(), filepath.Join(m.root, "settings.json"))
	}
	if err != nil {
		return m.snapshotLocked(), err
	}
	m.status.Enabled = enabled
	if !enabled {
		m.cancelLocked()
	}
	return m.snapshotLocked(), nil
}
func (m *Manager) cancelLocked() {
	if m.cancel != nil {
		m.cancel()
	}
	if m.upload != nil {
		name := m.upload.Name()
		_ = m.upload.Close()
		m.upload = nil
		_ = os.Remove(name)
		m.finishLocked("cancelled", "")
	}
}
func (m *Manager) Cancel(id string) (Status, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if id == "" || id != m.status.OperationID {
		return m.snapshotLocked(), errors.New("browser installation operation changed")
	}
	m.cancelLocked()
	return m.snapshotLocked(), nil
}
func (m *Manager) Close() {
	m.mu.Lock()
	m.closed = true
	m.cancelLocked()
	done := m.done
	m.mu.Unlock()
	if done != nil {
		<-done
	}
}
func (m *Manager) finishLocked(state, reason string) {
	m.status.State = state
	m.status.Error = reason
	m.status.AuthorizationCommand = ""
	m.cancel = nil
	if m.done != nil {
		close(m.done)
		m.done = nil
	}
}
func (m *Manager) Start(packageID, source string) (Status, error) {
	return m.start(packageID, source, false)
}
func (m *Manager) start(packageID, source string, system bool) (Status, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if !m.status.Enabled {
		return m.snapshotLocked(), ErrDisabled
	}
	if m.closed || packageID != m.status.Package.ID || (source != "download" && source != "upload") {
		return m.snapshotLocked(), errors.New("invalid browser installation request")
	}
	if m.cancel != nil {
		return m.snapshotLocked(), errors.New("browser installation is already active")
	}
	if m.installed() && (!system || m.snapshotLocked().Launch.State == "ready") {
		m.status.State = "installed"
		return m.snapshotLocked(), nil
	}
	m.systemPrepare = system
	if system && m.installed() {
		if _, err := os.Stat(m.archivePath()); err == nil {
			m.ctx, m.cancel = context.WithCancel(context.Background())
			m.done = make(chan struct{})
			m.status.OperationID = newBrowserOperationID()
			m.status.State = "verifying_system"
			m.status.Error = ""
			go m.systemPreparation(m.ctx)
			return m.snapshotLocked(), nil
		}
	}
	if err := os.MkdirAll(m.root, 0700); err != nil {
		return m.snapshotLocked(), err
	}
	file, err := os.CreateTemp(m.root, ".browser-*.zip")
	if err != nil {
		return m.snapshotLocked(), err
	}
	seed := make([]byte, 16)
	if _, err = rand.Read(seed); err != nil {
		_ = file.Close()
		_ = os.Remove(file.Name())
		return m.snapshotLocked(), err
	}
	m.ctx, m.cancel = context.WithCancel(context.Background())
	m.done = make(chan struct{})
	m.status.OperationID = hex.EncodeToString(seed)
	m.status.ReceivedBytes = 0
	m.status.Error = ""
	if source == "upload" {
		m.status.State = "uploading"
		m.upload = file
	} else {
		m.status.State = "downloading"
		go m.download(m.ctx, file)
	}
	return m.snapshotLocked(), nil
}
func (m *Manager) WriteChunk(id string, offset int64, data []byte) (Status, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.upload == nil || id != m.status.OperationID || offset != m.status.ReceivedBytes || len(data) == 0 || len(data) > 256*1024 || offset+int64(len(data)) > m.status.Package.SizeBytes {
		return m.snapshotLocked(), errors.New("invalid browser upload chunk")
	}
	n, err := m.upload.Write(data)
	m.status.ReceivedBytes += int64(n)
	if err != nil {
		m.cancelLocked()
		return m.snapshotLocked(), err
	}
	return m.snapshotLocked(), nil
}
func (m *Manager) CompleteUpload(id string) (Status, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.upload == nil || id != m.status.OperationID || m.status.ReceivedBytes != m.status.Package.SizeBytes {
		return m.snapshotLocked(), errors.New("browser upload is incomplete")
	}
	f := m.upload
	m.upload = nil
	m.status.State = "verifying"
	go m.install(m.ctx, f)
	return m.snapshotLocked(), nil
}

// ArchiveSpec maps the product's compiled browser catalog to the released
// acquisition contract. Callers must resolve Package through the catalog.
func ArchiveSpec(pkg Package) artifactcache.Spec {
	return artifactcache.Spec{URL: pkg.URL, SHA256: pkg.SHA256, SizeBytes: pkg.SizeBytes}
}
func (m *Manager) download(ctx context.Context, file *os.File) {
	cache, err := os.MkdirTemp(m.root, ".acquire-")
	if err != nil {
		m.fail(ctx, file, "download_failed")
		return
	}
	defer os.RemoveAll(cache)
	result, err := artifactcache.Acquire(ctx, cache, ArchiveSpec(m.status.Package), artifactcache.Options{
		Client: m.client,
		OnProgress: func(p artifactcache.Progress) error {
			m.mu.Lock()
			m.status.ReceivedBytes = p.ReceivedBytes
			if p.Phase == "verifying" {
				m.status.State = "verifying"
			}
			m.mu.Unlock()
			return ctx.Err()
		},
	})
	if err != nil {
		m.fail(ctx, file, "download_failed")
		return
	}
	_ = file.Close()
	_ = os.Remove(file.Name())
	verified, err := os.Open(result.Path)
	if err != nil {
		m.fail(ctx, file, "download_failed")
		return
	}
	m.install(ctx, verified)
}
func (m *Manager) fail(ctx context.Context, file *os.File, reason string) {
	_ = file.Close()
	_ = os.Remove(file.Name())
	m.mu.Lock()
	defer m.mu.Unlock()
	state := "failed"
	if ctx.Err() != nil {
		state = "cancelled"
		reason = ""
	}
	m.finishLocked(state, reason)
}
func (m *Manager) install(ctx context.Context, file *os.File) {
	defer os.Remove(file.Name())
	defer file.Close()
	m.mu.Lock()
	m.status.State = "verifying"
	m.mu.Unlock()
	info, err := file.Stat()
	if err != nil || info.Size() != m.status.Package.SizeBytes {
		m.fail(ctx, file, "invalid_archive")
		return
	}
	if err = artifactcache.Verify(ctx, file.Name(), ArchiveSpec(m.status.Package)); err != nil {
		m.fail(ctx, file, "invalid_archive")
		return
	}
	staging, err := os.MkdirTemp(m.root, ".extract-")
	if err != nil {
		m.fail(ctx, file, "install_failed")
		return
	}
	defer os.RemoveAll(staging)
	m.mu.Lock()
	m.status.State = "installing"
	m.mu.Unlock()
	if err = extract(ctx, file, info.Size(), staging, m.status.Package.InstalledBytes); err != nil {
		m.fail(ctx, file, "invalid_archive")
		return
	}
	executable := filepath.Join(staging, m.status.Package.Executable)
	stat, err := os.Stat(executable)
	if err != nil || !stat.Mode().IsRegular() || stat.Mode()&0111 == 0 {
		m.fail(ctx, file, "invalid_archive")
		return
	}
	if err = os.WriteFile(filepath.Join(staging, ".redeven-browser"), []byte(m.status.Package.SHA256), 0600); err != nil {
		m.fail(ctx, file, "install_failed")
		return
	}
	// Linux system preparation verifies the original archive again as root.
	// Platforms without that flow retain only the installed package.
	if runtime.GOOS == "linux" {
		archive, err := os.OpenFile(filepath.Join(staging, ".archive.zip"), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
		if err != nil {
			m.fail(ctx, file, "install_failed")
			return
		}
		if _, err = file.Seek(0, io.SeekStart); err == nil {
			_, err = io.Copy(archive, file)
		}
		closeErr := archive.Close()
		if err == nil {
			err = closeErr
		}
		if err != nil {
			m.fail(ctx, file, "install_failed")
			return
		}
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if ctx.Err() != nil || !m.status.Enabled || m.closed {
		m.finishLocked("cancelled", "")
		return
	}
	if err = os.MkdirAll(filepath.Dir(m.status.Directory), 0700); err == nil {
		// Only replace an invalid package after the replacement is fully verified.
		if !m.installed() {
			err = os.RemoveAll(m.status.Directory)
		}
		if err == nil {
			if m.installed() {
				if runtime.GOOS == "linux" {
					err = os.Rename(filepath.Join(staging, ".archive.zip"), m.archivePath())
				}
			} else {
				err = os.Rename(staging, m.status.Directory)
			}
		}
	}
	if err != nil {
		m.finishLocked("failed", "install_failed")
		return
	}
	if m.systemPrepare {
		m.status.State = "verifying_system"
		go m.systemPreparation(ctx)
	} else {
		m.finishLocked("installed", "")
	}
}
