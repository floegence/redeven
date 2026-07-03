package containers

import "strings"

const (
	SchemaVersion     = "redeven.capability.container_resources.v1"
	CapabilityID      = "redeven.capability.container_resources"
	CapabilityVersion = "1.0.0"
)

type Engine string

const (
	EngineDocker Engine = "docker"
	EnginePodman Engine = "podman"
)

func (e Engine) Valid() bool {
	switch e {
	case EngineDocker, EnginePodman:
		return true
	default:
		return false
	}
}

type Method string

const (
	MethodStatus         Method = "containers.status"
	MethodList           Method = "containers.list"
	MethodInspect        Method = "containers.inspect"
	MethodStartPreflight Method = "containers.start.preflight"
	MethodStart          Method = "containers.start"
	MethodStop           Method = "containers.stop"
	MethodRestart        Method = "containers.restart"
	MethodRemove         Method = "containers.remove"
	MethodLogsTail       Method = "containers.logs.tail"
	MethodImagesPull     Method = "images.pull"
)

func Methods() []Method {
	return []Method{
		MethodStatus,
		MethodList,
		MethodInspect,
		MethodStartPreflight,
		MethodStart,
		MethodStop,
		MethodRestart,
		MethodRemove,
		MethodLogsTail,
		MethodImagesPull,
	}
}

type ContainerState string

const (
	ContainerStateCreated    ContainerState = "created"
	ContainerStateRunning    ContainerState = "running"
	ContainerStatePaused     ContainerState = "paused"
	ContainerStateRestarting ContainerState = "restarting"
	ContainerStateExited     ContainerState = "exited"
	ContainerStateStopped    ContainerState = "stopped"
	ContainerStateUnknown    ContainerState = "unknown"
)

type RiskSeverity string

const (
	RiskSeverityLow      RiskSeverity = "low"
	RiskSeverityMedium   RiskSeverity = "medium"
	RiskSeverityHigh     RiskSeverity = "high"
	RiskSeverityCritical RiskSeverity = "critical"
)

type RiskLevel string

const (
	RiskLevelNone     RiskLevel = "none"
	RiskLevelLow      RiskLevel = "low"
	RiskLevelMedium   RiskLevel = "medium"
	RiskLevelHigh     RiskLevel = "high"
	RiskLevelCritical RiskLevel = "critical"
)

type StatusRequest struct {
	SchemaVersion string `json:"schema_version"`
}

type StatusResponse struct {
	SchemaVersion     string `json:"schema_version"`
	CapabilityID      string `json:"capability_id"`
	CapabilityVersion string `json:"capability_version"`
	Engine            Engine `json:"engine"`
	Available         bool   `json:"available"`
	EngineVersion     string `json:"engine_version,omitempty"`
}

type ContainerListRequest struct {
	SchemaVersion string `json:"schema_version"`
	Engine        Engine `json:"engine,omitempty"`
	All           bool   `json:"all,omitempty"`
}

type ContainerListResponse struct {
	SchemaVersion string             `json:"schema_version"`
	CapabilityID  string             `json:"capability_id"`
	Engine        Engine             `json:"engine"`
	Containers    []ContainerSummary `json:"containers"`
}

type ContainerInspectRequest struct {
	SchemaVersion string `json:"schema_version"`
	Engine        Engine `json:"engine"`
	ContainerID   string `json:"container_id"`
}

type ContainerInspectResponse struct {
	SchemaVersion string           `json:"schema_version"`
	CapabilityID  string           `json:"capability_id"`
	Engine        Engine           `json:"engine"`
	Container     ContainerInspect `json:"container"`
}

type ContainerActionRequest struct {
	SchemaVersion string `json:"schema_version"`
	Engine        Engine `json:"engine"`
	ContainerID   string `json:"container_id"`
	Force         bool   `json:"force,omitempty"`
	TimeoutSec    int    `json:"timeout_sec,omitempty"`
}

type ContainerStartRequest struct {
	SchemaVersion string `json:"schema_version"`
	Engine        Engine `json:"engine"`
	ContainerID   string `json:"container_id"`
}

type LogsTailRequest struct {
	SchemaVersion string `json:"schema_version"`
	Engine        Engine `json:"engine"`
	ContainerID   string `json:"container_id"`
	TailLines     int    `json:"tail_lines,omitempty"`
	SinceUnixMs   int64  `json:"since_unix_ms,omitempty"`
	Follow        bool   `json:"follow,omitempty"`
}

type ImagePullRequest struct {
	SchemaVersion string `json:"schema_version"`
	Engine        Engine `json:"engine"`
	ImageRef      string `json:"image_ref"`
}

type ContainerSummary struct {
	ContainerID     string         `json:"container_id"`
	Name            string         `json:"name,omitempty"`
	Image           ImageSummary   `json:"image"`
	State           ContainerState `json:"state"`
	CreatedAtUnixMs int64          `json:"created_at_unix_ms,omitempty"`
	Ports           []PortSummary  `json:"ports,omitempty"`
}

type ContainerInspect struct {
	ContainerID     string          `json:"container_id"`
	Name            string          `json:"name,omitempty"`
	Image           ImageSummary    `json:"image"`
	State           ContainerState  `json:"state"`
	CreatedAtUnixMs int64           `json:"created_at_unix_ms,omitempty"`
	Runtime         RuntimeSummary  `json:"runtime"`
	Labels          LabelSummary    `json:"labels"`
	Ports           []PortSummary   `json:"ports,omitempty"`
	Mounts          []MountSummary  `json:"mounts,omitempty"`
	Devices         []DeviceSummary `json:"devices,omitempty"`
}

type ImageSummary struct {
	Reference    string `json:"reference,omitempty"`
	Digest       string `json:"digest,omitempty"`
	DigestPinned bool   `json:"digest_pinned"`
}

type RuntimeSummary struct {
	Privileged    bool            `json:"privileged"`
	NetworkMode   string          `json:"network_mode,omitempty"`
	PIDMode       string          `json:"pid_mode,omitempty"`
	IPCMode       string          `json:"ipc_mode,omitempty"`
	RestartPolicy string          `json:"restart_policy,omitempty"`
	Env           EnvSummary      `json:"env"`
	Labels        LabelSummary    `json:"labels"`
	Mounts        []MountSummary  `json:"mounts,omitempty"`
	Devices       []DeviceSummary `json:"devices,omitempty"`
	CapAdd        []string        `json:"cap_add,omitempty"`
	CapDrop       []string        `json:"cap_drop,omitempty"`
}

type EnvSummary struct {
	Total           int `json:"total"`
	PlainCount      int `json:"plain_count"`
	SecretLikeCount int `json:"secret_like_count"`
}

type LabelSummary struct {
	Total           int `json:"total"`
	PlainCount      int `json:"plain_count"`
	SecretLikeCount int `json:"secret_like_count"`
}

type MountType string

const (
	MountTypeBind   MountType = "bind"
	MountTypeVolume MountType = "volume"
	MountTypeTmpfs  MountType = "tmpfs"
	MountTypeOther  MountType = "other"
)

type MountSourceKind string

const (
	MountSourceHostPath        MountSourceKind = "host_path"
	MountSourceNamedVolume     MountSourceKind = "named_volume"
	MountSourceTmpfs           MountSourceKind = "tmpfs"
	MountSourceContainerSocket MountSourceKind = "container_socket"
	MountSourceUnknown         MountSourceKind = "unknown"
)

type MountSummary struct {
	Type            MountType       `json:"type"`
	Source          string          `json:"source,omitempty"`
	Target          string          `json:"target,omitempty"`
	SourceKind      MountSourceKind `json:"source_kind"`
	ReadOnly        bool            `json:"read_only"`
	SensitivePath   bool            `json:"sensitive_path,omitempty"`
	ContainerSocket bool            `json:"container_socket,omitempty"`
}

type DeviceSummary struct {
	HostPath      string `json:"host_path,omitempty"`
	ContainerPath string `json:"container_path,omitempty"`
	Permissions   string `json:"permissions,omitempty"`
	SensitivePath bool   `json:"sensitive_path,omitempty"`
}

type PortSummary struct {
	Protocol string `json:"protocol,omitempty"`
	HostIP   string `json:"host_ip,omitempty"`
	HostPort int    `json:"host_port,omitempty"`
	Port     int    `json:"port"`
}

type TargetSummary struct {
	Engine        Engine `json:"engine"`
	ContainerID   string `json:"container_id"`
	ContainerName string `json:"container_name,omitempty"`
	TargetHash    string `json:"target_hash"`
}

type RiskFlag struct {
	ID            string       `json:"id"`
	Severity      RiskSeverity `json:"severity"`
	Title         string       `json:"title"`
	Detail        string       `json:"detail,omitempty"`
	AdminRequired bool         `json:"admin_required,omitempty"`
}

type StartPreflightPlan struct {
	SchemaVersion     string                `json:"schema_version"`
	CapabilityID      string                `json:"capability_id"`
	CapabilityVersion string                `json:"capability_version"`
	Method            Method                `json:"method"`
	Request           ContainerStartRequest `json:"request"`
	Target            TargetSummary         `json:"target"`
	Image             ImageSummary          `json:"image"`
	Runtime           RuntimeSummary        `json:"runtime"`
	RiskLevel         RiskLevel             `json:"risk_level"`
	RiskFlags         []RiskFlag            `json:"risk_flags"`
	RequiresAdmin     bool                  `json:"requires_admin"`
	Summary           []string              `json:"summary,omitempty"`
}

func NewStartRequest(engine Engine, containerID string) ContainerStartRequest {
	return ContainerStartRequest{
		SchemaVersion: SchemaVersion,
		Engine:        engine,
		ContainerID:   strings.TrimSpace(containerID),
	}
}
