package containerresource

import (
	"encoding/json"
	"errors"
	"fmt"

	"github.com/floegence/redeven/internal/containerengine"
)

type ResourceKind string

const (
	ResourceContainer        ResourceKind = "container"
	ResourceImage            ResourceKind = "image"
	ResourceVolume           ResourceKind = "volume"
	ResourceComposeProject   ResourceKind = "compose_project"
	ResourcePod              ResourceKind = "pod"
	ResourceContainerService ResourceKind = "container_service"
)

type ContainerServiceItem struct {
	containerengine.ContainerService
}

type ContainerServiceConfigurationState struct {
	ServiceID             string
	ConfigurationRevision string
	RestartRequired       bool
	ServiceGeneration     string
	UpdatedAtUnixMs       int64
}

type OperationState string

const (
	OperationQueued      OperationState = "queued"
	OperationRunning     OperationState = "running"
	OperationSucceeded   OperationState = "succeeded"
	OperationFailed      OperationState = "failed"
	OperationCanceling   OperationState = "canceling"
	OperationCanceled    OperationState = "canceled"
	OperationInterrupted OperationState = "interrupted"
)

func (s OperationState) Terminal() bool {
	switch s {
	case OperationSucceeded, OperationFailed, OperationCanceled, OperationInterrupted:
		return true
	default:
		return false
	}
}

type ManagedOwner struct {
	Kind      string `json:"kind"`
	ServiceID string `json:"service_id"`
	Name      string `json:"name"`
}

type Management struct {
	Managed bool          `json:"managed"`
	Owner   *ManagedOwner `json:"owner,omitempty"`
}

type PreflightRequest struct {
	Method  containerengine.Method `json:"method"`
	Request json.RawMessage        `json:"request"`
}

type Preflight struct {
	Method           containerengine.Method       `json:"method"`
	Engine           containerengine.Engine       `json:"engine"`
	EndpointID       containerengine.EndpointID   `json:"endpoint_id,omitempty"`
	ResourceKind     ResourceKind                 `json:"resource_kind"`
	ResourceIdentity string                       `json:"resource_identity"`
	RequestHash      string                       `json:"request_hash"`
	PlanHash         string                       `json:"plan_hash"`
	Plan             containerengine.ResourcePlan `json:"plan"`
	Management       Management                   `json:"management"`
}

type CreateOperationRequest struct {
	RequestID   string                 `json:"request_id"`
	Method      containerengine.Method `json:"method"`
	Request     json.RawMessage        `json:"request"`
	RequestHash string                 `json:"request_hash"`
	PlanHash    string                 `json:"plan_hash"`
}

type Operation struct {
	OperationID      string                     `json:"operation_id"`
	RequestID        string                     `json:"request_id"`
	RequestHash      string                     `json:"request_hash"`
	PlanHash         string                     `json:"plan_hash"`
	Method           containerengine.Method     `json:"method"`
	Engine           containerengine.Engine     `json:"engine"`
	EndpointID       containerengine.EndpointID `json:"endpoint_id,omitempty"`
	ResourceKind     ResourceKind               `json:"resource_kind"`
	ResourceIdentity string                     `json:"resource_identity"`
	State            OperationState             `json:"state"`
	CancelRequested  bool                       `json:"cancel_requested"`
	ErrorCode        string                     `json:"error_code,omitempty"`
	ErrorMessage     string                     `json:"error_message,omitempty"`
	Reconciliation   json.RawMessage            `json:"reconciliation,omitempty"`
	CreatedAtUnixMs  int64                      `json:"created_at_unix_ms"`
	StartedAtUnixMs  int64                      `json:"started_at_unix_ms,omitempty"`
	FinishedAtUnixMs int64                      `json:"finished_at_unix_ms,omitempty"`
	UpdatedAtUnixMs  int64                      `json:"updated_at_unix_ms"`
}

type Event struct {
	Sequence        int64           `json:"sequence"`
	OperationID     string          `json:"operation_id"`
	Type            string          `json:"type"`
	State           OperationState  `json:"state"`
	Payload         json.RawMessage `json:"payload,omitempty"`
	CreatedAtUnixMs int64           `json:"created_at_unix_ms"`
}

type OperationProgress struct {
	Phase           string `json:"phase"`
	DownloadedBytes int64  `json:"downloaded_bytes,omitempty"`
	TotalBytes      int64  `json:"total_bytes,omitempty"`
	CompletedLayers int64  `json:"completed_layers,omitempty"`
	TotalLayers     int64  `json:"total_layers,omitempty"`
}

type ListOperationsRequest struct {
	AfterSequence int64
	Limit         int
}

var (
	ErrInvalidRequest      = errors.New("container resource request is invalid")
	ErrPreflightStale      = errors.New("container resource preflight is stale")
	ErrIdempotencyConflict = errors.New("container resource idempotency conflict")
	ErrOperationNotFound   = errors.New("container resource operation was not found")
	ErrOperationTerminal   = errors.New("container resource operation is already terminal")
	ErrManagedByWebService = errors.New("container resource is managed by Web Services")
)

type ManagedResourceError struct {
	Owner ManagedOwner
}

func (e *ManagedResourceError) Error() string {
	if e == nil {
		return ErrManagedByWebService.Error()
	}
	return fmt.Sprintf("%s: %s", ErrManagedByWebService, e.Owner.Name)
}

func (e *ManagedResourceError) Is(target error) bool { return target == ErrManagedByWebService }

type IdempotencyConflictError struct {
	RequestID string
}

func (e *IdempotencyConflictError) Error() string {
	return fmt.Sprintf("%s: request_id %q already represents another request", ErrIdempotencyConflict, e.RequestID)
}

func (e *IdempotencyConflictError) Is(target error) bool { return target == ErrIdempotencyConflict }

type ContainerItem struct {
	containerengine.ContainerSummary
	Management Management `json:"management"`
}

type ContainerDetails struct {
	containerengine.ContainerInspect
	Management Management `json:"management"`
}

type VolumeItem struct {
	containerengine.VolumeRecord
	Management Management `json:"management"`
}

type ComposeProjectItem struct {
	containerengine.ComposeProject
	Management Management `json:"management"`
	Saved      bool       `json:"saved"`
	Source     string     `json:"source,omitempty"`
}

type ComposeProjectDefinitionInput struct {
	Engine      containerengine.Engine     `json:"engine"`
	EndpointID  containerengine.EndpointID `json:"endpoint_id"`
	Name        string                     `json:"name"`
	ConfigPaths []string                   `json:"config_paths"`
	EnvFilePath string                     `json:"env_file_path,omitempty"`
	Profiles    []string                   `json:"profiles,omitempty"`
}

type ComposeProjectDefinition struct {
	ProjectID       string                     `json:"project_id"`
	Engine          containerengine.Engine     `json:"engine"`
	EndpointID      containerengine.EndpointID `json:"endpoint_id"`
	Name            string                     `json:"name"`
	ConfigPaths     []string                   `json:"config_paths"`
	EnvFilePath     string                     `json:"env_file_path,omitempty"`
	Profiles        []string                   `json:"profiles,omitempty"`
	CreatedAtUnixMs int64                      `json:"created_at_unix_ms"`
	UpdatedAtUnixMs int64                      `json:"updated_at_unix_ms"`
}

var ErrComposeProjectDefinitionNotFound = errors.New("saved Compose project was not found")
