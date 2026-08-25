package managedwebservice

import (
	"archive/tar"
	"bufio"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
)

const maxNativeArchiveBytes = 4 * 1024 * 1024 * 1024
const maxNativeExtractedBytes = 4 * 1024 * 1024 * 1024

type nativeProcess struct {
	cmd      *exec.Cmd
	identity string
	done     <-chan struct{}
}

type nativeDriver struct {
	log       *slog.Logger
	stateDir  string
	client    *http.Client
	mu        sync.Mutex
	processes map[string]nativeProcess
}

func (d *nativeDriver) Install(ctx context.Context, service *pfregistry.ManagedService, catalog catalogPayload, progress func(string, int64)) (string, string, error) {
	if d.processes == nil {
		d.processes = map[string]nativeProcess{}
	}
	artifact, ok := catalog.Platforms[currentPlatformKey()]
	if !ok {
		return "", "", serviceError("PLATFORM_UNSUPPORTED", "The audited catalog does not include this Environment's platform.", 409, false, nil)
	}
	if err := validateNativeArtifact(artifact, d.client, defaultPackageOrigin); err != nil {
		return "", "", err
	}
	installRoot := filepath.Join(d.stateDir, DeepSeekHarnessTemplateID, "native", DeepSeekHarnessVersion, currentPlatformKey())
	executable := filepath.Join(installRoot, filepath.FromSlash(artifact.ExecutableRelPath))
	if info, err := os.Stat(executable); err == nil && info.Mode().IsRegular() && info.Mode()&0o111 != 0 {
		return "", executable, nil
	}
	stagingRoot := filepath.Join(d.stateDir, ".staging", service.ServiceID)
	_ = os.RemoveAll(stagingRoot)
	if err := os.MkdirAll(stagingRoot, 0o700); err != nil {
		return "", "", err
	}
	defer os.RemoveAll(stagingRoot)
	archivePath := filepath.Join(stagingRoot, "package.tar.gz")
	progress("downloading", 2)
	if err := downloadNativeArchive(ctx, d.client, artifact, archivePath); err != nil {
		return "", "", err
	}
	progress("verifying", 3)
	if err := verifyNativeArchive(archivePath, artifact); err != nil {
		return "", "", err
	}
	extractRoot := filepath.Join(stagingRoot, "root")
	progress("installing", 4)
	if err := extractManagedArchive(archivePath, extractRoot); err != nil {
		return "", "", serviceError("ARCHIVE_INVALID", "The audited native package could not be safely extracted.", 502, false, err)
	}
	stagedExecutable := filepath.Join(extractRoot, filepath.FromSlash(artifact.ExecutableRelPath))
	if info, err := os.Stat(stagedExecutable); err != nil || !info.Mode().IsRegular() || info.Mode()&0o111 == 0 {
		return "", "", serviceError("ARCHIVE_LAYOUT_INVALID", "The audited native package is missing its executable launcher.", 502, false, err)
	}
	if err := os.MkdirAll(filepath.Dir(installRoot), 0o700); err != nil {
		return "", "", err
	}
	if _, err := os.Stat(installRoot); err == nil {
		return "", "", serviceError("INSTALL_IDENTITY_CONFLICT", "An unexpected native installation already occupies the managed runtime path.", 409, false, nil)
	} else if !errors.Is(err, os.ErrNotExist) {
		return "", "", err
	}
	if err := os.Rename(extractRoot, installRoot); err != nil {
		return "", "", err
	}
	return "", executable, nil
}

func validateNativeArtifact(artifact nativeArtifact, client *http.Client, packageOrigin string) error {
	if client == nil {
		return serviceError("DOWNLOAD_UNAVAILABLE", "The native package downloader is unavailable.", 503, true, nil)
	}
	if err := validatePackageURL(artifact.DownloadURL, packageOrigin); err != nil {
		return serviceError("PACKAGE_SOURCE_REJECTED", "The native package URL is outside Redeven's audited package origin.", 502, false, err)
	}
	digest, err := hex.DecodeString(strings.ToLower(strings.TrimSpace(artifact.SHA256)))
	if err != nil || len(digest) != sha256.Size {
		return serviceError("CATALOG_INVALID", "The native package SHA-256 is invalid.", 502, false, err)
	}
	if artifact.SizeBytes <= 0 || artifact.SizeBytes > maxNativeArchiveBytes {
		return serviceError("CATALOG_INVALID", "The native package size is invalid.", 502, false, nil)
	}
	rel := filepath.Clean(filepath.FromSlash(strings.TrimSpace(artifact.ExecutableRelPath)))
	if rel == "." || filepath.IsAbs(rel) || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return serviceError("CATALOG_INVALID", "The native package executable path is invalid.", 502, false, nil)
	}
	return nil
}

func downloadNativeArchive(ctx context.Context, client *http.Client, artifact nativeArtifact, destination string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, artifact.DownloadURL, nil)
	if err != nil {
		return err
	}
	resp, err := client.Do(req)
	if err != nil {
		return serviceError("DOWNLOAD_FAILED", "The audited native package could not be downloaded.", 503, true, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return serviceError("DOWNLOAD_FAILED", "The audited native package could not be downloaded.", 503, true, fmt.Errorf("package returned %s", resp.Status))
	}
	if resp.ContentLength >= 0 && resp.ContentLength != artifact.SizeBytes {
		return serviceError("PACKAGE_SIZE_MISMATCH", "The native package size does not match the audited catalog.", 502, true, nil)
	}
	file, err := os.OpenFile(destination, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	written, copyErr := io.Copy(file, io.LimitReader(resp.Body, artifact.SizeBytes+1))
	closeErr := file.Close()
	if copyErr != nil {
		return copyErr
	}
	if closeErr != nil {
		return closeErr
	}
	if written != artifact.SizeBytes {
		return serviceError("PACKAGE_SIZE_MISMATCH", "The native package size does not match the audited catalog.", 502, true, nil)
	}
	return nil
}

func verifyNativeArchive(path string, artifact nativeArtifact) error {
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()
	hash := sha256.New()
	written, err := io.Copy(hash, file)
	if err != nil {
		return err
	}
	if written != artifact.SizeBytes || !strings.EqualFold(hex.EncodeToString(hash.Sum(nil)), artifact.SHA256) {
		return serviceError("PACKAGE_CHECKSUM_MISMATCH", "The native package checksum does not match the audited catalog.", 502, true, nil)
	}
	return nil
}

func extractManagedArchive(archivePath, destination string) error {
	if err := os.MkdirAll(destination, 0o700); err != nil {
		return err
	}
	file, err := os.Open(archivePath)
	if err != nil {
		return err
	}
	defer file.Close()
	gz, err := gzip.NewReader(file)
	if err != nil {
		return err
	}
	defer gz.Close()
	reader := tar.NewReader(gz)
	entries := 0
	var extractedBytes int64
	for {
		header, err := reader.Next()
		if errors.Is(err, io.EOF) {
			return nil
		}
		if err != nil {
			return err
		}
		entries++
		if entries > 500_000 {
			return errors.New("archive has too many entries")
		}
		name := filepath.Clean(filepath.FromSlash(header.Name))
		if name == "." {
			continue
		}
		if filepath.IsAbs(name) || name == ".." || strings.HasPrefix(name, ".."+string(filepath.Separator)) {
			return errors.New("archive path escapes destination")
		}
		target := filepath.Join(destination, name)
		rel, err := filepath.Rel(destination, target)
		if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
			return errors.New("archive path escapes destination")
		}
		switch header.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(target, 0o700); err != nil {
				return err
			}
		case tar.TypeReg, tar.TypeRegA:
			if header.Size < 0 || header.Size > maxNativeArchiveBytes {
				return errors.New("archive entry size is invalid")
			}
			if header.Size > maxNativeExtractedBytes-extractedBytes {
				return errors.New("archive expands beyond the managed package limit")
			}
			extractedBytes += header.Size
			if err := os.MkdirAll(filepath.Dir(target), 0o700); err != nil {
				return err
			}
			mode := os.FileMode(header.Mode) & 0o777
			mode &^= 0o022
			if mode&0o111 == 0 {
				mode = 0o600
			} else {
				mode = 0o700
			}
			out, err := os.OpenFile(target, os.O_CREATE|os.O_EXCL|os.O_WRONLY, mode)
			if err != nil {
				return err
			}
			written, copyErr := io.CopyN(out, reader, header.Size)
			closeErr := out.Close()
			if copyErr != nil {
				return copyErr
			}
			if closeErr != nil {
				return closeErr
			}
			if written != header.Size {
				return io.ErrUnexpectedEOF
			}
		default:
			return fmt.Errorf("archive entry type %d is not allowed", header.Typeflag)
		}
	}
}

func (d *nativeDriver) Start(_ context.Context, service *pfregistry.ManagedService) (string, error) {
	if service == nil {
		return "", errors.New("service is required")
	}
	d.mu.Lock()
	if d.processes == nil {
		d.processes = map[string]nativeProcess{}
	}
	if current, ok := d.processes[service.ServiceID]; ok && current.cmd.ProcessState == nil {
		d.mu.Unlock()
		if service.RuntimeIdentity != "" && current.identity != service.RuntimeIdentity {
			return "", serviceError("RUNTIME_IDENTITY_MISMATCH", "The managed native process identity does not match the persisted instance.", 409, false, nil)
		}
		return current.identity, nil
	}
	d.mu.Unlock()
	if pid := nativePIDFromIdentity(service.RuntimeIdentity); pid > 0 && managedProcessAlive(pid) {
		return "", serviceError("RUNTIME_IDENTITY_MISMATCH", "A process still uses the saved managed identity, but this Runtime did not create it.", 409, false, nil)
	}
	executable := filepath.Clean(strings.TrimSpace(service.ArtifactReference))
	installRoot := filepath.Join(d.stateDir, DeepSeekHarnessTemplateID, "native")
	rel, err := filepath.Rel(installRoot, executable)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", serviceError("INSTALL_IDENTITY_MISMATCH", "The native launcher is outside the managed runtime directory.", 409, false, err)
	}
	if info, err := os.Stat(executable); err != nil || !info.Mode().IsRegular() || info.Mode()&0o111 == 0 {
		return "", serviceError("INSTALL_NOT_READY", "The native DeepSeek Harness launcher is not installed.", 409, true, err)
	}
	dataDir := filepath.Join(d.stateDir, DeepSeekHarnessTemplateID, "data")
	logDir := filepath.Join(d.stateDir, DeepSeekHarnessTemplateID, "logs")
	if err := os.MkdirAll(dataDir, 0o700); err != nil {
		return "", err
	}
	if err := os.MkdirAll(logDir, 0o700); err != nil {
		return "", err
	}
	logFile, err := os.OpenFile(filepath.Join(logDir, "harness.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return "", err
	}
	cmd := exec.Command(executable, nativeCommandArgs(service)...)
	cmd.Dir = service.WorkspacePath
	cmd.Env = append(os.Environ(), "DSH_HOME="+dataDir, "HOME="+service.WorkspacePath)
	cmd.Stdout, cmd.Stderr = logFile, logFile
	configureManagedProcess(cmd)
	if err := cmd.Start(); err != nil {
		_ = logFile.Close()
		return "", serviceError("START_FAILED", "DeepSeek Harness could not be started.", 502, true, err)
	}
	nonce, err := randomID("proc")
	if err != nil {
		_ = terminateManagedProcess(cmd)
		_ = logFile.Close()
		return "", err
	}
	identity := "native:" + service.ServiceID + ":" + nonce + ":" + strconv.Itoa(cmd.Process.Pid)
	done := make(chan struct{})
	d.mu.Lock()
	d.processes[service.ServiceID] = nativeProcess{cmd: cmd, identity: identity, done: done}
	d.mu.Unlock()
	go func() {
		waitErr := cmd.Wait()
		_ = logFile.Close()
		d.mu.Lock()
		if current, ok := d.processes[service.ServiceID]; ok && current.identity == identity {
			delete(d.processes, service.ServiceID)
		}
		d.mu.Unlock()
		close(done)
		if waitErr != nil {
			d.log.Info("managed DeepSeek Harness process exited", "service_id", service.ServiceID, "error", waitErr)
		}
	}()
	return identity, nil
}

func nativeCommandArgs(service *pfregistry.ManagedService) []string {
	return []string{"web", "--host", "127.0.0.1", "--port", strconv.Itoa(service.RuntimePort)}
}

func (d *nativeDriver) Stop(ctx context.Context, service *pfregistry.ManagedService) error {
	if service == nil {
		return nil
	}
	d.mu.Lock()
	current, ok := d.processes[service.ServiceID]
	d.mu.Unlock()
	if !ok {
		if pid := nativePIDFromIdentity(service.RuntimeIdentity); pid > 0 && managedProcessAlive(pid) {
			return serviceError("RUNTIME_IDENTITY_MISMATCH", "Redeven will not stop a native process it did not create in this Runtime generation.", 409, false, nil)
		}
		return nil
	}
	if current.identity != service.RuntimeIdentity {
		return serviceError("RUNTIME_IDENTITY_MISMATCH", "Redeven will not stop a process whose instance identity does not match.", 409, false, nil)
	}
	if err := terminateManagedProcess(current.cmd); err != nil {
		return serviceError("STOP_FAILED", "DeepSeek Harness could not be stopped cleanly.", 502, true, err)
	}
	deadline := time.NewTimer(8 * time.Second)
	defer deadline.Stop()
	select {
	case <-current.done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	case <-deadline.C:
		if err := killManagedProcess(current.cmd); err != nil {
			return serviceError("STOP_FAILED", "DeepSeek Harness could not be killed after the stop timeout.", 502, true, err)
		}
	}
	killDeadline := time.NewTimer(2 * time.Second)
	defer killDeadline.Stop()
	select {
	case <-current.done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	case <-killDeadline.C:
		return serviceError("STOP_FAILED", "DeepSeek Harness did not exit after it was killed.", 502, true, nil)
	}
}

func (d *nativeDriver) Uninstall(ctx context.Context, service *pfregistry.ManagedService, deleteData bool) error {
	if err := d.Stop(ctx, service); err != nil {
		return err
	}
	if err := os.RemoveAll(filepath.Join(d.stateDir, DeepSeekHarnessTemplateID, "native")); err != nil {
		return err
	}
	if deleteData {
		if err := os.RemoveAll(filepath.Join(d.stateDir, DeepSeekHarnessTemplateID, "data")); err != nil {
			return err
		}
	}
	return os.RemoveAll(filepath.Join(d.stateDir, DeepSeekHarnessTemplateID, "logs"))
}
func (d *nativeDriver) CleanupPartial(ctx context.Context, service *pfregistry.ManagedService) error {
	if err := d.Stop(ctx, service); err != nil {
		return err
	}
	return os.RemoveAll(filepath.Join(d.stateDir, ".staging", service.ServiceID))
}

func (d *nativeDriver) Logs(_ context.Context, _ *pfregistry.ManagedService, tail int) (*LogResult, error) {
	return tailRedactedFile(filepath.Join(d.stateDir, DeepSeekHarnessTemplateID, "logs", "harness.log"), tail)
}

func nativePIDFromIdentity(identity string) int {
	parts := strings.Split(strings.TrimSpace(identity), ":")
	if len(parts) != 4 || parts[0] != "native" {
		return 0
	}
	value, _ := strconv.Atoi(parts[3])
	return value
}

var (
	authorizationLogPattern = regexp.MustCompile(`(?i)(authorization["']?\s*[:=]\s*).*$`)
	credentialLogPattern    = regexp.MustCompile(`(?i)(api[_-]?key|access[_-]?token|secret)(["']?\s*[:=]\s*["']?)[^\s,"';&}]+`)
)

func redactLogLine(value string) string {
	value = authorizationLogPattern.ReplaceAllString(value, `$1[REDACTED]`)
	return credentialLogPattern.ReplaceAllString(value, `$1$2[REDACTED]`)
}
func tailRedactedFile(path string, tail int) (*LogResult, error) {
	file, err := os.Open(path)
	if errors.Is(err, os.ErrNotExist) {
		return &LogResult{Lines: []string{}}, nil
	}
	if err != nil {
		return nil, err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return nil, err
	}
	const maxRead = int64(2 * 1024 * 1024)
	if info.Size() > maxRead {
		_, _ = file.Seek(info.Size()-maxRead, io.SeekStart)
	}
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 64*1024), 1024*1024)
	lines := make([]string, 0, tail)
	for scanner.Scan() {
		lines = append(lines, redactLogLine(scanner.Text()))
		if len(lines) > tail {
			copy(lines, lines[len(lines)-tail:])
			lines = lines[:tail]
		}
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}
	return &LogResult{Lines: lines}, nil
}
