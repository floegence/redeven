package agentprotocol

import (
	"errors"
	"os"
	"sort"
	"strings"

	"github.com/floegence/redeven/internal/config"
	localuiruntime "github.com/floegence/redeven/internal/localui/runtime"
)

const (
	TargetKindLocalEnvironment = "local_environment"

	TargetStatusAvailable     = "available"
	TargetStatusConfigured    = "configured"
	TargetStatusNotConfigured = "not_configured"

	CapabilityLocalUI       = "local_ui"
	CapabilityRemoteControl = "remote_control"
	CapabilityFiles         = "files"
	CapabilityTerminal      = "terminal"
	CapabilityMonitor       = "monitor"
	CapabilityGit           = "git"
	CapabilityFlower        = "flower"
	CapabilityCodexGateway  = "codex_gateway"
)

var ErrTargetNotFound = errors.New("target not found")

type DiscoverTargetsOptions struct {
	StateRoot string
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

	runtimeState, err := localuiruntime.Load(layout.RuntimeStatePath)
	if err != nil {
		return TargetCatalog{}, err
	}

	target := TargetDescriptor{
		ID:               "local:" + config.DefaultLocalEnvironmentID,
		Kind:             TargetKindLocalEnvironment,
		Label:            "Local Environment",
		Status:           TargetStatusNotConfigured,
		StateRoot:        layout.StateRoot,
		StateDir:         layout.StateDir,
		ConfigPath:       layout.ConfigPath,
		RuntimeStatePath: layout.RuntimeStatePath,
		Capabilities:     []string{},
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
		if cfg.AI != nil && strings.TrimSpace(cfg.AI.CurrentModelID) != "" {
			target.Capabilities = append(target.Capabilities, CapabilityFlower)
		}
	} else {
		target.UnavailableReasonCode = "config_missing"
	}

	if runtimeState != nil {
		target.Status = TargetStatusAvailable
		target.LocalUIURL = strings.TrimSpace(runtimeState.LocalUIURL)
		target.LocalUIURLs = compactStrings(runtimeState.LocalUIURLs)
		target.PasswordRequired = runtimeState.PasswordRequired
		target.EffectiveRunMode = strings.TrimSpace(runtimeState.EffectiveRunMode)
		target.RemoteEnabled = runtimeState.RemoteEnabled
		target.DesktopManaged = runtimeState.DesktopManaged
		if target.ControlplaneBaseURL == "" {
			target.ControlplaneBaseURL = strings.TrimSpace(runtimeState.ControlplaneBaseURL)
		}
		if target.ControlplaneProvider == "" {
			target.ControlplaneProvider = strings.TrimSpace(runtimeState.ControlplaneProviderID)
		}
		if target.EnvPublicID == "" {
			target.EnvPublicID = strings.TrimSpace(runtimeState.EnvPublicID)
		}
		target.Capabilities = append(target.Capabilities,
			CapabilityLocalUI,
			CapabilityFiles,
			CapabilityTerminal,
			CapabilityMonitor,
			CapabilityGit,
			CapabilityCodexGateway,
		)
		target.UnavailableReasonCode = ""
	}

	target.Capabilities = sortedUniqueStrings(target.Capabilities)
	return TargetCatalog{Targets: []TargetDescriptor{target}}, nil
}

func ResolveTarget(catalog TargetCatalog, rawTarget string) (TargetDescriptor, error) {
	target := strings.TrimSpace(rawTarget)
	if target == "" && len(catalog.Targets) == 1 {
		return catalog.Targets[0], nil
	}
	normalized := strings.ToLower(target)
	for _, candidate := range catalog.Targets {
		if normalized == strings.ToLower(strings.TrimSpace(candidate.ID)) ||
			normalized == strings.ToLower(strings.TrimSpace(candidate.Label)) ||
			normalized == strings.ToLower(config.DefaultLocalEnvironmentID) ||
			target == strings.TrimSpace(candidate.EnvPublicID) ||
			target == strings.TrimSpace(candidate.LocalEnvironmentID) {
			return candidate, nil
		}
	}
	return TargetDescriptor{}, ErrTargetNotFound
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
