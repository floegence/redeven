package ai

import (
	"context"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"

	fltools "github.com/floegence/floret/v7/tools"
	aitools "github.com/floegence/redeven/internal/ai/tools"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/filesystemscope"
	"github.com/santhosh-tekuri/jsonschema/v5"
)

func TestPatchToolWriteAbsoluteThenPatchSameFile(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	path := filepath.Join(dir, "f.txt")
	r := newRun(runOptions{AgentHomeDir: dir, WorkingDir: dir, FilesystemScope: flowerTestFilesystemScope(t, dir)})
	if _, err := r.toolFileWrite(t.Context(), FileWriteArgs{FilePath: path, Content: "old\n"}); err != nil {
		t.Fatal(err)
	}
	text := "*** Begin Patch\n*** Update File: " + path + "\n@@\n-old\n+new\n*** End Patch"
	refs, err := r.patchToolResources(text)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.WithValue(t.Context(), authorizedPatchResourcesKey{}, refs)
	result, err := r.toolApplyPatch(ctx, text)
	if err != nil {
		t.Fatal(err)
	}
	got, _ := os.ReadFile(path)
	if string(got) != "new\n" {
		t.Fatalf("got %q", got)
	}
	mutation := result.(ApplyPatchResult).Mutations[0]
	if len(refs) != 1 || refs[0].Value != mutation.FilePath {
		t.Fatalf("approval=%+v mutation=%+v", refs, mutation)
	}
}

func TestPatchToolRejectsRetargetedApproval(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	for _, name := range []string{"one", "two"} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte("old\n"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	link := filepath.Join(dir, "link")
	if err := os.Symlink("one", link); err != nil {
		t.Fatal(err)
	}
	r := newRun(runOptions{AgentHomeDir: dir, WorkingDir: dir, FilesystemScope: flowerTestFilesystemScope(t, dir)})
	text := "*** Begin Patch\n*** Update File: link\n@@\n-old\n+new\n*** End Patch"
	refs, err := r.patchToolResources(text)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(link); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink("two", link); err != nil {
		t.Fatal(err)
	}
	_, err = r.toolApplyPatch(context.WithValue(t.Context(), authorizedPatchResourcesKey{}, refs), text)
	if err == nil || !strings.Contains(err.Error(), "after authorization") {
		t.Fatalf("err=%v", err)
	}
	for _, name := range []string{"one", "two"} {
		got, _ := os.ReadFile(filepath.Join(dir, name))
		if string(got) != "old\n" {
			t.Fatalf("changed %s", name)
		}
	}
}

func TestPatchToolRejectsReadOnlyFilesystemRoot(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	nested := filepath.Join(dir, "readonly")
	if err := os.Mkdir(nested, 0700); err != nil {
		t.Fatal(err)
	}
	registry, err := filesystemscope.NewRegistry(&config.Config{AgentHomeDir: dir, FilesystemScope: &config.FilesystemScope{
		SchemaVersion: 1, DefaultRootID: "workspace", Roots: []config.FilesystemRootPolicy{
			{ID: "workspace", Label: "Workspace", Path: dir, Kind: config.FilesystemRootCustom, Permissions: config.FilesystemPermissionSet{Read: true, Write: true}},
			{ID: "readonly", Label: "Read only", Path: nested, Kind: config.FilesystemRootCustom, Permissions: config.FilesystemPermissionSet{Read: true}},
		},
	}})
	if err != nil {
		t.Fatal(err)
	}
	r := newRun(runOptions{AgentHomeDir: dir, WorkingDir: dir, FilesystemScope: registry})
	patch := "*** Begin Patch\n*** Add File: readonly/new.txt\n+denied\n*** End Patch"
	if _, err := r.patchToolResources(patch); !errors.Is(err, filesystemscope.ErrWriteDenied) {
		t.Fatalf("resource error=%v", err)
	}
	_, executionErr := r.toolApplyPatch(t.Context(), patch)
	var failure *patchApplyError
	if !errors.Is(executionErr, filesystemscope.ErrWriteDenied) || !errors.As(executionErr, &failure) {
		t.Fatalf("execution error=%v", executionErr)
	}
	classified := patchToolError(failure)
	if classified.Code != aitools.ErrorCodePermissionDenied || classified.Meta["effect"] != "none" || classified.Retryable {
		t.Fatalf("denied classification=%+v", classified)
	}
	if _, err := os.Stat(filepath.Join(nested, "new.txt")); !os.IsNotExist(err) {
		t.Fatalf("wrote denied file: %v", err)
	}

}

func TestPatchCommitFailureRetainsCompletedFacts(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	parsed, err := parsePatchText("*** Begin Patch\n*** Add File: a.txt\n+a\n*** Add File: b.txt\n+b\n*** End Patch")
	if err != nil {
		t.Fatal(err)
	}
	var plans []patchFilePlan
	for _, fd := range parsed.files {
		p, err := buildPatchFilePlan(dir, fd)
		if err != nil {
			t.Fatal(err)
		}
		plans = append(plans, p)
	}
	writes := 0
	_, err = commitPatchPlans(t.Context(), dir, plans, func(path string, data []byte, mode fs.FileMode) error {
		writes++
		if writes == 2 {
			return errors.New("injected write failure")
		}
		return atomicWriteFile(path, data, mode)
	}, os.Remove)
	var failure *patchApplyError
	if !errors.As(err, &failure) || !failure.attempted || len(failure.completed) != 1 || writes != 2 {
		t.Fatalf("failure=%+v writes=%d", err, writes)
	}
	classified := patchToolError(failure)
	if classified.Code != aitools.ErrorCodePatchCommitFailed || classified.Retryable || classified.Meta["effect"] != "uncertain" {
		t.Fatalf("classification=%+v", classified)
	}
	result, err := floretToolResultFromFlower(&run{}, ToolResult{ToolID: "patch", ToolName: "apply_patch", Status: toolResultStatusError, Error: classified, effectUncertain: true})
	if err != nil {
		t.Fatal(err)
	}
	if result.EffectOutcome != fltools.EffectOutcomeUncertain || !strings.Contains(result.Text, "completed_files") || !strings.Contains(result.Text, "suggested_fixes") {
		t.Fatalf("result=%+v", result)
	}
	got, _ := os.ReadFile(filepath.Join(dir, "a.txt"))
	if string(got) != "a\n" {
		t.Fatalf("confirmed write=%q", got)
	}
	if _, err := os.Stat(filepath.Join(dir, "b.txt")); !os.IsNotExist(err) {
		t.Fatalf("unexpected b: %v", err)
	}
}

func TestPatchValidationAndCancellationHaveNoEffects(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	path := filepath.Join(dir, "f.txt")
	if err := os.WriteFile(path, []byte("old\n"), 0600); err != nil {
		t.Fatal(err)
	}
	parsed, _ := parsePatchText("*** Begin Patch\n*** Update File: f.txt\n@@\n-old\n+new\n*** End Patch")
	plan, err := buildPatchFilePlan(dir, parsed.files[0])
	if err != nil {
		t.Fatal(err)
	}
	for _, cancel := range []bool{false, true} {
		t.Run(map[bool]string{false: "stale", true: "canceled"}[cancel], func(t *testing.T) {
			content := "changed\n"
			if cancel {
				content = "old\n"
			}
			if err := os.WriteFile(path, []byte(content), 0600); err != nil {
				t.Fatal(err)
			}
			ctx, stop := context.WithCancel(t.Context())
			defer stop()
			if cancel {
				stop()
			}
			calls := 0
			_, err := commitPatchPlans(ctx, dir, []patchFilePlan{plan}, func(string, []byte, fs.FileMode) error { calls++; return nil }, os.Remove)
			var failure *patchApplyError
			if !errors.As(err, &failure) || failure.attempted || calls != 0 {
				t.Fatalf("failure=%+v calls=%d", err, calls)
			}
			if patchToolError(failure).Meta["effect"] != "none" {
				t.Fatal("no-effect failure mislabeled")
			}
		})
	}
}

func TestPatchModelOutputKeepsDiffInActivity(t *testing.T) {
	t.Parallel()
	result, err := floretToolResultFromFlower(&run{}, ToolResult{ToolID: "patch", ToolName: "apply_patch", Status: toolResultStatusSuccess, Data: ApplyPatchResult{
		FilesChanged: 1, InputFormat: "begin_patch", NormalizedFormat: "begin_patch", Files: []patchFileSummary{{Path: "/workspace/f.txt", Change: "modified"}},
		Mutations: []FileMutationResult{{FilePath: "/workspace/f.txt", DisplayName: "f.txt", ChangeType: "update", UnifiedDiff: "@@ -1 +1 @@\n-old\n+new\n"}},
	}})
	if err != nil {
		t.Fatal(err)
	}
	for _, field := range []string{"input_format", "normalized_format", "unified_diff", "mutations"} {
		if strings.Contains(result.Text, field) {
			t.Errorf("model payload echoes %s: %s", field, result.Text)
		}
	}
	if !strings.Contains(result.Text, "/workspace/f.txt") {
		t.Fatal("model lost confirmed path")
	}
	payload, ok := result.Activity.Payload.(fltools.PatchActivityPayload)
	if !ok || payload.Mutations == nil || len(*payload.Mutations) != 1 || (*payload.Mutations)[0].UnifiedDiff == "" || payload.InputFormat != "begin_patch" {
		t.Fatalf("activity lost diff: %+v", result.Activity)
	}
}

func TestPatchToolSchemaHasOnePatchInput(t *testing.T) {
	t.Parallel()
	var definition ToolDef
	for _, candidate := range builtInToolDefinitions() {
		if candidate.Name == "apply_patch" {
			definition = candidate
			break
		}
	}
	compiler := jsonschema.NewCompiler()
	if err := compiler.AddResource("patch.json", strings.NewReader(string(definition.InputSchema))); err != nil {
		t.Fatal(err)
	}
	schema, err := compiler.Compile("patch.json")
	if err != nil {
		t.Fatal(err)
	}
	patch := "*** Begin Patch\n*** Add File: f.txt\n+hello\n*** End Patch"
	if err := schema.Validate(map[string]any{"patch": patch}); err != nil {
		t.Fatal(err)
	}
	for _, args := range []map[string]any{{}, {"input": patch}, {"patch": patch, "input_format": "begin_patch"}, {"patch": patch, "input": patch}} {
		if err := schema.Validate(args); err == nil {
			t.Fatalf("accepted unsupported input: %+v", args)
		}
	}
	for _, want := range []string{"@@ context", "*** End of File", "JSON example"} {
		if !strings.Contains(string(definition.InputSchema), want) {
			t.Fatalf("missing guidance %q", want)
		}
	}
}

func TestPatchRenameDeleteFailureRemainsUncertain(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	source := filepath.Join(dir, "source.txt")
	if err := os.WriteFile(source, []byte("old\n"), 0600); err != nil {
		t.Fatal(err)
	}
	parsed, _ := parsePatchText("*** Begin Patch\n*** Update File: source.txt\n*** Move to: dest.txt\n@@\n-old\n+new\n*** End Patch")
	plan, err := buildPatchFilePlan(dir, parsed.files[0])
	if err != nil {
		t.Fatal(err)
	}
	_, err = commitPatchPlans(t.Context(), dir, []patchFilePlan{plan}, atomicWriteFile, func(string) error { return errors.New("injected remove failure") })
	var failure *patchApplyError
	if !errors.As(err, &failure) || !failure.attempted {
		t.Fatalf("failure=%v", err)
	}
	got, _ := os.ReadFile(filepath.Join(dir, "dest.txt"))
	if string(got) != "new\n" {
		t.Fatalf("destination=%q", got)
	}
	got, _ = os.ReadFile(source)
	if string(got) != "old\n" {
		t.Fatalf("source=%q", got)
	}
}
