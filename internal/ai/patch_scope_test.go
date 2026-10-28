package ai

import (
	"context"
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/filesystemscope"
)

func TestPatchToolWritesDetachedTaskScratch(t *testing.T) {
	t.Parallel()
	r := taskFilesTestRun(t)
	space, err := r.prepareTaskFiles()
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(space.Scratch, "part3a.js")
	if _, err := r.toolFileWrite(t.Context(), FileWriteArgs{FilePath: path, Content: "const value = 1;\n"}); err != nil {
		t.Fatal(err)
	}
	patch := "*** Begin Patch\n*** Update File: " + path + "\n@@\n-const value = 1;\n+const value = 2;\n*** End Patch"
	refs, err := r.patchToolResources(patch)
	if err != nil {
		t.Fatal(err)
	}
	result, err := r.toolApplyPatch(context.WithValue(t.Context(), authorizedPatchResourcesKey{}, refs), patch)
	if err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(path)
	if err != nil || string(got) != "const value = 2;\n" {
		t.Fatalf("content=%q err=%v", got, err)
	}
	mutation := result.(ApplyPatchResult).Mutations[0]
	if len(refs) != 1 || refs[0].Value != mutation.FilePath {
		t.Fatalf("resources=%+v mutation=%+v", refs, mutation)
	}
}

func TestPatchToolRejectsSwappedAuthorizedTargets(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	r := newRun(runOptions{AgentHomeDir: dir, WorkingDir: dir, FilesystemScope: flowerTestFilesystemScope(t, dir)})
	for _, name := range []string{"one", "two"} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte("old\n"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	for link, target := range map[string]string{"a": "one", "b": "two"} {
		if err := os.Symlink(target, filepath.Join(dir, link)); err != nil {
			t.Fatal(err)
		}
	}
	patch := "*** Begin Patch\n*** Update File: a\n@@\n-old\n+first\n*** Update File: b\n@@\n-old\n+second\n*** End Patch"
	refs, err := r.patchToolResources(patch)
	if err != nil {
		t.Fatal(err)
	}
	for link, target := range map[string]string{"a": "two", "b": "one"} {
		if err := os.Remove(filepath.Join(dir, link)); err != nil {
			t.Fatal(err)
		}
		if err := os.Symlink(target, filepath.Join(dir, link)); err != nil {
			t.Fatal(err)
		}
	}
	_, err = r.toolApplyPatch(context.WithValue(t.Context(), authorizedPatchResourcesKey{}, refs), patch)
	if err == nil || !strings.Contains(err.Error(), "after authorization") {
		t.Fatalf("swapped targets: %v", err)
	}
	for _, name := range []string{"one", "two"} {
		got, err := os.ReadFile(filepath.Join(dir, name))
		if err != nil || string(got) != "old\n" {
			t.Fatalf("%s=%q err=%v", name, got, err)
		}
	}
}

func TestPatchToolUsesWritableRootsBeyondCwd(t *testing.T) {
	t.Parallel()
	root := t.TempDir()
	cwd, output := filepath.Join(root, "project"), filepath.Join(root, "output")
	for _, dir := range []string{cwd, output} {
		if err := os.Mkdir(dir, 0700); err != nil {
			t.Fatal(err)
		}
	}
	registry, err := filesystemscope.NewRegistry(&config.Config{AgentHomeDir: cwd, FilesystemScope: &config.FilesystemScope{
		SchemaVersion: 1, DefaultRootID: "project", Roots: []config.FilesystemRootPolicy{
			{ID: "project", Label: "Project", Path: cwd, Kind: config.FilesystemRootCustom, Permissions: config.FilesystemPermissionSet{Read: true, Write: true}},
			{ID: "output", Label: "Output", Path: output, Kind: config.FilesystemRootCustom, Permissions: config.FilesystemPermissionSet{Read: true, Write: true}},
		},
	}})
	if err != nil {
		t.Fatal(err)
	}
	r := newRun(runOptions{AgentHomeDir: cwd, WorkingDir: cwd, FilesystemScope: registry})
	patch := "*** Begin Patch\n*** Add File: ../output/draft.txt\n+old\n*** End Patch"
	if _, err := r.toolApplyPatch(t.Context(), patch); err != nil {
		t.Fatal(err)
	}
	patch = "*** Begin Patch\n*** Update File: ../output/draft.txt\n*** Move to: " + filepath.Join(output, "nested", "final.txt") + "\n@@\n-old\n+new\n*** End Patch"
	refs, err := r.patchToolResources(patch)
	if err != nil || len(refs) != 2 {
		t.Fatalf("refs=%+v err=%v", refs, err)
	}
	if _, err := r.toolApplyPatch(context.WithValue(t.Context(), authorizedPatchResourcesKey{}, refs), patch); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(filepath.Join(output, "nested", "final.txt"))
	if err != nil || string(got) != "new\n" {
		t.Fatalf("content=%q err=%v", got, err)
	}
	patch = "*** Begin Patch\n*** Delete File: ../output/nested/final.txt\n*** End Patch"
	if _, err := r.toolApplyPatch(t.Context(), patch); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(output, "nested", "final.txt")); !os.IsNotExist(err) {
		t.Fatalf("delete=%v", err)
	}
	if _, err := r.patchToolResources("*** Begin Patch\n*** Add File: ../denied.txt\n+denied\n*** End Patch"); !errors.Is(err, filesystemscope.ErrPathOutsideScope) {
		t.Fatalf("outside scope=%v", err)
	}
}

func TestPatchToolRejectsPrivateSiblingsAndAliases(t *testing.T) {
	t.Parallel()
	r := taskFilesTestRun(t)
	own, err := r.prepareTaskFiles()
	if err != nil {
		t.Fatal(err)
	}
	sibling, err := prepareTaskFiles(r.stateDir, "thread-two")
	if err != nil {
		t.Fatal(err)
	}
	// Even a broad configured root must not bypass task-private policy.
	r.scope = flowerTestFilesystemScope(t, filepath.Dir(r.stateDir))
	aliases := map[string]string{
		filepath.Join(r.workingDir, "private-alias"):   sibling.Scratch,
		filepath.Join(own.Scratch, "sibling-alias"):    sibling.Scratch,
		filepath.Join(sibling.Scratch, "public-alias"): r.workingDir,
	}
	for link, target := range aliases {
		if err := os.Symlink(target, link); err != nil {
			t.Fatal(err)
		}
	}
	paths := []string{filepath.Join(sibling.Scratch, "denied.txt"), filepath.Join(filepath.Dir(own.Root), "denied.txt")}
	for link := range aliases {
		paths = append(paths, filepath.Join(link, "denied.txt"))
	}
	for _, path := range paths {
		patch := "*** Begin Patch\n*** Add File: " + path + "\n+denied\n*** End Patch"
		if _, err := r.patchToolResources(patch); err == nil {
			t.Fatalf("authorized %s", path)
		}
		if _, err := r.toolApplyPatch(t.Context(), patch); err == nil {
			t.Fatalf("wrote %s", path)
		}
		if _, err := os.Stat(path); !os.IsNotExist(err) {
			t.Fatalf("target changed %s: %v", path, err)
		}
	}
}

func TestPatchCommitRechecksLogicalPaths(t *testing.T) {
	t.Parallel()
	for _, phase := range []string{"preflight", "next-file", "move-delete"} {
		t.Run(phase, func(t *testing.T) {
			dir := t.TempDir()
			scope := patchTestScope(t, dir)
			for _, name := range []string{"one", "two"} {
				if err := os.WriteFile(filepath.Join(dir, name), []byte("old\n"), 0600); err != nil {
					t.Fatal(err)
				}
			}
			link := filepath.Join(dir, "link")
			if err := os.Symlink("one", link); err != nil {
				t.Fatal(err)
			}
			patch := "*** Begin Patch\n*** Add File: first\n+first\n*** Update File: link\n@@\n-old\n+new\n*** End Patch"
			if phase == "move-delete" {
				patch = "*** Begin Patch\n*** Update File: link\n*** Move to: moved\n@@\n-old\n+new\n*** End Patch"
			}
			parsed, err := parsePatchText(patch)
			if err != nil {
				t.Fatal(err)
			}
			files, err := resolvePatchFiles(scope, parsed.files)
			if err != nil {
				t.Fatal(err)
			}
			var plans []patchFilePlan
			for _, fd := range files {
				plan, err := buildPatchFilePlan(scope, fd)
				if err != nil {
					t.Fatal(err)
				}
				plans = append(plans, plan)
			}
			swap := func() {
				if err := os.Remove(link); err != nil {
					t.Fatal(err)
				}
				if err := os.Symlink("two", link); err != nil {
					t.Fatal(err)
				}
			}
			if phase == "preflight" {
				swap()
			}
			writes := 0
			mutations, err := commitPatchPlans(t.Context(), scope, plans, func(path string, data []byte, mode fs.FileMode) error {
				writes++
				if err := atomicWriteFile(path, data, mode); err != nil {
					return err
				}
				swap()
				return nil
			}, os.Remove)
			var failure *patchApplyError
			if !errors.As(err, &failure) || !strings.Contains(err.Error(), "target changed") {
				t.Fatalf("failure=%v", err)
			}
			want := 1
			if phase == "preflight" {
				want = 0
			}
			if writes != want || len(mutations) != want || failure.attempted != (want > 0) {
				t.Fatalf("writes=%d mutations=%+v failure=%+v", writes, mutations, failure)
			}
			for _, name := range []string{"one", "two"} {
				got, err := os.ReadFile(filepath.Join(dir, name))
				if err != nil || string(got) != "old\n" {
					t.Fatalf("%s=%q err=%v", name, got, err)
				}
			}
		})
	}
}

func TestPatchMoveRequiresBothWritableEndpoints(t *testing.T) {
	t.Parallel()
	for _, denied := range []string{"source", "destination"} {
		t.Run(denied, func(t *testing.T) {
			dir := t.TempDir()
			readonly := filepath.Join(dir, "readonly")
			if err := os.Mkdir(readonly, 0700); err != nil {
				t.Fatal(err)
			}
			source, destination := filepath.Join(dir, "source"), filepath.Join(dir, "destination")
			if denied == "source" {
				source = filepath.Join(readonly, "source")
			} else {
				destination = filepath.Join(readonly, "destination")
			}
			if err := os.WriteFile(source, []byte("old\n"), 0600); err != nil {
				t.Fatal(err)
			}
			registry, err := filesystemscope.NewRegistry(&config.Config{AgentHomeDir: dir, FilesystemScope: &config.FilesystemScope{
				SchemaVersion: 1, DefaultRootID: "workspace", Roots: []config.FilesystemRootPolicy{
					{ID: "workspace", Label: "Workspace", Path: dir, Kind: config.FilesystemRootCustom, Permissions: config.FilesystemPermissionSet{Read: true, Write: true}},
					{ID: "readonly", Label: "Read only", Path: readonly, Kind: config.FilesystemRootCustom, Permissions: config.FilesystemPermissionSet{Read: true}},
				},
			}})
			if err != nil {
				t.Fatal(err)
			}
			r := newRun(runOptions{AgentHomeDir: dir, WorkingDir: dir, FilesystemScope: registry})
			patch := "*** Begin Patch\n*** Update File: " + source + "\n*** Move to: " + destination + "\n@@\n-old\n+new\n*** End Patch"
			if _, err := r.patchToolResources(patch); !errors.Is(err, filesystemscope.ErrWriteDenied) {
				t.Fatalf("authorization=%v", err)
			}
			if _, err := r.toolApplyPatch(t.Context(), patch); !errors.Is(err, filesystemscope.ErrWriteDenied) {
				t.Fatalf("execution=%v", err)
			}
			got, err := os.ReadFile(source)
			if err != nil || string(got) != "old\n" {
				t.Fatalf("source=%q err=%v", got, err)
			}
			if _, err := os.Stat(destination); !os.IsNotExist(err) {
				t.Fatalf("destination changed: %v", err)
			}
		})
	}
}

func TestPatchCancellationRetainsConfirmedPrefix(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	scope := patchTestScope(t, dir)
	parsed, err := parsePatchText("*** Begin Patch\n*** Add File: first\n+first\n*** Add File: second\n+second\n*** End Patch")
	if err != nil {
		t.Fatal(err)
	}
	var plans []patchFilePlan
	for _, fd := range parsed.files {
		plan, err := buildPatchFilePlan(scope, fd)
		if err != nil {
			t.Fatal(err)
		}
		plans = append(plans, plan)
	}
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	mutations, err := commitPatchPlans(ctx, scope, plans, func(path string, data []byte, mode fs.FileMode) error {
		if err := atomicWriteFile(path, data, mode); err != nil {
			return err
		}
		cancel()
		return nil
	}, os.Remove)
	var failure *patchApplyError
	if !errors.Is(err, context.Canceled) || !errors.As(err, &failure) || !failure.attempted || len(failure.completed) != 1 || len(mutations) != 1 {
		t.Fatalf("failure=%+v mutations=%+v", err, mutations)
	}
	if _, err := os.Stat(filepath.Join(dir, "second")); !os.IsNotExist(err) {
		t.Fatalf("second changed: %v", err)
	}
}

func TestPatchTargetRoutingRetainsTargetPolicy(t *testing.T) {
	t.Parallel()
	executor := &recordingTargetExecutor{}
	r := newRun(runOptions{SessionMeta: testSendTurnMeta()})
	r.toolTargetPolicy = ToolTargetPolicy{Mode: ToolTargetModeExplicitTarget, DefaultTargetID: "remote"}
	r.targetResolver = staticTargetResolver{target: TargetDescriptor{ID: "remote", Ready: true}}
	r.targetToolExecutor = executor
	bindTargetTestRun(t, r)
	snapshot := buildPermissionSnapshot(FlowerPermissionFullAccess, builtInToolDefinitions(), nil)
	snapshot.SnapshotID = "patch-route"
	ctx := contextWithToolAuthorizationSnapshot(t.Context(), snapshot)
	ctx = contextWithFloretToolExecutionAuthorization(ctx, "patch", "apply_patch", "attempt", snapshot, ApprovalDecisionAllow, true, nil)
	patch := "*** Begin Patch\n*** Add File: /remote/only/file.txt\n+remote\n*** End Patch"
	result, err := r.execTool(ctx, testSendTurnMeta(), "patch", "apply_patch", map[string]any{"input": patch})
	if err != nil || len(executor.calls) != 1 {
		t.Fatalf("result=%+v err=%v calls=%+v", result, err, executor.calls)
	}
	var forwarded map[string]any
	if err := json.Unmarshal(executor.calls[0].Arguments, &forwarded); err != nil || forwarded["input"] != patch || executor.calls[0].TargetID != "remote" {
		t.Fatalf("forwarded=%+v err=%v", forwarded, err)
	}
}
