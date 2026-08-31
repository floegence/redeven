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
	WebtopUbuntuKDETemplateID          = "linuxserver-webtop-ubuntu-kde"
	WebtopDebianXFCETemplateID         = "linuxserver-webtop-debian-xfce"
)

const (
	BrandIconDeepSeekHarness = "deepseek-harness"
	BrandIconUbuntu          = "ubuntu"
	BrandIconDebian          = "debian"

	ContainerRuntimeProfileRestricted         = "restricted"
	ContainerRuntimeProfileInteractiveDesktop = "interactive_desktop"
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
	ActionUpdate       OperationAction = "update"
	ActionReconfigure  OperationAction = "reconfigure"
	ActionUninstall    OperationAction = "uninstall"
)

type TemplateNotice struct {
	ID                      string `json:"id"`
	Revision                int64  `json:"revision"`
	Severity                string `json:"severity"`
	TitleKey                string `json:"title_key"`
	DescriptionKey          string `json:"description_key"`
	AcknowledgementRequired bool   `json:"acknowledgement_required"`
}

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
	BrandIcon             string                   `json:"brand_icon,omitempty"`
	LocalizationKey       string                   `json:"localization_key,omitempty"`
	Notices               []TemplateNotice         `json:"notices,omitempty"`
	Deployments           []DeploymentAvailability `json:"deployments"`
	DefaultWorkspacePath  string                   `json:"default_workspace_path"`
	DefaultAccessMode     string                   `json:"default_access_mode"`
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
	EffectiveSpec         *TemplateSpec            `json:"effective_spec,omitempty"`
	SortOrder             int                      `json:"-"`
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
	RuntimeBundle   string            `json:"runtime_bundle,omitempty"`
}

type ContainerMountSpec struct {
	ResourceID   string   `json:"resource_id,omitempty"`
	Type         string   `json:"type"`
	Source       string   `json:"source,omitempty"`
	Target       string   `json:"target"`
	ReadOnly     bool     `json:"read_only,omitempty"`
	TmpfsOptions []string `json:"tmpfs_options,omitempty"`
}

type ContainerPortSpec struct {
	ResourceID    string `json:"resource_id,omitempty"`
	ContainerPort int    `json:"container_port"`
	HostPort      int    `json:"host_port,omitempty"`
	HostIP        string `json:"host_ip,omitempty"`
	Protocol      string `json:"protocol,omitempty"`
}

type ContainerDeviceSpec struct {
	ResourceID    string `json:"resource_id,omitempty"`
	HostPath      string `json:"host_path"`
	ContainerPath string `json:"container_path,omitempty"`
	Permissions   string `json:"permissions,omitempty"`
}

type ContainerTemplateSpec struct {
	Image          string                `json:"image"`
	Entrypoint     []string              `json:"entrypoint,omitempty"`
	Command        []string              `json:"command,omitempty"`
	Environment    map[string]string     `json:"environment,omitempty"`
	Labels         map[string]string     `json:"labels,omitempty"`
	RestartPolicy  string                `json:"restart_policy,omitempty"`
	NetworkMode    string                `json:"network_mode,omitempty"`
	PIDMode        string                `json:"pid_mode,omitempty"`
	IPCMode        string                `json:"ipc_mode,omitempty"`
	Ports          []ContainerPortSpec   `json:"ports,omitempty"`
	Mounts         []ContainerMountSpec  `json:"mounts,omitempty"`
	CapAdd         []string              `json:"cap_add,omitempty"`
	CapDrop        []string              `json:"cap_drop,omitempty"`
	Devices        []ContainerDeviceSpec `json:"devices,omitempty"`
	Privileged     bool                  `json:"privileged,omitempty"`
	SecurityOpts   []string              `json:"security_opts,omitempty"`
	User           string                `json:"user,omitempty"`
	ReadOnlyRoot   bool                  `json:"read_only_root"`
	MemoryBytes    int64                 `json:"memory_bytes,omitempty"`
	CPUs           float64               `json:"cpus,omitempty"`
	PIDsLimit      int64                 `json:"pids_limit,omitempty"`
	ShmSizeBytes   int64                 `json:"shm_size_bytes,omitempty"`
	RuntimeProfile string                `json:"runtime_profile,omitempty"`
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
	RequestID               string            `json:"request_id"`
	TemplateID              string            `json:"template_id"`
	Deployment              Deployment        `json:"deployment"`
	WorkspacePath           string            `json:"workspace_path"`
	Parameters              map[string]string `json:"parameters,omitempty"`
	AcceptedNoticeRevisions map[string]int64  `json:"accepted_notice_revisions,omitempty"`
	AccessMode              string            `json:"access_mode,omitempty"`
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
	RequestID               string              `json:"request_id"`
	Action                  OperationAction     `json:"action"`
	DeleteData              bool                `json:"delete_data,omitempty"`
	AcceptedNoticeRevisions map[string]int64    `json:"accepted_notice_revisions,omitempty"`
	Reconfigure             *ReconfigureRequest `json:"reconfigure,omitempty"`
}

type ServiceMetadataPatch struct {
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	AccessMode  string `json:"access_mode"`
}

type EnvironmentSetting struct {
	Name     string `json:"name"`
	Value    string `json:"value,omitempty"`
	Secret   bool   `json:"secret,omitempty"`
	HasValue bool   `json:"has_value,omitempty"`
	Clear    bool   `json:"clear,omitempty"`
}

type ContainerRuntimeSettings struct {
	Entrypoint    string                `json:"entrypoint,omitempty"`
	Command       []string              `json:"command,omitempty"`
	Environment   []EnvironmentSetting  `json:"environment,omitempty"`
	Labels        map[string]string     `json:"labels,omitempty"`
	RestartPolicy string                `json:"restart_policy,omitempty"`
	NetworkMode   string                `json:"network_mode,omitempty"`
	PIDMode       string                `json:"pid_mode,omitempty"`
	IPCMode       string                `json:"ipc_mode,omitempty"`
	Ports         []ContainerPortSpec   `json:"ports,omitempty"`
	Mounts        []ContainerMountSpec  `json:"mounts,omitempty"`
	CPUs          float64               `json:"cpus,omitempty"`
	MemoryBytes   int64                 `json:"memory_bytes,omitempty"`
	PIDsLimit     int64                 `json:"pids_limit,omitempty"`
	ShmSizeBytes  int64                 `json:"shm_size_bytes,omitempty"`
	CapAdd        []string              `json:"cap_add,omitempty"`
	CapDrop       []string              `json:"cap_drop,omitempty"`
	Devices       []ContainerDeviceSpec `json:"devices,omitempty"`
	Privileged    bool                  `json:"privileged,omitempty"`
	ReadOnlyRoot  bool                  `json:"read_only_root"`
	SecurityOpts  []string              `json:"security_opts,omitempty"`
	User          string                `json:"user,omitempty"`
}

type HostRuntimeSettings struct {
	InstallScript   string `json:"install_script,omitempty"`
	StartScript     string `json:"start_script"`
	StopScript      string `json:"stop_script,omitempty"`
	UninstallScript string `json:"uninstall_script,omitempty"`
}

type ServiceRuntimeSettings struct {
	Container *ContainerRuntimeSettings           `json:"container,omitempty"`
	Compose   map[string]ContainerRuntimeSettings `json:"compose,omitempty"`
	Host      *HostRuntimeSettings                `json:"host,omitempty"`
}

type LockedSetting struct {
	Path      string `json:"path"`
	Reason    string `json:"reason"`
	Duplicate bool   `json:"duplicate_to_edit,omitempty"`
}

type ServiceSettingsView struct {
	ServiceID             string                 `json:"service_id"`
	Name                  string                 `json:"name"`
	Description           string                 `json:"description,omitempty"`
	AccessMode            string                 `json:"access_mode"`
	Deployment            Deployment             `json:"deployment"`
	TemplateSource        string                 `json:"template_source"`
	ObservedState         string                 `json:"observed_state"`
	ConfigurationRevision int64                  `json:"configuration_revision"`
	ConfigurationSHA256   string                 `json:"configuration_sha256"`
	Parameters            map[string]string      `json:"parameters,omitempty"`
	Runtime               ServiceRuntimeSettings `json:"runtime"`
	Locked                []LockedSetting        `json:"locked,omitempty"`
}

type ReconfigureDraft struct {
	ConfigurationRevision int64                  `json:"configuration_revision"`
	Parameters            map[string]string      `json:"parameters,omitempty"`
	Runtime               ServiceRuntimeSettings `json:"runtime"`
}

type RiskNotice struct {
	ID            string `json:"id"`
	Title         string `json:"title"`
	Description   string `json:"description"`
	RequiresAdmin bool   `json:"requires_admin"`
}

type ReconfigurePlan struct {
	ConfigurationRevision int64        `json:"configuration_revision"`
	PlanDigest            string       `json:"plan_digest"`
	ChangedSections       []string     `json:"changed_sections"`
	Risks                 []RiskNotice `json:"risks,omitempty"`
	RequiresRebuild       bool         `json:"requires_rebuild"`
}

type ReconfigureRequest struct {
	Draft           ReconfigureDraft `json:"draft"`
	PlanDigest      string           `json:"plan_digest"`
	AcceptedRiskIDs []string         `json:"accepted_risk_ids,omitempty"`
	Administrator   bool             `json:"-"`
}

type CreateResult struct {
	Service   pfregistry.ManagedService   `json:"service"`
	Operation pfregistry.ManagedOperation `json:"operation"`
}

type ServiceView struct {
	pfregistry.ManagedService
	Name                       string                       `json:"name"`
	Description                string                       `json:"description,omitempty"`
	BrandIcon                  string                       `json:"brand_icon,omitempty"`
	LocalizationKey            string                       `json:"localization_key,omitempty"`
	UpdateAvailable            bool                         `json:"update_available"`
	TargetRevision             int64                        `json:"target_revision,omitempty"`
	TargetVersion              string                       `json:"target_version,omitempty"`
	UpdateNotices              []TemplateNotice             `json:"update_notices,omitempty"`
	ActiveOperation            *pfregistry.ManagedOperation `json:"active_operation,omitempty"`
	OperationArtifactReference string                       `json:"operation_artifact_reference,omitempty"`
	AccessMode                 string                       `json:"access_mode"`
	ContainerResources         []ContainerResourceLink      `json:"container_resources,omitempty"`
}

type ContainerResourceLink struct {
	Kind       string `json:"kind"`
	Engine     string `json:"engine"`
	EndpointID string `json:"endpoint_id,omitempty"`
	View       string `json:"view"`
	Identity   string `json:"identity"`
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
	Settings(context.Context, string) (*ServiceSettingsView, error)
	UpdateSettings(context.Context, string, ServiceMetadataPatch) (*ServiceSettingsView, error)
	PreflightReconfigure(context.Context, string, ReconfigureDraft) (*ReconfigurePlan, error)
	Create(context.Context, CreateRequest) (*CreateResult, error)
	Operate(context.Context, string, OperationRequest) (*pfregistry.ManagedOperation, error)
	Cancel(context.Context, string) (*pfregistry.ManagedOperation, error)
	Operation(context.Context, string) (*pfregistry.ManagedOperation, error)
	Subscribe(string) (<-chan pfregistry.ManagedOperation, func(), error)
	Logs(context.Context, string, int) (*LogResult, error)
}
