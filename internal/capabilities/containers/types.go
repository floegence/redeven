package containers

import "strings"

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
	MethodStatus                    Method = "containers.status"
	MethodList                      Method = "containers.list"
	MethodInspect                   Method = "containers.inspect"
	MethodStartPreflight            Method = "containers.start.preflight"
	MethodStart                     Method = "containers.start"
	MethodStop                      Method = "containers.stop"
	MethodRestart                   Method = "containers.restart"
	MethodRemove                    Method = "containers.remove"
	MethodLogsTail                  Method = "containers.logs.tail"
	MethodImagesPull                Method = "images.pull"
	MethodContainersStatsSnapshot   Method = "containers.stats.snapshot"
	MethodContainersStatsWatch      Method = "containers.stats.watch"
	MethodImagesList                Method = "images.list"
	MethodImagesInspect             Method = "images.inspect"
	MethodImagesHistory             Method = "images.history"
	MethodImagesTag                 Method = "images.tag"
	MethodImagesRemove              Method = "images.remove"
	MethodImagesRemovePreflight     Method = "images.remove.preflight"
	MethodImagesPrunePreflight      Method = "images.prune.preflight"
	MethodImagesPrune               Method = "images.prune"
	MethodVolumesList               Method = "volumes.list"
	MethodVolumesInspect            Method = "volumes.inspect"
	MethodVolumesCreate             Method = "volumes.create"
	MethodVolumesRemove             Method = "volumes.remove"
	MethodVolumesPrunePreflight     Method = "volumes.prune.preflight"
	MethodVolumesPrune              Method = "volumes.prune"
	MethodContainersCreatePreflight Method = "containers.create.preflight"
	MethodContainersCreate          Method = "containers.create"
	MethodContainersRemovePreflight Method = "containers.remove.preflight"
	MethodVolumesCreatePreflight    Method = "volumes.create.preflight"
	MethodVolumesRemovePreflight    Method = "volumes.remove.preflight"
	MethodPause                     Method = "containers.pause"
	MethodUnpause                   Method = "containers.unpause"
	MethodKill                      Method = "containers.kill"
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
		MethodContainersStatsSnapshot,
		MethodContainersStatsWatch,
		MethodImagesList, MethodImagesInspect, MethodImagesHistory, MethodImagesTag, MethodImagesRemovePreflight, MethodImagesRemove, MethodImagesPrunePreflight, MethodImagesPrune,
		MethodVolumesList, MethodVolumesInspect, MethodVolumesCreatePreflight, MethodVolumesCreate, MethodVolumesRemovePreflight, MethodVolumesRemove, MethodVolumesPrunePreflight, MethodVolumesPrune,
		MethodContainersCreatePreflight, MethodContainersCreate, MethodContainersRemovePreflight,
		MethodPause, MethodUnpause, MethodKill,
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
	Engine Engine `json:"engine"`
}

type StatusResponse struct {
	Engine        Engine `json:"engine"`
	Available     bool   `json:"available"`
	EngineVersion string `json:"engine_version,omitempty"`
}

type ContainerListRequest struct {
	Engine Engine `json:"engine"`
	All    bool   `json:"all,omitempty"`
}

type ContainerListResponse struct {
	Engine     Engine             `json:"engine"`
	Containers []ContainerSummary `json:"containers"`
}

type ContainerInspectRequest struct {
	Engine      Engine `json:"engine"`
	ContainerID string `json:"container_id"`
}

type ContainerInspectResponse struct {
	Engine    Engine           `json:"engine"`
	Container ContainerInspect `json:"container"`
}

type ContainerActionResponse struct {
	Engine      Engine `json:"engine"`
	Method      Method `json:"method"`
	ContainerID string `json:"container_id"`
	Completed   bool   `json:"completed"`
}

type ContainerActionRequest struct {
	Engine      Engine `json:"engine"`
	ContainerID string `json:"container_id"`
	Force       bool   `json:"force,omitempty"`
	TimeoutSec  int    `json:"timeout_sec,omitempty"`
}

type ContainerStartRequest struct {
	Engine      Engine `json:"engine"`
	ContainerID string `json:"container_id"`
}

type LogsTailRequest struct {
	Engine      Engine `json:"engine"`
	ContainerID string `json:"container_id"`
	TailLines   int    `json:"tail_lines,omitempty"`
	SinceUnixMs int64  `json:"since_unix_ms,omitempty"`
	Follow      bool   `json:"follow,omitempty"`
}

type ImagePullRequest struct {
	Engine   Engine `json:"engine"`
	ImageRef string `json:"image_ref"`
}

type LogsTailResponse struct {
	Engine      Engine    `json:"engine"`
	ContainerID string    `json:"container_id"`
	Lines       []LogLine `json:"lines"`
}

type LogLine struct {
	TimestampUnixMs int64  `json:"timestamp_unix_ms,omitempty"`
	Message         string `json:"message"`
}

type ImagePullResponse struct {
	Engine    Engine       `json:"engine"`
	Image     ImageSummary `json:"image"`
	Completed bool         `json:"completed"`
}

type ContainerStats struct {
	ContainerID    string  `json:"container_id"`
	CPUPercent     float64 `json:"cpu_percent"`
	MemoryBytes    int64   `json:"memory_bytes"`
	MemoryLimit    int64   `json:"memory_limit"`
	NetworkRxBytes int64   `json:"network_rx_bytes"`
	NetworkTxBytes int64   `json:"network_tx_bytes"`
}

type ContainerStatsWatchRequest struct {
	Engine      Engine `json:"engine"`
	ContainerID string `json:"container_id"`
	IntervalMS  int    `json:"interval_ms,omitempty"`
}

type ImageRecord struct {
	ID                          string   `json:"id"`
	Reference                   string   `json:"reference,omitempty"`
	Digest                      string   `json:"digest,omitempty"`
	Tags                        []string `json:"tags,omitempty"`
	SizeBytes                   int64    `json:"size_bytes,omitempty"`
	CreatedAtUnixMs             int64    `json:"created_at_unix_ms,omitempty"`
	ReferencedContainers        int      `json:"referenced_containers"`
	ReferenceInspectionFailures int      `json:"-"`
}

type ImageHistoryEntry struct {
	ID              string `json:"id,omitempty"`
	CreatedAtUnixMs int64  `json:"created_at_unix_ms,omitempty"`
	SizeBytes       int64  `json:"size_bytes,omitempty"`
}

type VolumeRecord struct {
	Name                        string `json:"name"`
	Driver                      string `json:"driver,omitempty"`
	Scope                       string `json:"scope,omitempty"`
	CreatedAtUnixMs             int64  `json:"created_at_unix_ms,omitempty"`
	ReferencedContainers        int    `json:"referenced_containers"`
	ReferenceInspectionFailures int    `json:"-"`
}

type ResourcePlan struct {
	Method        Method         `json:"method"`
	Target        map[string]any `json:"target"`
	Request       any            `json:"request"`
	PlanDigest    string         `json:"plan_digest"`
	Summary       []string       `json:"summary,omitempty"`
	RiskLevel     RiskLevel      `json:"risk_level"`
	RiskFlags     []RiskFlag     `json:"risk_flags"`
	RequiresAdmin bool           `json:"requires_admin"`
}

type ContainerSummary struct {
	ContainerID     string         `json:"container_id"`
	Name            string         `json:"name,omitempty"`
	Image           ImageSummary   `json:"image"`
	State           ContainerState `json:"state"`
	Health          string         `json:"health,omitempty"`
	CreatedAtUnixMs int64          `json:"created_at_unix_ms,omitempty"`
	Ports           []PortSummary  `json:"ports,omitempty"`
}

type ContainerInspect struct {
	ContainerID     string          `json:"container_id"`
	Name            string          `json:"name,omitempty"`
	Image           ImageSummary    `json:"image"`
	State           ContainerState  `json:"state"`
	Health          string          `json:"health,omitempty"`
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
	Method        Method                `json:"method"`
	Request       ContainerStartRequest `json:"request"`
	Target        TargetSummary         `json:"target"`
	Image         ImageSummary          `json:"image"`
	Runtime       RuntimeSummary        `json:"runtime"`
	RiskLevel     RiskLevel             `json:"risk_level"`
	RiskFlags     []RiskFlag            `json:"risk_flags"`
	RequiresAdmin bool                  `json:"requires_admin"`
	Summary       []string              `json:"summary,omitempty"`
}

func NewStartRequest(engine Engine, containerID string) ContainerStartRequest {
	return ContainerStartRequest{
		Engine:      engine,
		ContainerID: strings.TrimSpace(containerID),
	}
}
