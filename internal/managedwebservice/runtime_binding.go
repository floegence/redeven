package managedwebservice

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"path"
	"path/filepath"
	"strings"

	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
)

const runtimeBindingSchemaVersion = 1

type runtimeBinding struct {
	SchemaVersion int                      `json:"schema_version"`
	Deployment    Deployment               `json:"deployment"`
	Host          *hostRuntimeBinding      `json:"host,omitempty"`
	Container     *containerRuntimeBinding `json:"container,omitempty"`
	Compose       *composeRuntimeBinding   `json:"compose,omitempty"`
}

type hostRuntimeBinding struct {
	InstallRoot string `json:"install_root"`
	DataRoot    string `json:"data_root"`
	LogPath     string `json:"log_path"`
}

type containerRuntimeBinding struct {
	Name string `json:"name"`
}

type composeRuntimeBinding struct {
	ProjectName string `json:"project_name"`
	ConfigRoot  string `json:"config_root"`
}

func newRuntimeBinding(serviceID, familyID string, deployment Deployment) (string, string, error) {
	binding := runtimeBinding{SchemaVersion: runtimeBindingSchemaVersion, Deployment: deployment}
	switch deployment {
	case DeploymentHost:
		instanceRoot := path.Join("instances", serviceID)
		binding.Host = &hostRuntimeBinding{
			InstallRoot: path.Join(instanceRoot, "install"),
			DataRoot:    path.Join("families", familyID, "data"),
			LogPath:     path.Join(instanceRoot, "logs", "service.log"),
		}
	case DeploymentContainer:
		binding.Container = &containerRuntimeBinding{Name: standardContainerName(serviceID)}
	case DeploymentCompose:
		binding.Compose = &composeRuntimeBinding{
			ProjectName: "redeven_" + resourceNameSuffix(serviceID),
			ConfigRoot:  path.Join("instances", serviceID, "compose"),
		}
	default:
		return "", "", serviceError("DEPLOYMENT_INVALID", "The managed Web Service deployment is invalid.", 400, false, nil)
	}
	raw, err := json.Marshal(binding)
	if err != nil {
		return "", "", err
	}
	digest := sha256.Sum256(raw)
	return string(raw), hex.EncodeToString(digest[:]), nil
}

func decodeRuntimeBinding(service *pfregistry.ManagedService) (*runtimeBinding, error) {
	if service == nil {
		return nil, serviceError("RUNTIME_BINDING_INVALID", "The managed Runtime binding is missing.", 409, false, nil)
	}
	raw := strings.TrimSpace(service.RuntimeBindingJSON)
	digest := sha256.Sum256([]byte(raw))
	if raw == "" || hex.EncodeToString(digest[:]) != strings.TrimSpace(service.RuntimeBindingSHA256) {
		return nil, serviceError("RUNTIME_BINDING_INVALID", "The managed Runtime binding digest is invalid.", 409, false, nil)
	}
	binding := runtimeBinding{}
	if err := decodeStrictJSON([]byte(raw), &binding); err != nil {
		return nil, serviceError("RUNTIME_BINDING_INVALID", "The managed Runtime binding is invalid.", 409, false, err)
	}
	if binding.SchemaVersion != runtimeBindingSchemaVersion || binding.Deployment != Deployment(service.Deployment) {
		return nil, serviceError("RUNTIME_BINDING_INVALID", "The managed Runtime binding does not match the service deployment.", 409, false, nil)
	}
	switch binding.Deployment {
	case DeploymentHost:
		if binding.Host == nil || binding.Container != nil || binding.Compose != nil ||
			!validBindingPath(binding.Host.InstallRoot) || !validBindingPath(binding.Host.DataRoot) || !validBindingPath(binding.Host.LogPath) {
			return nil, serviceError("RUNTIME_BINDING_INVALID", "The managed Host Runtime binding is invalid.", 409, false, nil)
		}
	case DeploymentContainer:
		if binding.Host != nil || binding.Container == nil || binding.Compose != nil || binding.Container.Name != standardContainerName(service.ServiceID) {
			return nil, serviceError("RUNTIME_BINDING_INVALID", "The managed container Runtime binding is invalid.", 409, false, nil)
		}
	case DeploymentCompose:
		if binding.Host != nil || binding.Container != nil || binding.Compose == nil ||
			binding.Compose.ProjectName != "redeven_"+resourceNameSuffix(service.ServiceID) || !validBindingPath(binding.Compose.ConfigRoot) {
			return nil, serviceError("RUNTIME_BINDING_INVALID", "The managed Compose Runtime binding is invalid.", 409, false, nil)
		}
	default:
		return nil, serviceError("RUNTIME_BINDING_INVALID", "The managed Runtime binding deployment is invalid.", 409, false, nil)
	}
	return &binding, nil
}

func validBindingPath(value string) bool {
	value = strings.TrimSpace(value)
	clean := path.Clean(value)
	return value != "" && value == clean && clean != "." && clean != ".." && !strings.HasPrefix(clean, "../") && !strings.HasPrefix(clean, "/")
}

func (m *Manager) resolveBindingPath(value string) string {
	return filepath.Join(m.stateDir, filepath.FromSlash(value))
}

func standardContainerName(serviceID string) string {
	return "redeven-mws-" + strings.TrimPrefix(strings.TrimSpace(serviceID), "mws_")
}
