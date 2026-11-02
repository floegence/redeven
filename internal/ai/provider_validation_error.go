package ai

// These codes describe checks owned by the adapter. Only reviewed, constant
// messages cross the diagnostic boundary; the private cause remains available
// through Unwrap without changing its retry or cancellation classification.
type providerValidationCode string

const (
	responseOutputLimit              providerValidationCode = "response_output_limit_exceeded"
	responseOutputInvalid            providerValidationCode = "response_output_invalid"
	responseOutputConflict           providerValidationCode = "response_output_conflict"
	responseOutputMissing            providerValidationCode = "response_output_missing"
	responseSnapshotIncomplete       providerValidationCode = "response_snapshot_incomplete"
	responseOutputIndexMissing       providerValidationCode = "response_output_index_missing"
	responseToolNamespaceInvalid     providerValidationCode = "response_tool_namespace_invalid"
	responseToolArgumentsConflict    providerValidationCode = "response_tool_arguments_conflict"
	responseUsageInvalid             providerValidationCode = "response_usage_invalid"
	responseUsageCacheConflict       providerValidationCode = "response_usage_cache_conflict"
	responseUsageNegative            providerValidationCode = "response_usage_negative"
	responseUsageCacheExceedsInput   providerValidationCode = "response_usage_cache_exceeds_input"
	responseUsageOverflow            providerValidationCode = "response_usage_overflow"
	responseHistoryPreparationFailed providerValidationCode = "response_history_preparation_failed"
	responseHistoryCommitFailed      providerValidationCode = "response_history_commit_failed"
)

type providerValidationError struct {
	code        providerValidationCode
	cause       error
	outputIndex *int64
}

func (e *providerValidationError) diagnostic(providerType string) providerFailureDiagnostic {
	d := providerFailureDiagnostic{Provider: providerType, Code: string(e.code), Stage: "response_validation", Shape: "local_validation", OutputIndex: e.outputIndex}
	switch e.code {
	case responseOutputLimit:
		d.Message = "Response output exceeds the conversation context state limit."
	case responseOutputInvalid:
		d.Message = "Invalid completed response output item."
	case responseOutputConflict:
		d.Message = "Conflicting completed response output item."
	case responseOutputMissing:
		d.Message = "The provider response is missing native output."
	case responseSnapshotIncomplete:
		d.Message = "The completed response snapshot omits previously received output items."
	case responseOutputIndexMissing:
		d.Message = "The completed response has a gap in its output item indexes."
	case responseToolNamespaceInvalid:
		d.Message = "The provider returned an unexpected tool namespace."
	case responseToolArgumentsConflict:
		d.Message = "Completed tool arguments conflict with the streamed arguments."
	case responseUsageInvalid:
		d.Stage, d.Message = "usage_validation", "The provider returned invalid token usage details."
	case responseUsageCacheConflict:
		d.Stage, d.Message = "usage_validation", "The provider returned conflicting cache-read token counts."
	case responseUsageNegative:
		d.Stage, d.Message = "usage_validation", "The provider returned negative token counts."
	case responseUsageCacheExceedsInput:
		d.Stage, d.Message = "usage_validation", "Provider cached tokens exceed total input tokens."
	case responseUsageOverflow:
		d.Stage, d.Message = "usage_validation", "The provider token usage total exceeds the supported integer range."
	case responseHistoryPreparationFailed:
		d.Stage, d.Message = "history_preparation", "Could not prepare native provider conversation history."
	case responseHistoryCommitFailed:
		d.Stage, d.Message = "history_commit", "Could not retain the provider response for conversation continuation."
	default:
		d.Code, d.Message = "response_validation_failed", "The provider response failed local validation."
	}
	return d
}

func (e *providerValidationError) Error() string { return e.diagnostic("unknown").Message }
func (e *providerValidationError) Unwrap() error { return e.cause }
