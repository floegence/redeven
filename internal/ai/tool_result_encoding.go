package ai

import (
	"encoding/json"
	"errors"
	"fmt"

	fltools "github.com/floegence/floret/v7/tools"
	aitools "github.com/floegence/redeven/internal/ai/tools"
)

const (
	computerResultMaxBytes     = 1 << 20
	computerResultArchiveBytes = 64 << 10
)

// Execution owns these facts. Arbitrary result data and presentation cannot
// establish effect completion or authorize a target.
type toolExecutionFacts struct {
	callID            string
	toolName          string
	targetID          string
	completed         bool
	potentialMutation bool
	completedActions  []string
	needsObservation  bool
}

type encodedModelToolResult struct {
	result        ToolResult
	text          []byte
	structured    map[string]any
	inputRequired *fltools.InputRequest
}

var errComputerResultTooLarge = errors.New("computer result exceeds final JSON envelope limit")

func encodeToolResultEnvelope(result ToolResult) ([]byte, map[string]any, error) {
	payload, err := modelToolResultPayload(result)
	if err != nil {
		return nil, nil, err
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return nil, nil, err
	}
	if isComputerUseTool(result.ToolName) && len(raw) > computerResultMaxBytes {
		return nil, nil, errComputerResultTooLarge
	}
	value, err := decodeToolJSON(raw)
	if err != nil {
		return nil, nil, err
	}
	return raw, value.(map[string]any), nil
}

// One final encoder supplies both model text and an independent, exact snapshot.
// A failed projection is settled from execution facts, never from damaged data.
func encodeModelToolResult(result ToolResult) (encodedModelToolResult, error) {
	if result.Pending == nil {
		status, err := validateToolResultStatus(result.Status)
		if err != nil {
			return encodedModelToolResult{}, err
		}
		result.Status = status
		if result.Error != nil && status == toolResultStatusSuccess {
			return encodedModelToolResult{}, errors.New("successful tool result cannot carry an error")
		}
	}
	prepared := result
	var err error
	if !isComputerUseTool(result.ToolName) && !completeReportTool(result.ToolName) {
		var truncated bool
		prepared.Data, truncated, err = normalizeTruncatedToolPayload(result.ToolName, result.Data)
		prepared.Truncated = result.Truncated || truncated
	}
	var raw []byte
	var snapshot map[string]any
	if err == nil {
		raw, snapshot, err = encodeToolResultEnvelope(prepared)
	}
	if err == nil {
		return encodedModelToolResult{result: prepared, text: raw, structured: snapshot}, nil
	}
	code := aitools.ErrorCodeToolResultEncodingFailed
	if errors.Is(err, errComputerResultTooLarge) {
		code = aitools.ErrorCodeToolResultTooLarge
	}
	safe, input := safeToolResultAfterEncodingFailure(result, code)
	raw, snapshot, err = encodeToolResultEnvelope(safe)
	if err != nil {
		return encodedModelToolResult{}, fmt.Errorf("encode safe tool result: %w", err)
	}
	return encodedModelToolResult{result: safe, text: raw, structured: snapshot, inputRequired: input}, nil
}

func safeToolResultAfterEncodingFailure(source ToolResult, code aitools.ErrorCode) (ToolResult, *fltools.InputRequest) {
	guidance := "The tool result could not be encoded. Inspect current state before deciding the next step."
	if code == aitools.ErrorCodeToolResultTooLarge {
		guidance = "The final Computer JSON result exceeds 1 MiB. "
	}
	if isComputerManagementTool(source.ToolName) {
		guidance += " Refresh computer.targets, select an eligible candidate, then observe it."
	} else if source.ToolName == "computer.exec" {
		guidance += " Reduce script output and use a read-only computer.observe or computer.screenshot before any further action. Never replay completed operations."
	} else if isComputerUseTool(source.ToolName) {
		guidance += " Use a smaller root_ref/limit for computer.observe, or computer.screenshot. No action is replayed."
	}
	facts := source.executionFacts
	data := map[string]any{"result_unavailable": true}
	confirmed := facts.completed && facts.callID == source.ToolID && facts.toolName == source.ToolName
	if confirmed {
		data["tool_call_id"] = facts.callID
		data["invocation_completed"] = true
		data["completed_actions"] = append([]string{}, facts.completedActions...)
		data["needs_observation"] = facts.needsObservation
		if facts.targetID != "" {
			data["target_id"] = facts.targetID
		}
	}
	safe := ToolResult{ToolID: source.ToolID, ToolName: source.ToolName, Status: toolResultStatusError, Summary: "Tool result unavailable", Details: guidance, Data: data, Error: &aitools.ToolError{Code: code, Message: guidance}, dispatchErr: source.dispatchErr, effectUncertain: source.effectUncertain, executionFacts: facts}
	// Terminal dispatch/cancellation authority always wins over optional content.
	if source.dispatchErr != nil || source.Status == toolResultStatusAborted {
		safe.Status = source.Status
		safe.cancellationConfirmed = source.cancellationConfirmed
		if source.Error != nil {
			safe.Error = &aitools.ToolError{Code: source.Error.Code, Message: "Tool execution did not complete normally; result content is unavailable."}
		}
		return safe, nil
	}
	if source.Pending != nil {
		safe.Pending = source.Pending
		return safe, nil
	}
	if source.effectUncertain || !confirmed || !facts.potentialMutation || (source.Error != nil && source.Error.Code == aitools.ErrorCodePermissionDenied) {
		return safe, nil
	}
	safe.Details += " The operation returned a confirmed result, but its output is unavailable. The action may already be complete. Check the current interface before continuing. After your response, the Agent must first inspect current state without changing it; completed actions must not be replayed. You can also stop this task."
	safe.Error.Message = safe.Details
	input := &fltools.InputRequest{Summary: safe.Details, Questions: []fltools.InputQuestion{{ID: "tool_result_checked", Prompt: "Continue after checking the current interface?", Kind: "select", Options: []string{"Checked, continue"}}}}
	// Input is a generic completed-tool interaction, not a fabricated takeover.
	safe.activityInput = nil
	return safe, input
}

// Source-side semantic pruning is independent of the Activity display budget.
func computerSourceTruncated(value any) bool {
	return computerSourceTruncatedAtDepth(value, 0)
}
func computerSourceTruncatedAtDepth(value any, depth int) bool {
	if depth > 4 {
		return false
	}
	record, ok := value.(map[string]any)
	if !ok {
		return false
	}
	if record["truncated"] == true {
		return true
	}
	for _, key := range []string{"observation", "semantic", "result"} {
		if computerSourceTruncatedAtDepth(record[key], depth+1) {
			return true
		}
	}
	return false
}
