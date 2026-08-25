package managedwebservice

import (
	"context"
	"errors"

	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
)

const (
	DeepSeekHarnessTemplateID = "deepseek-harness"
	DeepSeekHarnessVersion    = "0.1.1-rc.2"
)

type Deployment string

const (
	DeploymentNative Deployment = "native"
	DeploymentDocker Deployment = "docker"
)

type OperationAction string

const (
	ActionInstall      OperationAction = "install"
	ActionStart        OperationAction = "start"
	ActionStop         OperationAction = "stop"
	ActionRestart      OperationAction = "restart"
	ActionRetryInstall OperationAction = "retry_install"
	ActionUninstall    OperationAction = "uninstall"
)

type DeploymentAvailability struct {
	Deployment Deployment `json:"deployment"`
	Available  bool       `json:"available"`
	ReasonCode string     `json:"reason_code,omitempty"`
	Reason     string     `json:"reason,omitempty"`
}

type WorkspaceRoot struct {
	ID    string `json:"id"`
	Label string `json:"label"`
	Path  string `json:"path"`
}

type Template struct {
	TemplateID       string                   `json:"template_id"`
	Name             string                   `json:"name"`
	Description      string                   `json:"description"`
	Version          string                   `json:"version"`
	DeveloperPreview bool                     `json:"developer_preview"`
	DiskBytes        int64                    `json:"disk_bytes"`
	DataLocation     string                   `json:"data_location"`
	SourceURL        string                   `json:"source_url"`
	DockerSourceURL  string                   `json:"docker_source_url"`
	Deployments      []DeploymentAvailability `json:"deployments"`
	WorkspaceRoots   []WorkspaceRoot          `json:"workspace_roots"`
}

type CreateRequest struct {
	RequestID     string     `json:"request_id"`
	TemplateID    string     `json:"template_id"`
	Deployment    Deployment `json:"deployment"`
	WorkspacePath string     `json:"workspace_path"`
}

type OperationRequest struct {
	RequestID  string          `json:"request_id"`
	Action     OperationAction `json:"action"`
	DeleteData bool            `json:"delete_data,omitempty"`
}

type CreateResult struct {
	Service   pfregistry.ManagedService   `json:"service"`
	Operation pfregistry.ManagedOperation `json:"operation"`
}

type ServiceView struct {
	pfregistry.ManagedService
	ActiveOperation *pfregistry.ManagedOperation `json:"active_operation,omitempty"`
}

type LogResult struct {
	Lines []string `json:"lines"`
}

type Error struct {
	Code       string
	Message    string
	HTTPStatus int
	Retryable  bool
	Cause      error
}

func (e *Error) Error() string {
	if e == nil {
		return "managed web service error"
	}
	return e.Message
}
func (e *Error) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.Cause
}

func serviceError(code, message string, status int, retryable bool, cause error) error {
	return &Error{Code: code, Message: message, HTTPStatus: status, Retryable: retryable, Cause: cause}
}

func ErrorDetails(err error) (code string, message string, status int, retryable bool) {
	var managedErr *Error
	if errors.As(err, &managedErr) {
		return managedErr.Code, managedErr.Message, managedErr.HTTPStatus, managedErr.Retryable
	}
	if err == nil {
		return "", "", 200, false
	}
	return "MANAGED_WEB_SERVICE_INTERNAL", "The managed Web Service operation failed.", 500, false
}

type Backend interface {
	Catalog(context.Context) ([]Template, error)
	List(context.Context) ([]ServiceView, error)
	Create(context.Context, CreateRequest) (*CreateResult, error)
	Operate(context.Context, string, OperationRequest) (*pfregistry.ManagedOperation, error)
	Cancel(context.Context, string) (*pfregistry.ManagedOperation, error)
	Operation(context.Context, string) (*pfregistry.ManagedOperation, error)
	Subscribe(string) (<-chan pfregistry.ManagedOperation, func(), error)
	Logs(context.Context, string, int) (*LogResult, error)
}
