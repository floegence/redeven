package ai

import (
	"context"
	"errors"
	"fmt"
	"slices"

	fltools "github.com/floegence/floret/v7/tools"
	aitools "github.com/floegence/redeven/internal/ai/tools"
	"github.com/floegence/redeven/internal/filesystemscope"
)

type authorizedPatchResourcesKey struct{}

func (r *run) resolveToolPatch(text string) (parsedPatch, error) {
	parsed, err := parsePatchText(text)
	if err != nil {
		return parsedPatch{}, &patchApplyError{cause: err}
	}
	scope, err := r.runPathScope()
	if err != nil {
		return parsedPatch{}, &patchApplyError{cause: err}
	}
	files, err := resolvePatchFiles(scope.WorkingDirAbs, parsed.files)
	if err != nil {
		return parsedPatch{}, &patchApplyError{cause: err}
	}
	for _, ref := range resourceRefsFromPatchFiles(files) {
		resolved, err := scope.Registry.ResolveTarget(ref.Value, filesystemscope.ResolveOptions{ForWrite: true})
		if err != nil {
			return parsedPatch{}, &patchApplyError{cause: err}
		}
		if resolved.RealAbs != ref.Value {
			return parsedPatch{}, &patchApplyError{cause: fmt.Errorf("patch target changed during resolution: %s", ref.Value)}
		}
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
	slices.Sort(want)
	slices.Sort(got)
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
	if errors.Is(failure.cause, filesystemscope.ErrWriteDenied) {
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
