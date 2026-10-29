package tools

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"testing"
)

type orchestratorInvalidArgsError struct{}

func (orchestratorInvalidArgsError) Error() string {
	return "invalid arguments: inspect requires target or ids"
}

func (orchestratorInvalidArgsError) InvalidArgumentsCode() string {
	return "invalid_arguments.subagents.inspect_requires_target_or_ids"
}

func (orchestratorInvalidArgsError) InvalidArgumentsMeta() map[string]any {
	return map[string]any{"action": "inspect"}
}

func TestClassifyErrorUnknownWordingDoesNotInventAuthority(t *testing.T) {
	for _, message := range []string{"process not found", "old text not found", "attachment not found", "permission denied by quoted document", "invalid cwd", "path must be absolute", "command timed out", "missing web search api key", "new unexpected condition"} {
		t.Run(message, func(t *testing.T) {
			failure := ClassifyError(errors.New(message))
			if failure.Code != ErrorCodeUnknown || failure.Message != message || failure.Retryable || len(failure.SuggestedFixes) != 0 || len(failure.Meta) != 0 {
				t.Fatalf("invented facts: %+v", failure)
			}
		})
	}
}

func TestClassifyErrorWrappedSourceFacts(t *testing.T) {
	for _, tc := range []struct {
		err  error
		code ErrorCode
	}{{os.ErrNotExist, ErrorCodeNotFound}, {os.ErrPermission, ErrorCodePermissionDenied}, {context.Canceled, ErrorCodeCanceled}, {context.DeadlineExceeded, ErrorCodeTimeout}} {
		failure := ClassifyError(fmt.Errorf("source: %w", tc.err))
		if failure.Code != tc.code || failure.Retryable {
			t.Fatalf("lost source classification: %+v", failure)
		}
	}
}

func TestClassifyError_InvalidArguments(t *testing.T) {
	t.Parallel()

	toolErr := ClassifyError(orchestratorInvalidArgsError{})
	if toolErr == nil {
		t.Fatalf("expected tool error")
	}
	if toolErr.Code != ErrorCodeInvalidArguments {
		t.Fatalf("code=%q, want=%q", toolErr.Code, ErrorCodeInvalidArguments)
	}
	if toolErr.Retryable {
		t.Fatalf("retryable=true, want false")
	}
	if got := toolErr.Meta["validation_error_code"]; got != "invalid_arguments.subagents.inspect_requires_target_or_ids" {
		t.Fatalf("validation_error_code=%v, want inspect contract code", got)
	}
}

func TestClassifyErrorDoesNotAuthorizeUnknownEffectReplay(t *testing.T) {
	for _, err := range []error{context.DeadlineExceeded, errors.New("command timed out"), errors.New("permission denied")} {
		classified := ClassifyError(err)
		if classified.Retryable {
			t.Fatalf("%v must not imply that dispatch is safe to replay", err)
		}
		advice := strings.Join(classified.SuggestedFixes, " ")
		if strings.Contains(advice, "switch to") || strings.Contains(advice, "Increase timeout") {
			t.Fatalf("unsafe recovery advice for %v: %s", err, advice)
		}
	}
}

func TestClassifyErrorPreservesTypedOwnerMetadataAndBoundsUnknownText(t *testing.T) {
	source := &ToolError{Code: ErrorCodeInvalidPath, Message: "owner validation", Meta: map[string]any{"field": "cwd"}}
	got := ClassifyError(fmt.Errorf("wrapped: %w", source))
	if got.Code != source.Code || got.Message != source.Message || got.Meta["field"] != "cwd" || got.Retryable {
		t.Fatalf("lost owner facts: %+v", got)
	}
	unknown := ClassifyError(errors.New(strings.Repeat("x", 5000) + "\x00\n"))
	if len(unknown.Message) > 4099 || strings.ContainsAny(unknown.Message, "\x00\n") || !strings.HasSuffix(unknown.Message, "...") {
		t.Fatalf("unbounded diagnostic: %d", len(unknown.Message))
	}
}
