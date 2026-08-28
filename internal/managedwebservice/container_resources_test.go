package managedwebservice

import (
	"strings"
	"testing"

	"github.com/floegence/redeven/internal/containerengine"
	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
)

func TestContainerResourceLinkUsesAuthoritativeRuntimeIdentity(t *testing.T) {
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
			link := containerResourceLink(test.service)
			if !test.wantLinked {
				if link != nil {
					t.Fatalf("containerResourceLink() = %#v, want nil", link)
				}
				return
			}
			if link == nil || link.Engine != "docker" || link.View != test.wantView || link.Identity != test.wantID {
				t.Fatalf("containerResourceLink() = %#v", link)
			}
		})
	}
}
