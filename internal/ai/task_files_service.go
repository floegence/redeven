package ai

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/floegence/floret/v7/identity"
	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/floret/v7/threadquery"
	"github.com/floegence/redeven/internal/filesystemscope"
	"github.com/floegence/redeven/internal/session"
)

type FlowerDeliveredFile struct {
	deliveredFile
	Status string `json:"status"`
}
type FlowerWorkingFile struct {
	Path string `json:"path"`
	Name string `json:"name"`
	Size int64  `json:"size"`
}

type FlowerTaskFiles struct {
	Working          []FlowerWorkingFile   `json:"working"`
	WorkingTruncated bool                  `json:"working_truncated"`
	Files            []FlowerDeliveredFile `json:"files"`
	NextCursor       string                `json:"next_cursor,omitempty"`
	WorkingPath      string                `json:"working_path"`
	WorkingBytes     int64                 `json:"working_bytes"`
	WorkingFiles     int                   `json:"working_files"`
	CanClean         bool                  `json:"can_clean"`
	StateInWorkspace bool                  `json:"state_in_workspace"`
}

// Task files are queried from canonical tool results, never a second artifact ledger.
func (s *Service) GetTaskFiles(ctx context.Context, meta *session.Meta, threadID, cursor string) (FlowerTaskFiles, error) {
	out := FlowerTaskFiles{Files: []FlowerDeliveredFile{}, Working: []FlowerWorkingFile{}}
	scope, err := s.flowerHistoryScope(ctx, meta, threadID)
	if err != nil {
		return out, err
	}
	reader, ok := s.threadRuntime.(flruntime.ThreadQueryReader)
	if !ok {
		return out, errors.New("canonical file results unavailable")
	}
	page, err := reader.Query(ctx, scope, threadquery.QueryInput{Object: threadquery.ToolCalls, Filter: threadquery.Filter{ThreadIDs: []identity.ThreadID{identity.ThreadID(threadID)}, ToolNames: []string{"file.present"}, Statuses: []string{"success"}, ToolKinds: []string{"local"}}, Sort: threadquery.Sort{Key: "time", Descending: true}, Limit: 50, Cursor: cursor})
	if err != nil {
		return out, err
	}
	for _, record := range page.Records {
		var content strings.Builder
		input := threadquery.ReadInput{Ref: record.Ref}
		for {
			scope, err = s.flowerHistoryScope(ctx, meta, threadID)
			if err != nil {
				return out, err
			}
			part, e := reader.Read(ctx, scope, input)
			if e != nil {
				return out, e
			}
			if part.Record.ToolCallID != record.ToolCallID || part.Record.RunID != record.RunID || part.Record.ThreadID != record.ThreadID {
				return out, errors.New("file result identity changed")
			}
			for _, chunk := range part.Chunks {
				if chunk.Field == "result" {
					if chunk.Offset != content.Len() || content.Len()+len(chunk.Text) > 32768 {
						return out, errors.New("invalid file result")
					}
					content.WriteString(chunk.Text)
				}
			}
			if part.NextCursor == "" {
				break
			}
			input.Cursor = part.NextCursor
		}
		var result struct {
			Status string        `json:"status"`
			Data   deliveredFile `json:"data"`
		}
		if json.Unmarshal([]byte(content.String()), &result) != nil || result.Status != "success" || result.Data.FilePath == "" {
			return out, errors.New("invalid canonical file delivery")
		}
		if result.Data.ThreadID == "" || result.Data.RunID != record.RunID.String() || result.Data.TurnID != record.TurnID.String() {
			return out, errors.New("canonical delivery identity mismatch")
		}
		file := FlowerDeliveredFile{deliveredFile: result.Data, Status: "available"}
		// Inspect actual destination against current policy; history grants no file access.
		r := &run{agentHomeDir: s.agentHomeDir, workingDir: s.agentHomeDir, scope: s.scope}
		resolved, e := r.runPathScope()
		var info os.FileInfo
		if e == nil {
			var path string
			path, e = resolved.ResolveExistingPath(file.FilePath)
			if e == nil {
				info, e = os.Stat(path)
			}
		}
		switch {
		case errors.Is(e, os.ErrNotExist):
			file.Status = "missing"
		case e != nil || !info.Mode().IsRegular():
			file.Status = "unavailable"
		case info.Size() != file.Size || info.ModTime().UnixNano() != file.ModifiedNS:
			file.Status = "changed"
		}

		out.Files = append(out.Files, file)
	}
	out.NextCursor = page.NextCursor
	space, err := taskFiles(s.stateDir, threadID)
	if err != nil {
		return out, err
	}
	stateReal, err := filepath.EvalSymlinks(s.stateDir)
	if err != nil {
		return out, err
	}
	space.Root = filepath.Join(stateReal, "task-files", threadID)
	out.WorkingPath = space.Root
	if info, e := os.Lstat(space.Root); e == nil {
		if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return out, errors.New("invalid task directory")
		}
		parentInfo, e := os.Lstat(filepath.Dir(space.Root))
		if e != nil {
			return out, e
		}
		if !parentInfo.IsDir() || parentInfo.Mode()&os.ModeSymlink != 0 {
			return out, errors.New("invalid task directory parent")
		}
		root, e := os.OpenRoot(space.Root)
		if e != nil {
			return out, e
		}
		defer root.Close()
		if err = scanTaskWorkingFiles(ctx, root, space.Root, &out); err != nil {
			return out, err
		}

	} else if !errors.Is(e, os.ErrNotExist) {
		return out, e
	}
	current, _, err := readFlowerHistory(ctx, s.threadRuntime, scope, flruntime.ThreadWindowInput{ThreadID: identity.ThreadID(threadID), Limit: 1, PreviewBytes: 128, ActivityFields: true})
	if err != nil {
		return out, err
	}
	out.CanClean = meta.CanWrite && meta.CanExecute && !canonicalThreadBusy(current) && !s.taskFilesBusy(meta.EndpointID, threadID)
	settings, err := s.threadSettingsForRead(ctx, meta, threadID)
	if err != nil {
		return out, err
	}
	if settings != nil {
		cwd, e := threadWorkingDir(settings)
		if e == nil {
			if realCwd, e := filepath.EvalSymlinks(cwd); e == nil {
				out.StateInWorkspace = taskPathWithin(stateReal, realCwd)
			}
		}
	}
	return out, nil
}

// Read directory entries in fixed batches; a huge single directory must not
// allocate or enumerate its entire contents before the visible limit applies.
func scanTaskWorkingFiles(ctx context.Context, root *os.Root, absolute string, out *FlowerTaskFiles) error {
	pending := []string{"scratch", "staging"}
	visited := 0
	for len(pending) > 0 {
		name := pending[len(pending)-1]
		pending = pending[:len(pending)-1]
		directory, err := root.Open(name)
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			return err
		}
		for {
			if err = ctx.Err(); err != nil {
				directory.Close()
				return err
			}
			entries, readErr := directory.ReadDir(128)
			for _, entry := range entries {
				visited++
				if visited > 10000 {
					out.WorkingTruncated = true
					directory.Close()
					return nil
				}
				path := filepath.Join(name, entry.Name())
				if entry.IsDir() {
					pending = append(pending, path)
					continue
				}
				if !entry.Type().IsRegular() {
					continue
				}
				info, e := entry.Info()
				if errors.Is(e, os.ErrNotExist) {
					continue
				}
				if e != nil {
					directory.Close()
					return e
				}
				out.WorkingBytes += info.Size()
				out.WorkingFiles++
				if len(out.Working) < 200 {
					out.Working = append(out.Working, FlowerWorkingFile{Path: filepath.Join(absolute, path), Name: filepath.ToSlash(path), Size: info.Size()})
				} else {
					out.WorkingTruncated = true
				}
			}
			if readErr == io.EOF {
				break
			}
			if readErr != nil {
				directory.Close()
				return readErr
			}
		}
		directory.Close()
	}
	return nil
}

func (s *Service) taskFilesBusy(endpoint, thread string) bool {
	s.taskFiles.mu.Lock()
	defer s.taskFiles.mu.Unlock()
	return s.taskFilesBusyLocked(endpoint, thread)
}
func (s *Service) taskFilesBusyLocked(endpoint, thread string) bool {
	if s.taskFiles.active[thread] > 0 || s.taskFiles.frozen[thread] != nil {
		return true
	}
	return s.taskFilesProcessesBusy(endpoint, thread)
}
func (s *Service) taskFilesProcessesBusy(endpoint, thread string) bool {
	manager := s.terminalProcessManager()
	if manager == nil {
		return false
	}
	manager.mu.Lock()
	defer manager.mu.Unlock()
	for _, p := range manager.processes {
		p.mu.Lock()
		busy := p.endpointID == endpoint && p.threadID == thread && !p.reaped
		p.mu.Unlock()
		if busy {
			return true
		}
	}
	return false
}
func (s *Service) CleanTaskFiles(ctx context.Context, meta *session.Meta, threadID string) error {
	if err := requireRWX(meta); err != nil {
		return err
	}
	if _, err := s.flowerHistoryScope(ctx, meta, threadID); err != nil {
		return err
	}
	s.taskFiles.mu.Lock()
	defer s.taskFiles.mu.Unlock()
	current, err := s.threadRuntime.View(ctx, identity.ThreadID(threadID))
	if err != nil {
		return err
	}
	if canonicalThreadBusy(current) || s.taskFilesBusyLocked(meta.EndpointID, threadID) {
		return ErrThreadBusy
	}
	space, err := taskFiles(s.stateDir, threadID)
	if err != nil {
		return err
	}
	// OpenRoot pins the owned directory and never follows symlinks outside it.
	if _, err = os.Lstat(space.Root); errors.Is(err, os.ErrNotExist) {
		return nil
	} else if err != nil {
		return err
	}
	space, err = prepareTaskFiles(s.stateDir, threadID)
	if err != nil {
		return err
	}
	root, err := os.OpenRoot(space.Root)
	if err != nil {
		return err
	}
	defer root.Close()
	for _, name := range []string{"scratch", "staging"} {
		if err = ctx.Err(); err != nil {
			return err
		}
		if err = root.RemoveAll(name); err != nil {
			return err
		}
	}
	return nil
}

// OpenTaskFile reauthorizes each read and pins the owned root before opening bytes.
func (s *Service) OpenTaskFile(ctx context.Context, meta *session.Meta, threadID, path string, working bool) (*os.File, error) {
	if _, err := s.flowerHistoryScope(ctx, meta, threadID); err != nil {
		return nil, err
	}
	if !filepath.IsAbs(path) {
		return nil, filesystemscope.ErrPathOutsideScope
	}
	if working {
		release, err := s.taskFiles.acquire(ctx, threadID)
		if err != nil {
			return nil, err
		}
		defer release()
		space, err := prepareTaskFiles(s.stateDir, threadID)
		if err != nil {
			return nil, err
		}
		rel, err := filepath.Rel(space.Root, filepath.Clean(path))
		if err != nil || !taskPathWithin(filepath.Clean(path), space.Root) {
			return nil, filesystemscope.ErrPathOutsideScope
		}
		root, err := os.OpenRoot(space.Root)
		if err != nil {
			return nil, err
		}
		defer root.Close()
		return root.Open(rel)
	}
	r := &run{agentHomeDir: s.agentHomeDir, workingDir: s.agentHomeDir, scope: s.scope}
	scope, err := r.runPathScope()
	if err != nil {
		return nil, err
	}
	resolved, err := scope.Registry.Resolve(path, filesystemscope.ResolveOptions{RequireExisting: true})
	if err != nil {
		return nil, err
	}
	state, err := filepath.EvalSymlinks(s.stateDir)
	if err != nil {
		return nil, err
	}
	if taskPathWithin(resolved.RealAbs, state) {
		return nil, filesystemscope.ErrPathOutsideScope
	}
	root, err := os.OpenRoot(filepath.Dir(resolved.RealAbs))
	if err != nil {
		return nil, err
	}
	defer root.Close()
	return root.Open(filepath.Base(resolved.RealAbs))
}

// Deleting a conversation releases only its owned disposable tree after writers settle.
func (s *Service) deleteTaskFiles(ctx context.Context, endpoint, thread string) error {
	// Canonical deletion has settled; finish owned terminal processes before
	// removing their working files, including a force-deleted active conversation.
	if manager := s.terminalProcessManager(); manager != nil {
		manager.mu.Lock()
		var processes []*terminalProcess
		for _, p := range manager.processes {
			p.mu.Lock()
			match := p.endpointID == endpoint && p.threadID == thread
			p.mu.Unlock()
			if match {
				processes = append(processes, p)
			}
		}
		manager.mu.Unlock()
		for _, p := range processes {
			if _, err := p.Terminate(ctx); err != nil {
				return err
			}
		}
	}
	if err := s.taskFiles.waitIdle(ctx, thread); err != nil {
		return err
	}
	s.taskFiles.mu.Lock()
	defer s.taskFiles.mu.Unlock()
	if s.taskFilesBusyLocked(endpoint, thread) {
		return ErrThreadBusy
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if !taskFileComponent(thread) {
		return errors.New("invalid task identity")
	}
	space, err := taskFiles(s.stateDir, thread)
	if err != nil {
		return err
	}
	if _, err = os.Lstat(space.Root); errors.Is(err, os.ErrNotExist) {
		return nil
	} else if err != nil {
		return err
	}
	if _, err = prepareTaskFiles(s.stateDir, thread); err != nil {
		return err
	}
	base, err := os.OpenRoot(s.stateDir)
	if err != nil {
		return err
	}
	defer base.Close()
	return base.RemoveAll(filepath.Join("task-files", thread))
}
