package browserinstall

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/floegence/floe-native-apps/artifactcache"
)

var ErrDisabled = errors.New("built-in browser is disabled; do not request installation")
var ErrInstallRequired = errors.New("built-in browser requires user-confirmed installation")

// Status is the single installation observation. It does not own task continuation.
type Status struct {
	Enabled       bool    `json:"enabled"`
	State         string  `json:"state"`
	Package       Package `json:"package"`
	Directory     string  `json:"directory"`
	OperationID   string  `json:"operation_id,omitempty"`
	ReceivedBytes int64   `json:"received_bytes"`
	Error         string  `json:"error,omitempty"`
}

type Manager struct {
	mu     sync.Mutex
	root   string
	status Status
	client *http.Client
	cancel context.CancelFunc
	upload *os.File
	ctx    context.Context
	done   chan struct{}
	closed bool
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
func (m *Manager) Snapshot() Status { m.mu.Lock(); defer m.mu.Unlock(); return m.status }
func (m *Manager) Executable() (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if !m.status.Enabled {
		return "", ErrDisabled
	}
	if !m.installed() && m.status.State == "installed" {
		m.status.State = "not_installed"
	}
	if m.closed || m.status.State != "installed" {
		return "", ErrInstallRequired
	}
	return filepath.Join(m.status.Directory, m.status.Package.Executable), nil
}
func (m *Manager) SetEnabled(enabled bool) (Status, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.closed {
		return m.status, errors.New("browser installer closed")
	}
	if err := os.MkdirAll(m.root, 0700); err != nil {
		return m.status, err
	}
	data, _ := json.Marshal(struct {
		Version int  `json:"version"`
		Enabled bool `json:"enabled"`
	}{1, enabled})
	f, err := os.CreateTemp(m.root, ".settings-")
	if err != nil {
		return m.status, err
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
		return m.status, err
	}
	m.status.Enabled = enabled
	if !enabled {
		m.cancelLocked()
	}
	return m.status, nil
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
		return m.status, errors.New("browser installation operation changed")
	}
	m.cancelLocked()
	return m.status, nil
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
	m.cancel = nil
	if m.done != nil {
		close(m.done)
		m.done = nil
	}
}
func (m *Manager) Start(packageID, source string) (Status, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if !m.status.Enabled {
		return m.status, ErrDisabled
	}
	if m.closed || packageID != m.status.Package.ID || (source != "download" && source != "upload") {
		return m.status, errors.New("invalid browser installation request")
	}
	if m.cancel != nil {
		return m.status, errors.New("browser installation is already active")
	}
	if m.installed() {
		m.status.State = "installed"
		return m.status, nil
	}
	if err := os.MkdirAll(m.root, 0700); err != nil {
		return m.status, err
	}
	file, err := os.CreateTemp(m.root, ".browser-*.zip")
	if err != nil {
		return m.status, err
	}
	seed := make([]byte, 16)
	if _, err = rand.Read(seed); err != nil {
		_ = file.Close()
		_ = os.Remove(file.Name())
		return m.status, err
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
	return m.status, nil
}
func (m *Manager) WriteChunk(id string, offset int64, data []byte) (Status, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.upload == nil || id != m.status.OperationID || offset != m.status.ReceivedBytes || len(data) == 0 || len(data) > 256*1024 || offset+int64(len(data)) > m.status.Package.SizeBytes {
		return m.status, errors.New("invalid browser upload chunk")
	}
	n, err := m.upload.Write(data)
	m.status.ReceivedBytes += int64(n)
	if err != nil {
		m.cancelLocked()
		return m.status, err
	}
	return m.status, nil
}
func (m *Manager) CompleteUpload(id string) (Status, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.upload == nil || id != m.status.OperationID || m.status.ReceivedBytes != m.status.Package.SizeBytes {
		return m.status, errors.New("browser upload is incomplete")
	}
	f := m.upload
	m.upload = nil
	m.status.State = "verifying"
	go m.install(m.ctx, f)
	return m.status, nil
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
			err = os.Rename(staging, m.status.Directory)
		}
	}
	if err != nil {
		m.finishLocked("failed", "install_failed")
		return
	}
	m.finishLocked("installed", "")
}
