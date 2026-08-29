package managedwebservice

import (
	"runtime"
	"strings"

	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
)

func operationArtifactReference(service pfregistry.ManagedService, operation *pfregistry.ManagedOperation) string {
	if operation == nil {
		return ""
	}
	if (operation.Action == "install" || operation.Action == "retry_install") && Deployment(service.Deployment) == DeploymentDocker && service.TemplateID == DeepSeekHarnessContainerTemplateID {
		if artifact, ok := auditedDockerArtifact("linux-" + runtime.GOARCH); ok {
			return artifact.Image + "@" + artifact.Digest
		}
		return strings.TrimSpace(service.ArtifactReference)
	}
	if operation.Action == "update" {
		if definition, ok := builtInTemplateDefinitionByID(service.TemplateID); ok && definition.Revision > service.TemplateRevision {
			if artifact, artifactOK := auditedWebtopArtifact(definition.TemplateID, "linux-"+runtime.GOARCH); artifactOK {
				return strings.TrimSpace(webtopTemplateSpec(definition.TemplateID, artifact).Container.Image)
			}
		}
	}
	if Deployment(service.Deployment) == DeploymentContainer {
		spec, err := templateSpecFromService(&service)
		if err == nil && spec.Container != nil {
			return strings.TrimSpace(spec.Container.Image)
		}
	}
	return strings.TrimSpace(service.ArtifactReference)
}
