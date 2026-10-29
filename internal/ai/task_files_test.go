package ai

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/filesystemscope"
)

func taskFilesTestRun(t *testing.T) *run {
	t.Helper()
	work := t.TempDir()
	r := newRun(runOptions{StateDir: t.TempDir(), ThreadID: "thread-one", RunID: "run-one", TurnID: "turn-one", AgentHomeDir: work, WorkingDir: work, FilesystemScope: flowerTestFilesystemScope(t, work)})
	if err := r.observeFloretCanonicalIdentity("run-one", "thread-one", "turn-one"); err != nil {
		t.Fatal(err)
	}
	return r
}
func TestTaskFilesSeparationAndEnvironment(t *testing.T) {
	r := taskFilesTestRun(t)
	space, e := r.prepareTaskFiles()
	if e != nil {
		t.Fatal(e)
	}
	scope, e := r.runPathScope()
	if e != nil {
		t.Fatal(e)
	}
	realWork, _ := filepath.EvalSymlinks(r.workingDir)
	if scope.WorkingDirAbs != realWork {
		t.Fatal("project cwd changed")
	}
	if _, e = scope.ResolveTargetPath(filepath.Join(space.Scratch, "helper.py")); e != nil {
		t.Fatal(e)
	}
	sibling, e := prepareTaskFiles(r.stateDir, "thread-two")
	if e != nil {
		t.Fatal(e)
	}
	if _, e = scope.ResolveExistingPath(sibling.Scratch); e == nil {
		t.Fatal("sibling task exposed")
	}
	env, e := r.taskEnvironment([]string{"HOME=unchanged", "FLOWER_OUTPUT_DIR=bad", "TMPDIR=old"})
	if e != nil {
		t.Fatal(e)
	}
	joined := strings.Join(env, "\n")
	if !strings.Contains(joined, "HOME=unchanged") || !strings.Contains(joined, "FLOWER_SCRATCH_DIR="+space.Scratch) || strings.Contains(joined, "FLOWER_OUTPUT_DIR=") || !strings.Contains(joined, "TMPDIR=old") {
		t.Fatal(env)
	}
	path := filepath.Join(r.workingDir, "report.txt")
	if e = os.WriteFile(path, []byte("final"), 0600); e != nil {
		t.Fatal(e)
	}
	file, e := r.presentFile(t.Context(), path, "Report")
	if e != nil || file.Size != 5 || len(file.SHA256) != 64 {
		t.Fatalf("%+v %v", file, e)
	}
	private := filepath.Join(space.Scratch, "draft.txt")
	if e = os.WriteFile(private, []byte("draft"), 0600); e != nil {
		t.Fatal(e)
	}
	if _, e = r.presentFile(t.Context(), private, ""); e == nil {
		t.Fatal("private file accepted as final")
	}
	if e = os.Symlink(sibling.Scratch, filepath.Join(space.Scratch, "escape")); e != nil {
		t.Fatal(e)
	}
	if _, e = scope.ResolveExistingPath(filepath.Join(space.Scratch, "escape")); e == nil {
		t.Fatal("sibling symlink allowed")
	}
	if _, e = scope.Registry.Resolve(filepath.Join(space.Scratch, "new"), filesystemscope.ResolveOptions{ForWrite: true}); e != nil {
		t.Fatal(e)
	}
}
func TestTaskFilesRejectSymlinkBeforeCreatingChildren(t *testing.T) {
	state := t.TempDir()
	outside := t.TempDir()
	if e := os.Symlink(outside, filepath.Join(state, "task-files")); e != nil {
		t.Fatal(e)
	}
	if _, e := prepareTaskFiles(state, "thread-one"); e == nil {
		t.Fatal("symlink accepted")
	}
	entries, e := os.ReadDir(outside)
	if e != nil || len(entries) != 0 {
		t.Fatal("changed linked destination")
	}
	for _, id := range []string{"..", "../outside", "a/b", "a\\b", "", "a\x00b"} {
		if _, e := taskFiles(state, id); e == nil {
			t.Fatalf("accepted %q", id)
		}
	}
}
func TestTaskFilesCurrentPolicyAndWorkingDirectoryRemainIntact(t *testing.T) {
	r := taskFilesTestRun(t)
	space, e := r.prepareTaskFiles()
	if e != nil {
		t.Fatal(e)
	}
	for _, id := range []string{"thread-one", "thread-fork"} {
		r.threadID = id
		s, e := r.prepareTaskFiles()
		if e != nil {
			t.Fatal(e)
		}
		if id != "thread-one" && s.Root == space.Root {
			t.Fatal("fork shares working files")
		}
	}
	if !strings.Contains(buildFlowerSystemPrompt(), "Save final deliverables") || !strings.Contains(buildFlowerSystemPrompt(), "file.present") {
		t.Fatal("delivery contract absent")
	}
}

func TestTaskFilesCleanupAuthorizationActivityAndDownloads(t *testing.T) {
	svc := newTestService(t, &config.AIConfig{CurrentModelID: "openai/gpt-5-mini", Providers: []config.AIProvider{{ID: "openai", Name: "OpenAI", Type: "openai", Models: []config.AIProviderModel{{ModelName: "gpt-5-mini"}}}}})
	meta := testSendTurnMeta()
	thread, err := svc.CreateThread(t.Context(), meta, "Files", "", config.AIPermissionFullAccess, svc.agentHomeDir)
	if err != nil {
		t.Fatal(err)
	}
	space, err := prepareTaskFiles(svc.stateDir, thread.ThreadID)
	if err != nil {
		t.Fatal(err)
	}
	draft := filepath.Join(space.Scratch, "helper.txt")
	final := filepath.Join(svc.agentHomeDir, "report.txt")
	for _, p := range []string{draft, final} {
		if err = os.WriteFile(p, []byte("retained"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	release, err := svc.taskFiles.acquire(t.Context(), thread.ThreadID)
	if err != nil {
		t.Fatal(err)
	}
	if err = svc.CleanTaskFiles(t.Context(), meta, thread.ThreadID); !errors.Is(err, ErrThreadBusy) {
		t.Fatalf("active cleanup: %v", err)
	}
	release()
	release()
	foreign := *meta
	foreign.EndpointID = "other-endpoint"
	if _, err = svc.OpenTaskFile(t.Context(), &foreign, thread.ThreadID, draft, true); err == nil {
		t.Fatal("foreign read")
	}
	readonly := *meta
	readonly.CanWrite = false
	if err = svc.CleanTaskFiles(t.Context(), &readonly, thread.ThreadID); err == nil {
		t.Fatal("readonly cleanup")
	}
	for _, tc := range []struct {
		path    string
		working bool
		ok      bool
	}{{draft, true, true}, {final, false, true}, {draft, false, false}, {final, true, false}} {
		f, e := svc.OpenTaskFile(t.Context(), meta, thread.ThreadID, tc.path, tc.working)
		if (e == nil) != tc.ok {
			t.Fatalf("%+v: %v", tc, e)
		}
		if f != nil {
			f.Close()
		}
	}
	link := filepath.Join(space.Scratch, "escape")
	if err = os.Symlink(final, link); err != nil {
		t.Fatal(err)
	}
	if f, e := svc.OpenTaskFile(t.Context(), meta, thread.ThreadID, link, true); e == nil {
		f.Close()
		t.Fatal("symlink escape")
	}
	if err = svc.CleanTaskFiles(t.Context(), meta, thread.ThreadID); err != nil {
		t.Fatal(err)
	}
	if _, err = os.Stat(draft); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("draft retained", err)
	}
	if _, err = os.Stat(final); err != nil {
		t.Fatal("final removed", err)
	}
	space, err = prepareTaskFiles(svc.stateDir, thread.ThreadID)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(space.Scratch, "new.txt"), []byte("draft"), 0600); err != nil {
		t.Fatal(err)
	}
	if err = svc.DeleteThread(t.Context(), meta, thread.ThreadID, false); err != nil {
		t.Fatal(err)
	}
	if _, err = os.Stat(space.Root); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("deleted thread working files retained", err)
	}
	if _, err = os.Stat(final); err != nil {
		t.Fatal("delete removed final", err)
	}
}

func TestTaskFilesBackgroundProcessPreventsCleanup(t *testing.T) {
	svc := newTestService(t, &config.AIConfig{CurrentModelID: "openai/gpt-5-mini", Providers: []config.AIProvider{{ID: "openai", Name: "OpenAI", Type: "openai", Models: []config.AIProviderModel{{ModelName: "gpt-5-mini"}}}}})
	meta := testSendTurnMeta()
	thread, err := svc.CreateThread(t.Context(), meta, "Files", "", "full_access", svc.agentHomeDir)
	if err != nil {
		t.Fatal(err)
	}
	process, err := svc.terminalProcessManager().Start(terminalProcessStartRequest{ProcessID: "tp-task-files-test", EndpointID: meta.EndpointID, ThreadID: thread.ThreadID, RunID: "run-background", TurnID: "turn-background", ToolID: "terminal", ToolName: "terminal.exec", Command: "sleep 30", CwdAbs: svc.agentHomeDir, Shell: "/bin/sh", Env: os.Environ()})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = process.Terminate(context.Background()) })
	files, err := svc.GetTaskFiles(t.Context(), meta, thread.ThreadID, "")
	if err != nil {
		t.Fatal(err)
	}
	if files.CanClean {
		t.Fatal("background process marked cleanable")
	}
	if err = svc.CleanTaskFiles(t.Context(), meta, thread.ThreadID); !errors.Is(err, ErrThreadBusy) {
		t.Fatalf("background cleanup %v", err)
	}
	if err = svc.DeleteThread(t.Context(), meta, thread.ThreadID, false); !errors.Is(err, ErrThreadBusy) {
		t.Fatal("ordinary delete ignored process", err)
	}
	if err = svc.DeleteThread(t.Context(), meta, thread.ThreadID, true); err != nil {
		t.Fatal(err)
	}
	if process.Snapshot().Status == terminalProcessStatusRunning {
		t.Fatal("force delete left process running")
	}

}

func TestTaskFilesDoesNotExpandProjectWritePermission(t *testing.T) {
	r := taskFilesTestRun(t)
	scope, err := filesystemscope.NewRegistry(&config.Config{AgentHomeDir: r.workingDir, FilesystemScope: &config.FilesystemScope{SchemaVersion: config.FilesystemScopeSchemaVersionV1, DefaultRootID: "project", Roots: []config.FilesystemRootPolicy{{ID: "project", Label: "Project", Path: r.workingDir, Kind: config.FilesystemRootCustom, Permissions: config.FilesystemPermissionSet{Read: true, Write: false}}}}})
	if err != nil {
		t.Fatal(err)
	}
	r.scope = scope
	paths, err := r.runPathScope()
	if err != nil {
		t.Fatal(err)
	}
	if _, err = r.toolFileWrite(t.Context(), FileWriteArgs{FilePath: filepath.Join(r.workingDir, "new.txt"), Content: "must not write"}); !errors.Is(err, filesystemscope.ErrWriteDenied) {
		t.Fatal("write tool ignored readonly root", err)
	}
	if _, err = paths.Registry.Resolve(filepath.Join(r.workingDir, "new.txt"), filesystemscope.ResolveOptions{ForWrite: true}); !errors.Is(err, filesystemscope.ErrWriteDenied) {
		t.Fatal("project write expanded", err)
	}
	space, err := r.prepareTaskFiles()
	if err != nil {
		t.Fatal(err)
	}
	if _, err = paths.Registry.Resolve(filepath.Join(space.Scratch, "helper.txt"), filesystemscope.ResolveOptions{ForWrite: true}); err != nil {
		t.Fatal(err)
	}
}

func TestTaskFilesRejectParentReplacementAfterPreparation(t *testing.T) {
	state, outside := t.TempDir(), t.TempDir()
	if _, err := prepareTaskFiles(state, "thread-one"); err != nil {
		t.Fatal(err)
	}
	if _, err := prepareTaskFiles(outside, "thread-one"); err != nil {
		t.Fatal(err)
	}
	parent := filepath.Join(state, "task-files")
	if err := os.Rename(parent, parent+".old"); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(outside, "task-files"), parent); err != nil {
		t.Fatal(err)
	}
	for _, create := range []bool{false, true} {
		if root, err := openTaskFileRoot(state, "thread-one", create); err == nil {
			root.Close()
			t.Fatal("replaced task parent accepted")
		}
	}
}
