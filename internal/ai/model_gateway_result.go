package ai

import (
	"encoding/json"
	"fmt"
	"strings"
)

type modelGatewayContractError struct {
	ToolCallIndex int
	MissingFields []string
	Cause         error
}

func (e *modelGatewayContractError) Error() string {
	if e == nil {
		return "model gateway result is invalid"
	}
	prefix := fmt.Sprintf("model gateway result tool call %d is invalid", e.ToolCallIndex)
	if len(e.MissingFields) > 0 {
		return fmt.Sprintf("%s: missing %s", prefix, strings.Join(e.MissingFields, ", "))
	}
	if e.Cause != nil {
		return fmt.Sprintf("%s: arguments are not valid JSON: %v", prefix, e.Cause)
	}
	return prefix
}

func (e *modelGatewayContractError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.Cause
}

func validateModelGatewayResult(result ModelGatewayResult) error {
	for index, call := range result.ToolCalls {
		missing := make([]string, 0, 3)
		if strings.TrimSpace(call.ID) == "" {
			missing = append(missing, "id")
		}
		if strings.TrimSpace(call.Name) == "" {
			missing = append(missing, "name")
		}
		if call.Args == nil {
			missing = append(missing, "args")
		}
		if len(missing) > 0 {
			return &modelGatewayContractError{ToolCallIndex: index, MissingFields: missing}
		}
		if _, err := json.Marshal(call.Args); err != nil {
			return &modelGatewayContractError{ToolCallIndex: index, Cause: err}
		}
	}
	return nil
}
