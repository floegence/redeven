package ai

import "strings"

// These codes describe adapter and upstream output checks. Only reviewed, safe
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
	code         providerValidationCode
	cause        error
	outputIndex  *int64
	outputFields []string
	outputDetail *responsesOutputDiagnostic
}

func (e *providerValidationError) diagnostic(providerType string) providerFailureDiagnostic {
	d := providerFailureDiagnostic{Provider: providerType, Code: string(e.code), Stage: "response_validation", Shape: "local_validation", OutputIndex: e.outputIndex, OutputFields: e.outputFields, OutputDetail: e.outputDetail}
	switch e.code {
	case responseOutputLimit:
		d.Message = "Response output exceeds the conversation context state limit."
	case responseOutputInvalid:
		d.Message = "Invalid completed response output item."
	case responseOutputConflict:
		d.Message = "Conflicting completed response output item."
		if e.outputDetail != nil && e.outputDetail.CurrentEvent == "terminal_snapshot" {
			d.Message = "Response content was received, but final verification failed."
		}
		if e.outputDetail != nil {
			if detail := e.outputDetail.sanitized(); detail != nil && len(detail.Paths) > 0 {
				d.Message += " Conflicting paths: " + strings.Join(detail.Paths, ", ") + "."
				return d
			}
		}
		if fields := safeOutputConflictFields(e.outputFields); len(fields) > 0 {
			d.Message += " Conflicting fields: " + strings.Join(fields, ", ") + "."
		}
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
		d.Stage, d.Message = "history_preparation", "Conversation history failed local validation before a model request could be sent. Existing messages are retained."
	case responseHistoryCommitFailed:
		d.Stage, d.Message = "history_commit", "The model responded, but its history could not be retained for continuation. Existing messages are retained."
	default:
		d.Code, d.Message = "response_validation_failed", "The provider response failed local validation."
	}
	if e.code == responseHistoryPreparationFailed || e.code == responseHistoryCommitFailed {
		d.HistoryDetail = responsesHistoryFailureDetail(e.cause)
	}
	return d
}

func (e *providerValidationError) Error() string { return e.diagnostic("unknown").Message }
func (e *providerValidationError) Unwrap() error { return e.cause }
