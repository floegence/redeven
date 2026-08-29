package managedwebservice

import (
	"runtime"
	"slices"
	"strings"
	"testing"

	"github.com/floegence/redeven/internal/containerengine"
	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
)

func TestAuditedDockerCatalogPinsReviewedPlatformDigests(t *testing.T) {
	t.Parallel()
	catalog := auditedDockerCatalog()
	if auditedDockerImage != "ghcr.io/runzhliu/deepseek-harness:0.1.1-rc.2" {
		t.Fatalf("audited Docker image = %q", auditedDockerImage)
	}
	if catalog.TemplateID != DeepSeekHarnessTemplateID || catalog.Version != DeepSeekHarnessVersion {
		t.Fatalf("audited Docker catalog identity = %+v", catalog)
	}
	if len(catalog.Docker) != 2 {
		t.Fatalf("audited Docker platforms = %+v", catalog.Docker)
	}
	for _, platform := range []string{"linux-amd64", "linux-arm64"} {
		artifact, ok := catalog.Docker[platform]
		if !ok || artifact.Image != auditedDockerImage || !dockerDigestPattern.MatchString(artifact.Digest) {
			t.Fatalf("audited Docker artifact %s = %+v", platform, artifact)
		}
	}
	current, ok := catalog.Docker["linux-"+runtime.GOARCH]
	if (runtime.GOARCH == "amd64" || runtime.GOARCH == "arm64") && (!ok || current.Digest == "") {
		t.Fatalf("current platform audited Docker artifact = %+v", current)
	}

	catalog.Docker["linux-amd64"] = dockerArtifact{}
	artifact, ok := auditedDockerArtifact("linux-amd64")
	if !ok || artifact.Digest == "" {
		t.Fatal("audited Docker catalog returned a mutable digest map")
	}
}

func TestDeepSeekOperationArtifactUsesCurrentAuditedRegistry(t *testing.T) {
	t.Parallel()
	service := pfregistry.ManagedService{
		TemplateID:        DeepSeekHarnessContainerTemplateID,
		Deployment:        string(DeploymentDocker),
		ArtifactReference: "runzhliu/deepseek-harness:0.1.1-rc.2@sha256:" + strings.Repeat("f", 64),
	}
	operation := &pfregistry.ManagedOperation{Action: "retry_install"}
	reference := operationArtifactReference(service, operation)
	if !strings.HasPrefix(reference, "ghcr.io/runzhliu/deepseek-harness:0.1.1-rc.2@sha256:") {
		t.Fatalf("operation artifact reference = %q", reference)
	}
	operation.Action = "stop"
	if got := operationArtifactReference(service, operation); got != service.ArtifactReference {
		t.Fatalf("stop operation artifact reference = %q, want installed %q", got, service.ArtifactReference)
	}
	if got := operationArtifactReference(service, nil); got != "" {
		t.Fatalf("idle operation artifact reference = %q, want empty", got)
	}
}

func TestHardenedDockerCreateRequestUsesExactIdentityAndLoopbackOnly(t *testing.T) {
	t.Parallel()
	service := &pfregistry.ManagedService{ServiceID: "mws_one", WorkspacePath: "/workspace/project", RuntimePort: 43123}
	pinnedImage := auditedDockerImage + "@sha256:" + strings.Repeat("a", 64)
	req := hardenedDockerCreateRequest(service, pinnedImage, "redeven-dsh-data-one")

	if req.Engine != containerengine.EngineDocker || req.Name != "redeven-dsh-one" || req.Image != pinnedImage || req.Labels[managedServiceLabel] != service.ServiceID {
		t.Fatalf("container identity request = %+v", req)
	}
	if req.Privileged || !req.ReadOnlyRoot || req.PIDsLimit != 512 || req.ShmSizeBytes != 1024*1024*1024 || req.User != "1000:1000" || !slices.Contains(req.CapDrop, "ALL") || !slices.Contains(req.SecurityOpts, "no-new-privileges:true") {
		t.Fatalf("container hardening request = %+v", req)
	}
	if len(req.Ports) != 1 || req.Ports[0].ContainerPort != 3080 || req.Ports[0].HostPort != service.RuntimePort || req.Ports[0].HostIP != "127.0.0.1" {
		t.Fatalf("container port request = %+v", req.Ports)
	}
	for _, port := range req.Ports {
		if port.ContainerPort == 6080 {
			t.Fatalf("noVNC port was published: %+v", req.Ports)
		}
	}
	if len(req.Mounts) != 3 || req.Mounts[0].Type != containerengine.MountTypeVolume || req.Mounts[1].Source != service.WorkspacePath || req.Mounts[2].Type != containerengine.MountTypeTmpfs {
		t.Fatalf("container mounts = %+v", req.Mounts)
	}
}
