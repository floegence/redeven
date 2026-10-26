package ai

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"unicode/utf8"
)

// taskFileSpace owns disposable working files, never final user files.
type taskFileSpace struct{ Root, Scratch, Staging string }
type taskFileManager struct {
	mu      sync.Mutex
	active  map[string]int
	changed chan struct{}
}

func (m *taskFileManager) acquire(id string) func() {
	if m == nil {
		return func() {}
	}
	m.mu.Lock()
	if m.active == nil {
		m.active = map[string]int{}
	}
	if m.changed == nil {
		m.changed = make(chan struct{})
	}
	m.active[id]++
	m.mu.Unlock()
	var once sync.Once
	return func() {
		once.Do(func() {
			m.mu.Lock()
			m.active[id]--
			if m.active[id] == 0 {
				delete(m.active, id)
			}
			close(m.changed)
			m.changed = make(chan struct{})
			m.mu.Unlock()
		})
	}
}
func (m *taskFileManager) waitIdle(ctx context.Context, id string) error {
	for {
		m.mu.Lock()
		count, changed := m.active[id], m.changed
		m.mu.Unlock()
		if count == 0 {
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-changed:
		}
	}
}
func taskFileComponent(s string) bool {
	return s != "" && s != "." && s != ".." && !strings.ContainsAny(s, "/\\\x00") && strings.TrimSpace(s) == s
}
func taskFiles(state, thread string) (taskFileSpace, error) {
	if state == "" || !taskFileComponent(thread) {
		return taskFileSpace{}, errors.New("task file identity unavailable")
	}
	root := filepath.Join(state, "task-files", thread)
	return taskFileSpace{Root: root, Scratch: filepath.Join(root, "scratch"), Staging: filepath.Join(root, "staging")}, nil
}
func prepareTaskFiles(state, thread string) (taskFileSpace, error) {
	space, err := taskFiles(state, thread)
	if err != nil {
		return space, err
	}
	base, err := os.OpenRoot(state)
	if err != nil {
		return space, err
	}
	defer base.Close()
	for _, dir := range []string{"task-files", filepath.Join("task-files", thread), filepath.Join("task-files", thread, "scratch"), filepath.Join("task-files", thread, "staging")} {
		info, e := base.Lstat(dir)
		if errors.Is(e, os.ErrNotExist) {
			if e = base.Mkdir(dir, 0700); e != nil && !errors.Is(e, os.ErrExist) {
				return space, e
			}
			info, e = base.Lstat(dir)
		}
		if e != nil {
			return space, e
		}
		if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return space, errors.New("task directory must not be a symbolic link")
		}
	}
	real, err := filepath.EvalSymlinks(space.Root)
	if err != nil {
		return space, err
	}
	expected, err := filepath.EvalSymlinks(state)
	if err != nil {
		return space, err
	}
	if real != filepath.Join(expected, "task-files", thread) {
		return space, errors.New("task directory must not be a symbolic link")
	}
	space.Root = real
	space.Scratch = filepath.Join(real, "scratch")
	space.Staging = filepath.Join(real, "staging")
	for _, dir := range []string{space.Scratch, space.Staging} {
		info, e := os.Lstat(dir)
		if e != nil {
			return space, e
		}
		if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return space, errors.New("task directory must be a real directory")
		}
	}
	return space, nil
}
func (r *run) prepareTaskFiles() (taskFileSpace, error) {
	release := r.taskFiles.acquire(r.threadID)
	defer release()
	return prepareTaskFiles(r.stateDir, r.threadID)
}
func taskPathWithin(path, root string) bool {
	rel, err := filepath.Rel(root, path)
	return err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}
func (r *run) taskEnvironment(env []string) ([]string, error) {
	if r.stateDir == "" || r.threadID == "" {
		return env, nil
	}
	space, err := r.prepareTaskFiles()
	if err != nil {
		return nil, err
	}
	// Preserve OS temp conventions (notably short Unix socket paths). Long-lived
	// task intermediates use explicit scratch; HOME and tool caches stay unchanged.
	values := map[string]string{"FLOWER_SCRATCH_DIR": space.Scratch, "FLOWER_STAGING_DIR": space.Staging}
	out := make([]string, 0, len(env)+len(values))
	for _, entry := range env {
		k, _, _ := strings.Cut(entry, "=")
		if _, ok := values[k]; !ok && k != "FLOWER_OUTPUT_DIR" {
			out = append(out, entry)
		}
	}
	for _, k := range []string{"FLOWER_SCRATCH_DIR", "FLOWER_STAGING_DIR"} {
		out = append(out, k+"="+values[k])
	}
	return out, nil
}

type deliveredFile struct {
	FilePath   string `json:"file_path"`
	Name       string `json:"name"`
	Title      string `json:"title"`
	MIME       string `json:"mime"`
	Size       int64  `json:"size"`
	ModifiedNS int64  `json:"modified_ns"`
	SHA256     string `json:"sha256"`
	EndpointID string `json:"endpoint_id"`
	ThreadID   string `json:"thread_id"`
	RunID      string `json:"run_id"`
	TurnID     string `json:"turn_id"`
}

func (r *run) presentFile(ctx context.Context, path, title string) (deliveredFile, error) {
	var out deliveredFile
	scope, err := r.runPathScope()
	if err != nil {
		return out, err
	}
	path, err = scope.ResolveExistingPath(path)
	if err != nil {
		return out, err
	}
	if r.stateDir != "" {
		state, err := filepath.EvalSymlinks(r.stateDir)
		if err != nil {
			return out, err
		}
		if taskPathWithin(path, state) {
			return out, errors.New("final files must be saved to the user destination, outside application state and task directories")
		}
	}
	parent, err := os.OpenRoot(filepath.Dir(path))
	if err != nil {
		return out, err
	}
	defer parent.Close()
	f, err := parent.Open(filepath.Base(path))
	if err != nil {
		return out, err
	}
	defer f.Close()
	before, err := f.Stat()
	if err != nil {
		return out, err
	}
	if !before.Mode().IsRegular() {
		return out, errors.New("deliverable must be a regular file")
	}
	hash := sha256.New()
	buf := make([]byte, 64*1024)
	var size int64
	var prefix []byte
	for {
		if err = ctx.Err(); err != nil {
			return out, err
		}
		n, e := f.Read(buf)
		if n > 0 {
			if prefix == nil {
				prefix = append([]byte{}, buf[:min(n, 512)]...)
			}
			_, _ = hash.Write(buf[:n])
			size += int64(n)
		}
		if e == io.EOF {
			break
		}
		if e != nil {
			return out, e
		}
	}
	after, err := f.Stat()
	if err != nil {
		return out, err
	}
	current, currentErr := parent.Stat(filepath.Base(path))
	if currentErr != nil || !os.SameFile(before, current) || !current.ModTime().Equal(after.ModTime()) || before.Size() != size || after.Size() != size || !before.ModTime().Equal(after.ModTime()) {
		return out, errors.New("file changed while verifying delivery")
	}
	run, thread, turn := r.floretCanonicalIdentity()
	if run == "" || thread == "" || turn == "" {
		return out, errors.New("canonical delivery identity unavailable")
	}
	title = strings.TrimSpace(title)
	if title == "" {
		title = filepath.Base(path)
	}
	if utf8.RuneCountInString(title) > 240 {
		return out, fmt.Errorf("file title exceeds 240 characters")
	}
	return deliveredFile{FilePath: path, Name: filepath.Base(path), Title: title, MIME: taskFileMIME(path, prefix), Size: size, ModifiedNS: after.ModTime().UnixNano(), SHA256: hex.EncodeToString(hash.Sum(nil)), EndpointID: r.endpointID, ThreadID: thread, RunID: run, TurnID: turn}, nil
}

func taskFileMIME(path string, prefix []byte) string {
	if kind := mime.TypeByExtension(filepath.Ext(path)); kind != "" {
		return kind
	}
	return http.DetectContentType(prefix)
}
