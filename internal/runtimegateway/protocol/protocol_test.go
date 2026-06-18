package protocol

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

func TestCatalogResponseUsesSnakeCaseWireNames(t *testing.T) {
	payload, err := json.Marshal(NewCatalogResponse(GatewayMetadata{
		GatewayID:                   " gateway_demo ",
		DisplayName:                 " Demo Gateway ",
		Status:                      GatewayStatusOnline,
		Capabilities:                []GatewayCapability{GatewayCapabilityEnvCatalog},
		GatewayPublicKeyFingerprint: " SHA256:demo ",
	}, []Environment{{
		GatewayEnvID: " env_demo ",
		DisplayName:  " Demo ",
		State:        EnvironmentStateAvailable,
		Capabilities: []EnvironmentCapability{EnvironmentCapabilityOpen},
	}}))
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}
	body := string(payload)
	for _, want := range []string{"protocol_version", "gateway_id", "gateway_env_id", "display_name", "env_kind", "gateway_public_key_fingerprint"} {
		if !strings.Contains(body, `"`+want+`"`) {
			t.Fatalf("JSON body %s does not contain %q", body, want)
		}
	}
	for _, forbidden := range []string{"EnvPublicID", "env_public_id", "clientSessionID"} {
		if strings.Contains(body, forbidden) {
			t.Fatalf("JSON body %s contains non-wire field %q", body, forbidden)
		}
	}
}

func TestOpenSessionRequestValidation(t *testing.T) {
	if err := ValidateProtocolVersion(""); err != ErrUnsupportedProtocolVersion {
		t.Fatalf("ValidateProtocolVersion() error = %v, want %v", err, ErrUnsupportedProtocolVersion)
	}
	if err := ValidateProtocolVersion(Version); err != nil {
		t.Fatalf("ValidateProtocolVersion() error = %v", err)
	}
	if err := ValidateProtocolVersion(" " + Version + " "); err != ErrUnsupportedProtocolVersion {
		t.Fatalf("ValidateProtocolVersion() error = %v, want strict mismatch error", err)
	}
	if err := ValidateOpenSessionRequest(OpenSessionRequest{
		GatewayEnvID:        " env_demo ",
		RequestedCapability: RequestedCapabilityEnvApp,
		ClientNonce:         " nonce_demo ",
	}); err != nil {
		t.Fatalf("ValidateOpenSessionRequest() error = %v", err)
	}
	if err := ValidateOpenSessionRequest(OpenSessionRequest{}); err != ErrMissingGatewayEnvID {
		t.Fatalf("ValidateOpenSessionRequest() error = %v, want %v", err, ErrMissingGatewayEnvID)
	}
	if err := ValidateOpenSessionRequest(OpenSessionRequest{
		GatewayEnvID: "env_demo",
	}); err != ErrMissingRequestedCapability {
		t.Fatalf("ValidateOpenSessionRequest() error = %v, want %v", err, ErrMissingRequestedCapability)
	}
	if err := ValidateOpenSessionRequest(OpenSessionRequest{
		GatewayEnvID:        "env_demo",
		RequestedCapability: RequestedCapabilityEnvApp,
	}); err != ErrMissingClientNonce {
		t.Fatalf("ValidateOpenSessionRequest() error = %v, want %v", err, ErrMissingClientNonce)
	}
}

func TestCatalogNormalization(t *testing.T) {
	resp := NewCatalogResponse(GatewayMetadata{
		GatewayID:    " gateway_demo ",
		DisplayName:  " Demo Gateway ",
		Status:       "bad",
		Capabilities: []GatewayCapability{GatewayCapabilityEnvCatalog, GatewayCapabilityEnvProfileWrite, "bad", GatewayCapabilityEnvCatalog},
	}, []Environment{
		{
			GatewayEnvID:        " env_demo ",
			State:               "bad",
			AccessCapabilities:  []EnvironmentCapability{EnvironmentCapabilityOpen, EnvironmentCapabilityFiles, "bad", EnvironmentCapabilityOpen},
			ControlCapabilities: []EnvironmentCapability{EnvironmentCapabilityStart, EnvironmentCapabilityRestart, EnvironmentCapabilityUpdateRuntime, "bad"},
			Profile:             &EnvironmentProfile{Managed: true, AccessRouteKind: EnvProfileAccessRouteKindSSHHost},
			Origin:              EnvironmentOrigin{Kind: "bad", Label: " Target "},
		},
		{
			GatewayEnvID: " env_legacy ",
			DisplayName:  "Legacy",
			Capabilities: []EnvironmentCapability{EnvironmentCapabilityOpen, EnvironmentCapabilityStop, EnvironmentCapabilityTerminal},
			Profile:      &EnvironmentProfile{Managed: true},
		},
		{
			GatewayEnvID: ReservedLocalEnvironmentID,
			DisplayName:  "Default Host Env",
			Capabilities: []EnvironmentCapability{EnvironmentCapabilityOpen},
		},
		{GatewayEnvID: " "},
	})

	if resp.Gateway.GatewayID != "gateway_demo" {
		t.Fatalf("GatewayID = %q", resp.Gateway.GatewayID)
	}
	if resp.Gateway.Status != GatewayStatusUnknown {
		t.Fatalf("Gateway status = %q", resp.Gateway.Status)
	}
	if got := resp.Gateway.Capabilities; !reflect.DeepEqual(got, []GatewayCapability{GatewayCapabilityEnvCatalog, GatewayCapabilityEnvProfileWrite}) {
		t.Fatalf("Gateway capabilities = %#v", got)
	}
	if len(resp.Environments) != 2 {
		t.Fatalf("Environments length = %d, want 2 after reserved env filter", len(resp.Environments))
	}
	env := resp.Environments[0]
	if env.GatewayEnvID != "env_demo" || env.DisplayName != "env_demo" {
		t.Fatalf("Environment identity = %#v", env)
	}
	if env.State != EnvironmentStateUnknown {
		t.Fatalf("State = %q", env.State)
	}
	if env.EnvKind != EnvironmentKindReachableEnv {
		t.Fatalf("EnvKind = %q", env.EnvKind)
	}
	if env.Origin.Kind != EnvironmentOriginKindNetworkTarget || env.Origin.Label != "Target" {
		t.Fatalf("Origin = %#v", env.Origin)
	}
	if got := env.AccessCapabilities; !reflect.DeepEqual(got, []EnvironmentCapability{EnvironmentCapabilityOpen, EnvironmentCapabilityFiles}) {
		t.Fatalf("AccessCapabilities = %#v", got)
	}
	if got := env.ControlCapabilities; !reflect.DeepEqual(got, []EnvironmentCapability{EnvironmentCapabilityStart, EnvironmentCapabilityRestart, EnvironmentCapabilityUpdateRuntime}) {
		t.Fatalf("ControlCapabilities = %#v", got)
	}
	if got := env.Capabilities; !reflect.DeepEqual(got, []EnvironmentCapability{EnvironmentCapabilityOpen, EnvironmentCapabilityFiles, EnvironmentCapabilityStart, EnvironmentCapabilityRestart, EnvironmentCapabilityUpdateRuntime}) {
		t.Fatalf("Environment capabilities = %#v", got)
	}
	if env.Profile == nil || !env.Profile.Managed || env.Profile.AccessRouteKind != EnvProfileAccessRouteKindSSHHost {
		t.Fatalf("Profile = %#v, want managed ssh_host profile marker", env.Profile)
	}
	legacy := resp.Environments[1]
	if legacy.Profile != nil {
		t.Fatalf("legacy Profile = %#v, want nil without access_route_kind", legacy.Profile)
	}
	if got := legacy.AccessCapabilities; len(got) != 0 {
		t.Fatalf("legacy AccessCapabilities = %#v, want no inferred access capability", got)
	}
	if got := legacy.ControlCapabilities; len(got) != 0 {
		t.Fatalf("legacy ControlCapabilities = %#v, want no inferred control capability", got)
	}
	if got := legacy.Capabilities; len(got) != 0 {
		t.Fatalf("legacy Capabilities = %#v, want no inferred aggregate capability", got)
	}
}

func TestRuntimeGatewayWireContractsDoNotExposeSecrets(t *testing.T) {
	types := []reflect.Type{
		reflect.TypeOf(CatalogRequest{}),
		reflect.TypeOf(CatalogResponse{}),
		reflect.TypeOf(GatewayMetadata{}),
		reflect.TypeOf(Environment{}),
		reflect.TypeOf(EnvironmentProfile{}),
		reflect.TypeOf(EnvironmentOrigin{}),
		reflect.TypeOf(OpenSessionRequest{}),
		reflect.TypeOf(OpenSessionResponse{}),
		reflect.TypeOf(EnvProfileUpsertRequest{}),
		reflect.TypeOf(EnvProfileInput{}),
		reflect.TypeOf(EnvProfileSSHSecret{}),
		reflect.TypeOf(EnvProfileAccessRoute{}),
		reflect.TypeOf(EnvProfileUpsertResponse{}),
		reflect.TypeOf(EnvProfileDeleteRequest{}),
		reflect.TypeOf(EnvProfileDeleteResponse{}),
		reflect.TypeOf(EnvLifecycleRequest{}),
		reflect.TypeOf(EnvLifecycleResponse{}),
		reflect.TypeOf(GatewayConnectArtifact{}),
		reflect.TypeOf(DiagnosticsHint{}),
		reflect.TypeOf(PairingChallengeRequest{}),
		reflect.TypeOf(PairingChallengeResponse{}),
		reflect.TypeOf(PairingCompleteRequest{}),
		reflect.TypeOf(PairingCompleteResponse{}),
		reflect.TypeOf(ErrorEnvelope{}),
	}
	for _, typ := range types {
		assertNoSecretWireFields(t, typ)
	}
}

func assertNoSecretWireFields(t *testing.T, typ reflect.Type) {
	t.Helper()
	for i := 0; i < typ.NumField(); i++ {
		field := typ.Field(i)
		if field.PkgPath != "" {
			continue
		}
		tag := field.Tag.Get("json")
		wireName := strings.Split(tag, ",")[0]
		if typ == reflect.TypeOf(EnvProfileSSHSecret{}) && (wireName == "password" || wireName == "mode") {
			continue
		}
		if typ == reflect.TypeOf(EnvProfileInput{}) && wireName == "ssh_secret" {
			continue
		}
		name := strings.ToLower(field.Name + " " + wireName)
		if strings.Contains(name, "token") || strings.Contains(name, "secret") || strings.Contains(name, "bearer") {
			t.Fatalf("%s.%s exposes forbidden credential-shaped wire field %q", typ.Name(), field.Name, wireName)
		}
	}
}
