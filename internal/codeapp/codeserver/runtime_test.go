package codeserver

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestRuntimeManagerStatusDetectsSupportedOverride(t *testing.T) {
	root := t.TempDir()
	bin := filepath.Join(root, "code-server")
	writeFakeCodeServerBinary(t, bin, "4.108.2")
	t.Setenv("REDEVEN_CODE_SERVER_BIN", bin)

	mgr := newTestRuntimeManager(t)
	status := waitForActiveRuntimeDetection(t, mgr, RuntimeDetectionReady)
	if status.ActiveRuntime.Source != "env_override" {
		t.Fatalf("source=%q, want %q", status.ActiveRuntime.Source, "env_override")
	}
	if status.ActiveRuntime.BinaryPath != bin {
		t.Fatalf("binary_path=%q, want %q", status.ActiveRuntime.BinaryPath, bin)
	}
}

func TestProbeRuntimeBinaryVersionFiltersRuntimeStartupSecrets(t *testing.T) {
	root := t.TempDir()
	bin := filepath.Join(root, "code-server")
	script := `#!/bin/sh
if [ -n "${REDEVEN_LOCAL_UI_PASSWORD+x}${REDEVEN_BOOTSTRAP_TICKET+x}${REDEVEN_DESKTOP_BOOTSTRAP_TICKET+x}" ]; then
  exit 97
fi
printf '4.108.2\n'
`
	if err := os.WriteFile(bin, []byte(script), 0o755); err != nil {
		t.Fatalf("write fake code-server: %v", err)
	}
	t.Setenv("REDEVEN_LOCAL_UI_PASSWORD", "password-secret")
	t.Setenv("REDEVEN_BOOTSTRAP_TICKET", "ticket-secret")
	t.Setenv("REDEVEN_DESKTOP_BOOTSTRAP_TICKET", "legacy-ticket")

	version, err := probeRuntimeBinaryVersionWithTimeout(context.Background(), bin, defaultRuntimeProbeTimeout)
	if err != nil {
		t.Fatalf("probeRuntimeBinaryVersionWithTimeout() error = %v", err)
	}
	if version != "4.108.2" {
		t.Fatalf("version = %q, want 4.108.2", version)
	}
}

func TestRuntimeManagerSelectedManagedVersionDoesNotSilentlyFallBackToSystem(t *testing.T) {
	stateDir := t.TempDir()
	stateRoot := t.TempDir()
	systemRoot := t.TempDir()
	systemBin := filepath.Join(systemRoot, "code-server")
	writeFakeCodeServerBinary(t, systemBin, "4.108.2")
	t.Setenv("PATH", systemRoot+string(os.PathListSeparator)+os.Getenv("PATH"))

	if err := saveLocalEnvironmentRuntimeState(stateRoot, localEnvironmentRuntimeState{
		SelectedVersion: "4.109.1",
		UpdatedAtUnixMs: time.Now().UnixMilli(),
		Versions: map[string]localEnvironmentRuntimeVersion{
			"4.109.1": {InstalledAtUnixMs: time.Now().UnixMilli(), BinaryRelPath: filepath.Join("bin", codeServerBinaryName())},
		},
	}); err != nil {
		t.Fatalf("saveLocalEnvironmentRuntimeState() error = %v", err)
	}

	mgr := NewRuntimeManager(RuntimeManagerOptions{
		StateDir:  stateDir,
		StateRoot: stateRoot,
	})

	status := mgr.Status(context.Background())
	if status.ActiveRuntime.Source != "managed" {
		t.Fatalf("active source=%q, want managed", status.ActiveRuntime.Source)
	}
	if status.ActiveRuntime.DetectionState != RuntimeDetectionMissing {
		t.Fatalf("active detection_state=%q, want missing", status.ActiveRuntime.DetectionState)
	}
	if status.ActiveRuntime.ErrorCode != "managed_version_missing" {
		t.Fatalf("error_code=%q, want managed_version_missing", status.ActiveRuntime.ErrorCode)
	}
}

func TestRuntimeManagerStatusKeepsSelectedManagedRuntimeVisibleWhenOverrideIsActive(t *testing.T) {
	stateDir := t.TempDir()
	stateRoot := t.TempDir()
	overrideRoot := t.TempDir()
	overrideBin := filepath.Join(overrideRoot, "code-server")
	writeFakeCodeServerBinary(t, overrideBin, "4.108.2")
	t.Setenv("REDEVEN_CODE_SERVER_BIN", overrideBin)

	writeFakeCodeServerBinary(t, filepath.Join(sharedVersionRoot(stateRoot, "4.109.1"), "bin", codeServerBinaryName()), "4.109.1")
	if err := saveLocalEnvironmentRuntimeState(stateRoot, localEnvironmentRuntimeState{
		SelectedVersion: "4.109.1",
		UpdatedAtUnixMs: time.Now().UnixMilli(),
		Versions: map[string]localEnvironmentRuntimeVersion{
			"4.109.1": {InstalledAtUnixMs: time.Now().UnixMilli(), BinaryRelPath: filepath.Join("bin", codeServerBinaryName())},
		},
	}); err != nil {
		t.Fatalf("saveLocalEnvironmentRuntimeState() error = %v", err)
	}

	mgr := NewRuntimeManager(RuntimeManagerOptions{
		StateDir:  stateDir,
		StateRoot: stateRoot,
	})

	status := waitForActiveRuntimeDetection(t, mgr, RuntimeDetectionReady)
	if status.ActiveRuntime.Source != "env_override" {
		t.Fatalf("active source=%q, want env_override", status.ActiveRuntime.Source)
	}
	if status.ManagedRuntime.DetectionState != RuntimeDetectionReady {
		t.Fatalf("managed detection_state=%q, want ready", status.ManagedRuntime.DetectionState)
	}
	if status.ManagedRuntime.Version != "4.109.1" {
		t.Fatalf("managed version=%q, want 4.109.1", status.ManagedRuntime.Version)
	}
	if status.ManagedRuntimeSource != "managed" {
		t.Fatalf("managed_runtime_source=%q, want managed", status.ManagedRuntimeSource)
	}
}

func TestWorkspaceEngineManifestAcceptsTwoGiBArchiveLimit(t *testing.T) {
	manifest, _ := writeFakeWorkspaceEngineArchive(t, "4.126.0", t.TempDir())
	manifest.Archive.SizeBytes = defaultWorkspaceEngineArchiveLimit

	if err := validateWorkspaceEngineManifest(manifest, currentWorkspaceEnginePlatform()); err != nil {
		t.Fatalf("validateWorkspaceEngineManifest() error = %v", err)
	}
}

func TestWorkspaceEngineManifestRejectsArchiveOverTwoGiBLimit(t *testing.T) {
	manifest, _ := writeFakeWorkspaceEngineArchive(t, "4.126.0", t.TempDir())
	manifest.Archive.SizeBytes = defaultWorkspaceEngineArchiveLimit + 1

	err := validateWorkspaceEngineManifest(manifest, currentWorkspaceEnginePlatform())
	want := fmt.Sprintf("workspace engine archive is too large: %d bytes", defaultWorkspaceEngineArchiveLimit+1)
	if err == nil || !strings.Contains(err.Error(), want) {
		t.Fatalf("validateWorkspaceEngineManifest() error = %v, want containing %q", err, want)
	}
}

func TestExtractWorkspaceEngineArchiveRejectsExpandedDataOverTwoGiBLimit(t *testing.T) {
	archivePath := writeWorkspaceEngineArchiveHeaderOnly(t, defaultWorkspaceEngineArchiveLimit+1)

	err := extractWorkspaceEngineArchive(context.Background(), archivePath, t.TempDir())
	want := fmt.Sprintf("workspace engine archive extracts too much data: %d bytes", defaultWorkspaceEngineArchiveLimit+1)
	if err == nil || !strings.Contains(err.Error(), want) {
		t.Fatalf("extractWorkspaceEngineArchive() error = %v, want containing %q", err, want)
	}
}

func TestRuntimeManagerInstallPromotesSharedVersionAndSelectsEnvironment(t *testing.T) {
	stateDir := t.TempDir()
	stateRoot := t.TempDir()
	mgr := NewRuntimeManager(RuntimeManagerOptions{
		StateDir:  stateDir,
		StateRoot: stateRoot,
	})
	manifest, archivePath := writeFakeWorkspaceEngineArchive(t, "4.109.1", stateRoot)
	session, err := mgr.CreateImportSession(context.Background(), manifest)
	if err != nil {
		t.Fatalf("CreateImportSession() error = %v", err)
	}
	archive, err := os.Open(archivePath)
	if err != nil {
		t.Fatalf("open archive: %v", err)
	}
	if _, err := mgr.AppendImportChunk(context.Background(), session.UploadID, 0, archive); err != nil {
		t.Fatalf("AppendImportChunk() error = %v", err)
	}
	if err := archive.Close(); err != nil {
		t.Fatalf("close archive: %v", err)
	}

	final, err := mgr.CompleteImportSession(context.Background(), session.UploadID)
	if err != nil {
		t.Fatalf("CompleteImportSession() error = %v", err)
	}
	sharedBin := filepath.Join(sharedVersionRoot(stateRoot, "4.109.1"), "bin", codeServerBinaryName())
	if final.ActiveRuntime.DetectionState != RuntimeDetectionReady {
		t.Fatalf("active detection_state=%q, want ready", final.ActiveRuntime.DetectionState)
	}
	if final.ManagedRuntimeVersion != "4.109.1" {
		t.Fatalf("managed_runtime_version=%q, want 4.109.1", final.ManagedRuntimeVersion)
	}
	if _, err := os.Stat(sharedBin); err != nil {
		t.Fatalf("shared runtime missing: %v", err)
	}
	linkTarget, err := os.Readlink(managedRuntimePrefix(stateDir))
	if err != nil {
		t.Fatalf("Readlink(managedRuntimePrefix) error = %v", err)
	}
	if filepath.Clean(linkTarget) != filepath.Clean(sharedVersionRoot(stateRoot, "4.109.1")) {
		t.Fatalf("managed link target=%q, want %q", linkTarget, sharedVersionRoot(stateRoot, "4.109.1"))
	}
}

func TestRuntimeManagerInstallPreservesSafeRelativeSymlink(t *testing.T) {
	stateDir := t.TempDir()
	stateRoot := t.TempDir()
	version := "4.109.1"
	manifest, archivePath := writeFakeWorkspaceEngineArchiveWithEntries(t, version, stateRoot, []fakeWorkspaceEngineArchiveEntry{
		{
			RelPath: "node_modules/typescript/bin/tsc",
			Body:    []byte("#!/bin/sh\necho tsc\n"),
			Mode:    0o755,
		},
		{
			RelPath:  "node_modules/.bin/tsc",
			Typeflag: tar.TypeSymlink,
			Linkname: "../typescript/bin/tsc",
			Mode:     0o777,
		},
	})
	mgr := NewRuntimeManager(RuntimeManagerOptions{
		StateDir:  stateDir,
		StateRoot: stateRoot,
	})
	session, err := mgr.CreateImportSession(context.Background(), manifest)
	if err != nil {
		t.Fatalf("CreateImportSession() error = %v", err)
	}
	appendArchiveToSession(t, mgr, session.UploadID, archivePath)
	if _, err := mgr.CompleteImportSession(context.Background(), session.UploadID); err != nil {
		t.Fatalf("CompleteImportSession() error = %v", err)
	}

	linkPath := filepath.Join(sharedVersionRoot(stateRoot, version), "node_modules", ".bin", "tsc")
	info, err := os.Lstat(linkPath)
	if err != nil {
		t.Fatalf("lstat symlink: %v", err)
	}
	if info.Mode()&os.ModeSymlink == 0 {
		t.Fatalf("installed path mode=%v, want symlink", info.Mode())
	}
	linkTarget, err := os.Readlink(linkPath)
	if err != nil {
		t.Fatalf("readlink: %v", err)
	}
	if filepath.ToSlash(linkTarget) != "../typescript/bin/tsc" {
		t.Fatalf("symlink target=%q, want ../typescript/bin/tsc", linkTarget)
	}
	if _, err := os.Stat(filepath.Join(filepath.Dir(linkPath), filepath.FromSlash(linkTarget))); err != nil {
		t.Fatalf("symlink target should resolve inside install root: %v", err)
	}
}

func TestRuntimeManagerInstallRejectsUnsafeArchiveLinks(t *testing.T) {
	tests := []struct {
		name string
		link fakeWorkspaceEngineArchiveEntry
	}{
		{
			name: "absolute symlink",
			link: fakeWorkspaceEngineArchiveEntry{
				RelPath:  "node_modules/.bin/evil",
				Typeflag: tar.TypeSymlink,
				Linkname: "/etc/passwd",
				Mode:     0o777,
			},
		},
		{
			name: "escaping symlink",
			link: fakeWorkspaceEngineArchiveEntry{
				RelPath:  "node_modules/.bin/evil",
				Typeflag: tar.TypeSymlink,
				Linkname: "../../../outside",
				Mode:     0o777,
			},
		},
		{
			name: "hard link",
			link: fakeWorkspaceEngineArchiveEntry{
				RelPath:  "bin/evil-hardlink",
				Typeflag: tar.TypeLink,
				Linkname: "bin/" + codeServerBinaryName(),
				Mode:     0o755,
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			stateDir := t.TempDir()
			stateRoot := t.TempDir()
			version := "4.109.1"
			manifest, archivePath := writeFakeWorkspaceEngineArchiveWithEntries(t, version, stateRoot, []fakeWorkspaceEngineArchiveEntry{tt.link})
			mgr := NewRuntimeManager(RuntimeManagerOptions{
				StateDir:  stateDir,
				StateRoot: stateRoot,
			})
			session, err := mgr.CreateImportSession(context.Background(), manifest)
			if err != nil {
				t.Fatalf("CreateImportSession() error = %v", err)
			}
			appendArchiveToSession(t, mgr, session.UploadID, archivePath)
			if _, err := mgr.CompleteImportSession(context.Background(), session.UploadID); err == nil {
				t.Fatalf("CompleteImportSession() error = nil, want link rejection")
			}
			if _, err := os.Stat(sharedVersionRoot(stateRoot, version)); !errors.Is(err, os.ErrNotExist) {
				t.Fatalf("unsafe archive should not promote shared version, stat error = %v", err)
			}
		})
	}
}

func TestRuntimeManagerInstallDoesNotWriteRegularFilesThroughSymlinkedParent(t *testing.T) {
	stateDir := t.TempDir()
	stateRoot := t.TempDir()
	version := "4.109.1"
	manifest, archivePath := writeFakeWorkspaceEngineArchiveWithEntries(t, version, stateRoot, []fakeWorkspaceEngineArchiveEntry{
		{
			RelPath:  "node_modules/.bin",
			Typeflag: tar.TypeSymlink,
			Linkname: "../typescript/bin",
			Mode:     0o777,
		},
		{
			RelPath: "node_modules/.bin/tsc",
			Body:    []byte("#!/bin/sh\necho replaced\n"),
			Mode:    0o755,
		},
	})
	mgr := NewRuntimeManager(RuntimeManagerOptions{
		StateDir:  stateDir,
		StateRoot: stateRoot,
	})
	session, err := mgr.CreateImportSession(context.Background(), manifest)
	if err != nil {
		t.Fatalf("CreateImportSession() error = %v", err)
	}
	appendArchiveToSession(t, mgr, session.UploadID, archivePath)
	if _, err := mgr.CompleteImportSession(context.Background(), session.UploadID); err == nil {
		t.Fatalf("CompleteImportSession() error = nil, want symlink parent rejection")
	}

	versionRoot := sharedVersionRoot(stateRoot, version)
	if _, err := os.Stat(filepath.Join(versionRoot, "node_modules", "typescript", "bin", "tsc")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("regular file should not be written through removed symlink parent, stat error = %v", err)
	}
	if _, err := os.Stat(versionRoot); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("archive with symlink parent should not promote shared version, stat error = %v", err)
	}
}

func TestRuntimeManagerInstallReusesExistingSharedVersion(t *testing.T) {
	stateRoot := t.TempDir()
	firstStateDir := t.TempDir()
	secondStateDir := t.TempDir()
	manifest, archivePath := writeFakeWorkspaceEngineArchive(t, "4.109.1", stateRoot)

	first := NewRuntimeManager(RuntimeManagerOptions{
		StateDir:  firstStateDir,
		StateRoot: stateRoot,
	})
	firstSession, err := first.CreateImportSession(context.Background(), manifest)
	if err != nil {
		t.Fatalf("CreateImportSession(first) error = %v", err)
	}
	appendArchiveToSession(t, first, firstSession.UploadID, archivePath)
	if _, err := first.CompleteImportSession(context.Background(), firstSession.UploadID); err != nil {
		t.Fatalf("CompleteImportSession(first) error = %v", err)
	}

	second := NewRuntimeManager(RuntimeManagerOptions{
		StateDir:  secondStateDir,
		StateRoot: stateRoot,
	})
	secondSession, err := second.CreateImportSession(context.Background(), manifest)
	if err != nil {
		t.Fatalf("CreateImportSession(second) error = %v", err)
	}
	appendArchiveToSession(t, second, secondSession.UploadID, archivePath)
	final, err := second.CompleteImportSession(context.Background(), secondSession.UploadID)
	if err != nil {
		t.Fatalf("CompleteImportSession(second) error = %v", err)
	}

	if final.ManagedRuntimeVersion != "4.109.1" {
		t.Fatalf("managed_runtime_version=%q, want 4.109.1", final.ManagedRuntimeVersion)
	}
	state, err := loadLocalEnvironmentRuntimeState(stateRoot)
	if err != nil {
		t.Fatalf("loadLocalEnvironmentRuntimeState() error = %v", err)
	}
	if state.SelectedVersion != "4.109.1" {
		t.Fatalf("selected_version=%q, want 4.109.1", state.SelectedVersion)
	}
	if len(state.Versions) != 1 {
		t.Fatalf("len(versions)=%d, want 1", len(state.Versions))
	}
}

func TestRuntimeManagerInstallRollsBackExistingVersionOnInvalidReplacement(t *testing.T) {
	stateRoot := t.TempDir()
	stateDir := t.TempDir()
	version := "4.109.1"
	versionRoot := sharedVersionRoot(stateRoot, version)
	existingBin := filepath.Join(versionRoot, "bin", codeServerBinaryName())
	writeFakeCodeServerBinary(t, existingBin, version)
	if err := saveLocalEnvironmentRuntimeState(stateRoot, localEnvironmentRuntimeState{
		SelectedVersion: version,
		UpdatedAtUnixMs: time.Now().UnixMilli(),
		Versions: map[string]localEnvironmentRuntimeVersion{
			version: {InstalledAtUnixMs: time.Now().UnixMilli(), BinaryRelPath: filepath.Join("bin", codeServerBinaryName())},
		},
	}); err != nil {
		t.Fatalf("saveLocalEnvironmentRuntimeState() error = %v", err)
	}

	manifest, archivePath := writeFakeWorkspaceEngineArchive(t, version, stateRoot)
	manifest.Layout.BinaryRelPath = filepath.Join("bin", "missing-code-server")
	mgr := NewRuntimeManager(RuntimeManagerOptions{
		StateDir:  stateDir,
		StateRoot: stateRoot,
	})
	session, err := mgr.CreateImportSession(context.Background(), manifest)
	if err != nil {
		t.Fatalf("CreateImportSession() error = %v", err)
	}
	appendArchiveToSession(t, mgr, session.UploadID, archivePath)
	if _, err := mgr.CompleteImportSession(context.Background(), session.UploadID); err == nil {
		t.Fatalf("CompleteImportSession() error = nil, want validation failure")
	}

	if _, err := os.Stat(existingBin); err != nil {
		t.Fatalf("existing version should be restored, stat error = %v", err)
	}
	state, err := loadLocalEnvironmentRuntimeState(stateRoot)
	if err != nil {
		t.Fatalf("loadLocalEnvironmentRuntimeState() error = %v", err)
	}
	if state.SelectedVersion != version {
		t.Fatalf("selected_version=%q, want %q", state.SelectedVersion, version)
	}
	status := mgr.Status(context.Background())
	if status.ManagedRuntime.DetectionState != RuntimeDetectionReady {
		t.Fatalf("managed detection_state=%q, want ready", status.ManagedRuntime.DetectionState)
	}
}

func TestRuntimeManagerCancelOperationRemovesActiveImportSession(t *testing.T) {
	stateDir := t.TempDir()
	stateRoot := t.TempDir()
	mgr := NewRuntimeManager(RuntimeManagerOptions{
		StateDir:  stateDir,
		StateRoot: stateRoot,
	})
	manifest, archivePath := writeFakeWorkspaceEngineArchive(t, "4.109.1", stateRoot)
	session, err := mgr.CreateImportSession(context.Background(), manifest)
	if err != nil {
		t.Fatalf("CreateImportSession() error = %v", err)
	}
	f, err := os.Open(archivePath)
	if err != nil {
		t.Fatalf("open archive: %v", err)
	}
	buf := make([]byte, 128)
	n, err := f.Read(buf)
	if err != nil {
		t.Fatalf("read archive: %v", err)
	}
	if err := f.Close(); err != nil {
		t.Fatalf("close archive: %v", err)
	}
	if _, err := mgr.AppendImportChunk(context.Background(), session.UploadID, 0, strings.NewReader(string(buf[:n]))); err != nil {
		t.Fatalf("AppendImportChunk() error = %v", err)
	}

	status := mgr.CancelOperation(context.Background())
	if status.Operation.State != RuntimeOperationStateCancelled {
		t.Fatalf("operation.state=%q, want cancelled", status.Operation.State)
	}
	if _, err := os.Stat(workspaceEngineUploadSessionPath(stateRoot, session.UploadID)); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("session file should be removed, err=%v", err)
	}
	if _, err := os.Stat(workspaceEngineUploadPartPath(stateRoot, session.UploadID)); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("part file should be removed, err=%v", err)
	}
}

func TestRuntimeManagerRejectsOversizedImportChunkWithoutAppending(t *testing.T) {
	stateDir := t.TempDir()
	stateRoot := t.TempDir()
	mgr := NewRuntimeManager(RuntimeManagerOptions{
		StateDir:  stateDir,
		StateRoot: stateRoot,
	})
	manifest, _ := writeFakeWorkspaceEngineArchive(t, "4.109.1", stateRoot)
	manifest.Archive.SizeBytes = int64(defaultWorkspaceEngineChunkSize + 2)
	session, err := mgr.CreateImportSession(context.Background(), manifest)
	if err != nil {
		t.Fatalf("CreateImportSession() error = %v", err)
	}

	_, err = mgr.AppendImportChunk(context.Background(), session.UploadID, 0, strings.NewReader(strings.Repeat("x", defaultWorkspaceEngineChunkSize+1)))
	if err == nil || !strings.Contains(err.Error(), "chunk is too large") {
		t.Fatalf("AppendImportChunk() error = %v, want chunk too large", err)
	}
	if stat, statErr := os.Stat(workspaceEngineUploadPartPath(stateRoot, session.UploadID)); statErr == nil && stat.Size() != 0 {
		t.Fatalf("oversized chunk should not be appended, part size=%d", stat.Size())
	} else if statErr != nil && !errors.Is(statErr, os.ErrNotExist) {
		t.Fatalf("unexpected part stat error: %v", statErr)
	}

	reloaded, err := loadWorkspaceEngineImportSession(stateRoot, session.UploadID)
	if err != nil {
		t.Fatalf("loadWorkspaceEngineImportSession() error = %v", err)
	}
	if reloaded.ReceivedBytes != 0 || reloaded.NextChunkIndex != 0 {
		t.Fatalf("session advanced after oversized chunk: received=%d next=%d", reloaded.ReceivedBytes, reloaded.NextChunkIndex)
	}
}

func TestRuntimeManagerReportsImportTransferProgress(t *testing.T) {
	stateDir := t.TempDir()
	stateRoot := t.TempDir()
	mgr := NewRuntimeManager(RuntimeManagerOptions{
		StateDir:  stateDir,
		StateRoot: stateRoot,
	})
	manifest, _ := writeFakeWorkspaceEngineArchive(t, "4.109.1", stateRoot)
	manifest.Archive.SizeBytes = 2
	session, err := mgr.CreateImportSession(context.Background(), manifest)
	if err != nil {
		t.Fatalf("CreateImportSession() error = %v", err)
	}
	status := mgr.Status(context.Background())
	if status.Operation.Transfer == nil || status.Operation.Transfer.ReceivedBytes != 0 || status.Operation.Transfer.ExpectedBytes != 2 {
		t.Fatalf("initial transfer=%+v, want 0/2", status.Operation.Transfer)
	}

	if _, err := mgr.AppendImportChunk(context.Background(), session.UploadID, 0, strings.NewReader("x")); err != nil {
		t.Fatalf("AppendImportChunk() error = %v", err)
	}
	status = mgr.Status(context.Background())
	if status.Operation.Transfer == nil || status.Operation.Transfer.ReceivedBytes != 1 || status.Operation.Transfer.ExpectedBytes != 2 {
		t.Fatalf("updated transfer=%+v, want 1/2", status.Operation.Transfer)
	}

	status = mgr.CancelOperation(context.Background())
	if status.Operation.Transfer == nil || status.Operation.Transfer.ReceivedBytes != 1 || status.Operation.Transfer.ExpectedBytes != 2 {
		t.Fatalf("cancelled transfer=%+v, want retained 1/2", status.Operation.Transfer)
	}

	manifest.Archive.SizeBytes = 3
	if _, err := mgr.CreateImportSession(context.Background(), manifest); err != nil {
		t.Fatalf("second CreateImportSession() error = %v", err)
	}
	status = mgr.Status(context.Background())
	if status.Operation.Transfer == nil || status.Operation.Transfer.ReceivedBytes != 0 || status.Operation.Transfer.ExpectedBytes != 3 {
		t.Fatalf("reset transfer=%+v, want 0/3", status.Operation.Transfer)
	}
}

func TestRuntimeManagerSerializesImportChunkAppend(t *testing.T) {
	stateDir := t.TempDir()
	stateRoot := t.TempDir()
	mgr := NewRuntimeManager(RuntimeManagerOptions{
		StateDir:  stateDir,
		StateRoot: stateRoot,
	})
	manifest, _ := writeFakeWorkspaceEngineArchive(t, "4.109.1", stateRoot)
	manifest.Archive.SizeBytes = 2
	session, err := mgr.CreateImportSession(context.Background(), manifest)
	if err != nil {
		t.Fatalf("CreateImportSession() error = %v", err)
	}

	start := make(chan struct{})
	errs := make(chan error, 2)
	var wg sync.WaitGroup
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			_, appendErr := mgr.AppendImportChunk(context.Background(), session.UploadID, 0, strings.NewReader("x"))
			errs <- appendErr
		}()
	}
	close(start)
	wg.Wait()
	close(errs)

	var successCount int
	var mismatchCount int
	for appendErr := range errs {
		if appendErr == nil {
			successCount++
			continue
		}
		if strings.Contains(appendErr.Error(), "chunk index mismatch") {
			mismatchCount++
		}
	}
	if successCount != 1 || mismatchCount != 1 {
		t.Fatalf("concurrent append outcomes success=%d mismatch=%d, want 1/1", successCount, mismatchCount)
	}
	reloaded, err := loadWorkspaceEngineImportSession(stateRoot, session.UploadID)
	if err != nil {
		t.Fatalf("loadWorkspaceEngineImportSession() error = %v", err)
	}
	if reloaded.ReceivedBytes != 1 || reloaded.NextChunkIndex != 1 {
		t.Fatalf("session should advance exactly once: received=%d next=%d", reloaded.ReceivedBytes, reloaded.NextChunkIndex)
	}
	part, err := os.ReadFile(workspaceEngineUploadPartPath(stateRoot, session.UploadID))
	if err != nil {
		t.Fatalf("read part: %v", err)
	}
	if string(part) != "x" {
		t.Fatalf("part=%q, want one chunk", string(part))
	}
}

func TestRuntimeManagerSelectVersionUpdatesLocalEnvironmentSelection(t *testing.T) {
	stateDir := t.TempDir()
	stateRoot := t.TempDir()
	writeFakeCodeServerBinary(t, filepath.Join(sharedVersionRoot(stateRoot, "4.108.2"), "bin", codeServerBinaryName()), "4.108.2")
	writeFakeCodeServerBinary(t, filepath.Join(sharedVersionRoot(stateRoot, "4.109.1"), "bin", codeServerBinaryName()), "4.109.1")

	if err := saveLocalEnvironmentRuntimeState(stateRoot, localEnvironmentRuntimeState{
		SelectedVersion: "4.108.2",
		UpdatedAtUnixMs: time.Now().UnixMilli(),
		Versions: map[string]localEnvironmentRuntimeVersion{
			"4.108.2": {InstalledAtUnixMs: time.Now().UnixMilli(), BinaryRelPath: filepath.Join("bin", codeServerBinaryName())},
			"4.109.1": {InstalledAtUnixMs: time.Now().UnixMilli(), BinaryRelPath: filepath.Join("bin", codeServerBinaryName())},
		},
	}); err != nil {
		t.Fatalf("saveLocalEnvironmentRuntimeState() error = %v", err)
	}

	mgr := NewRuntimeManager(RuntimeManagerOptions{StateDir: stateDir, StateRoot: stateRoot})
	status, err := mgr.SelectVersion(context.Background(), "4.109.1")
	if err != nil {
		t.Fatalf("SelectVersion() error = %v", err)
	}
	if status.ManagedRuntimeSource != "managed" {
		t.Fatalf("managed_runtime_source=%q, want managed", status.ManagedRuntimeSource)
	}
	if status.ManagedRuntimeVersion != "4.109.1" {
		t.Fatalf("managed_runtime_version=%q, want 4.109.1", status.ManagedRuntimeVersion)
	}
	state, err := loadLocalEnvironmentRuntimeState(stateRoot)
	if err != nil {
		t.Fatalf("loadLocalEnvironmentRuntimeState() error = %v", err)
	}
	if state.SelectedVersion != "4.109.1" {
		t.Fatalf("selected_version=%q, want 4.109.1", state.SelectedVersion)
	}
}

func TestRuntimeManagerRemoveLocalEnvironmentVersionEnforcesSafetyChecks(t *testing.T) {
	stateDir := t.TempDir()
	stateRoot := t.TempDir()
	writeFakeCodeServerBinary(t, filepath.Join(sharedVersionRoot(stateRoot, "4.108.2"), "bin", codeServerBinaryName()), "4.108.2")
	writeFakeCodeServerBinary(t, filepath.Join(sharedVersionRoot(stateRoot, "4.109.1"), "bin", codeServerBinaryName()), "4.109.1")
	if err := saveLocalEnvironmentRuntimeState(stateRoot, localEnvironmentRuntimeState{
		SelectedVersion: "4.108.2",
		UpdatedAtUnixMs: time.Now().UnixMilli(),
		Versions: map[string]localEnvironmentRuntimeVersion{
			"4.108.2": {InstalledAtUnixMs: time.Now().UnixMilli(), BinaryRelPath: filepath.Join("bin", codeServerBinaryName())},
			"4.109.1": {InstalledAtUnixMs: time.Now().UnixMilli(), BinaryRelPath: filepath.Join("bin", codeServerBinaryName())},
		},
	}); err != nil {
		t.Fatalf("saveLocalEnvironmentRuntimeState() error = %v", err)
	}

	mgr := NewRuntimeManager(RuntimeManagerOptions{StateDir: stateDir, StateRoot: stateRoot})
	if _, err := mgr.RemoveLocalEnvironmentVersion(context.Background(), "4.108.2"); err != nil {
		t.Fatalf("RemoveLocalEnvironmentVersion(default) returned error = %v, want nil status kickoff", err)
	}
	final := waitForOperationState(t, mgr, RuntimeOperationStateFailed)
	if !strings.Contains(final.Operation.LastError, "selected by the current Local Environment") {
		t.Fatalf("last_error=%q, want current Local Environment selection guidance", final.Operation.LastError)
	}

	state, err := loadLocalEnvironmentRuntimeState(stateRoot)
	if err != nil {
		t.Fatalf("loadLocalEnvironmentRuntimeState() error = %v", err)
	}
	state.SelectedVersion = ""
	if err := saveLocalEnvironmentRuntimeState(stateRoot, state); err != nil {
		t.Fatalf("saveLocalEnvironmentRuntimeState() error = %v", err)
	}

	if _, err := mgr.RemoveLocalEnvironmentVersion(context.Background(), "4.109.1"); err != nil {
		t.Fatalf("RemoveLocalEnvironmentVersion(removable) returned error = %v", err)
	}
	final = waitForOperationState(t, mgr, RuntimeOperationStateSucceeded)
	if final.Operation.TargetVersion != "4.109.1" {
		t.Fatalf("target_version=%q, want 4.109.1", final.Operation.TargetVersion)
	}
	if _, err := os.Stat(sharedVersionRoot(stateRoot, "4.109.1")); !os.IsNotExist(err) {
		t.Fatalf("shared version should be removed, err=%v", err)
	}
}

func TestResolveBinaryReturnsSelectedManagedRuntime(t *testing.T) {
	stateDir := t.TempDir()
	stateRoot := t.TempDir()
	managedBin := filepath.Join(sharedVersionRoot(stateRoot, "4.109.1"), "bin", codeServerBinaryName())
	writeFakeCodeServerBinary(t, managedBin, "4.109.1")
	if err := saveLocalEnvironmentRuntimeState(stateRoot, localEnvironmentRuntimeState{
		SelectedVersion: "4.109.1",
		UpdatedAtUnixMs: time.Now().UnixMilli(),
		Versions: map[string]localEnvironmentRuntimeVersion{
			"4.109.1": {InstalledAtUnixMs: time.Now().UnixMilli(), BinaryRelPath: filepath.Join("bin", codeServerBinaryName())},
		},
	}); err != nil {
		t.Fatalf("saveLocalEnvironmentRuntimeState() error = %v", err)
	}

	got, err := ResolveBinary(stateDir, stateRoot)
	if err != nil {
		t.Fatalf("ResolveBinary() error = %v", err)
	}
	if got != managedBin {
		t.Fatalf("ResolveBinary()=%q, want %q", got, managedBin)
	}
}

func newTestRuntimeManager(t *testing.T) *RuntimeManager {
	t.Helper()
	return NewRuntimeManager(RuntimeManagerOptions{
		StateDir:  t.TempDir(),
		StateRoot: t.TempDir(),
	})
}

func waitForActiveRuntimeDetection(t *testing.T, mgr *RuntimeManager, want RuntimeDetectionState) RuntimeStatus {
	t.Helper()
	deadline := time.Now().Add(15 * time.Second)
	last := RuntimeStatus{}
	for time.Now().Before(deadline) {
		status := mgr.Status(context.Background())
		last = status
		if status.ActiveRuntime.DetectionState == want {
			return status
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("active detection_state=%q, want %q (last=%+v)", last.ActiveRuntime.DetectionState, want, last)
	return RuntimeStatus{}
}

func waitForOperationState(t *testing.T, mgr *RuntimeManager, want RuntimeOperationState) RuntimeStatus {
	t.Helper()
	deadline := time.Now().Add(20 * time.Second)
	last := RuntimeStatus{}
	for time.Now().Before(deadline) {
		status := mgr.Status(context.Background())
		last = status
		if status.Operation.State == want {
			return status
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("operation.state never reached %q (last=%+v)", want, last)
	return RuntimeStatus{}
}

func writeFakeCodeServerBinary(t *testing.T, path string, version string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("mkdir %s: %v", filepath.Dir(path), err)
	}
	script := fmt.Sprintf(`#!/bin/sh
if [ "${1:-}" = "--version" ]; then
  echo "%s"
  exit 0
fi
echo "ok"
`, version)
	if err := os.WriteFile(path, []byte(script), 0o755); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}

type fakeWorkspaceEngineArchiveEntry struct {
	RelPath  string
	Typeflag byte
	Body     []byte
	Linkname string
	Mode     int64
}

func writeFakeWorkspaceEngineArchive(t *testing.T, version string, root string) (WorkspaceEngineArtifactManifest, string) {
	t.Helper()
	return writeFakeWorkspaceEngineArchiveWithEntries(t, version, root, nil)
}

func writeFakeWorkspaceEngineArchiveWithEntries(t *testing.T, version string, root string, extraEntries []fakeWorkspaceEngineArchiveEntry) (WorkspaceEngineArtifactManifest, string) {
	t.Helper()
	archivePath := filepath.Join(t.TempDir(), "code-server.tar.gz")
	file, err := os.Create(archivePath)
	if err != nil {
		t.Fatalf("create archive: %v", err)
	}
	gz := gzip.NewWriter(file)
	tw := tar.NewWriter(gz)
	script := fmt.Sprintf("#!/bin/sh\nif [ \"${1:-}\" = \"--version\" ]; then\n  echo \"%s\"\n  exit 0\nfi\necho ok\n", version)
	entries := []fakeWorkspaceEngineArchiveEntry{
		{
			RelPath: path.Join("bin", codeServerBinaryName()),
			Body:    []byte(script),
			Mode:    0o755,
		},
	}
	entries = append(entries, extraEntries...)
	for _, entry := range entries {
		rel := path.Clean(strings.TrimPrefix(filepath.ToSlash(strings.TrimSpace(entry.RelPath)), "/"))
		if rel == "." || rel == "" || strings.HasPrefix(rel, "../") || rel == ".." {
			t.Fatalf("test archive entry path is unsafe: %q", entry.RelPath)
		}
		typeflag := entry.Typeflag
		if typeflag == 0 {
			typeflag = tar.TypeReg
		}
		mode := entry.Mode
		if mode == 0 {
			mode = 0o644
		}
		header := &tar.Header{
			Name:     path.Join(fmt.Sprintf("code-server-%s", version), rel),
			Typeflag: typeflag,
			Mode:     mode,
			Linkname: entry.Linkname,
		}
		if typeflag == tar.TypeReg {
			header.Size = int64(len(entry.Body))
		}
		if err := tw.WriteHeader(header); err != nil {
			t.Fatalf("write tar header: %v", err)
		}
		if typeflag != tar.TypeReg {
			continue
		}
		if _, err := tw.Write(entry.Body); err != nil {
			t.Fatalf("write tar body: %v", err)
		}
	}
	if err := tw.Close(); err != nil {
		t.Fatalf("close tar: %v", err)
	}
	if err := gz.Close(); err != nil {
		t.Fatalf("close gzip: %v", err)
	}
	if err := file.Close(); err != nil {
		t.Fatalf("close archive: %v", err)
	}
	raw, err := os.ReadFile(archivePath)
	if err != nil {
		t.Fatalf("read archive: %v", err)
	}
	sum := sha256.Sum256(raw)
	platform := currentWorkspaceEnginePlatform()
	platform.Supported = true
	return WorkspaceEngineArtifactManifest{
		SchemaVersion: workspaceEngineManifestSchemaVersion,
		Engine:        workspaceEngineNameCodeServer,
		Version:       version,
		Source: WorkspaceEngineArtifactSource{
			Kind:      "test",
			AssetName: filepath.Base(archivePath),
		},
		Platform: platform,
		Archive: WorkspaceEngineArchive{
			SHA256:      hex.EncodeToString(sum[:]),
			SizeBytes:   int64(len(raw)),
			Compression: "tar.gz",
		},
		Layout: WorkspaceEngineArchiveLayout{
			BinaryRelPath: filepath.Join("bin", codeServerBinaryName()),
			RootDirHint:   fmt.Sprintf("code-server-%s", version),
		},
	}, archivePath
}

func appendArchiveToSession(t *testing.T, mgr *RuntimeManager, uploadID string, archivePath string) {
	t.Helper()
	f, err := os.Open(archivePath)
	if err != nil {
		t.Fatalf("open archive: %v", err)
	}
	defer f.Close()
	if _, err := mgr.AppendImportChunk(context.Background(), uploadID, 0, f); err != nil {
		t.Fatalf("AppendImportChunk() error = %v", err)
	}
}

func writeWorkspaceEngineArchiveHeaderOnly(t *testing.T, size int64) string {
	t.Helper()
	archivePath := filepath.Join(t.TempDir(), "oversized-code-server.tar.gz")
	file, err := os.Create(archivePath)
	if err != nil {
		t.Fatalf("create archive: %v", err)
	}
	gz := gzip.NewWriter(file)
	tw := tar.NewWriter(gz)
	if err := tw.WriteHeader(&tar.Header{
		Name:     "code-server-oversized/bin/code-server",
		Typeflag: tar.TypeReg,
		Mode:     0o755,
		Size:     size,
	}); err != nil {
		t.Fatalf("write tar header: %v", err)
	}
	// The extractor rejects by header-declared size before copying file data.
	if err := gz.Close(); err != nil {
		t.Fatalf("close gzip: %v", err)
	}
	if err := file.Close(); err != nil {
		t.Fatalf("close archive: %v", err)
	}
	return archivePath
}
