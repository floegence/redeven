package ai

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"

	fltools "github.com/floegence/floret/v7/tools"
	aitools "github.com/floegence/redeven/internal/ai/tools"
	"github.com/floegence/redeven/internal/filesystemscope"
)

type authorizedPatchResourcesKey struct{}

// Failed patches expose only confirmed mutations, never the original plan.
func confirmedPatchResult(parsed parsedPatch) ApplyPatchResult {
	result := ApplyPatchResult{InputFormat: string(parsed.inputFormat), NormalizedFormat: string(parsed.normalizedFormat), Mutations: parsed.mutations}
	for _, mutation := range parsed.mutations {
		change := map[string]string{"create": "added", "update": "modified", "delete": "deleted", "rename": "renamed"}[mutation.ChangeType]
		hunks := strings.Count(mutation.UnifiedDiff, "\n@@ ")
		result.Files = append(result.Files, patchFileSummary{Path: mutation.FilePath, OldPath: mutation.OldPath, NewPath: mutation.NewPath, Change: change, Hunks: hunks, Additions: mutation.Additions, Deletions: mutation.Deletions})
		result.Hunks += hunks
		result.Additions += mutation.Additions
		result.Deletions += mutation.Deletions
	}
	result.FilesChanged = len(result.Files)
	return result
}

func (r *run) resolveToolPatch(text string) (parsedPatch, error) {
	parsed, err := parsePatchText(text)
	if err != nil {
		return parsedPatch{}, &patchApplyError{cause: err}
	}
	scope, err := r.runPathScope()
	if err != nil {
		return parsedPatch{}, &patchApplyError{cause: err}
	}
	files, err := resolvePatchFiles(scope, parsed.files)
	if err != nil {
		return parsedPatch{}, &patchApplyError{cause: err}
	}
	parsed.files = files
	return parsed, nil
}

func (r *run) patchToolResources(text string) ([]fltools.ResourceRef, error) {
	parsed, err := r.resolveToolPatch(text)
	if err != nil {
		return nil, err
	}
	return resourceRefsFromPatchFiles(parsed.files), nil
}

func validateAuthorizedPatchResources(ctx context.Context, parsed parsedPatch) error {
	authorized, ok := ctx.Value(authorizedPatchResourcesKey{}).([]fltools.ResourceRef)
	if !ok {
		return nil
	} // Direct local helper calls have no Floret approval boundary.
	actual := resourceRefsFromPatchFiles(parsed.files)
	key := func(ref fltools.ResourceRef) string { return ref.Kind + ":" + ref.Value }
	want, got := make([]string, len(authorized)), make([]string, len(actual))
	for i, ref := range authorized {
		want[i] = key(ref)
	}
	for i, ref := range actual {
		got[i] = key(ref)
	}
	// Order binds operations to approved targets, including swapped symlinks.
	if !slices.Equal(want, got) {
		return &patchApplyError{cause: fmt.Errorf("patch targets changed after authorization; inspect the current paths and submit a new patch")}
	}
	return nil
}

func patchToolError(failure *patchApplyError) *aitools.ToolError {
	if failure.attempted {
		return &aitools.ToolError{Code: aitools.ErrorCodePatchCommitFailed, Message: failure.Error(), Retryable: false,
			Meta:           map[string]any{"effect": "uncertain", "completed_files": failure.completed, "file": failure.path},
			SuggestedFixes: []string{"Inspect the affected files and confirmed completed operations before preparing a new edit. Do not replay this patch."}}
	}
	classified := aitools.ClassifyError(aitools.Invocation{ToolName: "apply_patch"}, failure.cause)
	if classified.Code == aitools.ErrorCodeUnknown || classified.Code == aitools.ErrorCodeNotFound {
		classified.Code = aitools.ErrorCodePatchValidationFailed
	}
	if errors.Is(failure.cause, filesystemscope.ErrWriteDenied) || errors.Is(failure.cause, filesystemscope.ErrReadDenied) || errors.Is(failure.cause, filesystemscope.ErrPathOutsideScope) {
		classified.Code = aitools.ErrorCodePermissionDenied
	}
	classified.Message = failure.Error()
	classified.Retryable = false
	classified.Meta = map[string]any{"effect": "none"}
	classified.SuggestedFixes = []string{"Read the reported file or directory, correct the patch using its current content and permitted path, then submit a new call."}
	var diagnostic *patchDiagnostic
	if errors.As(failure.cause, &diagnostic) {
		classified.Meta["reason"] = diagnostic.reason
		if diagnostic.chunk > 0 {
			classified.Meta["chunk"] = diagnostic.chunk
			classified.Meta["patch_body_line"] = diagnostic.patchLine
			classified.Meta["search_from_line"] = diagnostic.searchLine
		}
		if diagnostic.sourceLine > 0 {
			classified.Meta["source_line"] = diagnostic.sourceLine
		}
		classified.SuggestedFixes = []string{diagnostic.fix}
	}
	if classified.Code == aitools.ErrorCodePermissionDenied {
		classified.SuggestedFixes = []string{"The target is not writable under the current permissions; report the denied operation to the user."}
	}
	return classified
}
