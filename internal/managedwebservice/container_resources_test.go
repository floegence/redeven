package managedwebservice

import (
	"strings"
	"testing"

	"github.com/floegence/redeven/internal/containerengine"
	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
)

func TestContainerResourceLinksUseAuthoritativeRuntimeIdentityAndArtifact(t *testing.T) {
	tests := []struct {
		name       string
		service    pfregistry.ManagedService
		wantView   string
		wantID     string
		wantLinked bool
	}{
		{name: "container", service: pfregistry.ManagedService{Deployment: string(DeploymentContainer), RuntimeIdentity: "ctr-123"}, wantView: "containers", wantID: "ctr-123", wantLinked: true},
		{name: "compose", service: pfregistry.ManagedService{Deployment: string(DeploymentCompose), RuntimeIdentity: "compose:mws_one:redeven_demo:" + strings.Repeat("a", 64)}, wantView: "compose-projects", wantID: containerengine.ComposeProjectID("redeven_demo"), wantLinked: true},
		{name: "host", service: pfregistry.ManagedService{Deployment: string(DeploymentHost), RuntimeIdentity: "host:mws_one:1"}},
		{name: "incomplete", service: pfregistry.ManagedService{Deployment: string(DeploymentContainer)}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			links := containerResourceLinks(test.service)
			if !test.wantLinked {
				if len(links) != 0 {
					t.Fatalf("containerResourceLinks() = %#v, want none", links)
				}
				return
			}
			if len(links) != 1 || links[0].Engine != "docker" || links[0].View != test.wantView || links[0].Identity != test.wantID {
				t.Fatalf("containerResourceLinks() = %#v", links)
			}
		})
	}

	image := "ghcr.io/example/service@sha256:" + strings.Repeat("b", 64)
	links := containerResourceLinks(pfregistry.ManagedService{
		Deployment:        string(DeploymentContainer),
		RuntimeIdentity:   "ctr-123",
		ArtifactReference: image,
	})
	if len(links) != 2 || links[0].Kind != "container" || links[1].Kind != "image" || links[1].View != "images" || links[1].Identity != image {
		t.Fatalf("containerResourceLinks() = %#v", links)
	}
}
