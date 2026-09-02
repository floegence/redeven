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
	"net/http"
	"net/url"
	"os"
	pathpkg "path"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
)

const maxVerifiedPackageArchiveBytes = 4 * 1024 * 1024 * 1024
const maxVerifiedPackageExtractedBytes = 4 * 1024 * 1024 * 1024

type verifiedPackageDownloader struct {
	client *http.Client
}

func validateVerifiedPackageArtifact(artifact verifiedPackageArtifact, client *http.Client, packageOrigin string) error {
	if client == nil {
		return serviceError("DOWNLOAD_UNAVAILABLE", "The verified package downloader is unavailable.", 503, true, nil)
	}
	if err := validatePackageURL(artifact.DownloadURL, packageOrigin); err != nil {
		return serviceError("PACKAGE_SOURCE_REJECTED", "The software package URL is outside the release-locked package origin.", 502, false, err)
	}
	digest, err := hex.DecodeString(strings.ToLower(strings.TrimSpace(artifact.SHA256)))
	if err != nil || len(digest) != sha256.Size {
		return serviceError("CATALOG_INVALID", "The software package SHA-256 is invalid.", 502, false, err)
	}
	if artifact.SizeBytes <= 0 || artifact.SizeBytes > maxVerifiedPackageArchiveBytes {
		return serviceError("CATALOG_INVALID", "The software package size is invalid.", 502, false, nil)
	}
	for _, value := range []string{artifact.ArchiveRoot, artifact.NodeRelPath, artifact.NPMCLIRelPath} {
		rel := filepath.Clean(filepath.FromSlash(strings.TrimSpace(value)))
		if rel == "." || filepath.IsAbs(rel) || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
			return serviceError("CATALOG_INVALID", "The software package layout is invalid.", 502, false, nil)
		}
	}
	archiveRoot := filepath.Clean(filepath.FromSlash(artifact.ArchiveRoot))
	for _, value := range []string{artifact.NodeRelPath, artifact.NPMCLIRelPath} {
		rel, err := filepath.Rel(archiveRoot, filepath.Clean(filepath.FromSlash(value)))
		if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
			return serviceError("CATALOG_INVALID", "The software package runtime paths do not belong to its archive root.", 502, false, err)
		}
	}
	return nil
}

func fileSHA256(path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer file.Close()
	digest := sha256.New()
	if _, err := io.Copy(digest, file); err != nil {
		return "", err
	}
	return hex.EncodeToString(digest.Sum(nil)), nil
}

func regularFile(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.Mode().IsRegular()
}

func regularExecutable(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.Mode().IsRegular() && info.Mode()&0o111 != 0
}

type verifiedPackageProgressWriter struct {
	destination io.Writer
	reporter    *managedTransferProgressReporter
	progress    operationProgress
	transfer    pfregistry.ManagedOperationTransferProgress
}

func (w *verifiedPackageProgressWriter) Write(p []byte) (int, error) {
	written, err := w.destination.Write(p)
	w.transfer.DownloadedBytes += int64(written)
	w.report(false)
	return written, err
}

func (w *verifiedPackageProgressWriter) report(final bool) {
	var emit bool
	if final {
		w.transfer = w.reporter.observeFinal(w.transfer)
		emit = true
	} else {
		w.transfer, emit = w.reporter.observe(w.transfer)
	}
	if emit && w.progress != nil {
		w.progress("downloading", 2, w.transfer)
	}
}

func verifiedPackageArtifactProgressReference(artifact verifiedPackageArtifact) string {
	name := "software-package"
	if parsed, err := url.Parse(strings.TrimSpace(artifact.DownloadURL)); err == nil {
		candidate := pathpkg.Base(strings.TrimSuffix(parsed.Path, "/"))
		if decoded, decodeErr := url.PathUnescape(candidate); decodeErr == nil {
			candidate = decoded
		}
		if candidate != "" && candidate != "." && candidate != "/" {
			name = candidate
		}
	}
	return name + "@sha256:" + strings.ToLower(strings.TrimSpace(artifact.SHA256))
}

func downloadVerifiedPackageArchive(ctx context.Context, client *http.Client, artifact verifiedPackageArtifact, destination string, progress operationProgress) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, artifact.DownloadURL, nil)
	if err != nil {
		return err
	}
	reporter := managedTransferProgressReporter{now: time.Now}
	writer := verifiedPackageProgressWriter{
		reporter: &reporter,
		progress: progress,
		transfer: pfregistry.ManagedOperationTransferProgress{
			Phase:             "downloading",
			ArtifactReference: verifiedPackageArtifactProgressReference(artifact),
			ArtifactIndex:     1,
			ArtifactTotal:     1,
			TotalBytes:        artifact.SizeBytes,
		},
	}
	writer.report(false)
	resp, err := client.Do(req)
	if err != nil {
		return serviceError("DOWNLOAD_FAILED", "The verified software package could not be downloaded.", 503, true, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return serviceError("DOWNLOAD_FAILED", "The verified software package could not be downloaded.", 503, true, fmt.Errorf("package returned %s", resp.Status))
	}
	if resp.ContentLength >= 0 && resp.ContentLength != artifact.SizeBytes {
		return serviceError("PACKAGE_SIZE_MISMATCH", "The software package size does not match the audited catalog.", 502, true, nil)
	}
	file, err := os.OpenFile(destination, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	writer.destination = file
	written, copyErr := io.Copy(&writer, io.LimitReader(resp.Body, artifact.SizeBytes+1))
	closeErr := file.Close()
	if copyErr != nil {
		writer.report(true)
		return copyErr
	}
	if closeErr != nil {
		writer.report(true)
		return closeErr
	}
	if written != artifact.SizeBytes {
		writer.report(true)
		return serviceError("PACKAGE_SIZE_MISMATCH", "The software package size does not match the audited catalog.", 502, true, nil)
	}
	return nil
}

func verifyVerifiedPackageArchive(path string, artifact verifiedPackageArtifact) error {
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
		return serviceError("PACKAGE_CHECKSUM_MISMATCH", "The software package checksum does not match the audited catalog.", 502, true, nil)
	}
	return nil
}

func extractManagedArchive(archivePath, destination string) error {
	return extractManagedArchiveWithOptions(archivePath, destination, false)
}

func extractNodeRuntimeArchive(archivePath, destination string) error {
	return extractManagedArchiveWithOptions(archivePath, destination, true)
}

func extractManagedArchiveWithOptions(archivePath, destination string, skipSymlinks bool) error {
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
		case tar.TypeReg:
			if header.Size < 0 || header.Size > maxVerifiedPackageArchiveBytes {
				return errors.New("archive entry size is invalid")
			}
			if header.Size > maxVerifiedPackageExtractedBytes-extractedBytes {
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
		case tar.TypeSymlink:
			if !skipSymlinks {
				return errors.New("archive symbolic links are not allowed")
			}
		default:
			return fmt.Errorf("archive entry type %d is not allowed", header.Typeflag)
		}
	}
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
