package main

import (
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
)

type evalTaskSandbox struct {
	WorkspacePath string
	StateDir      string
	WorkspaceMode string
	WorkspaceSeed string
}

func copyDirectoryTree(src string, dst string) error {
	src = filepath.Clean(src)
	dst = filepath.Clean(dst)

	info, err := os.Lstat(src)
	if err != nil {
		return err
	}
	if !info.IsDir() {
		return fmt.Errorf("workspace source is not a directory: %s", src)
	}
	if err := os.MkdirAll(dst, info.Mode().Perm()); err != nil {
		return err
	}

	return filepath.WalkDir(src, func(path string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		rel, err := filepath.Rel(src, path)
		if err != nil {
			return err
		}
		if rel == "." {
			return nil
		}
		target := filepath.Join(dst, rel)
		info, err := os.Lstat(path)
		if err != nil {
			return err
		}
		mode := info.Mode()
		switch {
		case mode.IsDir():
			return os.MkdirAll(target, mode.Perm())
		case mode&os.ModeSymlink != 0:
			link, err := os.Readlink(path)
			if err != nil {
				return err
			}
			return os.Symlink(link, target)
		case mode.IsRegular():
			return copyRegularFile(path, target, mode.Perm())
		default:
			return nil
		}
	})
}

func copyRegularFile(src string, dst string, perm fs.FileMode) error {
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()

	out, err := os.OpenFile(dst, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, perm)
	if err != nil {
		return err
	}
	defer out.Close()

	if _, err := io.Copy(out, in); err != nil {
		return err
	}
	return out.Close()
}

func prepareEmptyDir(path string, perm fs.FileMode) error {
	if err := os.RemoveAll(path); err != nil {
		return err
	}
	return os.MkdirAll(path, perm)
}

func prepareTaskSandbox(workspaceRoot string, stateRoot string, taskID string, sourceWorkspace string, workspace evalTaskWorkspace) (evalTaskSandbox, error) {
	sandbox := evalTaskSandbox{
		WorkspacePath: filepath.Join(filepath.Clean(workspaceRoot), sanitizeID(taskID)),
		StateDir:      filepath.Join(filepath.Clean(stateRoot), sanitizeID(taskID)),
		WorkspaceMode: strings.TrimSpace(workspace.Mode),
	}
	if err := os.MkdirAll(filepath.Clean(workspaceRoot), 0o700); err != nil {
		return sandbox, err
	}
	if err := os.MkdirAll(filepath.Clean(stateRoot), 0o700); err != nil {
		return sandbox, err
	}
	if err := os.RemoveAll(sandbox.WorkspacePath); err != nil {
		return sandbox, err
	}
	if err := os.RemoveAll(sandbox.StateDir); err != nil {
		return sandbox, err
	}
	switch sandbox.WorkspaceMode {
	case taskWorkspaceModeNone:
		if err := prepareEmptyDir(sandbox.WorkspacePath, 0o755); err != nil {
			return sandbox, err
		}
	case taskWorkspaceModeSourceReadonly:
		sourceWorkspace = filepath.Clean(strings.TrimSpace(sourceWorkspace))
		if sourceWorkspace == "" {
			return sandbox, fmt.Errorf("missing source workspace")
		}
		info, err := os.Stat(sourceWorkspace)
		if err != nil {
			return sandbox, err
		}
		if !info.IsDir() {
			return sandbox, fmt.Errorf("source workspace is not a directory: %s", sourceWorkspace)
		}
		sandbox.WorkspacePath = sourceWorkspace
		sandbox.WorkspaceSeed = sourceWorkspace
	case taskWorkspaceModeFixtureCopy:
		sandbox.WorkspaceSeed = strings.TrimSpace(workspace.FixturePath)
		if sandbox.WorkspaceSeed == "" {
			return sandbox, fmt.Errorf("missing fixture path")
		}
		if err := prepareEmptyDir(sandbox.WorkspacePath, 0o755); err != nil {
			return sandbox, err
		}
		if err := copyDirectoryTree(sandbox.WorkspaceSeed, sandbox.WorkspacePath); err != nil {
			return sandbox, err
		}
	default:
		return sandbox, fmt.Errorf("unsupported workspace mode: %s", sandbox.WorkspaceMode)
	}
	if err := os.MkdirAll(sandbox.StateDir, 0o700); err != nil {
		return sandbox, err
	}
	return sandbox, nil
}
