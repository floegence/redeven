package managedwebservice

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"strings"

	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
)

const runtimeSpecIdentitySchemaVersion = 1

type resolvedRuntime struct {
	Template            Template
	BaseSpec            TemplateSpec
	Spec                TemplateSpec
	Configuration       serviceConfiguration
	ConfigurationJSON   string
	ConfigurationSHA256 string
	Release             ReleaseIdentity
	Binding             runtimeBinding
	Parameters          map[string]string
	RuntimeSpecSHA256   string
}

func (r resolvedRuntime) applyTo(service *pfregistry.ManagedService) {
	if service == nil {
		return
	}
	service.ConfigurationJSON = r.ConfigurationJSON
	service.ConfigurationSHA256 = r.ConfigurationSHA256
}

// resolveCurrentRuntime is the only bridge from persisted instance state to
// executable behavior. It always starts from the current template definition.
func (m *Manager) resolveCurrentRuntime(ctx context.Context, service *pfregistry.ManagedService) (*resolvedRuntime, error) {
	if service == nil {
		return nil, serviceError("SERVICE_NOT_FOUND", "The managed Web Service was not found.", 404, false, nil)
	}
	template, err := m.Template(ctx, service.TemplateID)
	if err != nil {
		return nil, err
	}
	if template.Spec == nil {
		return nil, serviceError("TEMPLATE_UNAVAILABLE", "The current template runtime definition is unavailable.", 409, true, nil)
	}
	binding, err := decodeRuntimeBinding(service)
	if err != nil {
		return nil, err
	}
	if err := validateRuntimeBindingTemplate(binding, template); err != nil {
		return nil, err
	}
	release, err := decodeReleaseIdentity(service.ReleaseIdentityJSON, service.ReleaseIdentitySHA256)
	if err != nil {
		return nil, serviceError("RELEASE_IDENTITY_INVALID", "The managed Web Service release identity is invalid.", 409, false, err)
	}

	base := cloneTemplateSpec(*template.Spec)
	materialized, err := materializeCurrentRelease(base, *release)
	if err != nil {
		return nil, err
	}
	savedConfiguration, err := decodeServiceConfiguration(service.ConfigurationJSON)
	if err != nil {
		return nil, err
	}
	savedJSON, savedDigest, err := canonicalServiceConfiguration(savedConfiguration)
	if err != nil {
		return nil, err
	}
	if savedJSON != strings.TrimSpace(service.ConfigurationJSON) || savedDigest != strings.TrimSpace(service.ConfigurationSHA256) {
		return nil, serviceError("SERVICE_CONFIGURATION_IDENTITY_MISMATCH", "The managed-service configuration identity has changed.", 409, false, nil)
	}
	parameters, err := m.serviceParameters(service)
	if err != nil {
		return nil, err
	}
	validated, _, err := resolveTemplateInputs(materialized, parameters, savedConfiguration.AcceptedNoticeRevisions)
	if err != nil {
		return nil, serviceError("CURRENT_TEMPLATE_PARAMETERS_INCOMPATIBLE", "The current template requires service settings that are not available.", 409, false, err)
	}
	validated.Container = savedConfiguration.Container
	validated.Compose = savedConfiguration.Compose
	validated.Host = savedConfiguration.Host
	validated.SecretEnvironmentNames = append([]string(nil), savedConfiguration.SecretEnvironmentNames...)
	effective, err := applyServiceConfiguration(materialized, validated, template.Source)
	if err != nil {
		return nil, err
	}
	effectiveConfigurationJSON, effectiveConfigurationDigest, err := canonicalServiceConfiguration(validated)
	if err != nil {
		return nil, err
	}
	secrets, err := m.serviceSecretDocument(service.ServiceID)
	if err != nil {
		return nil, err
	}
	runtimeDigest, err := currentRuntimeSpecDigest(effective, validated, *release, *binding, secrets, service)
	if err != nil {
		return nil, err
	}
	return &resolvedRuntime{
		Template: *template, BaseSpec: materialized, Spec: effective, Configuration: validated, ConfigurationJSON: effectiveConfigurationJSON,
		ConfigurationSHA256: effectiveConfigurationDigest, Release: *release, Binding: *binding,
		Parameters: parameters, RuntimeSpecSHA256: runtimeDigest,
	}, nil
}

func materializeCurrentRelease(base TemplateSpec, release ReleaseIdentity) (TemplateSpec, error) {
	if release.Kind == "none" {
		if base.Kind == DeploymentContainer || (base.Kind == DeploymentHost && base.Host != nil && base.Host.NPM != nil) {
			return TemplateSpec{}, serviceError("RELEASE_TEMPLATE_INCOMPATIBLE", "The saved application release does not belong to the current template source.", 409, false, nil)
		}
		return base, nil
	}
	return materializeReleaseSpec(base, release)
}

func currentRuntimeSpecDigest(spec TemplateSpec, configuration serviceConfiguration, release ReleaseIdentity, binding runtimeBinding, secrets serviceSecrets, service *pfregistry.ManagedService) (string, error) {
	configuration.AcceptedNoticeRevisions = nil
	document := struct {
		SchemaVersion int                  `json:"schema_version"`
		Spec          TemplateSpec         `json:"spec"`
		Configuration serviceConfiguration `json:"configuration"`
		Release       ReleaseIdentity      `json:"release"`
		Binding       runtimeBinding       `json:"runtime_binding"`
		Secrets       serviceSecrets       `json:"secrets"`
		WorkspacePath string               `json:"workspace_path"`
		RuntimePort   int                  `json:"runtime_port"`
	}{
		SchemaVersion: runtimeSpecIdentitySchemaVersion, Spec: spec, Configuration: configuration,
		Release: release, Binding: binding, Secrets: secrets, WorkspacePath: service.WorkspacePath, RuntimePort: service.RuntimePort,
	}
	raw, err := json.Marshal(document)
	if err != nil {
		return "", err
	}
	digest := sha256.Sum256(raw)
	return hex.EncodeToString(digest[:]), nil
}

func validRuntimeSpecSHA256(value string) bool {
	if len(value) != sha256.Size*2 {
		return false
	}
	for _, char := range value {
		if (char < '0' || char > '9') && (char < 'a' || char > 'f') {
			return false
		}
	}
	return true
}
