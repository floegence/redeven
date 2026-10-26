package ai

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
)

const taskForkSourceFile = ".fork-source.json"

type taskForkSource struct {
	ThreadID     string `json:"thread_id"`
	SourceItemID string `json:"source_item_id,omitempty"`
}

// stageForkTaskFiles prepares a private copy. Only complete directories are
// renamed into a thread root, before settings publish the fork to the product.
func stageForkTaskFiles(ctx context.Context, state, sourceID, requestKey, item string) (*os.Root, string, func(), error) {
	source, err := prepareTaskFiles(state, sourceID)
	if err != nil {
		return nil, "", nil, err
	}
	base, err := os.OpenRoot(filepath.Dir(source.Root))
	if err != nil {
		return nil, "", nil, err
	}
	hash := sha256.Sum256([]byte(sourceID + "\x00" + requestKey))
	staging := ".fork-" + hex.EncodeToString(hash[:])
	cleanup := func() { _ = base.RemoveAll(staging); _ = base.Close() }
	fail := func(e error) (*os.Root, string, func(), error) { cleanup(); return nil, "", nil, e }
	if err = base.RemoveAll(staging); err != nil {
		base.Close()
		return nil, "", nil, err
	}
	if err = base.Mkdir(staging, 0700); err != nil {
		return fail(err)
	}
	dst, err := base.OpenRoot(staging)
	if err != nil {
		return fail(err)
	}
	defer dst.Close()
	src, err := base.OpenRoot(sourceID)
	if err != nil {
		return fail(err)
	}
	defer src.Close()
	observed := map[string]os.FileInfo{}
	for _, name := range []string{"scratch", "staging"} {
		if err = copyTaskTree(ctx, src, dst, name, observed); err != nil {
			return fail(fmt.Errorf("copy fork working files: %w", err))
		}
	}
	for name, before := range observed {
		if err = ctx.Err(); err != nil {
			return fail(err)
		}
		after, e := src.Lstat(name)
		if e != nil || !sameTaskFile(before, after) {
			return fail(fmt.Errorf("working file changed while forking: %s", name))
		}
	}
	encoded, err := json.Marshal(taskForkSource{ThreadID: sourceID, SourceItemID: item})
	if err != nil {
		return fail(err)
	}
	f, err := dst.OpenFile(taskForkSourceFile, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return fail(err)
	}
	_, writeErr := f.Write(encoded)
	closeErr := f.Close()
	if writeErr != nil {
		return fail(writeErr)
	}
	if closeErr != nil {
		return fail(closeErr)
	}
	if err = ctx.Err(); err != nil {
		return fail(err)
	}
	return base, staging, cleanup, nil
}

func publishForkTaskFiles(ctx context.Context, base *os.Root, staging, sourceID, targetID, item string) error {
	if !taskFileComponent(targetID) || sourceID == targetID {
		return errors.New("invalid fork file identity")
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	ready, err := publishedForkTaskFiles(base, sourceID, targetID, item)
	if err != nil {
		return err
	}
	if ready {
		return nil
	}
	return base.Rename(staging, targetID)
}

func publishedForkTaskFiles(base *os.Root, sourceID, targetID, item string) (bool, error) {
	info, err := base.Lstat(targetID)
	if errors.Is(err, os.ErrNotExist) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return false, errors.New("invalid fork working directory")
	}
	root, err := base.OpenRoot(targetID)
	if err != nil {
		return false, err
	}
	defer root.Close()
	previous, err := readTaskForkSource(root)
	if err != nil {
		return false, err
	}
	if previous == nil || *previous != (taskForkSource{ThreadID: sourceID, SourceItemID: item}) {
		return false, errors.New("fork working file identity mismatch")
	}
	return true, nil
}

func inheritForkTaskFiles(ctx context.Context, state, sourceID, targetID, requestKey, item string) error {
	if _, err := taskFiles(state, targetID); err != nil {
		return err
	}
	// Recover a completed publication without requiring its source to still exist.
	parent, err := os.OpenRoot(filepath.Join(state, "task-files"))
	if err == nil {
		ready, e := publishedForkTaskFiles(parent, sourceID, targetID, item)
		parent.Close()
		if e != nil {
			return e
		}
		if ready {
			return ctx.Err()
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	base, staging, discard, err := stageForkTaskFiles(ctx, state, sourceID, requestKey, item)
	if err != nil {
		return err
	}
	defer discard()
	return publishForkTaskFiles(ctx, base, staging, sourceID, targetID, item)
}

func readTaskForkSource(root *os.Root) (*taskForkSource, error) {
	info, err := root.Lstat(taskForkSourceFile)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() {
		return nil, errors.New("invalid fork working file provenance")
	}
	f, err := root.Open(taskForkSourceFile)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	var source taskForkSource
	if err = json.NewDecoder(io.LimitReader(f, 4096)).Decode(&source); err != nil {
		return nil, err
	}
	if !taskFileComponent(source.ThreadID) {
		return nil, errors.New("invalid fork file source")
	}
	return &source, nil
}

func taskForkContext(space taskFileSpace) (string, error) {
	root, err := os.OpenRoot(space.Root)
	if err != nil {
		return "", err
	}
	defer root.Close()
	source, err := readTaskForkSource(root)
	if err != nil || source == nil {
		return "", err
	}
	// Every ancestor uses the same relative scratch/staging layout, including nested forks.
	return "- Fork working files: independent copies of files available when this fork was created from thread " + source.ThreadID + ". These are current files, not a historical filesystem snapshot. Inspect them before reuse. For scratch/staging paths in inherited history, use the same relative path under the current task directories, including paths from earlier ancestors. Correct hardcoded old paths before executing helpers; do not access ancestor task directories. Project files and final deliverables remain at their existing shared locations. Handle directory preparation internally. Keep user-facing updates about the task itself; do not narrate scratch paths, copying, isolation, or snapshot mechanics, and do not ask users to select a working-file mode.", nil
}
func sameTaskFile(a, b os.FileInfo) bool {
	return a != nil && b != nil && os.SameFile(a, b) && a.Mode() == b.Mode() && a.Size() == b.Size() && a.ModTime().Equal(b.ModTime())
}
func copyTaskTree(ctx context.Context, src, dst *os.Root, name string, observed map[string]os.FileInfo) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	info, err := src.Lstat(name)
	if err != nil {
		return err
	}
	observed[name] = info
	if info.IsDir() {
		if err = dst.Mkdir(name, 0700); err != nil {
			return err
		}
		dir, err := src.Open(name)
		if err != nil {
			return err
		}
		defer dir.Close()
		for {
			entries, e := dir.ReadDir(128)
			for _, entry := range entries {
				if err = copyTaskTree(ctx, src, dst, filepath.Join(name, entry.Name()), observed); err != nil {
					return err
				}
			}
			if e == io.EOF {
				return nil
			}
			if e != nil {
				return e
			}
		}
	}
	if !info.Mode().IsRegular() {
		return fmt.Errorf("unsupported working file: %s", name)
	}
	in, err := src.Open(name)
	if err != nil {
		return err
	}
	defer in.Close()
	opened, err := in.Stat()
	if err != nil {
		return err
	}
	if !sameTaskFile(info, opened) {
		return fmt.Errorf("working file changed while opening: %s", name)
	}
	out, err := dst.OpenFile(name, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600|info.Mode().Perm()&0100)
	if err != nil {
		return err
	}
	defer out.Close()
	buf := make([]byte, 64*1024)
	var total int64
	for {
		if err = ctx.Err(); err != nil {
			return err
		}
		n, e := in.Read(buf)
		if n > 0 {
			w, writeErr := out.Write(buf[:n])
			total += int64(w)
			if writeErr != nil {
				return writeErr
			}
			if w != n {
				return io.ErrShortWrite
			}
		}
		if e == io.EOF {
			break
		}
		if e != nil {
			return e
		}
	}
	after, err := in.Stat()
	if err != nil {
		return err
	}
	if total != info.Size() || !sameTaskFile(info, after) {
		return fmt.Errorf("working file changed while copying: %s", name)
	}
	return out.Close()
}
