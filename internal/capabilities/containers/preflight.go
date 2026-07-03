package containers

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"sort"
	"strings"
)

const redactedSensitivePath = "[redacted:sensitive_path]"

type StartPreflightInput struct {
	Engine        Engine
	ContainerID   string
	ContainerName string
	Image         ImageInput
	Runtime       RuntimeInput
}

type ImageInput struct {
	Reference string
	Digest    string
}

type RuntimeInput struct {
	Privileged    bool
	NetworkMode   string
	PIDMode       string
	IPCMode       string
	RestartPolicy string
	Env           []string
	Labels        map[string]string
	Mounts        []MountInput
	Devices       []DeviceInput
	CapAdd        []string
	CapDrop       []string
}

type MountInput struct {
	Type     MountType
	Source   string
	Target   string
	ReadOnly bool
}

type DeviceInput struct {
	HostPath      string
	ContainerPath string
	Permissions   string
}

func BuildStartPreflightPlan(input StartPreflightInput) (StartPreflightPlan, error) {
	engine := input.Engine
	containerID := strings.TrimSpace(input.ContainerID)
	if !engine.Valid() {
		return StartPreflightPlan{}, fmt.Errorf("invalid engine: %q", engine)
	}
	if containerID == "" {
		return StartPreflightPlan{}, errors.New("container_id is required")
	}

	image := ImageSummary{
		Reference:    strings.TrimSpace(input.Image.Reference),
		Digest:       strings.TrimSpace(input.Image.Digest),
		DigestPinned: strings.TrimSpace(input.Image.Digest) != "",
	}
	runtime := RuntimeSummary{
		Privileged:    input.Runtime.Privileged,
		NetworkMode:   strings.TrimSpace(input.Runtime.NetworkMode),
		PIDMode:       strings.TrimSpace(input.Runtime.PIDMode),
		IPCMode:       strings.TrimSpace(input.Runtime.IPCMode),
		RestartPolicy: strings.TrimSpace(input.Runtime.RestartPolicy),
		Env:           summarizeEnv(input.Runtime.Env),
		Labels:        summarizeLabels(input.Runtime.Labels),
		Mounts:        summarizeMounts(input.Runtime.Mounts),
		Devices:       summarizeDevices(input.Runtime.Devices),
		CapAdd:        normalizeCaps(input.Runtime.CapAdd),
		CapDrop:       normalizeCaps(input.Runtime.CapDrop),
	}

	target := TargetSummary{
		Engine:        engine,
		ContainerID:   containerID,
		ContainerName: strings.TrimSpace(input.ContainerName),
		TargetHash: hashTarget(targetHashInput{
			SchemaVersion:  SchemaVersion,
			Engine:         engine,
			ContainerID:    containerID,
			ContainerName:  strings.TrimSpace(input.ContainerName),
			ImageReference: image.Reference,
			ImageDigest:    image.Digest,
		}),
	}

	risks := startRiskFlags(image, runtime)
	sort.Slice(risks, func(i, j int) bool {
		if risks[i].Severity == risks[j].Severity {
			return risks[i].ID < risks[j].ID
		}
		return riskSeverityRank(risks[i].Severity) > riskSeverityRank(risks[j].Severity)
	})

	return StartPreflightPlan{
		SchemaVersion:     SchemaVersion,
		CapabilityID:      CapabilityID,
		CapabilityVersion: CapabilityVersion,
		Method:            MethodStart,
		Request:           NewStartRequest(engine, containerID),
		Target:            target,
		Image:             image,
		Runtime:           runtime,
		RiskLevel:         maxRiskLevel(risks),
		RiskFlags:         risks,
		RequiresAdmin:     requiresAdmin(risks),
		Summary:           startRiskSummary(risks),
	}, nil
}

type targetHashInput struct {
	SchemaVersion  string `json:"schema_version"`
	Engine         Engine `json:"engine"`
	ContainerID    string `json:"container_id"`
	ContainerName  string `json:"container_name,omitempty"`
	ImageReference string `json:"image_reference,omitempty"`
	ImageDigest    string `json:"image_digest,omitempty"`
}

func hashTarget(input targetHashInput) string {
	raw, err := json.Marshal(input)
	if err != nil {
		panic(err)
	}
	sum := sha256.Sum256(raw)
	return "sha256:" + hex.EncodeToString(sum[:])
}

func summarizeEnv(values []string) EnvSummary {
	summary := EnvSummary{Total: len(values)}
	for _, value := range values {
		key := envKey(value)
		if isSensitiveName(key) {
			summary.SecretLikeCount++
			continue
		}
		summary.PlainCount++
	}
	return summary
}

func envKey(value string) string {
	key, _, found := strings.Cut(strings.TrimSpace(value), "=")
	if !found {
		key = strings.TrimSpace(value)
	}
	return strings.TrimSpace(key)
}

func summarizeLabels(labels map[string]string) LabelSummary {
	summary := LabelSummary{Total: len(labels)}
	for key := range labels {
		if isSensitiveName(key) {
			summary.SecretLikeCount++
			continue
		}
		summary.PlainCount++
	}
	return summary
}

func summarizeMounts(inputs []MountInput) []MountSummary {
	out := make([]MountSummary, 0, len(inputs))
	for _, input := range inputs {
		mountType := input.Type
		if mountType == "" {
			mountType = MountTypeOther
		}
		source := strings.TrimSpace(input.Source)
		target := strings.TrimSpace(input.Target)
		socket := isContainerSocketPath(source) || isContainerSocketPath(target)
		sensitive := isSensitivePath(source) || isSensitivePath(target)
		out = append(out, MountSummary{
			Type:            mountType,
			Source:          redactPath(source),
			Target:          redactPath(target),
			SourceKind:      mountSourceKind(mountType, source, socket),
			ReadOnly:        input.ReadOnly,
			SensitivePath:   sensitive,
			ContainerSocket: socket,
		})
	}
	sort.Slice(out, func(i, j int) bool {
		return mountSortKey(out[i]) < mountSortKey(out[j])
	})
	return out
}

func mountSortKey(m MountSummary) string {
	return string(m.Type) + "\x00" + m.Source + "\x00" + m.Target
}

func mountSourceKind(mountType MountType, source string, socket bool) MountSourceKind {
	if socket {
		return MountSourceContainerSocket
	}
	switch mountType {
	case MountTypeBind:
		return MountSourceHostPath
	case MountTypeVolume:
		if strings.TrimSpace(source) == "" {
			return MountSourceUnknown
		}
		return MountSourceNamedVolume
	case MountTypeTmpfs:
		return MountSourceTmpfs
	default:
		return MountSourceUnknown
	}
}

func summarizeDevices(inputs []DeviceInput) []DeviceSummary {
	out := make([]DeviceSummary, 0, len(inputs))
	for _, input := range inputs {
		hostPath := strings.TrimSpace(input.HostPath)
		containerPath := strings.TrimSpace(input.ContainerPath)
		sensitive := isSensitivePath(hostPath) || isSensitivePath(containerPath)
		out = append(out, DeviceSummary{
			HostPath:      redactPath(hostPath),
			ContainerPath: redactPath(containerPath),
			Permissions:   strings.TrimSpace(input.Permissions),
			SensitivePath: sensitive,
		})
	}
	sort.Slice(out, func(i, j int) bool {
		return out[i].HostPath+"\x00"+out[i].ContainerPath < out[j].HostPath+"\x00"+out[j].ContainerPath
	})
	return out
}

func normalizeCaps(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		capability := strings.ToUpper(strings.TrimSpace(value))
		if capability == "" {
			continue
		}
		seen[capability] = struct{}{}
	}
	out := make([]string, 0, len(seen))
	for value := range seen {
		out = append(out, value)
	}
	sort.Strings(out)
	return out
}

func startRiskFlags(image ImageSummary, runtime RuntimeSummary) []RiskFlag {
	var risks []RiskFlag
	if runtime.Privileged {
		risks = append(risks, RiskFlag{
			ID:            "container_privileged",
			Severity:      RiskSeverityCritical,
			Title:         "Privileged container",
			Detail:        "The container can receive broad host-level privileges.",
			AdminRequired: true,
		})
	}
	if strings.EqualFold(runtime.NetworkMode, "host") {
		risks = append(risks, RiskFlag{
			ID:            "host_network",
			Severity:      RiskSeverityHigh,
			Title:         "Host network namespace",
			Detail:        "The container shares the host network namespace.",
			AdminRequired: true,
		})
	}
	if strings.EqualFold(runtime.PIDMode, "host") {
		risks = append(risks, RiskFlag{
			ID:            "host_pid_namespace",
			Severity:      RiskSeverityHigh,
			Title:         "Host PID namespace",
			Detail:        "The container can observe host processes.",
			AdminRequired: true,
		})
	}
	if strings.EqualFold(runtime.IPCMode, "host") {
		risks = append(risks, RiskFlag{
			ID:            "host_ipc_namespace",
			Severity:      RiskSeverityHigh,
			Title:         "Host IPC namespace",
			Detail:        "The container shares the host IPC namespace.",
			AdminRequired: true,
		})
	}
	if len(runtime.Devices) > 0 {
		risks = append(risks, RiskFlag{
			ID:            "host_device",
			Severity:      RiskSeverityHigh,
			Title:         "Host device access",
			Detail:        "The container receives one or more host device mappings.",
			AdminRequired: true,
		})
	}
	if len(runtime.CapAdd) > 0 {
		severity := RiskSeverityHigh
		adminRequired := true
		if onlyLowImpactCaps(runtime.CapAdd) {
			severity = RiskSeverityMedium
			adminRequired = false
		}
		risks = append(risks, RiskFlag{
			ID:            "added_linux_capability",
			Severity:      severity,
			Title:         "Added Linux capabilities",
			Detail:        "The container adds Linux capabilities beyond the default runtime set.",
			AdminRequired: adminRequired,
		})
	}
	for _, mount := range runtime.Mounts {
		if mount.ContainerSocket {
			risks = append(risks, RiskFlag{
				ID:            "container_socket_mount",
				Severity:      RiskSeverityCritical,
				Title:         "Container engine socket mount",
				Detail:        "The container can reach a Docker or Podman socket through a mounted path.",
				AdminRequired: true,
			})
			break
		}
	}
	for _, mount := range runtime.Mounts {
		if mount.Type == MountTypeBind {
			risks = append(risks, RiskFlag{
				ID:       "host_bind_mount",
				Severity: RiskSeverityMedium,
				Title:    "Host bind mount",
				Detail:   "The container receives one or more host bind mounts.",
			})
			break
		}
	}
	for _, mount := range runtime.Mounts {
		if mount.SensitivePath {
			risks = append(risks, RiskFlag{
				ID:       "sensitive_mount_path",
				Severity: RiskSeverityHigh,
				Title:    "Sensitive mount path",
				Detail:   "At least one mount path appears to contain credentials or private material.",
			})
			break
		}
	}
	if runtime.Env.SecretLikeCount > 0 {
		risks = append(risks, RiskFlag{
			ID:       "secret_environment",
			Severity: RiskSeverityMedium,
			Title:    "Secret-like environment variables",
			Detail:   "One or more environment variable names indicate secret material may be present.",
		})
	}
	if runtime.Labels.SecretLikeCount > 0 {
		risks = append(risks, RiskFlag{
			ID:       "secret_labels",
			Severity: RiskSeverityMedium,
			Title:    "Secret-like labels",
			Detail:   "One or more container label names indicate secret material may be present.",
		})
	}
	if isPersistentRestartPolicy(runtime.RestartPolicy) {
		risks = append(risks, RiskFlag{
			ID:       "persistent_restart_policy",
			Severity: RiskSeverityMedium,
			Title:    "Persistent restart policy",
			Detail:   "The container may restart automatically after failure or host restart.",
		})
	}
	if image.Reference != "" && !image.DigestPinned {
		risks = append(risks, RiskFlag{
			ID:       "image_not_digest_pinned",
			Severity: RiskSeverityLow,
			Title:    "Image is not digest-pinned",
			Detail:   "The image reference does not include a resolved digest.",
		})
	}
	return dedupeRisks(risks)
}

func dedupeRisks(risks []RiskFlag) []RiskFlag {
	seen := make(map[string]struct{}, len(risks))
	out := make([]RiskFlag, 0, len(risks))
	for _, risk := range risks {
		if _, ok := seen[risk.ID]; ok {
			continue
		}
		seen[risk.ID] = struct{}{}
		out = append(out, risk)
	}
	return out
}

func onlyLowImpactCaps(caps []string) bool {
	lowImpact := map[string]struct{}{
		"CHOWN":            {},
		"DAC_OVERRIDE":     {},
		"FOWNER":           {},
		"FSETID":           {},
		"KILL":             {},
		"SETGID":           {},
		"SETUID":           {},
		"SETPCAP":          {},
		"NET_BIND_SERVICE": {},
		"SYS_CHROOT":       {},
		"MKNOD":            {},
		"AUDIT_WRITE":      {},
		"SETFCAP":          {},
	}
	for _, capability := range caps {
		if _, ok := lowImpact[capability]; !ok {
			return false
		}
	}
	return true
}

func maxRiskLevel(risks []RiskFlag) RiskLevel {
	if len(risks) == 0 {
		return RiskLevelNone
	}
	maxRank := 0
	for _, risk := range risks {
		maxRank = max(maxRank, riskSeverityRank(risk.Severity))
	}
	switch maxRank {
	case 4:
		return RiskLevelCritical
	case 3:
		return RiskLevelHigh
	case 2:
		return RiskLevelMedium
	default:
		return RiskLevelLow
	}
}

func riskSeverityRank(severity RiskSeverity) int {
	switch severity {
	case RiskSeverityCritical:
		return 4
	case RiskSeverityHigh:
		return 3
	case RiskSeverityMedium:
		return 2
	case RiskSeverityLow:
		return 1
	default:
		return 0
	}
}

func requiresAdmin(risks []RiskFlag) bool {
	for _, risk := range risks {
		if risk.AdminRequired {
			return true
		}
	}
	return false
}

func startRiskSummary(risks []RiskFlag) []string {
	if len(risks) == 0 {
		return []string{"No elevated container start risks were detected."}
	}
	out := make([]string, 0, min(len(risks), 4))
	for i, risk := range risks {
		if i >= 4 {
			break
		}
		out = append(out, risk.Title)
	}
	return out
}

func isPersistentRestartPolicy(policy string) bool {
	switch strings.ToLower(strings.TrimSpace(policy)) {
	case "always", "unless-stopped", "on-failure":
		return true
	default:
		return false
	}
}

func redactPath(path string) string {
	path = strings.TrimSpace(path)
	if path == "" {
		return ""
	}
	if isSensitivePath(path) {
		return redactedSensitivePath
	}
	return path
}

func isSensitivePath(path string) bool {
	path = strings.TrimSpace(path)
	if path == "" {
		return false
	}
	lower := strings.ToLower(filepath.ToSlash(path))
	for _, needle := range []string{
		"/.ssh",
		"/secrets",
		"/secret",
		"/credentials",
		"/credential",
		"/password",
		"/private",
		"/keychain",
		"/vault",
		"id_rsa",
		"id_ed25519",
		"private_key",
		"api_key",
		"access_token",
	} {
		if strings.Contains(lower, needle) {
			return true
		}
	}
	base := strings.ToLower(filepath.Base(lower))
	return isSensitiveName(base)
}

func isSensitiveName(name string) bool {
	clean := strings.ToLower(strings.TrimSpace(name))
	if clean == "" {
		return false
	}
	for _, needle := range []string{
		"secret",
		"token",
		"password",
		"passwd",
		"credential",
		"private_key",
		"api_key",
		"apikey",
		"access_key",
		"auth",
		"bearer",
		"cert",
	} {
		if strings.Contains(clean, needle) {
			return true
		}
	}
	return clean == "key" || strings.HasSuffix(clean, "_key")
}

func isContainerSocketPath(path string) bool {
	lower := strings.ToLower(filepath.ToSlash(strings.TrimSpace(path)))
	if lower == "" {
		return false
	}
	return strings.HasSuffix(lower, "/docker.sock") ||
		strings.HasSuffix(lower, "/podman.sock") ||
		strings.Contains(lower, "/docker/docker.sock") ||
		strings.Contains(lower, "/podman/podman.sock")
}
