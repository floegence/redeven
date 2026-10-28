package ai

import (
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
)

func openTaskFilesRoot(state string) (*os.Root, error) {
	root, err := os.OpenRoot(state)
	if err != nil {
		return nil, err
	}
	defer root.Close()
	info, err := root.Lstat("task-files")
	if err != nil {
		return nil, err
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return nil, errors.New("task directory must not be a symbolic link")
	}
	return root.OpenRoot("task-files")
}

// The caller holds the target file gate. Product settings are the sole durable
// publication authority; provenance identifies disposable, unadmitted copies.
func (s *Service) removeUnpublishedForkFiles(ctx context.Context, thread string) error {
	settings, err := s.threadsDB.GetThreadSettingsByCanonicalThreadID(ctx, thread)
	if err != nil || settings != nil {
		return err
	}
	base, err := openTaskFilesRoot(s.stateDir)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	defer base.Close()
	info, err := base.Lstat(thread)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return errors.New("invalid fork working directory")
	}
	root, err := base.OpenRoot(thread)
	if err != nil {
		return err
	}
	source, readErr := readTaskForkSource(root)
	root.Close()
	if readErr != nil || source == nil {
		return readErr
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	return base.RemoveAll(thread)
}

// Stream directory names in bounded batches. No resource ledger, historical
// transcript, or recursive scan is needed to recover interrupted publication.
func (s *Service) sweepUnpublishedForkFiles(ctx context.Context) error {
	if s.threadsDB == nil {
		return nil
	}
	base, err := openTaskFilesRoot(s.stateDir)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	defer base.Close()
	dir, err := base.Open(".")
	if err != nil {
		return err
	}
	defer dir.Close()
	var failures []error
	for {
		entries, readErr := dir.ReadDir(50)
		for _, entry := range entries {
			if err := ctx.Err(); err != nil {
				return errors.Join(append(failures, err)...)
			}
			name := entry.Name()
			if !entry.IsDir() {
				continue
			}
			release, idle := s.taskFiles.tryFreeze(name)
			if !idle {
				continue
			}
			hash, decodeErr := hex.DecodeString(strings.TrimPrefix(name, ".fork-"))
			if strings.HasPrefix(name, ".fork-") && decodeErr == nil && len(hash) == 32 {
				err = base.RemoveAll(name)
			} else {
				err = s.removeUnpublishedForkFiles(ctx, name)
			}
			release()
			if err != nil {
				failures = append(failures, fmt.Errorf("recover fork files %s: %w", name, err))
			}
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			return errors.Join(append(failures, readErr)...)
		}
	}
	return errors.Join(failures...)
}
