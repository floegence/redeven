package ai

import (
	"encoding/base64"
	fltools "github.com/floegence/floret/v7/tools"
)

// activityPayloadMap converts the closed upstream display contract without encoding.
// Field-level public policy remains owned by sanitizeActivityPayloadValue.
func activityPayloadMap(payload fltools.ActivityPayload) map[string]any {
	switch value := payload.(type) {
	case fltools.StructuredActivityPayload:
		return activityPayloadStructuredMap(value)
	case *fltools.StructuredActivityPayload:
		if value != nil {
			return activityPayloadStructuredMap(*value)
		}
	case fltools.TerminalActivityPayload:
		return activityPayloadTerminalMap(value)
	case *fltools.TerminalActivityPayload:
		if value != nil {
			return activityPayloadTerminalMap(*value)
		}
	case fltools.FileActivityPayload:
		return activityPayloadFileMap(value)
	case *fltools.FileActivityPayload:
		if value != nil {
			return activityPayloadFileMap(*value)
		}
	case fltools.PatchActivityPayload:
		return activityPayloadPatchMap(value)
	case *fltools.PatchActivityPayload:
		if value != nil {
			return activityPayloadPatchMap(*value)
		}
	case fltools.WebSearchActivityPayload:
		return activityPayloadWebSearchMap(value)
	case *fltools.WebSearchActivityPayload:
		if value != nil {
			return activityPayloadWebSearchMap(*value)
		}
	case fltools.WebFetchActivityPayload:
		return activityPayloadWebFetchMap(value)
	case *fltools.WebFetchActivityPayload:
		if value != nil {
			return activityPayloadWebFetchMap(*value)
		}
	case fltools.TodosActivityPayload:
		return activityPayloadTodosMap(value)
	case *fltools.TodosActivityPayload:
		if value != nil {
			return activityPayloadTodosMap(*value)
		}
	case fltools.QuestionActivityPayload:
		return activityPayloadQuestionMap(value)
	case *fltools.QuestionActivityPayload:
		if value != nil {
			return activityPayloadQuestionMap(*value)
		}
	case fltools.CompletionActivityPayload:
		return activityPayloadCompletionMap(value)
	case *fltools.CompletionActivityPayload:
		if value != nil {
			return activityPayloadCompletionMap(*value)
		}
	case fltools.SubAgentActivityPayload:
		return activityPayloadSubAgentMap(value)
	case *fltools.SubAgentActivityPayload:
		if value != nil {
			return activityPayloadSubAgentMap(*value)
		}
	case fltools.SubAgentOperationActivityPayload:
		return activityPayloadSubAgentOperationMap(value)
	case *fltools.SubAgentOperationActivityPayload:
		if value != nil {
			return activityPayloadSubAgentOperationMap(*value)
		}
	}
	return nil
}

func activityPayloadActivityErrorMap(value fltools.ActivityError) map[string]any {
	out := make(map[string]any)
	out["message"] = value.Message
	return out
}

func activityPayloadActivityTargetRefMap(value fltools.ActivityTargetRef) map[string]any {
	out := make(map[string]any)
	out["kind"] = value.Kind
	out["label"] = value.Label
	if value.URI != "" {
		out["uri"] = value.URI
	}
	if value.ResourceRef != "" {
		out["resource_ref"] = value.ResourceRef
	}
	if value.Path != "" {
		out["path"] = value.Path
	}
	if value.Line != 0 {
		out["line"] = value.Line
	}
	return out
}

func activityPayloadCompletionMap(value fltools.CompletionActivityPayload) map[string]any {
	out := make(map[string]any)
	if value.Status != "" {
		out["status"] = value.Status
	}
	if value.Summary != "" {
		out["summary"] = value.Summary
	}
	return out
}

func activityPayloadFileMap(value fltools.FileActivityPayload) map[string]any {
	out := make(map[string]any)
	if value.Path != "" {
		out["path"] = value.Path
	}
	if value.Operation != "" {
		out["operation"] = value.Operation
	}
	if value.Status != "" {
		out["status"] = value.Status
	}
	if value.Summary != "" {
		out["summary"] = value.Summary
	}
	if value.SizeBytes != 0 {
		out["size_bytes"] = value.SizeBytes
	}
	if value.DisplayName != "" {
		out["display_name"] = value.DisplayName
	}
	if value.Content != "" {
		out["content"] = value.Content
	}
	if value.LineOffset != 0 {
		out["line_offset"] = value.LineOffset
	}
	if value.LineCount != 0 {
		out["line_count"] = value.LineCount
	}
	if value.TotalLines != 0 {
		out["total_lines"] = value.TotalLines
	}
	if value.ChangeType != "" {
		out["change_type"] = value.ChangeType
	}
	if value.Additions != 0 {
		out["additions"] = value.Additions
	}
	if value.Deletions != 0 {
		out["deletions"] = value.Deletions
	}
	if value.UnifiedDiff != "" {
		out["unified_diff"] = value.UnifiedDiff
	}
	if value.DiffUnavailableReason != "" {
		out["diff_unavailable_reason"] = value.DiffUnavailableReason
	}
	if value.Truncated {
		out["truncated"] = value.Truncated
	}
	if value.Error != nil {
		out["error"] = activityPayloadActivityErrorMap(*value.Error)
	}
	return out
}

func activityPayloadFileMutationActivityPayloadMap(value fltools.FileMutationActivityPayload) map[string]any {
	out := make(map[string]any)
	if value.Target != nil {
		out["target"] = activityPayloadActivityTargetRefMap(*value.Target)
	}
	if value.DisplayName != "" {
		out["display_name"] = value.DisplayName
	}
	if value.ChangeType != "" {
		out["change_type"] = value.ChangeType
	}
	if value.Additions != 0 {
		out["additions"] = value.Additions
	}
	if value.Deletions != 0 {
		out["deletions"] = value.Deletions
	}
	if value.UnifiedDiff != "" {
		out["unified_diff"] = value.UnifiedDiff
	}
	if value.DiffUnavailableReason != "" {
		out["diff_unavailable_reason"] = value.DiffUnavailableReason
	}
	if value.Truncated {
		out["truncated"] = value.Truncated
	}
	return out
}

func activityPayloadGoalActivityMap(value fltools.GoalActivity) map[string]any {
	out := make(map[string]any)
	if value.Applied {
		out["applied"] = value.Applied
	}
	out["operation"] = value.Operation
	out["version"] = value.Version
	if value.Text != "" {
		out["text"] = value.Text
	}
	if value.Outcome != "" {
		out["outcome"] = value.Outcome
	}
	if value.Evidence != "" {
		out["evidence"] = value.Evidence
	}
	return out
}

func activityPayloadPatchMap(value fltools.PatchActivityPayload) map[string]any {
	out := make(map[string]any)
	if value.Path != "" {
		out["path"] = value.Path
	}
	if value.Diff != "" {
		out["diff"] = value.Diff
	}
	if value.Status != "" {
		out["status"] = value.Status
	}
	if value.Summary != "" {
		out["summary"] = value.Summary
	}
	if value.FilesChanged != 0 {
		out["files_changed"] = value.FilesChanged
	}
	if value.Hunks != 0 {
		out["hunks"] = value.Hunks
	}
	if value.Additions != 0 {
		out["additions"] = value.Additions
	}
	if value.Deletions != 0 {
		out["deletions"] = value.Deletions
	}
	if value.InputFormat != "" {
		out["input_format"] = value.InputFormat
	}
	if value.NormalizedFormat != "" {
		out["normalized_format"] = value.NormalizedFormat
	}
	if value.Mutations != nil {
		items := make([]any, 0, len(*value.Mutations))
		for _, item := range *value.Mutations {
			items = append(items, activityPayloadFileMutationActivityPayloadMap(item))
		}
		out["mutations"] = items
	}
	if value.Truncated {
		out["truncated"] = value.Truncated
	}
	if value.Error != nil {
		out["error"] = activityPayloadActivityErrorMap(*value.Error)
	}
	return out
}

func activityPayloadQuestionActivityAnswerMap(value fltools.QuestionActivityAnswer) map[string]any {
	out := make(map[string]any)
	out["question_id"] = value.QuestionID
	if len(value.Values) > 0 {
		items := make([]any, 0, len(value.Values))
		for _, item := range value.Values {
			items = append(items, item)
		}
		out["values"] = items
	}
	if value.Redacted {
		out["redacted"] = value.Redacted
	}
	return out
}

func activityPayloadQuestionActivityItemMap(value fltools.QuestionActivityItem) map[string]any {
	out := make(map[string]any)
	out["id"] = value.ID
	out["question"] = value.Question
	if len(value.Options) > 0 {
		items := make([]any, 0, len(value.Options))
		for _, item := range value.Options {
			items = append(items, activityPayloadQuestionActivityOptionMap(item))
		}
		out["options"] = items
	}
	return out
}

func activityPayloadQuestionActivityOptionMap(value fltools.QuestionActivityOption) map[string]any {
	out := make(map[string]any)
	out["label"] = value.Label
	if value.Description != "" {
		out["description"] = value.Description
	}
	return out
}

func activityPayloadQuestionMap(value fltools.QuestionActivityPayload) map[string]any {
	out := make(map[string]any)
	if value.PromptID != "" {
		out["prompt_id"] = value.PromptID
	}
	if len(value.Questions) > 0 {
		items := make([]any, 0, len(value.Questions))
		for _, item := range value.Questions {
			items = append(items, activityPayloadQuestionActivityItemMap(item))
		}
		out["questions"] = items
	}
	if len(value.Answers) > 0 {
		items := make([]any, 0, len(value.Answers))
		for _, item := range value.Answers {
			items = append(items, activityPayloadQuestionActivityAnswerMap(item))
		}
		out["answers"] = items
	}
	return out
}

func activityPayloadStructuredMap(value fltools.StructuredActivityPayload) map[string]any {
	out := make(map[string]any)
	if value.Goal != nil {
		out["goal"] = activityPayloadGoalActivityMap(*value.Goal)
	}
	if value.Status != "" {
		out["status"] = value.Status
	}
	if value.Operation != "" {
		out["operation"] = value.Operation
	}
	if value.DisplayName != "" {
		out["display_name"] = value.DisplayName
	}
	if value.Summary != "" {
		out["summary"] = value.Summary
	}
	if value.DurationMS != 0 {
		out["duration_ms"] = value.DurationMS
	}
	if value.Error != nil {
		out["error"] = activityPayloadActivityErrorMap(*value.Error)
	}
	if len(value.Rows) > 0 {
		items := make([]any, 0, len(value.Rows))
		for _, item := range value.Rows {
			items = append(items, activityPayloadStructuredActivityRowMap(item))
		}
		out["rows"] = items
	}
	if len(value.Inputs) > 0 {
		items := make([]any, 0, len(value.Inputs))
		for _, item := range value.Inputs {
			items = append(items, activityPayloadStructuredActivityRowMap(item))
		}
		out["inputs"] = items
	}
	if value.RowsProvided {
		out["rows_provided"] = value.RowsProvided
	}
	return out
}

func activityPayloadStructuredActivityRowMap(value fltools.StructuredActivityRow) map[string]any {
	out := make(map[string]any)
	if value.Target != nil {
		out["target"] = activityPayloadActivityTargetRefMap(*value.Target)
	}
	if value.Title != "" {
		out["title"] = value.Title
	}
	if value.Meta != "" {
		out["meta"] = value.Meta
	}
	if value.Content != "" {
		out["content"] = value.Content
	}
	if value.Format != "" {
		out["format"] = string(value.Format)
	}
	if value.Language != "" {
		out["language"] = value.Language
	}
	if value.Truncated {
		out["truncated"] = value.Truncated
	}
	return out
}

func activityPayloadSubAgentMap(value fltools.SubAgentActivityPayload) map[string]any {
	out := make(map[string]any)
	out["thread_id"] = string(value.ThreadID)
	if value.Path != "" {
		out["path"] = value.Path
	}
	if value.TaskName != "" {
		out["task_name"] = value.TaskName
	}
	if value.TaskDescription != "" {
		out["task_description"] = value.TaskDescription
	}
	if value.Title != "" {
		out["title"] = value.Title
	}
	if value.HostProfileRef != "" {
		out["host_profile_ref"] = value.HostProfileRef
	}
	if value.ForkMode != "" {
		out["fork_mode"] = value.ForkMode
	}
	out["status"] = value.Status
	if value.LastMessage != "" {
		out["last_message"] = value.LastMessage
	}
	if value.WaitingPrompt != "" {
		out["waiting_prompt"] = value.WaitingPrompt
	}
	if value.QueuedInputs != 0 {
		out["queued_inputs"] = value.QueuedInputs
	}
	out["parent_thread_id"] = string(value.ParentThreadID)
	if value.ParentTurnID != "" {
		out["parent_turn_id"] = string(value.ParentTurnID)
	}
	if value.LatestTurnID != "" {
		out["latest_turn_id"] = string(value.LatestTurnID)
	}
	if value.CreatedAtUnixMS != 0 {
		out["created_at_unix_ms"] = value.CreatedAtUnixMS
	}
	if value.UpdatedAtUnixMS != 0 {
		out["updated_at_unix_ms"] = value.UpdatedAtUnixMS
	}
	if value.Closed {
		out["closed"] = value.Closed
	}
	out["can_send_input"] = value.CanSendInput
	out["can_interrupt"] = value.CanInterrupt
	out["can_close"] = value.CanClose
	return out
}

func activityPayloadSubAgentOperationMap(value fltools.SubAgentOperationActivityPayload) map[string]any {
	out := make(map[string]any)
	out["action"] = string(value.Action)
	if value.Status != "" {
		out["status"] = value.Status
	}
	if len(value.Targets) > 0 {
		items := make([]any, 0, len(value.Targets))
		for _, item := range value.Targets {
			items = append(items, activityPayloadSubAgentOperationTargetMap(item))
		}
		out["targets"] = items
	}
	if value.RequestedCount != 0 {
		out["requested_count"] = value.RequestedCount
	}
	if value.CompletedCount != 0 {
		out["completed_count"] = value.CompletedCount
	}
	if value.MissingCount != 0 {
		out["missing_count"] = value.MissingCount
	}
	if value.TimedOut {
		out["timed_out"] = value.TimedOut
	}
	if value.Error != nil {
		out["error"] = activityPayloadActivityErrorMap(*value.Error)
	}
	return out
}

func activityPayloadSubAgentOperationTargetMap(value fltools.SubAgentOperationTarget) map[string]any {
	out := make(map[string]any)
	if value.ThreadID != "" {
		out["thread_id"] = string(value.ThreadID)
	}
	if value.TaskName != "" {
		out["task_name"] = value.TaskName
	}
	if value.TaskDescription != "" {
		out["task_description"] = value.TaskDescription
	}
	if value.Status != "" {
		out["status"] = value.Status
	}
	return out
}

func activityPayloadTerminalMap(value fltools.TerminalActivityPayload) map[string]any {
	out := make(map[string]any)
	if value.Operation != "" {
		out["operation"] = value.Operation
	}
	if value.Command != "" {
		out["command"] = value.Command
	}
	if value.Status != "" {
		out["status"] = value.Status
	}
	if value.ProcessID != "" {
		out["process_id"] = value.ProcessID
	}
	if value.InputBytes != 0 {
		out["input_bytes"] = value.InputBytes
	}
	if value.LatestOutput != "" {
		out["latest_output"] = value.LatestOutput
	}
	if value.Output != "" {
		out["output"] = value.Output
	}
	if value.Stdout != "" {
		out["stdout"] = value.Stdout
	}
	if value.Stderr != "" {
		out["stderr"] = value.Stderr
	}
	if value.ExitCode != nil {
		out["exit_code"] = *value.ExitCode
	}
	if value.DurationMS != 0 {
		out["duration_ms"] = value.DurationMS
	}
	if value.FirstSeq != 0 {
		out["first_seq"] = value.FirstSeq
	}
	if value.LastSeq != 0 {
		out["last_seq"] = value.LastSeq
	}
	if value.LatestSeq != 0 {
		out["latest_seq"] = value.LatestSeq
	}
	if value.HasMore {
		out["has_more"] = value.HasMore
	}
	if value.TotalBytes != 0 {
		out["total_bytes"] = value.TotalBytes
	}
	if value.ExecutionLocation != "" {
		out["execution_location"] = value.ExecutionLocation
	}
	if value.Truncated {
		out["truncated"] = value.Truncated
	}
	if value.PendingResult != "" {
		out["pending_result"] = value.PendingResult
	}
	if value.Terminated {
		out["terminated"] = value.Terminated
	}
	if value.TimedOut {
		out["timed_out"] = value.TimedOut
	}
	if value.Error != nil {
		out["error"] = activityPayloadActivityErrorMap(*value.Error)
	}
	return out
}

func activityPayloadTodoActivityItemMap(value fltools.TodoActivityItem) map[string]any {
	out := make(map[string]any)
	out["text"] = value.Text
	out["status"] = value.Status
	return out
}

func activityPayloadTodosMap(value fltools.TodosActivityPayload) map[string]any {
	out := make(map[string]any)
	if value.Operation != "" {
		out["operation"] = value.Operation
	}
	if len(value.Items) > 0 {
		items := make([]any, 0, len(value.Items))
		for _, item := range value.Items {
			items = append(items, activityPayloadTodoActivityItemMap(item))
		}
		out["items"] = items
	}
	return out
}

func activityPayloadWebFetchActivityIconMap(value fltools.WebFetchActivityIcon) map[string]any {
	out := make(map[string]any)
	out["content_type"] = value.ContentType
	if len(value.Data) > 0 {
		out["data"] = base64.StdEncoding.EncodeToString(value.Data)
	}
	return out
}

func activityPayloadWebFetchMap(value fltools.WebFetchActivityPayload) map[string]any {
	out := make(map[string]any)
	if value.URL != "" {
		out["url"] = value.URL
	}
	if value.FinalURL != "" {
		out["final_url"] = value.FinalURL
	}
	if value.Status != "" {
		out["status"] = value.Status
	}
	if value.StatusCode != 0 {
		out["status_code"] = value.StatusCode
	}
	if value.ContentType != "" {
		out["content_type"] = value.ContentType
	}
	if value.Format != "" {
		out["format"] = value.Format
	}
	if value.ContentPreview != "" {
		out["content_preview"] = value.ContentPreview
	}
	if value.PreviewTruncated {
		out["preview_truncated"] = value.PreviewTruncated
	}
	if value.SiteIcon != nil {
		out["site_icon"] = activityPayloadWebFetchActivityIconMap(*value.SiteIcon)
	}
	if value.BytesRead != 0 {
		out["bytes_read"] = value.BytesRead
	}
	if value.Truncated {
		out["truncated"] = value.Truncated
	}
	if value.Error != nil {
		out["error"] = activityPayloadActivityErrorMap(*value.Error)
	}
	return out
}

func activityPayloadWebSearchMap(value fltools.WebSearchActivityPayload) map[string]any {
	out := make(map[string]any)
	if value.Operation != "" {
		out["operation"] = value.Operation
	}
	if value.URL != "" {
		out["url"] = value.URL
	}
	if value.Pattern != "" {
		out["pattern"] = value.Pattern
	}
	if value.ResultsProvided {
		out["results_provided"] = value.ResultsProvided
	}
	if value.Query != "" {
		out["query"] = value.Query
	}
	if value.Status != "" {
		out["status"] = value.Status
	}
	if len(value.Results) > 0 {
		items := make([]any, 0, len(value.Results))
		for _, item := range value.Results {
			items = append(items, activityPayloadWebSearchActivityResultMap(item))
		}
		out["results"] = items
	}
	if value.Error != nil {
		out["error"] = activityPayloadActivityErrorMap(*value.Error)
	}
	return out
}

func activityPayloadWebSearchActivityResultMap(value fltools.WebSearchActivityResult) map[string]any {
	out := make(map[string]any)
	if value.Snippet != "" {
		out["snippet"] = value.Snippet
	}
	out["title"] = value.Title
	out["url"] = value.URL
	return out
}
