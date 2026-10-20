package installer

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"strings"
)

type suiteFile struct {
	name     string
	mode     os.FileMode
	optional bool
}

var runtimeFiles = map[string]suiteFile{
	"redeven":                                      {"redeven", 0755, false},
	"redevplugin-runtime":                          {"redevplugin-runtime", 0755, false},
	"computer.zip":                                 {"computer.zip", 0644, true},
	"LICENSE":                                      {"REDEVEN_LICENSE", 0644, false},
	"THIRD_PARTY_NOTICES.md":                       {"REDEVEN_THIRD_PARTY_NOTICES.md", 0644, false},
	"REDEVPLUGIN_THIRD_PARTY_NOTICES.md":           {"REDEVPLUGIN_THIRD_PARTY_NOTICES.md", 0644, false},
	"REDEVPLUGIN_RUNTIME.spdx.json":                {"REDEVPLUGIN_RUNTIME.spdx.json", 0644, false},
	"redevplugin-runtime.provenance.json":          {"redevplugin-runtime.provenance.json", 0644, false},
	"redevplugin-runtime.sig":                      {"redevplugin-runtime.sig", 0644, false},
	"redevplugin-runtime.pem":                      {"redevplugin-runtime.pem", 0644, false},
	".redevplugin-release-artifacts-verified.json": {".redevplugin-release-artifacts-verified.json", 0644, false},
}

type contextReader struct {
	ctx context.Context
	r   io.Reader
}

func (r contextReader) Read(p []byte) (int, error) {
	if err := r.ctx.Err(); err != nil {
		return 0, err
	}
	return r.r.Read(p)
}

type zeroPaddingWriter struct{}

func (zeroPaddingWriter) Write(data []byte) (int, error) {
	for _, value := range data {
		if value != 0 {
			return 0, errors.New("archive contains nonzero data after its final tar entry")
		}
	}
	return len(data), nil
}

// extractArchive validates the entire authenticated tar stream, but writes only
// the product-selected regular files into a new private staging directory.
// An empty selectedPath rejects every file outside the runtime inventory;
// a nonempty selectedPath selects only the pinned ripgrep executable while
// validating and discarding its other regular documentation files.
func extractArchive(ctx context.Context, archive, digest, destination, selectedPath string) (map[string]string, error) {
	file, err := os.Open(archive)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	compressedHash := sha256.New()
	raw := io.TeeReader(contextReader{ctx, file}, compressedHash)
	gzipReader, err := gzip.NewReader(raw)
	if err != nil {
		return nil, fmt.Errorf("open compressed release archive: %w", err)
	}
	defer gzipReader.Close()
	bounded := &io.LimitedReader{R: gzipReader, N: (576 << 20) + 1}
	reader := tar.NewReader(bounded)
	seen, extracted := map[string]bool{}, map[string]string{}
	var total int64
	for entries := 0; ; entries++ {
		header, err := reader.Next()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("read release archive: %w", err)
		}
		if entries >= 4096 || header.Size < 0 || header.Size > 512<<20 {
			return nil, errors.New("release archive exceeds entry or file size limits")
		}
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		name := strings.TrimPrefix(header.Name, "./")
		if header.Typeflag == tar.TypeDir {
			name = strings.TrimSuffix(name, "/")
		}
		if name == "" || name == "." || path.IsAbs(name) || path.Clean(name) != name || strings.ContainsAny(name, "\\\x00\r\n") || name == ".." || strings.HasPrefix(name, "../") || seen[name] {
			return nil, fmt.Errorf("unsafe or duplicate archive path %q", header.Name)
		}
		seen[name] = true
		if selectedPath != "" {
			root := strings.SplitN(selectedPath, "/", 2)[0]
			if name != root && !strings.HasPrefix(name, root+"/") {
				return nil, fmt.Errorf("pinned tool archive entry is outside its expected root: %s", name)
			}
		}
		if header.Typeflag == tar.TypeDir {
			if selectedPath == "" {
				return nil, fmt.Errorf("unexpected archive directory %q", name)
			}
			continue
		}
		if header.Typeflag != tar.TypeReg && header.Typeflag != tar.TypeRegA {
			return nil, fmt.Errorf("archive entry %q is not a regular file", name)
		}
		total += header.Size
		if total > 512<<20 {
			return nil, errors.New("release archive exceeds the expanded size limit")
		}
		role, allowed := runtimeFiles[name]
		if selectedPath != "" {
			if name != selectedPath {
				if _, err := io.Copy(io.Discard, contextReader{ctx, reader}); err != nil {
					return nil, err
				}
				continue
			}
			role, allowed = suiteFile{"rg", 0755, false}, true
		}
		if !allowed {
			return nil, fmt.Errorf("unexpected file in the closed runtime archive: %s", name)
		}
		output, err := os.OpenFile(filepath.Join(destination, role.name), os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if err != nil {
			return nil, err
		}
		hash := sha256.New()
		written, copyErr := io.Copy(io.MultiWriter(output, hash), contextReader{ctx, reader})
		if copyErr == nil && written != header.Size {
			copyErr = errors.New("archive file length does not match its header")
		}
		if copyErr == nil {
			copyErr = output.Chmod(role.mode)
		}
		if copyErr == nil {
			copyErr = output.Sync()
		}
		closeErr := output.Close()
		if err := errors.Join(copyErr, closeErr); err != nil {
			return nil, err
		}
		extracted[role.name] = hex.EncodeToString(hash.Sum(nil))
	}
	if _, err := io.Copy(zeroPaddingWriter{}, bounded); err != nil {
		return nil, fmt.Errorf("verify compressed archive trailer: %w", err)
	}
	if bounded.N <= 0 {
		return nil, errors.New("archive tar stream exceeds its metadata budget")
	}
	if _, err := io.Copy(io.Discard, raw); err != nil {
		return nil, err
	}
	if hex.EncodeToString(compressedHash.Sum(nil)) != digest {
		return nil, errors.New("archive content changed after download verification")
	}
	if selectedPath != "" {
		if _, present := extracted["rg"]; !present {
			return nil, errors.New("pinned ripgrep archive does not contain its executable")
		}
		return extracted, nil
	}
	for _, role := range runtimeFiles {
		if _, present := extracted[role.name]; !present && !role.optional {
			return nil, fmt.Errorf("runtime archive is missing required suite file %s", role.name)
		}
	}
	return extracted, nil
}
