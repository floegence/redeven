// Frozen TemplateSpec v5 document shapes, used only by the registry upgrade
// edge. Keep these independent of executable runtime contracts.
package registry

type legacyV5TemplateParameter struct {
	Name        string `json:"name"`
	Label       string `json:"label"`
	Description string `json:"description,omitempty"`
	Type        string `json:"type"`
	Required    bool   `json:"required,omitempty"`
	Default     string `json:"default,omitempty"`
}

type legacyV5WebEndpointSpec struct {
	Scheme         string `json:"scheme"`
	ContainerPort  int    `json:"container_port,omitempty"`
	FixedHostPort  int    `json:"fixed_host_port,omitempty"`
	Path           string `json:"path,omitempty"`
	HealthPath     string `json:"health_path,omitempty"`
	HealthProtocol string `json:"health_protocol,omitempty"`
	StartupTimeout int    `json:"startup_timeout_sec,omitempty"`
}

type legacyV5HostArtifactSpec struct {
	DownloadURL       string `json:"download_url"`
	SizeBytes         int64  `json:"size_bytes"`
	SHA256            string `json:"sha256"`
	ExecutableRelPath string `json:"executable_rel_path"`
}

type legacyV5NPMHostPackageSpec struct {
	PackageName        string `json:"package_name"`
	Version            string `json:"version"`
	RegistryURL        string `json:"registry_url"`
	AuthTokenParameter string `json:"auth_token_parameter,omitempty"`
	Executable         string `json:"executable"`
}

type legacyV5HostOpenTargetSpec struct {
	Mode       string `json:"mode"`
	LinePrefix string `json:"line_prefix"`
}

type legacyV5HostTemplateSpec struct {
	InstallScript   string                      `json:"install_script,omitempty"`
	StartScript     string                      `json:"start_script"`
	StopScript      string                      `json:"stop_script,omitempty"`
	UninstallScript string                      `json:"uninstall_script,omitempty"`
	Environment     map[string]string           `json:"environment,omitempty"`
	Artifact        *legacyV5HostArtifactSpec   `json:"artifact,omitempty"`
	NPM             *legacyV5NPMHostPackageSpec `json:"npm,omitempty"`
	OpenTarget      *legacyV5HostOpenTargetSpec `json:"open_target,omitempty"`
}

type legacyV5ContainerMountSpec struct {
	ResourceID   string   `json:"resource_id,omitempty"`
	Type         string   `json:"type"`
	Source       string   `json:"source,omitempty"`
	Target       string   `json:"target"`
	ReadOnly     bool     `json:"read_only,omitempty"`
	TmpfsOptions []string `json:"tmpfs_options,omitempty"`
}

type legacyV5ContainerPortSpec struct {
	ResourceID    string `json:"resource_id,omitempty"`
	ContainerPort int    `json:"container_port"`
	HostPort      int    `json:"host_port,omitempty"`
	HostIP        string `json:"host_ip,omitempty"`
	Protocol      string `json:"protocol,omitempty"`
}

type legacyV5ContainerDeviceSpec struct {
	ResourceID    string `json:"resource_id,omitempty"`
	HostPath      string `json:"host_path"`
	ContainerPath string `json:"container_path,omitempty"`
	Permissions   string `json:"permissions,omitempty"`
}

type legacyV5ContainerTemplateSpec struct {
	Image          string                        `json:"image"`
	Entrypoint     []string                      `json:"entrypoint,omitempty"`
	Command        []string                      `json:"command,omitempty"`
	Environment    map[string]string             `json:"environment,omitempty"`
	Labels         map[string]string             `json:"labels,omitempty"`
	RestartPolicy  string                        `json:"restart_policy,omitempty"`
	NetworkMode    string                        `json:"network_mode,omitempty"`
	PIDMode        string                        `json:"pid_mode,omitempty"`
	IPCMode        string                        `json:"ipc_mode,omitempty"`
	Ports          []legacyV5ContainerPortSpec   `json:"ports,omitempty"`
	Mounts         []legacyV5ContainerMountSpec  `json:"mounts,omitempty"`
	CapAdd         []string                      `json:"cap_add,omitempty"`
	CapDrop        []string                      `json:"cap_drop,omitempty"`
	Devices        []legacyV5ContainerDeviceSpec `json:"devices,omitempty"`
	Privileged     bool                          `json:"privileged,omitempty"`
	SecurityOpts   []string                      `json:"security_opts,omitempty"`
	User           string                        `json:"user,omitempty"`
	ReadOnlyRoot   bool                          `json:"read_only_root"`
	MemoryBytes    int64                         `json:"memory_bytes,omitempty"`
	CPUs           float64                       `json:"cpus,omitempty"`
	PIDsLimit      int64                         `json:"pids_limit,omitempty"`
	ShmSizeBytes   int64                         `json:"shm_size_bytes,omitempty"`
	RuntimeProfile string                        `json:"runtime_profile,omitempty"`
}

type legacyV5ComposeTemplateSpec struct {
	YAML        string `json:"yaml"`
	MainService string `json:"main_service"`
}

type legacyV5TemplateSpec struct {
	SchemaVersion int                            `json:"schema_version"`
	Kind          string                         `json:"kind"`
	Endpoint      legacyV5WebEndpointSpec        `json:"endpoint"`
	Parameters    []legacyV5TemplateParameter    `json:"parameters,omitempty"`
	Host          *legacyV5HostTemplateSpec      `json:"host,omitempty"`
	Container     *legacyV5ContainerTemplateSpec `json:"container,omitempty"`
	Compose       *legacyV5ComposeTemplateSpec   `json:"compose,omitempty"`
}
