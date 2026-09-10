package managedwebservice

import (
	"context"
	"errors"

	templatecontract "github.com/floegence/redeven-service-templates/template"

	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
)

const (
	ContainerRuntimeProfileRestricted         = "restricted"
	ContainerRuntimeProfileInteractiveDesktop = "interactive_desktop"
)

type Deployment = templatecontract.Deployment

const (
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
	ActionRetry        OperationAction = "retry"
	ActionRetryInstall OperationAction = "retry_install"
	ActionUpdate       OperationAction = "update"
	ActionReconfigure  OperationAction = "reconfigure"
	ActionUninstall    OperationAction = "uninstall"
	ActionDetach       OperationAction = "detach"
	ActionRestore      OperationAction = "restore"
	ActionRecover      OperationAction = "recover"
)

type TemplateNotice = templatecontract.Notice

type LocalizedTemplateNotice = templatecontract.LocalizedNotice

type TemplateLocalization = templatecontract.Localization

type TemplateIcon = templatecontract.IconAsset

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

type HostLifecyclePackage struct {
	Reference string `json:"reference"`
	SHA256    string `json:"sha256"`
	SizeBytes int64  `json:"size_bytes"`
}

type HostLifecycleStep struct {
	Kind            string `json:"kind"`
	Reference       string `json:"reference,omitempty"`
	CommandTemplate string `json:"command_template,omitempty"`
}

type HostLifecycleActionPlan struct {
	Ownership string              `json:"ownership"`
	Steps     []HostLifecycleStep `json:"steps"`
}

type HostLifecyclePlan struct {
	SchemaVersion int                      `json:"schema_version"`
	Driver        string                   `json:"driver"`
	RuntimeBundle string                   `json:"runtime_bundle,omitempty"`
	Package       *HostLifecyclePackage    `json:"package,omitempty"`
	NPM           *NPMHostPackageSpec      `json:"npm,omitempty"`
	Install       HostLifecycleActionPlan  `json:"install"`
	Start         HostLifecycleActionPlan  `json:"start"`
	Open          *HostLifecycleActionPlan `json:"open,omitempty"`
	OutputMode    string                   `json:"output_mode,omitempty"`
	Stop          HostLifecycleActionPlan  `json:"stop"`
	Uninstall     HostLifecycleActionPlan  `json:"uninstall"`
}

type Template struct {
	DefaultLocale         string                            `json:"default_locale,omitempty"`
	GitSource             *pfregistry.ManagedTemplateSource `json:"git_source,omitempty"`
	SourceSHA256          string                            `json:"source_sha256,omitempty"`
	SourceDirectory       string                            `json:"-"`
	TemplateID            string                            `json:"template_id"`
	Name                  string                            `json:"name"`
	Description           string                            `json:"description"`
	RecommendedRelease    *ReleaseIdentity                  `json:"recommended_release,omitempty"`
	ReleaseSource         string                            `json:"release_source,omitempty"`
	DeveloperPreview      bool                              `json:"developer_preview"`
	DiskBytes             int64                             `json:"disk_bytes"`
	DataLocation          string                            `json:"data_location"`
	SourceURL             string                            `json:"source_url"`
	DockerSourceURL       string                            `json:"docker_source_url"`
	Localizations         map[string]TemplateLocalization   `json:"localizations,omitempty"`
	Icon                  *TemplateIcon                     `json:"icon,omitempty"`
	Notices               []TemplateNotice                  `json:"notices,omitempty"`
	Deployments           []DeploymentAvailability          `json:"deployments"`
	DefaultWorkspacePath  string                            `json:"default_workspace_path"`
	DefaultAccessMode     string                            `json:"default_access_mode"`
	WorkspaceRoots        []WorkspaceRoot                   `json:"workspace_roots"`
	Source                string                            `json:"source"`
	Deployment            Deployment                        `json:"deployment"`
	ContainerMode         string                            `json:"container_mode,omitempty"`
	Revision              int64                             `json:"revision"`
	Editable              bool                              `json:"editable"`
	Duplicateable         bool                              `json:"duplicateable"`
	DerivedFromTemplateID string                            `json:"derived_from_template_id,omitempty"`
	DerivedFromRevision   int64                             `json:"derived_from_revision,omitempty"`
	ServiceFamilyID       string                            `json:"service_family_id"`
	Available             bool                              `json:"available"`
	ReasonCode            string                            `json:"reason_code,omitempty"`
	Reason                string                            `json:"reason,omitempty"`
	Spec                  *TemplateSpec                     `json:"spec,omitempty"`
	EffectiveSpec         *TemplateSpec                     `json:"effective_spec,omitempty"`
	HostLifecyclePlan     *HostLifecyclePlan                `json:"host_lifecycle_plan,omitempty"`
	SortOrder             int                               `json:"-"`
}

type TemplateParameter = templatecontract.TemplateParameter

type WebEndpointSpec = templatecontract.WebEndpointSpec

type HostArtifactSpec = templatecontract.HostArtifactSpec

type NPMHostPackageSpec = templatecontract.NPMHostPackageSpec

type HostTemplateSpec = templatecontract.HostTemplateSpec

type ContainerMountSpec = templatecontract.ContainerMountSpec

type ContainerPortSpec = templatecontract.ContainerPortSpec

type ContainerDeviceSpec = templatecontract.ContainerDeviceSpec

type ContainerTemplateSpec = templatecontract.ContainerTemplateSpec

type ComposeTemplateSpec = templatecontract.ComposeTemplateSpec

type TemplateSpec = templatecontract.Spec

type CreateRequest struct {
	PlanDigest              string            `json:"plan_digest,omitempty"`
	RequestID               string            `json:"request_id"`
	TemplateID              string            `json:"template_id"`
	Deployment              Deployment        `json:"deployment"`
	WorkspacePath           string            `json:"workspace_path"`
	Parameters              map[string]string `json:"parameters,omitempty"`
	AcceptedNoticeRevisions map[string]int64  `json:"accepted_notice_revisions,omitempty"`
	AccessMode              string            `json:"access_mode,omitempty"`
	TargetReleaseID         string            `json:"target_release_id,omitempty"`
}

type TemplateWriteRequest struct {
	RequestID   string       `json:"request_id"`
	Name        string       `json:"name"`
	Description string       `json:"description,omitempty"`
	Spec        TemplateSpec `json:"spec"`
}

type TemplateDuplicateRequest struct {
	RequestID string `json:"request_id"`
	Name      string `json:"name"`
}

type OperationRequest struct {
	RetainResourceIDs       []string            `json:"retain_resource_ids,omitempty"`
	PlanDigest              string              `json:"plan_digest,omitempty"`
	SkipHooks               bool                `json:"skip_hooks,omitempty"`
	RequestID               string              `json:"request_id"`
	Action                  OperationAction     `json:"action"`
	DeleteData              bool                `json:"delete_data,omitempty"`
	DeleteWorkspace         bool                `json:"delete_workspace,omitempty"`
	AcceptedNoticeRevisions map[string]int64    `json:"accepted_notice_revisions,omitempty"`
	Reconfigure             *ReconfigureRequest `json:"reconfigure,omitempty"`
	UpdatePlanID            string              `json:"update_plan_id,omitempty"`
	Administrator           bool                `json:"-"`
}

type ReleaseIdentity struct {
	SchemaVersion     int    `json:"schema_version"`
	Kind              string `json:"kind"`
	Source            string `json:"source,omitempty"`
	Registry          string `json:"registry,omitempty"`
	Version           string `json:"version,omitempty"`
	Tag               string `json:"tag,omitempty"`
	Digest            string `json:"digest,omitempty"`
	Integrity         string `json:"integrity,omitempty"`
	Platform          string `json:"platform,omitempty"`
	ArtifactReference string `json:"artifact_reference,omitempty"`
	Trust             string `json:"trust,omitempty"`
}

type ReleaseCandidate struct {
	SchemaVersion        int    `json:"schema_version"`
	CandidateID          string `json:"candidate_id"`
	SourceKind           string `json:"source_kind"`
	Source               string `json:"source"`
	Registry             string `json:"registry,omitempty"`
	Version              string `json:"version,omitempty"`
	Tag                  string `json:"tag,omitempty"`
	PublishedAtUnixMs    int64  `json:"published_at_unix_ms,omitempty"`
	Channel              string `json:"channel"`
	Deprecated           bool   `json:"deprecated,omitempty"`
	DeprecationMessage   string `json:"deprecation_message,omitempty"`
	Trust                string `json:"trust"`
	Selectable           bool   `json:"selectable"`
	ReasonCode           string `json:"reason_code,omitempty"`
	Reason               string `json:"reason,omitempty"`
	Platform             string `json:"platform,omitempty"`
	IndexDigest          string `json:"index_digest,omitempty"`
	Digest               string `json:"digest,omitempty"`
	Integrity            string `json:"integrity,omitempty"`
	TagMoved             bool   `json:"tag_moved,omitempty"`
	IsCurrent            bool   `json:"is_current,omitempty"`
	IsRecommended        bool   `json:"is_recommended,omitempty"`
	RecommendationStatus string `json:"recommendation_status,omitempty"`
	DigestVerified       bool   `json:"digest_verified,omitempty"`
	IsLatestStable       bool   `json:"is_latest_stable,omitempty"`
	IsLatestPreview      bool   `json:"is_latest_preview,omitempty"`
	Relation             string `json:"relation"`
	VerificationStatus   string `json:"verification_status"`
}

type ReleaseCandidateRequest struct {
	Action       string            `json:"action"`
	Parameters   map[string]string `json:"parameters,omitempty"`
	CursorID     string            `json:"cursor_id,omitempty"`
	CandidateIDs []string          `json:"candidate_ids,omitempty"`
}

type ReleaseCandidateResult struct {
	SchemaVersion        int                `json:"schema_version"`
	CurrentRelease       *ReleaseIdentity   `json:"current_release,omitempty"`
	RecommendedRelease   *ReleaseIdentity   `json:"recommended_release,omitempty"`
	LatestStableRelease  *ReleaseCandidate  `json:"latest_stable_release,omitempty"`
	LatestPreviewRelease *ReleaseCandidate  `json:"latest_preview_release,omitempty"`
	Candidates           []ReleaseCandidate `json:"candidates"`
	CatalogStatus        string             `json:"catalog_status"`
	HasMore              bool               `json:"has_more"`
	CursorID             string             `json:"cursor_id,omitempty"`
	LoadedCount          int                `json:"loaded_count"`
	CheckStatus          string             `json:"check_status"`
	CheckedAtUnixMs      int64              `json:"checked_at_unix_ms"`
	NextCheckAtUnixMs    int64              `json:"next_check_at_unix_ms,omitempty"`
	LastErrorCode        string             `json:"last_error_code,omitempty"`
	LastErrorMessage     string             `json:"-"`
}

type ReleaseStatus struct {
	SchemaVersion         int              `json:"schema_version"`
	CurrentRelease        *ReleaseIdentity `json:"current_release,omitempty"`
	RecommendedRelease    *ReleaseIdentity `json:"recommended_release,omitempty"`
	LatestStableRelease   *ReleaseIdentity `json:"latest_stable_release,omitempty"`
	LatestPreviewRelease  *ReleaseIdentity `json:"latest_preview_release,omitempty"`
	LatestStableRelation  string           `json:"latest_stable_relation,omitempty"`
	LatestPreviewRelation string           `json:"latest_preview_relation,omitempty"`
	CheckStatus           string           `json:"check_status"`
	CheckedAtUnixMs       int64            `json:"checked_at_unix_ms,omitempty"`
	NextCheckAtUnixMs     int64            `json:"next_check_at_unix_ms,omitempty"`
	LastErrorCode         string           `json:"last_error_code,omitempty"`
}

type UpdatePlanRequest struct {
	TargetCandidateID string `json:"target_candidate_id,omitempty"`
}

type UpdatePlan struct {
	SchemaVersion   int              `json:"schema_version"`
	UpdatePlanID    string           `json:"update_plan_id"`
	CurrentRelease  ReleaseIdentity  `json:"current_release"`
	TargetRelease   ReleaseIdentity  `json:"target_release"`
	Notices         []TemplateNotice `json:"notices,omitempty"`
	RiskIDs         []string         `json:"risk_ids,omitempty"`
	RequiresStopped bool             `json:"requires_stopped,omitempty"`
	ExpiresAtUnixMs int64            `json:"expires_at_unix_ms"`
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
	ManagementState            string                 `json:"management_state"`
	ParameterDefinitions       []TemplateParameter    `json:"parameter_definitions,omitempty"`
	ConfiguredSecretParameters []string               `json:"configured_secret_parameters,omitempty"`
	ServiceID                  string                 `json:"service_id"`
	Name                       string                 `json:"name"`
	Description                string                 `json:"description,omitempty"`
	AccessMode                 string                 `json:"access_mode"`
	Deployment                 Deployment             `json:"deployment"`
	TemplateSource             string                 `json:"template_source"`
	ObservedState              string                 `json:"observed_state"`
	ConfigurationRevision      int64                  `json:"configuration_revision"`
	ConfigurationSHA256        string                 `json:"configuration_sha256"`
	Parameters                 map[string]string      `json:"parameters,omitempty"`
	Runtime                    ServiceRuntimeSettings `json:"runtime"`
	Locked                     []LockedSetting        `json:"locked,omitempty"`
}

type ReconfigureDraft struct {
	SecretParameters      map[string]string      `json:"secret_parameters,omitempty"`
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
	DefaultLocale string       `json:"default_locale,omitempty"`
	Facts         ServiceFacts `json:"facts"`
	PrimaryAction string       `json:"primary_action"`
	Status        string       `json:"status"`
	ProblemCode   string       `json:"problem_code,omitempty"`
	pfregistry.ManagedService
	Name               string                          `json:"name"`
	Description        string                          `json:"description,omitempty"`
	TemplateSource     string                          `json:"template_source"`
	Deployment         Deployment                      `json:"deployment"`
	Localizations      map[string]TemplateLocalization `json:"localizations,omitempty"`
	Icon               *TemplateIcon                   `json:"icon,omitempty"`
	ReleaseStatus      ReleaseStatus                   `json:"release_status"`
	ActiveOperation    *pfregistry.ManagedOperation    `json:"active_operation,omitempty"`
	LastFailure        *ServiceFailure                 `json:"last_failure,omitempty"`
	AccessMode         string                          `json:"access_mode"`
	ContainerResources []ContainerResourceLink         `json:"container_resources,omitempty"`
	Opening            ServiceOpening                  `json:"opening"`
	PendingChanges     bool                            `json:"pending_changes"`
	Actions            ServiceActions                  `json:"actions"`
}

type ActionCapability struct {
	Available  bool   `json:"available"`
	ReasonCode string `json:"reason_code,omitempty"`
}

type ServiceOpening struct {
	State     string `json:"state"`
	ErrorCode string `json:"error_code,omitempty"`
}

type ServiceActions struct {
	Inspect           ActionCapability `json:"inspect"`
	Uninstall         ActionCapability `json:"uninstall"`
	Recover           ActionCapability `json:"recover"`
	Detach            ActionCapability `json:"detach"`
	Open              ActionCapability `json:"open"`
	RestoreManagement ActionCapability `json:"restore_management"`
	Start             ActionCapability `json:"start"`
	Stop              ActionCapability `json:"stop"`
	Restart           ActionCapability `json:"restart"`
	Retry             ActionCapability `json:"retry"`
}

type ServiceFailure struct {
	Action            string `json:"action,omitempty"`
	Stage             string `json:"stage,omitempty"`
	ErrorCode         string `json:"error_code"`
	Message           string `json:"message"`
	ArtifactReference string `json:"artifact_reference,omitempty"`
	OperationID       string `json:"operation_id,omitempty"`
	OccurredAtUnixMs  int64  `json:"occurred_at_unix_ms,omitempty"`
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

type OpenSessionRequest struct {
	RequestID string `json:"request_id"`
}

type OpenSession struct {
	State     string                       `json:"state"`
	Forward   *pfregistry.Forward          `json:"forward,omitempty"`
	AppPath   string                       `json:"app_path,omitempty"`
	Operation *pfregistry.ManagedOperation `json:"operation,omitempty"`
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
	TemplateReleaseCandidates(context.Context, string, ReleaseCandidateRequest) (*ReleaseCandidateResult, error)
	List(context.Context) ([]ServiceView, error)
	ServiceReleaseCandidates(context.Context, string, ReleaseCandidateRequest) (*ReleaseCandidateResult, error)
	CreateUpdatePlan(context.Context, string, UpdatePlanRequest) (*UpdatePlan, error)
	Settings(context.Context, string) (*ServiceSettingsView, error)
	UpdateSettings(context.Context, string, ServiceMetadataPatch) (*ServiceSettingsView, error)
	PreflightReconfigure(context.Context, string, ReconfigureDraft) (*ReconfigurePlan, error)
	Create(context.Context, CreateRequest) (*CreateResult, error)
	Operate(context.Context, string, OperationRequest) (*pfregistry.ManagedOperation, error)
	Cancel(context.Context, string) (*pfregistry.ManagedOperation, error)
	Operation(context.Context, string) (*pfregistry.ManagedOperation, error)
	Subscribe(string) (<-chan pfregistry.ManagedOperation, func(), error)
	Logs(context.Context, string, int) (*LogResult, error)
	OpenSession(context.Context, string, OpenSessionRequest) (*OpenSession, error)
	ReviewHostManagement(context.Context, string) (*HostManagementReview, error)
	RestoreHostManagement(context.Context, string, RestoreManagementRequest) error
}
