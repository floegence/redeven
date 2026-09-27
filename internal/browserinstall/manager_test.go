package browserinstall

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"
)

func fixture(t *testing.T, name string) ([]byte, Package) {
	t.Helper()
	var buffer bytes.Buffer
	archive := zip.NewWriter(&buffer)
	entry := &zip.FileHeader{Name: name, Method: zip.Deflate}
	entry.SetMode(0755)
	file, err := archive.CreateHeader(entry)
	if err != nil {
		t.Fatal(err)
	}
	_, _ = file.Write([]byte("browser fixture"))
	if err = archive.Close(); err != nil {
		t.Fatal(err)
	}
	data := buffer.Bytes()
	return data, Package{ID: "fixture", URL: "https://example.invalid/browser.zip", SHA256: fmt.Sprintf("%x", sha256.Sum256(data)), SizeBytes: int64(len(data)), InstalledBytes: 1024, Executable: "browser/chrome"}
}
func settle(t *testing.T, m *Manager) Status {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		state := m.Snapshot()
		switch state.State {
		case "installed", "failed", "cancelled":
			return state
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("installation did not settle")
	return Status{}
}
func TestDownloadRequiresConfirmationAndDisablePersists(t *testing.T) {
	data, pkg := fixture(t, "browser/chrome")
	var reads atomic.Int32
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { reads.Add(1); _, _ = w.Write(data) }))
	defer server.Close()
	pkg.URL = server.URL
	root := t.TempDir()
	m, err := New(root, pkg)
	if err != nil {
		t.Fatal(err)
	}
	m.client = server.Client()
	defer m.Close()
	for range 3 {
		if m.Snapshot().State != "not_installed" {
			t.Fatal("unexpected initial state")
		}
		if _, err = m.Executable(); err != ErrInstallRequired {
			t.Fatal(err)
		}
	}
	if reads.Load() != 0 {
		t.Fatal("status inspection downloaded without confirmation")
	}
	if _, err = m.SetEnabled(false); err != nil {
		t.Fatal(err)
	}
	restarted, err := New(root, pkg)
	if err != nil {
		t.Fatal(err)
	}
	defer restarted.Close()
	if restarted.Snapshot().Enabled {
		t.Fatal("disabled preference lost on restart")
	}
	if _, err = restarted.Start(pkg.ID, "download"); err != ErrDisabled {
		t.Fatal("disabled browser accepted download")
	}
	if _, err = m.SetEnabled(true); err != nil {
		t.Fatal(err)
	}
	if reads.Load() != 0 {
		t.Fatal("enabling started a download")
	}
	if _, err = m.Start(pkg.ID, "download"); err != nil {
		t.Fatal(err)
	}
	if got := settle(t, m); got.State != "installed" {
		t.Fatalf("installation: %+v", got)
	}
	if reads.Load() != 1 {
		t.Fatal("unexpected download count")
	}
	installed, err := m.Executable()
	if err != nil {
		t.Fatal(err)
	}
	if _, err = m.SetEnabled(false); err != nil {
		t.Fatal(err)
	}
	if _, err = os.Stat(installed); err != nil {
		t.Fatal("disabling deleted installed browser")
	}
	if _, err = m.Executable(); err != ErrDisabled {
		t.Fatal("disabled browser was executable")
	}
	if _, err = m.SetEnabled(true); err != nil {
		t.Fatal(err)
	}
	if _, err = m.Start(pkg.ID, "download"); err != nil {
		t.Fatal(err)
	}
	if reads.Load() != 1 {
		t.Fatal("installed browser downloaded again")
	}
}
func TestUploadChecksIdentityOrderIntegrityAndArchivePaths(t *testing.T) {
	for _, scenario := range []string{"valid", "wrong_digest", "path_traversal"} {
		t.Run(scenario, func(t *testing.T) {
			name := "browser/chrome"
			if scenario == "path_traversal" {
				name = "../escaped"
			}
			data, pkg := fixture(t, name)
			if scenario == "wrong_digest" {
				pkg.SHA256 = fmt.Sprintf("%064d", 0)
			}
			root := t.TempDir()
			m, err := New(filepath.Join(root, "state"), pkg)
			if err != nil {
				t.Fatal(err)
			}
			defer m.Close()
			if _, err = m.Start("wrong-package", "upload"); err == nil {
				t.Fatal("accepted wrong platform or version")
			}
			state, err := m.Start(pkg.ID, "upload")
			if err != nil {
				t.Fatal(err)
			}
			if _, err = m.Start(pkg.ID, "download"); err == nil {
				t.Fatal("parallel install accepted")
			}
			if _, err = m.WriteChunk(state.OperationID, 1, data); err == nil {
				t.Fatal("out-of-order chunk accepted")
			}
			if _, err = m.CompleteUpload(state.OperationID); err == nil {
				t.Fatal("incomplete upload accepted")
			}
			if _, err = m.WriteChunk(state.OperationID, 0, data); err != nil {
				t.Fatal(err)
			}
			if _, err = m.CompleteUpload(state.OperationID); err != nil {
				t.Fatal(err)
			}
			got := settle(t, m)
			want := "installed"
			if scenario != "valid" {
				want = "failed"
			}
			if got.State != want {
				t.Fatalf("state=%+v", got)
			}
			if _, err = os.Stat(filepath.Join(root, "escaped")); !os.IsNotExist(err) {
				t.Fatal("archive escaped destination")
			}
			if want == "failed" {
				if _, err = m.Executable(); err != ErrInstallRequired {
					t.Fatal("invalid archive made browser available")
				}
			}
		})
	}
}
func TestDisableCancelsActiveDownloadWithoutPublishing(t *testing.T) {
	data, pkg := fixture(t, "browser/chrome")
	started := make(chan struct{})
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Length", fmt.Sprint(len(data)))
		w.WriteHeader(200)
		w.(http.Flusher).Flush()
		close(started)
		<-r.Context().Done()
	}))
	defer server.Close()
	pkg.URL = server.URL
	m, err := New(t.TempDir(), pkg)
	if err != nil {
		t.Fatal(err)
	}
	m.client = server.Client()
	defer m.Close()
	if _, err = m.Start(pkg.ID, "download"); err != nil {
		t.Fatal(err)
	}
	<-started
	if _, err = m.SetEnabled(false); err != nil {
		t.Fatal(err)
	}
	if state := settle(t, m); state.State != "cancelled" || state.Enabled {
		t.Fatalf("state=%+v", state)
	}
	if m.installed() {
		t.Fatal("cancelled download published installation")
	}
}
func TestExtractionRejectsSymlinkParentBeforeWriting(t *testing.T) {
	var buffer bytes.Buffer
	archive := zip.NewWriter(&buffer)
	link := &zip.FileHeader{Name: "browser"}
	link.SetMode(os.ModeSymlink | 0777)
	writer, _ := archive.CreateHeader(link)
	_, _ = io.WriteString(writer, "../outside")
	file, _ := archive.Create("browser/chrome")
	_, _ = file.Write([]byte("bad"))
	_ = archive.Close()
	if err := extract(context.Background(), bytes.NewReader(buffer.Bytes()), int64(buffer.Len()), t.TempDir(), 4096); err == nil {
		t.Fatal("unsafe link accepted")
	}
}

func TestPinnedBrowserArchiveInstallsAndLaunches(t *testing.T) {
	archive := os.Getenv("REDEVEN_BROWSER_ARCHIVE")
	if archive == "" {
		t.Skip("requires the exact pinned native browser ZIP")
	}
	pkg, err := NativePackage()
	if err != nil {
		t.Fatal(err)
	}
	m, err := New(t.TempDir(), pkg)
	if err != nil {
		t.Fatal(err)
	}
	defer m.Close()
	state, err := m.Start(pkg.ID, "upload")
	if err != nil {
		t.Fatal(err)
	}
	file, err := os.Open(archive)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	buffer := make([]byte, 256*1024)
	var offset int64
	for {
		n, err := file.Read(buffer)
		if n > 0 {
			if _, writeErr := m.WriteChunk(state.OperationID, offset, buffer[:n]); writeErr != nil {
				t.Fatal(writeErr)
			}
			offset += int64(n)
		}
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
	}
	if _, err = m.CompleteUpload(state.OperationID); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(time.Minute)
	for m.Snapshot().State != "installed" && time.Now().Before(deadline) {
		if m.Snapshot().State == "failed" {
			t.Fatalf("install: %+v", m.Snapshot())
		}
		time.Sleep(10 * time.Millisecond)
	}
	executable, err := m.Executable()
	if err != nil {
		t.Fatal(err)
	}
	output, err := exec.CommandContext(t.Context(), executable, "--version").CombinedOutput()
	if err != nil {
		t.Fatalf("launch: %s %v", output, err)
	}
	t.Logf("installed browser: %s", output)
}

func TestVerifiedInstallationRepairsIncompletePackage(t *testing.T) {
	data, pkg := fixture(t, "browser/chrome")
	m, err := New(t.TempDir(), pkg)
	if err != nil {
		t.Fatal(err)
	}
	defer m.Close()
	if err = os.MkdirAll(m.Snapshot().Directory, 0700); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(m.Snapshot().Directory, "incomplete"), []byte("partial"), 0600); err != nil {
		t.Fatal(err)
	}
	state, err := m.Start(pkg.ID, "upload")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = m.WriteChunk(state.OperationID, 0, data); err != nil {
		t.Fatal(err)
	}
	if _, err = m.CompleteUpload(state.OperationID); err != nil {
		t.Fatal(err)
	}
	if got := settle(t, m); got.State != "installed" {
		t.Fatalf("repair: %+v", got)
	}
	if _, err = m.Executable(); err != nil {
		t.Fatal(err)
	}
	if _, err = os.Stat(filepath.Join(m.Snapshot().Directory, "incomplete")); !os.IsNotExist(err) {
		t.Fatal("partial package retained")
	}
}

func TestMalformedPreferenceIsRejectedWithoutChanges(t *testing.T) {
	_, pkg := fixture(t, "browser/chrome")
	root := t.TempDir()
	data := []byte(`{"version":2,"enabled":true}`)
	path := filepath.Join(root, "settings.json")
	if err := os.WriteFile(path, data, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := New(root, pkg); err == nil {
		t.Fatal("unsupported settings accepted")
	}
	actual, _ := os.ReadFile(path)
	if !bytes.Equal(actual, data) {
		t.Fatal("settings modified")
	}
}

func TestRestartDiscardsInterruptedTransferWithoutDownloading(t *testing.T) {
	_, pkg := fixture(t, "browser/chrome")
	root := t.TempDir()
	for _, name := range []string{".browser-abandoned.zip", ".extract-abandoned", "profiles"} {
		if err := os.MkdirAll(filepath.Join(root, name), 0700); err != nil {
			t.Fatal(err)
		}
	}
	m, err := New(root, pkg)
	if err != nil {
		t.Fatal(err)
	}
	defer m.Close()
	if m.Snapshot().State != "not_installed" || m.Snapshot().OperationID != "" {
		t.Fatal("interrupted operation resumed")
	}
	for _, name := range []string{".browser-abandoned.zip", ".extract-abandoned"} {
		if _, err = os.Stat(filepath.Join(root, name)); !os.IsNotExist(err) {
			t.Fatal("interrupted transfer retained")
		}
	}
	if _, err = os.Stat(filepath.Join(root, "profiles")); err != nil {
		t.Fatal("website data changed")
	}
}

func TestObservedSandboxFailureRequiresPreparationUntilRepair(t *testing.T) {
	data, pkg := fixture(t, "browser/chrome")
	m, err := New(t.TempDir(), pkg)
	if err != nil {
		t.Fatal(err)
	}
	defer m.Close()
	status, err := m.Start(pkg.ID, "upload")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = m.WriteChunk(status.OperationID, 0, data); err != nil {
		t.Fatal(err)
	}
	if _, err = m.CompleteUpload(status.OperationID); err != nil {
		t.Fatal(err)
	}
	if settle(t, m).Launch.State != "ready" {
		t.Fatal("fixture failed to install")
	}
	m.status.Package.Platform = "linux"
	m.RequireSystemPreparation()
	if status = m.Snapshot(); status.Launch.State != "system_preparation_required" || status.Launch.Action != "prepare_system" {
		t.Fatalf("readiness: %+v", status.Launch)
	}
	if _, err = m.Executable(); err != ErrSystemPreparationRequired {
		t.Fatal("launch ignored observed sandbox failure", err)
	}
	m.finishLocked("failed", "system_preparation_failed")
	if m.Snapshot().Launch.State != "system_preparation_required" {
		t.Fatal("failed repair cleared observed failure")
	}
}
