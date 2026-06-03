package envprofiles

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/floegence/redeven/internal/runtimegateway/protocol"
)

func TestStoreUpsertURLProfileNormalizesAndPersistsAccessOnlyCatalogEntry(t *testing.T) {
	path := filepath.Join(t.TempDir(), "gateway", "environments.json")
	store := NewStore(path)

	env, err := store.Upsert(context.Background(), protocol.EnvProfileUpsertRequest{
		ProtocolVersion: protocol.Version,
		Profile: protocol.EnvProfileInput{
			DisplayName: " Lab Env ",
			AccessRoute: protocol.EnvProfileAccessRoute{
				Kind:        protocol.EnvProfileAccessRouteKindURL,
				URL:         "HTTPS://Example.COM:8443/some/path?token=secret#frag",
				OriginLabel: " Lab Network ",
			},
			ControlOwner: protocol.EnvProfileControlOwnerGateway,
		},
	})
	if err != nil {
		t.Fatalf("Upsert() error = %v", err)
	}
	if !strings.HasPrefix(env.GatewayEnvID, "envp_") {
		t.Fatalf("GatewayEnvID = %q, want generated envp_ id", env.GatewayEnvID)
	}
	if env.DisplayName != "Lab Env" || env.Origin.Label != "Lab Network" {
		t.Fatalf("Environment = %#v", env)
	}
	if env.Profile == nil || !env.Profile.Managed || env.Profile.AccessRouteKind != protocol.EnvProfileAccessRouteKindURL {
		t.Fatalf("Profile = %#v, want managed URL profile marker", env.Profile)
	}
	if got := env.AccessCapabilities; !reflect.DeepEqual(got, []protocol.EnvironmentCapability{protocol.EnvironmentCapabilityOpen}) {
		t.Fatalf("AccessCapabilities = %#v", got)
	}
	if len(env.ControlCapabilities) != 0 {
		t.Fatalf("ControlCapabilities = %#v, want empty for URL access profile", env.ControlCapabilities)
	}
	if got := env.Capabilities; !reflect.DeepEqual(got, []protocol.EnvironmentCapability{protocol.EnvironmentCapabilityOpen}) {
		t.Fatalf("Capabilities = %#v", got)
	}
	if env.ProfileAccessRoute == nil || env.ProfileAccessRoute.Kind != protocol.EnvProfileAccessRouteKindURL || env.ProfileAccessRoute.URL != "https://example.com:8443/" {
		t.Fatalf("ProfileAccessRoute = %#v, want normalized editable URL route", env.ProfileAccessRoute)
	}

	profiles, err := NewStore(path).List(context.Background())
	if err != nil {
		t.Fatalf("List() after reload error = %v", err)
	}
	if len(profiles) != 1 {
		t.Fatalf("profiles length = %d, want 1", len(profiles))
	}
	profile := profiles[0]
	if profile.AccessRoute.URL != "https://example.com:8443/" {
		t.Fatalf("stored URL = %q, want normalized target base URL", profile.AccessRoute.URL)
	}
	if profile.ControlOwner != protocol.EnvProfileControlOwnerNone {
		t.Fatalf("ControlOwner = %q, want none", profile.ControlOwner)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("ReadFile() error = %v", err)
	}
	if strings.Contains(string(raw), "token=secret") || strings.Contains(string(raw), "#frag") || strings.Contains(string(raw), "/some/path") {
		t.Fatalf("stored profile leaked open-time URL payload: %s", raw)
	}
}

func TestStoreRejectsUnsupportedOrUnsafeProfiles(t *testing.T) {
	store := NewStore("")

	for _, tc := range []struct {
		name string
		req  protocol.EnvProfileUpsertRequest
		want error
	}{
		{
			name: "embedded credentials",
			req: protocol.EnvProfileUpsertRequest{
				ProtocolVersion: protocol.Version,
				Profile: protocol.EnvProfileInput{
					DisplayName: "Bad",
					AccessRoute: protocol.EnvProfileAccessRoute{
						Kind: protocol.EnvProfileAccessRouteKindURL,
						URL:  "https://user:pass@example.com/",
					},
				},
			},
			want: ErrURLCredentialsUnsupported,
		},
		{
			name: "unsupported scheme",
			req: protocol.EnvProfileUpsertRequest{
				ProtocolVersion: protocol.Version,
				Profile: protocol.EnvProfileInput{
					DisplayName: "Bad",
					AccessRoute: protocol.EnvProfileAccessRoute{
						Kind: protocol.EnvProfileAccessRouteKindURL,
						URL:  "file:///tmp/redeven",
					},
				},
			},
			want: ErrURLMustBeAbsoluteHTTP,
		},
		{
			name: "reserved env id",
			req: protocol.EnvProfileUpsertRequest{
				ProtocolVersion: protocol.Version,
				Profile: protocol.EnvProfileInput{
					GatewayEnvID: "env_local",
					DisplayName:  "Local",
					AccessRoute: protocol.EnvProfileAccessRoute{
						Kind: protocol.EnvProfileAccessRouteKindURL,
						URL:  "https://example.com",
					},
				},
			},
			want: ErrGatewayEnvIDReserved,
		},
		{
			name: "ambiguous colon env id",
			req: protocol.EnvProfileUpsertRequest{
				ProtocolVersion: protocol.Version,
				Profile: protocol.EnvProfileInput{
					GatewayEnvID: "env:demo",
					DisplayName:  "Ambiguous",
					AccessRoute: protocol.EnvProfileAccessRoute{
						Kind: protocol.EnvProfileAccessRouteKindURL,
						URL:  "https://example.com",
					},
				},
			},
			want: ErrGatewayEnvIDInvalid,
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := store.Upsert(context.Background(), tc.req)
			if !errors.Is(err, tc.want) {
				t.Fatalf("Upsert() error = %v, want %v", err, tc.want)
			}
		})
	}
}

func TestStoreUpsertSSHProfilesPersistsGatewayOwnedRouteWithoutAdvertisedLifecycle(t *testing.T) {
	path := filepath.Join(t.TempDir(), "gateway", "environments.json")
	store := NewStore(path)

	sshEnv, err := store.Upsert(context.Background(), protocol.EnvProfileUpsertRequest{
		ProtocolVersion: protocol.Version,
		Profile: protocol.EnvProfileInput{
			GatewayEnvID: "env_ssh",
			DisplayName:  "SSH Env",
			AccessRoute: protocol.EnvProfileAccessRoute{
				Kind:           protocol.EnvProfileAccessRouteKindSSHHost,
				SSHDestination: "devbox",
				SSHPort:        2222,
				SSHAuthMode:    "key_agent",
				SSHRuntimeRoot: "",
			},
			ControlOwner: protocol.EnvProfileControlOwnerGateway,
		},
	})
	if err != nil {
		t.Fatalf("Upsert(ssh_host) error = %v", err)
	}
	if sshEnv.Origin.Kind != protocol.EnvironmentOriginKindSSHTarget || sshEnv.Origin.Label != "devbox" {
		t.Fatalf("ssh environment origin = %#v", sshEnv.Origin)
	}
	if sshEnv.Profile == nil || !sshEnv.Profile.Managed || sshEnv.Profile.AccessRouteKind != protocol.EnvProfileAccessRouteKindSSHHost {
		t.Fatalf("ssh profile marker = %#v", sshEnv.Profile)
	}
	if sshEnv.ProfileAccessRoute == nil ||
		sshEnv.ProfileAccessRoute.Kind != protocol.EnvProfileAccessRouteKindSSHHost ||
		sshEnv.ProfileAccessRoute.SSHDestination != "devbox" ||
		sshEnv.ProfileAccessRoute.SSHPort != 2222 ||
		sshEnv.ProfileAccessRoute.SSHAuthMode != "key_agent" ||
		sshEnv.ProfileAccessRoute.SSHPasswordConfigured ||
		sshEnv.ProfileAccessRoute.SSHRuntimeRoot != "~/.redeven" {
		t.Fatalf("ssh profile access route = %#v", sshEnv.ProfileAccessRoute)
	}
	if len(sshEnv.AccessCapabilities) != 0 || len(sshEnv.ControlCapabilities) != 0 || len(sshEnv.Capabilities) != 0 {
		t.Fatalf("ssh capabilities = access %#v control %#v legacy %#v, want empty until Gateway executor is available", sshEnv.AccessCapabilities, sshEnv.ControlCapabilities, sshEnv.Capabilities)
	}

	containerEnv, err := store.Upsert(context.Background(), protocol.EnvProfileUpsertRequest{
		ProtocolVersion: protocol.Version,
		Profile: protocol.EnvProfileInput{
			GatewayEnvID: "env_container",
			DisplayName:  "Container Env",
			AccessRoute: protocol.EnvProfileAccessRoute{
				Kind:                 protocol.EnvProfileAccessRouteKindSSHContainer,
				SSHDestination:       "devbox",
				ContainerEngine:      "Podman",
				ContainerID:          "workspace-1",
				ContainerRuntimeRoot: "~/.redeven",
			},
			ControlOwner: protocol.EnvProfileControlOwnerGateway,
		},
	})
	if err != nil {
		t.Fatalf("Upsert(ssh_container) error = %v", err)
	}
	if containerEnv.Origin.Kind != protocol.EnvironmentOriginKindContainer || containerEnv.Origin.Label != "devbox / workspace-1" {
		t.Fatalf("container environment origin = %#v", containerEnv.Origin)
	}
	if containerEnv.Profile == nil || !containerEnv.Profile.Managed || containerEnv.Profile.AccessRouteKind != protocol.EnvProfileAccessRouteKindSSHContainer {
		t.Fatalf("container profile marker = %#v", containerEnv.Profile)
	}
	if containerEnv.ProfileAccessRoute == nil ||
		containerEnv.ProfileAccessRoute.Kind != protocol.EnvProfileAccessRouteKindSSHContainer ||
		containerEnv.ProfileAccessRoute.SSHDestination != "devbox" ||
		containerEnv.ProfileAccessRoute.ContainerEngine != "podman" ||
		containerEnv.ProfileAccessRoute.ContainerID != "workspace-1" ||
		containerEnv.ProfileAccessRoute.ContainerRuntimeRoot != "~/.redeven" {
		t.Fatalf("container profile access route = %#v", containerEnv.ProfileAccessRoute)
	}
	if len(containerEnv.AccessCapabilities) != 0 || len(containerEnv.ControlCapabilities) != 0 || len(containerEnv.Capabilities) != 0 {
		t.Fatalf("container capabilities = access %#v control %#v legacy %#v, want empty until Gateway executor is available", containerEnv.AccessCapabilities, containerEnv.ControlCapabilities, containerEnv.Capabilities)
	}

	profiles, err := NewStore(path).List(context.Background())
	if err != nil {
		t.Fatalf("List() after reload error = %v", err)
	}
	if len(profiles) != 2 {
		t.Fatalf("profiles length = %d, want 2: %#v", len(profiles), profiles)
	}
	byID := make(map[string]EnvironmentProfile, len(profiles))
	for _, profile := range profiles {
		byID[profile.GatewayEnvID] = profile
	}
	if got := byID["env_ssh"].AccessRoute; got.Kind != protocol.EnvProfileAccessRouteKindSSHHost || got.SSHDestination != "devbox" || got.SSHPort != 2222 || got.SSHRuntimeRoot != "~/.redeven" {
		t.Fatalf("stored ssh route = %#v", got)
	}
	keptEnv, err := store.Upsert(context.Background(), protocol.EnvProfileUpsertRequest{
		ProtocolVersion: protocol.Version,
		Profile: protocol.EnvProfileInput{
			GatewayEnvID: "env_ssh",
			DisplayName:  "Renamed SSH Env",
			AccessRoute: protocol.EnvProfileAccessRoute{
				Kind:           protocol.EnvProfileAccessRouteKindSSHHost,
				SSHDestination: "devbox",
				SSHPort:        2222,
				SSHAuthMode:    "key_agent",
				SSHRuntimeRoot: "~/.redeven",
			},
			SSHSecret: &protocol.EnvProfileSSHSecret{Mode: "keep"},
		},
	})
	if err != nil {
		t.Fatalf("Upsert(ssh keep secret) error = %v", err)
	}
	if keptEnv.ProfileAccessRoute == nil || keptEnv.ProfileAccessRoute.SSHPasswordConfigured {
		t.Fatalf("kept ssh profile access route = %#v, want no password marker", keptEnv.ProfileAccessRoute)
	}
	keyAgentEnv, err := store.Upsert(context.Background(), protocol.EnvProfileUpsertRequest{
		ProtocolVersion: protocol.Version,
		Profile: protocol.EnvProfileInput{
			GatewayEnvID: "env_ssh",
			DisplayName:  "Key Agent SSH Env",
			AccessRoute: protocol.EnvProfileAccessRoute{
				Kind:           protocol.EnvProfileAccessRouteKindSSHHost,
				SSHDestination: "devbox",
				SSHPort:        2222,
				SSHAuthMode:    "key_agent",
				SSHRuntimeRoot: "~/.redeven",
			},
			SSHSecret: &protocol.EnvProfileSSHSecret{Mode: "keep"},
		},
	})
	if err != nil {
		t.Fatalf("Upsert(ssh key_agent keep secret) error = %v", err)
	}
	if keyAgentEnv.ProfileAccessRoute == nil || keyAgentEnv.ProfileAccessRoute.SSHPasswordConfigured {
		t.Fatalf("key-agent ssh profile access route = %#v, want no password marker", keyAgentEnv.ProfileAccessRoute)
	}
	if got := byID["env_container"].AccessRoute; got.Kind != protocol.EnvProfileAccessRouteKindSSHContainer || got.ContainerEngine != "podman" || got.ContainerID != "workspace-1" || got.ContainerRuntimeRoot != "~/.redeven" {
		t.Fatalf("stored container route = %#v", got)
	}
}

func TestStoreRejectsInvalidSSHProfiles(t *testing.T) {
	store := NewStore("")

	for _, tc := range []struct {
		name string
		req  protocol.EnvProfileUpsertRequest
		want error
	}{
		{
			name: "missing ssh destination",
			req: protocol.EnvProfileUpsertRequest{
				ProtocolVersion: protocol.Version,
				Profile: protocol.EnvProfileInput{
					DisplayName: "SSH",
					AccessRoute: protocol.EnvProfileAccessRoute{
						Kind: protocol.EnvProfileAccessRouteKindSSHHost,
					},
				},
			},
			want: ErrSSHDestinationRequired,
		},
		{
			name: "invalid ssh port",
			req: protocol.EnvProfileUpsertRequest{
				ProtocolVersion: protocol.Version,
				Profile: protocol.EnvProfileInput{
					DisplayName: "SSH",
					AccessRoute: protocol.EnvProfileAccessRoute{
						Kind:           protocol.EnvProfileAccessRouteKindSSHHost,
						SSHDestination: "devbox",
						SSHPort:        70000,
					},
				},
			},
			want: ErrSSHPortInvalid,
		},
		{
			name: "unsupported ssh password auth",
			req: protocol.EnvProfileUpsertRequest{
				ProtocolVersion: protocol.Version,
				Profile: protocol.EnvProfileInput{
					DisplayName: "SSH",
					AccessRoute: protocol.EnvProfileAccessRoute{
						Kind:           protocol.EnvProfileAccessRouteKindSSHHost,
						SSHDestination: "devbox",
						SSHAuthMode:    "password",
					},
					SSHSecret: &protocol.EnvProfileSSHSecret{Mode: "reuse", Password: "secret"},
				},
			},
			want: ErrSSHPasswordAuthUnsupported,
		},
		{
			name: "unsupported ssh password replacement",
			req: protocol.EnvProfileUpsertRequest{
				ProtocolVersion: protocol.Version,
				Profile: protocol.EnvProfileInput{
					DisplayName: "SSH",
					AccessRoute: protocol.EnvProfileAccessRoute{
						Kind:           protocol.EnvProfileAccessRouteKindSSHHost,
						SSHDestination: "devbox",
						SSHAuthMode:    "password",
					},
					SSHSecret: &protocol.EnvProfileSSHSecret{Mode: "replace"},
				},
			},
			want: ErrSSHPasswordAuthUnsupported,
		},
		{
			name: "invalid container engine",
			req: protocol.EnvProfileUpsertRequest{
				ProtocolVersion: protocol.Version,
				Profile: protocol.EnvProfileInput{
					DisplayName: "Container",
					AccessRoute: protocol.EnvProfileAccessRoute{
						Kind:                 protocol.EnvProfileAccessRouteKindSSHContainer,
						SSHDestination:       "devbox",
						ContainerEngine:      "nerdctl",
						ContainerID:          "abc",
						ContainerRuntimeRoot: "~/.redeven",
					},
				},
			},
			want: ErrContainerEngineInvalid,
		},
		{
			name: "missing container id",
			req: protocol.EnvProfileUpsertRequest{
				ProtocolVersion: protocol.Version,
				Profile: protocol.EnvProfileInput{
					DisplayName: "Container",
					AccessRoute: protocol.EnvProfileAccessRoute{
						Kind:                 protocol.EnvProfileAccessRouteKindSSHContainer,
						SSHDestination:       "devbox",
						ContainerEngine:      "docker",
						ContainerRuntimeRoot: "~/.redeven",
					},
				},
			},
			want: ErrContainerIDRequired,
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := store.Upsert(context.Background(), tc.req)
			if !errors.Is(err, tc.want) {
				t.Fatalf("Upsert() error = %v, want %v", err, tc.want)
			}
		})
	}
}
