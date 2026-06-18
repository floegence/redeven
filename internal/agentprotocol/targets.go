package agentprotocol

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/runtimemanagement"
)

const (
	TargetKindLocalEnvironment = "local_environment"

	TargetStatusAvailable     = "available"
	TargetStatusConfigured    = "configured"
	TargetStatusNotConfigured = "not_configured"

	TargetExecutionLocationLocalRuntime = "local_runtime"
	TargetExecutionLocationLocalHost    = "local_host"
	TargetExecutionLocationSSH          = "ssh_target"

	CapabilityLocalUI       = "local_ui"
	CapabilityRemoteControl = "remote_control"
	CapabilityFiles         = "files"
	CapabilityTerminal      = "terminal"
	CapabilityMonitor       = "monitor"
	CapabilityGit           = "git"
	CapabilityCodexAPI      = "codex_api"
)

var ErrTargetNotFound = errors.New("target not found")

const (
	TargetExecReasonUnsupportedTargetKind   = "unsupported_target_kind"
	TargetExecReasonPasswordAuthUnavailable = "password_auth_unavailable"
)

type DiscoverTargetsOptions struct {
	StateRoot string
}

type catalogConnectionRecord struct {
	SchemaVersion         int                `json:"schema_version"`
	RecordKind            string             `json:"record_kind"`
	Kind                  string             `json:"kind"`
	ID                    string             `json:"id"`
	Label                 string             `json:"label"`
	LocalUIURL            string             `json:"local_ui_url"`
	SSHDestination        string             `json:"ssh_destination"`
	SSHPort               *int               `json:"ssh_port"`
	AuthMode              string             `json:"auth_mode"`
	RuntimeRoot           string             `json:"runtime_root"`
	ConnectTimeoutSeconds *int               `json:"connect_timeout_seconds"`
	HostAccess            *runtimeHostAccess `json:"host_access"`
	Placement             *runtimePlacement  `json:"placement"`
}

type runtimeHostAccess struct {
	Kind string                `json:"kind"`
	SSH  *runtimeSSHHostAccess `json:"ssh"`
}

type runtimeSSHHostAccess struct {
	SSHDestination        string `json:"ssh_destination"`
	SSHPort               *int   `json:"ssh_port"`
	AuthMode              string `json:"auth_mode"`
	ConnectTimeoutSeconds *int   `json:"connect_timeout_seconds"`
}

type runtimePlacement struct {
	Kind            string `json:"kind"`
	RuntimeRoot     string `json:"runtime_root"`
	ContainerEngine string `json:"container_engine"`
	ContainerID     string `json:"container_id"`
	ContainerLabel  string `json:"container_label"`
	ContainerRef    string `json:"container_ref"`
}

func DiscoverTargets(opts DiscoverTargetsOptions) (TargetCatalog, error) {
	layout, err := config.LocalEnvironmentStateLayout(opts.StateRoot)
	if err != nil {
		return TargetCatalog{}, err
	}

	cfg, cfgErr := config.Load(layout.ConfigPath)
	if cfgErr != nil && !errors.Is(cfgErr, os.ErrNotExist) {
		return TargetCatalog{}, cfgErr
	}

	ctx, cancel := context.WithTimeout(context.Background(), 300*time.Millisecond)
	runtimeStatus, runtimeStatusErr := runtimemanagement.LoadStatus(ctx, layout.RuntimeControlSocketPath, 300*time.Millisecond)
	cancel()

	target := TargetDescriptor{
		ID:                       "local:" + config.DefaultLocalEnvironmentID,
		Kind:                     TargetKindLocalEnvironment,
		Label:                    "Local Environment",
		Status:                   TargetStatusNotConfigured,
		StateRoot:                layout.StateRoot,
		StateDir:                 layout.StateDir,
		ConfigPath:               layout.ConfigPath,
		RuntimeControlSocketPath: layout.RuntimeControlSocketPath,
		Capabilities:             []string{},
	}

	if cfg != nil {
		target.Status = TargetStatusConfigured
		target.ControlplaneBaseURL = strings.TrimSpace(cfg.ControlplaneBaseURL)
		target.ControlplaneProvider = strings.TrimSpace(cfg.ControlplaneProviderID)
		target.EnvPublicID = strings.TrimSpace(cfg.EnvironmentID)
		target.LocalEnvironmentID = strings.TrimSpace(cfg.LocalEnvironmentPublicID)
		target.AgentHomeDir = strings.TrimSpace(cfg.AgentHomeDir)
		target.Shell = strings.TrimSpace(cfg.Shell)
		if target.EnvPublicID != "" && target.ControlplaneBaseURL != "" {
			target.Capabilities = append(target.Capabilities, CapabilityRemoteControl)
		}
	} else {
		target.UnavailableReasonCode = "config_missing"
	}

	if runtimeStatusErr == nil && runtimeStatus.State == runtimemanagement.AttachStateReady && runtimeStatus.Endpoint != nil {
		target.Status = TargetStatusAvailable
		target.LocalUIURL = strings.TrimSpace(runtimeStatus.Endpoint.LocalUIURL)
		target.LocalUIURLs = compactStrings(runtimeStatus.Endpoint.LocalUIURLs)
		target.PasswordRequired = runtimeStatus.Endpoint.PasswordRequired
		target.EffectiveRunMode = strings.TrimSpace(runtimeStatus.RuntimeService.EffectiveRunMode)
		target.RemoteEnabled = runtimeStatus.RuntimeService.RemoteEnabled
		target.DesktopManaged = runtimeStatus.Identity.DesktopManaged
		if target.ControlplaneBaseURL == "" {
			target.ControlplaneBaseURL = strings.TrimSpace(runtimeStatus.RuntimeService.Bindings.ProviderLink.AccessPointOrigin)
		}
		if target.ControlplaneProvider == "" {
			target.ControlplaneProvider = strings.TrimSpace(runtimeStatus.RuntimeService.Bindings.ProviderLink.ProviderID)
		}
		if target.EnvPublicID == "" {
			target.EnvPublicID = strings.TrimSpace(runtimeStatus.RuntimeService.Bindings.ProviderLink.EnvPublicID)
		}
		target.Capabilities = append(target.Capabilities,
			CapabilityLocalUI,
			CapabilityFiles,
			CapabilityTerminal,
			CapabilityMonitor,
			CapabilityGit,
			CapabilityCodexAPI,
		)
		target.UnavailableReasonCode = ""
	}

	target.Capabilities = sortedUniqueStrings(target.Capabilities)
	target.Execution = &TargetExecutionRoute{Location: TargetExecutionLocationLocalRuntime}
	targets := []TargetDescriptor{target}
	catalogTargets, err := discoverCatalogConnectionTargets(layout.StateRoot)
	if err != nil {
		return TargetCatalog{}, err
	}
	targets = appendTargetsByID(targets, catalogTargets...)
	sort.SliceStable(targets, func(i, j int) bool {
		if targets[i].ID == "local:"+config.DefaultLocalEnvironmentID {
			return true
		}
		if targets[j].ID == "local:"+config.DefaultLocalEnvironmentID {
			return false
		}
		return strings.ToLower(targets[i].Label) < strings.ToLower(targets[j].Label)
	})
	return TargetCatalog{Targets: targets}, nil
}

func ResolveTarget(catalog TargetCatalog, rawTarget string) (TargetDescriptor, error) {
	target := strings.TrimSpace(rawTarget)
	normalized := strings.ToLower(target)
	if target == "" || normalized == "current" {
		if local, ok := localEnvironmentTarget(catalog); ok {
			return local, nil
		}
		if len(catalog.Targets) == 1 {
			return catalog.Targets[0], nil
		}
	}
	if normalized == strings.ToLower(config.DefaultLocalEnvironmentID) {
		if local, ok := localEnvironmentTarget(catalog); ok {
			return local, nil
		}
	}
	for _, candidate := range catalog.Targets {
		if targetMatches(candidate, target) ||
			normalized == strings.ToLower(strings.TrimSpace(candidate.Label)) ||
			target == strings.TrimSpace(candidate.EnvPublicID) ||
			target == strings.TrimSpace(candidate.LocalEnvironmentID) {
			return candidate, nil
		}
	}
	return TargetDescriptor{}, ErrTargetNotFound
}

func ResolveTargetForExecution(catalog TargetCatalog, rawTarget string) (TargetDescriptor, error) {
	target, err := ResolveTarget(catalog, rawTarget)
	if err == nil {
		return target, nil
	}
	requested := strings.TrimSpace(rawTarget)
	if requested == "" {
		return TargetDescriptor{}, err
	}
	if unsupportedTarget, ok := recognizedUnsupportedEnvironmentTarget(requested); ok {
		unsupportedTarget.UnavailableReasonCode = TargetExecReasonUnsupportedTargetKind
		return unsupportedTarget, nil
	}
	return TargetDescriptor{}, err
}

func discoverCatalogConnectionTargets(stateRoot string) ([]TargetDescriptor, error) {
	root := strings.TrimSpace(stateRoot)
	if root == "" {
		return nil, nil
	}
	connectionsDir := filepath.Join(root, "catalog", "connections")
	entries, err := os.ReadDir(connectionsDir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	targets := make([]TargetDescriptor, 0, len(entries))
	for _, entry := range entries {
		if entry == nil || entry.IsDir() || !strings.HasSuffix(strings.ToLower(entry.Name()), ".json") {
			continue
		}
		path := filepath.Join(connectionsDir, entry.Name())
		body, err := os.ReadFile(path)
		if err != nil {
			return nil, err
		}
		var record catalogConnectionRecord
		if err := json.Unmarshal(body, &record); err != nil {
			return nil, fmt.Errorf("read catalog connection %s: %w", path, err)
		}
		target, ok := targetFromCatalogConnection(record)
		if ok {
			targets = append(targets, target)
		}
	}
	return targets, nil
}

func targetFromCatalogConnection(record catalogConnectionRecord) (TargetDescriptor, bool) {
	if strings.TrimSpace(record.RecordKind) != "connection" {
		return TargetDescriptor{}, false
	}
	switch strings.TrimSpace(record.Kind) {
	case "url":
		return externalLocalUITargetFromCatalogConnection(record)
	case "ssh":
		route, ok := sshExecutionRoute(record.SSHDestination, record.SSHPort, record.AuthMode, record.ConnectTimeoutSeconds)
		if !ok {
			return TargetDescriptor{}, false
		}
		id := strings.TrimSpace(record.ID)
		if id == "" {
			id = "ssh:" + url.PathEscape(route.SSHDestination)
		}
		return TargetDescriptor{
			ID:           id,
			Kind:         TargetKindSSHEnvironment,
			Label:        firstNonEmpty(record.Label, route.SSHDestination),
			Status:       TargetStatusConfigured,
			Capabilities: []string{CapabilityTerminal},
			Execution:    route,
		}, true
	case "runtime_target":
		return targetFromRuntimeTargetConnection(record)
	default:
		return TargetDescriptor{}, false
	}
}

func externalLocalUITargetFromCatalogConnection(record catalogConnectionRecord) (TargetDescriptor, bool) {
	localUIURL, ok := cleanExternalLocalUIURL(record.LocalUIURL)
	if !ok {
		return TargetDescriptor{}, false
	}
	id := strings.TrimSpace(record.ID)
	if id == "" {
		id = "external_local_ui:" + url.PathEscape(localUIURL)
	}
	return TargetDescriptor{
		ID:                    id,
		Kind:                  TargetKindExternalLocalUI,
		Label:                 firstNonEmpty(record.Label, localUIURL),
		Status:                TargetStatusConfigured,
		LocalUIURL:            localUIURL,
		Capabilities:          []string{CapabilityLocalUI},
		UnavailableReasonCode: TargetExecReasonUnsupportedTargetKind,
	}, true
}

func cleanExternalLocalUIURL(raw string) (string, bool) {
	value := strings.TrimSpace(raw)
	if value == "" {
		return "", false
	}
	parsed, err := url.Parse(value)
	if err != nil || parsed == nil || strings.TrimSpace(parsed.Host) == "" {
		return "", false
	}
	switch strings.ToLower(strings.TrimSpace(parsed.Scheme)) {
	case "http", "https":
		return parsed.String(), true
	default:
		return "", false
	}
}

func targetFromRuntimeTargetConnection(record catalogConnectionRecord) (TargetDescriptor, bool) {
	if record.HostAccess == nil || record.Placement == nil {
		return TargetDescriptor{}, false
	}
	hostKind := strings.TrimSpace(record.HostAccess.Kind)
	placementKind := strings.TrimSpace(record.Placement.Kind)
	id := strings.TrimSpace(record.ID)
	if id == "" {
		return TargetDescriptor{}, false
	}
	target := TargetDescriptor{
		ID:           id,
		Label:        firstNonEmpty(record.Label, id),
		Status:       TargetStatusConfigured,
		Capabilities: []string{},
	}
	switch {
	case hostKind == "local_host" && placementKind == "host_process":
		target.Kind = TargetKindLocalHostRuntime
		target.Capabilities = []string{CapabilityTerminal}
		target.Execution = &TargetExecutionRoute{Location: TargetExecutionLocationLocalHost}
	case hostKind == "ssh_host" && placementKind == "host_process":
		if record.HostAccess.SSH == nil {
			return TargetDescriptor{}, false
		}
		route, ok := sshExecutionRoute(record.HostAccess.SSH.SSHDestination, record.HostAccess.SSH.SSHPort, record.HostAccess.SSH.AuthMode, record.HostAccess.SSH.ConnectTimeoutSeconds)
		if !ok {
			return TargetDescriptor{}, false
		}
		target.Kind = TargetKindSSHEnvironment
		target.Capabilities = []string{CapabilityTerminal}
		target.Execution = route
	case hostKind == "local_host" && placementKind == "container_process":
		target.Kind = TargetKindLocalContainerRuntime
		target.UnavailableReasonCode = TargetExecReasonUnsupportedTargetKind
	case hostKind == "ssh_host" && placementKind == "container_process":
		if record.HostAccess.SSH == nil {
			return TargetDescriptor{}, false
		}
		target.Kind = TargetKindSSHContainerRuntime
		target.UnavailableReasonCode = TargetExecReasonUnsupportedTargetKind
	default:
		return TargetDescriptor{}, false
	}
	target.Capabilities = sortedUniqueStrings(target.Capabilities)
	return target, true
}

func sshExecutionRoute(destination string, port *int, authMode string, connectTimeoutSeconds *int) (*TargetExecutionRoute, bool) {
	destination = strings.TrimSpace(destination)
	if destination == "" || strings.Contains(destination, "://") || strings.HasPrefix(destination, "-") || strings.IndexFunc(destination, func(r rune) bool {
		return r == ' ' || r == '\t' || r == '\n' || r == '\r'
	}) >= 0 {
		return nil, false
	}
	cleanPort := validSSHPort(port)
	cleanAuthMode := strings.TrimSpace(strings.ToLower(authMode))
	switch cleanAuthMode {
	case "", "key", "agent", "key_or_agent", "key_agent":
		cleanAuthMode = "key_agent"
	case "password":
		cleanAuthMode = "password"
	default:
		return nil, false
	}
	timeout := 10
	if connectTimeoutSeconds != nil && *connectTimeoutSeconds > 0 {
		timeout = *connectTimeoutSeconds
	}
	return &TargetExecutionRoute{
		Location:                 TargetExecutionLocationSSH,
		SSHDestination:           destination,
		SSHPort:                  cleanPort,
		SSHAuthMode:              cleanAuthMode,
		SSHConnectTimeoutSeconds: timeout,
	}, true
}

func validSSHPort(port *int) *int {
	if port == nil || *port < 1 || *port > 65535 {
		return nil
	}
	v := *port
	return &v
}

func appendTargetsByID(targets []TargetDescriptor, additions ...TargetDescriptor) []TargetDescriptor {
	seen := make(map[string]int, len(targets)+len(additions))
	for i := range targets {
		seen[strings.TrimSpace(targets[i].ID)] = i
	}
	for _, target := range additions {
		id := strings.TrimSpace(target.ID)
		if id == "" {
			continue
		}
		target.ID = id
		target.Capabilities = sortedUniqueStrings(target.Capabilities)
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = len(targets)
		targets = append(targets, target)
	}
	return targets
}

func localEnvironmentTarget(catalog TargetCatalog) (TargetDescriptor, bool) {
	for _, candidate := range catalog.Targets {
		if strings.TrimSpace(candidate.ID) == "local:"+config.DefaultLocalEnvironmentID {
			return candidate, true
		}
	}
	return TargetDescriptor{}, false
}

func targetMatches(candidate TargetDescriptor, rawTarget string) bool {
	target := strings.TrimSpace(rawTarget)
	candidateID := strings.TrimSpace(candidate.ID)
	if target == "" || candidateID == "" {
		return false
	}
	if strings.EqualFold(target, candidateID) {
		return true
	}
	if decoded, err := url.PathUnescape(target); err == nil && strings.EqualFold(decoded, candidateID) {
		return true
	}
	for _, prefix := range []string{"ssh:", "local:"} {
		if strings.HasPrefix(strings.ToLower(target), prefix) {
			rest := strings.TrimSpace(target[len(prefix):])
			if strings.EqualFold(rest, candidateID) {
				return true
			}
			if decoded, err := url.PathUnescape(rest); err == nil && strings.EqualFold(decoded, candidateID) {
				return true
			}
		}
	}
	return false
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func compactStrings(values []string) []string {
	if len(values) == 0 {
		return nil
	}
	out := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	return out
}

func sortedUniqueStrings(values []string) []string {
	out := compactStrings(values)
	sort.Strings(out)
	return out
}
