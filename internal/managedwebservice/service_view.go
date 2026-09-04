package managedwebservice

import (
	"strings"

	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
)

func serviceFailureView(service pfregistry.ManagedService, operation *pfregistry.ManagedOperation) *ServiceFailure {
	code, message := strings.TrimSpace(service.LastErrorCode), strings.TrimSpace(service.LastErrorMessage)
	if code == "" && operation != nil {
		code, message = strings.TrimSpace(operation.ErrorCode), strings.TrimSpace(operation.ErrorMessage)
	}
	if code == "" {
		return nil
	}
	failure := &ServiceFailure{ErrorCode: code, Message: message}
	if operation == nil || strings.TrimSpace(operation.ErrorCode) != code || strings.TrimSpace(operation.ErrorMessage) != message || operation.UpdatedAtUnixMs != service.UpdatedAtUnixMs {
		return failure
	}
	failure.Action = strings.TrimSpace(operation.Action)
	failure.Stage = strings.TrimSpace(operation.Stage)
	failure.OperationID = strings.TrimSpace(operation.OperationID)
	failure.OccurredAtUnixMs = operation.FinishedAtUnixMs
	if failure.OccurredAtUnixMs == 0 {
		failure.OccurredAtUnixMs = operation.UpdatedAtUnixMs
	}
	// Host artifact references are managed executable paths. They must never be
	// projected into a user-copyable failure diagnostic.
	binding, bindingErr := decodeRuntimeBinding(&service)
	if bindingErr == nil && binding.Deployment != DeploymentHost && operation.ProgressDetail != nil && operation.ProgressDetail.Transfer != nil {
		failure.ArtifactReference = strings.TrimSpace(operation.ProgressDetail.Transfer.ArtifactReference)
	}
	return failure
}
