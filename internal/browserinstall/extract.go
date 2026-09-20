package browserinstall

import (
	"archive/zip"
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// Verify the archive before extraction. Symlinks are created only after regular
// files, and every target must stay inside the new, task-owned directory.
func extract(ctx context.Context, source io.ReaderAt, size int64, directory string, limit int64) error {
	directory, err := filepath.EvalSymlinks(directory)
	if err != nil {
		return err
	}
	archive, err := zip.NewReader(source, size)
	if err != nil {
		return err
	}
	if len(archive.File) > 20000 {
		return errors.New("browser archive has too many entries")
	}
	var links []*zip.File
	var total int64
	seen := make(map[string]bool)
	for _, entry := range archive.File {
		if err := ctx.Err(); err != nil {
			return err
		}
		name := strings.TrimSuffix(entry.Name, "/")
		if !filepath.IsLocal(name) || filepath.Clean(name) != name || strings.Contains(name, "\\") || seen[name] {
			return errors.New("invalid browser archive path")
		}
		seen[name] = true
		destination := filepath.Join(directory, name)
		if entry.Mode()&os.ModeSymlink != 0 {
			links = append(links, entry)
			continue
		}
		if entry.FileInfo().IsDir() {
			if err = os.MkdirAll(destination, 0700); err != nil {
				return err
			}
			continue
		}
		if !entry.Mode().IsRegular() || entry.UncompressedSize64 > uint64(limit) {
			return errors.New("invalid browser archive entry")
		}
		total += int64(entry.UncompressedSize64)
		if total > limit {
			return errors.New("browser archive exceeds installation size")
		}
		if err = os.MkdirAll(filepath.Dir(destination), 0700); err != nil {
			return err
		}
		output, err := os.OpenFile(destination, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600|entry.Mode().Perm()&0111)
		if err != nil {
			return err
		}
		input, err := entry.Open()
		if err != nil {
			output.Close()
			return err
		}
		_, err = io.Copy(output, io.LimitReader(input, int64(entry.UncompressedSize64)+1))
		input.Close()
		closeErr := output.Close()
		if err != nil {
			return err
		}
		if closeErr != nil {
			return closeErr
		}
	}
	for _, entry := range links {
		input, err := entry.Open()
		if err != nil {
			return err
		}
		data, err := io.ReadAll(io.LimitReader(input, 4097))
		input.Close()
		if err != nil {
			return err
		}
		target := string(data)
		resolved := filepath.Clean(filepath.Join(filepath.Dir(entry.Name), target))
		if len(data) > 4096 || filepath.IsAbs(target) || !filepath.IsLocal(resolved) || strings.Contains(target, "\\") {
			return errors.New("browser symlink escapes installation")
		}
		destination := filepath.Join(directory, entry.Name)
		if err = os.MkdirAll(filepath.Dir(destination), 0700); err != nil {
			return err
		}
		if err = os.Symlink(target, destination); err != nil {
			return err
		}
	}
	for _, entry := range links {
		resolved, err := filepath.EvalSymlinks(filepath.Join(directory, entry.Name))
		if err != nil || !strings.HasPrefix(resolved, directory+string(filepath.Separator)) {
			return errors.New("invalid browser symlink")
		}
	}
	return ctx.Err()
}
