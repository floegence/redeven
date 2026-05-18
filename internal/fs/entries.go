package fs

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/floegence/redeven/internal/filesystemscope"
)

type fsEntryType string

const (
	fsEntryTypeFile    fsEntryType = "file"
	fsEntryTypeFolder  fsEntryType = "folder"
	fsEntryTypeSymlink fsEntryType = "symlink"
)

type fsResolvedType string

const (
	fsResolvedTypeFile    fsResolvedType = "file"
	fsResolvedTypeFolder  fsResolvedType = "folder"
	fsResolvedTypeBroken  fsResolvedType = "broken"
	fsResolvedTypeUnknown fsResolvedType = "unknown"
)

var errFSPathIsDirectory = errors.New("path is a directory")
var errFSDestinationExists = errors.New("destination already exists")
var errFSInvalidPath = errors.New("invalid path")
var errFSInvalidOldPath = errors.New("invalid old_path")
var errFSInvalidNewPath = errors.New("invalid new_path")
var errFSInvalidSourcePath = errors.New("invalid source_path")
var errFSInvalidDestPath = errors.New("invalid dest_path")

type resolvedListDirectory struct {
	logicalAbs  string
	resolvedAbs string
}

func (s *Service) listDirectoryEntries(path string, showHidden bool) ([]fsFileInfo, error) {
	dir, err := s.resolveListDirectory(path)
	if err != nil {
		return nil, err
	}

	entries, err := os.ReadDir(dir.resolvedAbs)
	if err != nil {
		return nil, err
	}

	out := make([]fsFileInfo, 0, len(entries))
	for _, entry := range entries {
		name := entry.Name()
		if !showHidden && strings.HasPrefix(name, ".") {
			continue
		}

		logicalPath := filepath.Join(dir.logicalAbs, name)
		resolvedPath := filepath.Join(dir.resolvedAbs, name)
		info, err := s.classifyListEntry(name, logicalPath, resolvedPath)
		if err != nil {
			continue
		}
		out = append(out, info)
	}
	return out, nil
}

func (s *Service) resolveListDirectory(path string) (resolvedListDirectory, error) {
	if s == nil {
		return resolvedListDirectory{}, errors.New("nil service")
	}

	if strings.TrimSpace(path) == "" {
		path = s.scope.DefaultRootPath()
	}

	resolved, err := s.scope.Resolve(path, filesystemscope.ResolveOptions{RequireExisting: true, RequireDir: true})
	if err != nil {
		return resolvedListDirectory{}, err
	}
	return resolvedListDirectory{
		logicalAbs:  resolved.LogicalAbs,
		resolvedAbs: resolved.RealAbs,
	}, nil
}

func (s *Service) resolveReadableFilePath(path string) (string, os.FileInfo, error) {
	if s == nil {
		return "", nil, errors.New("nil service")
	}
	if strings.TrimSpace(path) == "" {
		path = s.scope.DefaultRootPath()
	}

	resolved, err := s.scope.Resolve(path, filesystemscope.ResolveOptions{RequireExisting: true})
	if err != nil {
		return "", nil, err
	}

	info, err := os.Stat(resolved.RealAbs)
	if err != nil {
		return "", nil, err
	}
	if info.IsDir() {
		return "", nil, errFSPathIsDirectory
	}
	return resolved.RealAbs, info, nil
}

func (s *Service) resolveExistingEntryPath(path string) (string, error) {
	if s == nil {
		return "", errors.New("nil service")
	}

	normalized, err := s.scope.NormalizeInput(path)
	if err != nil {
		return "", err
	}
	parentResolved, err := s.scope.Resolve(filepath.Dir(normalized), filesystemscope.ResolveOptions{RequireExisting: true, RequireDir: true})
	if err != nil {
		return "", err
	}

	entryPath := filepath.Join(parentResolved.RealAbs, filepath.Base(normalized))
	if _, err := os.Lstat(entryPath); err != nil {
		return "", err
	}
	return entryPath, nil
}

func (s *Service) resolveExistingWritableEntryPath(path string) (string, error) {
	if s == nil {
		return "", errors.New("nil service")
	}

	normalized, err := s.scope.NormalizeInput(path)
	if err != nil {
		return "", err
	}
	parentResolved, err := s.scope.Resolve(filepath.Dir(normalized), filesystemscope.ResolveOptions{RequireExisting: true, RequireDir: true, ForWrite: true})
	if err != nil {
		return "", err
	}

	entryPath := filepath.Join(parentResolved.RealAbs, filepath.Base(normalized))
	if _, err := os.Lstat(entryPath); err != nil {
		return "", err
	}
	return entryPath, nil
}

func (s *Service) deleteEntry(path string, recursive bool) error {
	entryPath, err := s.resolveExistingWritableEntryPath(path)
	if err != nil {
		return fmt.Errorf("%w: %w", errFSInvalidPath, err)
	}
	if recursive {
		return os.RemoveAll(entryPath)
	}
	return os.Remove(entryPath)
}

func (s *Service) renameEntry(oldPath string, newPath string) (string, error) {
	oldEntryPath, err := s.resolveExistingWritableEntryPath(oldPath)
	if err != nil {
		return "", fmt.Errorf("%w: %w", errFSInvalidOldPath, err)
	}
	newEntryPath, err := s.resolveTargetPath(newPath)
	if err != nil {
		return "", fmt.Errorf("%w: %w", errFSInvalidNewPath, err)
	}

	if _, err := os.Lstat(oldEntryPath); os.IsNotExist(err) {
		return "", os.ErrNotExist
	} else if err != nil {
		return "", err
	}

	if _, err := os.Lstat(newEntryPath); err == nil {
		return "", errFSDestinationExists
	} else if !errors.Is(err, os.ErrNotExist) {
		return "", err
	}

	if err := os.MkdirAll(filepath.Dir(newEntryPath), 0o755); err != nil {
		return "", err
	}
	if err := os.Rename(oldEntryPath, newEntryPath); err != nil {
		return "", err
	}
	return newEntryPath, nil
}

func (s *Service) copyEntry(sourcePath string, destPath string, overwrite bool) (string, error) {
	sourceEntryPath, err := s.resolveExistingEntryPath(sourcePath)
	if err != nil {
		return "", fmt.Errorf("%w: %w", errFSInvalidSourcePath, err)
	}
	destEntryPath, err := s.resolveTargetPath(destPath)
	if err != nil {
		return "", fmt.Errorf("%w: %w", errFSInvalidDestPath, err)
	}

	sourceLinkInfo, err := os.Lstat(sourceEntryPath)
	if os.IsNotExist(err) {
		return "", os.ErrNotExist
	}
	if err != nil {
		return "", err
	}

	if _, err := os.Lstat(destEntryPath); err == nil && !overwrite {
		return "", errFSDestinationExists
	} else if err != nil && !errors.Is(err, os.ErrNotExist) {
		return "", err
	}

	if err := os.MkdirAll(filepath.Dir(destEntryPath), 0o755); err != nil {
		return "", err
	}

	if sourceLinkInfo.Mode()&os.ModeSymlink != 0 {
		if err := copySymbolicLink(sourceEntryPath, destEntryPath, overwrite); err != nil {
			return "", err
		}
		return destEntryPath, nil
	}

	sourceResolvedInfo, err := os.Stat(sourceEntryPath)
	if os.IsNotExist(err) {
		return "", os.ErrNotExist
	}
	if err != nil {
		return "", err
	}

	if sourceResolvedInfo.IsDir() {
		if err := copyDir(sourceEntryPath, destEntryPath); err != nil {
			return "", err
		}
		return destEntryPath, nil
	}

	if err := copyFile(sourceEntryPath, destEntryPath); err != nil {
		return "", err
	}
	return destEntryPath, nil
}

func (s *Service) classifyListEntry(name string, logicalPath string, resolvedPath string) (fsFileInfo, error) {
	linkInfo, err := os.Lstat(resolvedPath)
	if err != nil {
		return fsFileInfo{}, err
	}

	modifiedAt := linkInfo.ModTime().UnixMilli()
	info := fsFileInfo{
		Name:         name,
		Path:         logicalPath,
		IsDirectory:  false,
		EntryType:    string(fsEntryTypeFile),
		ResolvedType: string(fsResolvedTypeUnknown),
		Size:         linkInfo.Size(),
		ModifiedAt:   modifiedAt,
		CreatedAt:    modifiedAt,
		Permissions:  fileModeString(linkInfo.Mode()),
	}

	switch {
	case linkInfo.Mode()&os.ModeSymlink != 0:
		info.EntryType = string(fsEntryTypeSymlink)
		targetType, targetInfo := s.classifySymlinkTarget(resolvedPath)
		info.ResolvedType = string(targetType)
		info.IsDirectory = targetType == fsResolvedTypeFolder
		if targetType == fsResolvedTypeFile && targetInfo != nil {
			info.Size = targetInfo.Size()
		}
	case linkInfo.IsDir():
		info.EntryType = string(fsEntryTypeFolder)
		info.ResolvedType = string(fsResolvedTypeFolder)
		info.IsDirectory = true
	case linkInfo.Mode().IsRegular():
		info.EntryType = string(fsEntryTypeFile)
		info.ResolvedType = string(fsResolvedTypeFile)
	default:
		info.EntryType = string(fsEntryTypeFile)
		info.ResolvedType = string(fsResolvedTypeUnknown)
	}

	return info, nil
}

func (s *Service) classifySymlinkTarget(path string) (fsResolvedType, os.FileInfo) {
	targetPath, err := filepath.EvalSymlinks(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return fsResolvedTypeBroken, nil
		}
		return fsResolvedTypeUnknown, nil
	}

	targetPath = filepath.Clean(targetPath)
	if _, ok := s.scope.Contains(targetPath); !ok {
		return fsResolvedTypeUnknown, nil
	}

	targetInfo, err := os.Stat(targetPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return fsResolvedTypeBroken, nil
		}
		return fsResolvedTypeUnknown, nil
	}

	switch {
	case targetInfo.IsDir():
		return fsResolvedTypeFolder, targetInfo
	case targetInfo.Mode().IsRegular():
		return fsResolvedTypeFile, targetInfo
	default:
		return fsResolvedTypeUnknown, targetInfo
	}
}

func copySymbolicLink(src string, dst string, overwrite bool) error {
	if overwrite {
		if info, err := os.Lstat(dst); err == nil {
			if info.IsDir() {
				return errFSDestinationExists
			}
			if err := os.Remove(dst); err != nil {
				return err
			}
		} else if !errors.Is(err, os.ErrNotExist) {
			return err
		}
	}

	target, err := os.Readlink(src)
	if err != nil {
		return err
	}
	return os.Symlink(target, dst)
}
