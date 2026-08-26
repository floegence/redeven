package managedwebservice

import (
	"context"
	"errors"

	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
)

const (
	DeepSeekHarnessTemplateID          = "deepseek-harness"
	DeepSeekHarnessHostTemplateID      = "deepseek-harness-host"
	DeepSeekHarnessContainerTemplateID = "deepseek-harness-container"
	DeepSeekHarnessVersion             = "0.1.1-rc.2"
)

type Deployment string

const (
	DeploymentNative    Deployment = "native"
	DeploymentDocker    Deployment = "docker"
	DeploymentHost      Deployment = "host"
	DeploymentContainer Deployment = "container"
	DeploymentCompose   Deployment = "compose"
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
	TemplateID            string                   `json:"template_id"`
	Name                  string                   `json:"name"`
	Description           string                   `json:"description"`
	Version               string                   `json:"version"`
	DeveloperPreview      bool                     `json:"developer_preview"`
	DiskBytes             int64                    `json:"disk_bytes"`
	DataLocation          string                   `json:"data_location"`
	SourceURL             string                   `json:"source_url"`
	DockerSourceURL       string                   `json:"docker_source_url"`
	Deployments           []DeploymentAvailability `json:"deployments"`
	WorkspaceRoots        []WorkspaceRoot          `json:"workspace_roots"`
	Source                string                   `json:"source"`
	Deployment            Deployment               `json:"deployment"`
	ContainerMode         string                   `json:"container_mode,omitempty"`
	Revision              int64                    `json:"revision"`
	Editable              bool                     `json:"editable"`
	Duplicateable         bool                     `json:"duplicateable"`
	DerivedFromTemplateID string                   `json:"derived_from_template_id,omitempty"`
	DerivedFromRevision   int64                    `json:"derived_from_revision,omitempty"`
	ServiceFamilyID       string                   `json:"service_family_id"`
	Available             bool                     `json:"available"`
	ReasonCode            string                   `json:"reason_code,omitempty"`
	Reason                string                   `json:"reason,omitempty"`
	Spec                  *TemplateSpec            `json:"spec,omitempty"`
}

type TemplateParameter struct {
	Name        string `json:"name"`
	Label       string `json:"label"`
	Description string `json:"description,omitempty"`
	Type        string `json:"type"`
	Required    bool   `json:"required,omitempty"`
	Default     string `json:"default,omitempty"`
}

type WebEndpointSpec struct {
	Scheme         string `json:"scheme"`
	ContainerPort  int    `json:"container_port,omitempty"`
	FixedHostPort  int    `json:"fixed_host_port,omitempty"`
	Path           string `json:"path,omitempty"`
	HealthPath     string `json:"health_path,omitempty"`
	HealthProtocol string `json:"health_protocol,omitempty"`
	StartupTimeout int    `json:"startup_timeout_sec,omitempty"`
}

type HostArtifactSpec struct {
	DownloadURL       string `json:"download_url"`
	SizeBytes         int64  `json:"size_bytes"`
	SHA256            string `json:"sha256"`
	ExecutableRelPath string `json:"executable_rel_path"`
}

type HostTemplateSpec struct {
	InstallScript   string            `json:"install_script,omitempty"`
	StartScript     string            `json:"start_script"`
	StopScript      string            `json:"stop_script,omitempty"`
	UninstallScript string            `json:"uninstall_script,omitempty"`
	Artifact        *HostArtifactSpec `json:"artifact,omitempty"`
}

type ContainerMountSpec struct {
	Type     string `json:"type"`
	Source   string `json:"source,omitempty"`
	Target   string `json:"target"`
	ReadOnly bool   `json:"read_only,omitempty"`
}

type ContainerTemplateSpec struct {
	Image        string               `json:"image"`
	Entrypoint   []string             `json:"entrypoint,omitempty"`
	Command      []string             `json:"command,omitempty"`
	Environment  map[string]string    `json:"environment,omitempty"`
	Mounts       []ContainerMountSpec `json:"mounts,omitempty"`
	User         string               `json:"user,omitempty"`
	ReadOnlyRoot bool                 `json:"read_only_root"`
	MemoryBytes  int64                `json:"memory_bytes,omitempty"`
	CPUs         float64              `json:"cpus,omitempty"`
	PIDsLimit    int64                `json:"pids_limit,omitempty"`
}

type ComposeTemplateSpec struct {
	YAML        string `json:"yaml"`
	MainService string `json:"main_service"`
}

type TemplateSpec struct {
	SchemaVersion int                    `json:"schema_version"`
	Kind          Deployment             `json:"kind"`
	Endpoint      WebEndpointSpec        `json:"endpoint"`
	Parameters    []TemplateParameter    `json:"parameters,omitempty"`
	Host          *HostTemplateSpec      `json:"host,omitempty"`
	Container     *ContainerTemplateSpec `json:"container,omitempty"`
	Compose       *ComposeTemplateSpec   `json:"compose,omitempty"`
}

type CreateRequest struct {
	RequestID     string            `json:"request_id"`
	TemplateID    string            `json:"template_id"`
	Deployment    Deployment        `json:"deployment"`
	WorkspacePath string            `json:"workspace_path"`
	Parameters    map[string]string `json:"parameters,omitempty"`
}

type TemplateWriteRequest struct {
	RequestID   string       `json:"request_id"`
	Name        string       `json:"name"`
	Description string       `json:"description,omitempty"`
	Version     string       `json:"version,omitempty"`
	Spec        TemplateSpec `json:"spec"`
}

type TemplateDuplicateRequest struct {
	RequestID string `json:"request_id"`
	Name      string `json:"name"`
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
	Name            string                       `json:"name"`
	Description     string                       `json:"description,omitempty"`
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
	Template(context.Context, string) (*Template, error)
	CreateTemplate(context.Context, TemplateWriteRequest) (*Template, error)
	UpdateTemplate(context.Context, string, TemplateWriteRequest) (*Template, error)
	DeleteTemplate(context.Context, string) error
	DuplicateTemplate(context.Context, string, TemplateDuplicateRequest) (*Template, error)
	ValidateTemplate(context.Context, TemplateWriteRequest) error
	List(context.Context) ([]ServiceView, error)
	Create(context.Context, CreateRequest) (*CreateResult, error)
	Operate(context.Context, string, OperationRequest) (*pfregistry.ManagedOperation, error)
	Cancel(context.Context, string) (*pfregistry.ManagedOperation, error)
	Operation(context.Context, string) (*pfregistry.ManagedOperation, error)
	Subscribe(string) (<-chan pfregistry.ManagedOperation, func(), error)
	Logs(context.Context, string, int) (*LogResult, error)
}
