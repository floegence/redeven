package protocol_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"testing"

	"github.com/floegence/redeven/internal/gatewaymembership"
	gp "github.com/floegence/redeven/internal/runtimegateway/protocol"
)

func TestDesktopAndGatewayShareIndependentAuthorityContract(t *testing.T) {
	_, file, _, _ := runtime.Caller(0)
	root := filepath.Join(filepath.Dir(file), "../../..")
	raw, err := os.ReadFile(filepath.Join(root, "desktop/src/shared/gatewayMembership.ts"))
	if err != nil {
		t.Fatal(err)
	}
	match := regexp.MustCompile(`GATEWAY_COMPATIBILITY_EPOCH = (\d+)`).FindSubmatch(raw)
	if len(match) != 2 || string(match[1]) != strconv.Itoa(gp.CompatibilityEpoch) {
		t.Fatal("Desktop and Gateway authority epochs differ")
	}
	if !strings.Contains(string(raw), "'"+gp.Version+"'") {
		t.Fatal("Desktop and Gateway protocol versions differ")
	}
}

func TestMembershipOpenAPIContainsOnlyCurrentContract(t *testing.T) {
	_, file, _, _ := runtime.Caller(0)
	root := filepath.Join(filepath.Dir(file), "../../..")
	raw, err := os.ReadFile(filepath.Join(root, "spec/openapi/gateway-v6.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	var spec struct {
		Info struct {
			Version string `json:"version"`
		} `json:"info"`
		Paths      map[string]json.RawMessage `json:"paths"`
		Components struct {
			Schemas map[string]struct {
				Properties map[string]json.RawMessage `json:"properties"`
			} `json:"schemas"`
		} `json:"components"`
	}
	if err := json.Unmarshal(raw, &spec); err != nil {
		t.Fatal(err)
	}
	if spec.Info.Version != gp.Version {
		t.Fatal("OpenAPI protocol version differs from the executable")
	}
	for _, value := range []any{
		gp.IdentityRequest{}, gp.IdentityResponse{}, gp.ConfigureCloudRequest{}, gp.MemberCloudContext{}, gp.GatewayPermissions{}, gp.GatewayMetadata{}, gp.CatalogRequest{}, gp.CatalogResponse{}, gp.OpenSessionRequest{}, gp.MemberServiceRequest{}, gp.MemberServiceResponse{},
		gp.ClientAccessCodeRequest{}, gp.ClientAccessCodeResponse{}, gp.ClientListRequest{}, gp.ClientListResponse{}, gp.ClientRevokeRequest{}, gp.GatewayClientRecord{}, gp.InvitationRequest{}, gp.RemoveMemberRequest{}, gp.UpdatePolicyRequest{}, gp.UpdateMembersRequest{}, gp.PairingChallengeRequest{}, gp.PairingChallengeResponse{}, gp.PairingCompleteRequest{}, gp.PairingCompleteResponse{},
		gp.EnrollmentDescriptor{}, gp.MemberDelegation{}, gp.MemberService{}, gp.MemberMetadata{}, gp.MemberJoinRequest{}, gp.MemberJoinResponse{}, gp.MemberRotateRequest{}, gp.MemberRotateResponse{}, gp.GatewayEndpoint{}, gp.EndpointUpdateRequest{}, gp.EndpointUpdateResponse{}, gp.GatewayNetworkSettings{}, gp.NetworkSettingsRequest{}, gp.NetworkSettingsResponse{}, gp.MemberEndpointUpdateRequest{}, gp.MemberEndpointUpdateResponse{},
		gp.Member{}, gp.MemberConnectRequest{}, gp.GatewayPolicy{}, gp.MemberPolicyUpdate{}, gp.MemberOperationResult{}, gp.HookInput{}, gp.HookResult{}, gatewaymembership.ConnectionOffer{},
	} {
		typ := reflect.TypeOf(value)
		schema, ok := spec.Components.Schemas[typ.Name()]
		if !ok {
			t.Errorf("missing schema %s", typ.Name())
			continue
		}
		expected := map[string]bool{}
		for field := range typ.NumField() {
			name := strings.Split(typ.Field(field).Tag.Get("json"), ",")[0]
			if name != "" && name != "-" {
				expected[name] = true
			}
		}
		if len(schema.Properties) != len(expected) {
			t.Errorf("schema %s has %d fields, expected %d", typ.Name(), len(schema.Properties), len(expected))
		}
		for name := range expected {
			if _, ok := schema.Properties[name]; !ok {
				t.Errorf("missing %s.%s", typ.Name(), name)
			}
		}
	}
	expected := []string{"/gateway/v6/clients/access-codes", "/gateway/v6/clients/list", "/gateway/v6/clients/revoke", "/gateway/v6/identity", "/gateway/v6/cloud/configure", "/gateway/v6/cloud/status", "/gateway/v6/members/reevaluate", "/v6/member/cloud", "/gateway/v6/pairing/challenge", "/gateway/v6/pairing/complete", "/gateway/v6/catalog", "/gateway/v6/invitation-codes", "/gateway/v6/endpoints", "/gateway/v6/network-settings", "/gateway/v6/members/remove", "/gateway/v6/members/policy", "/gateway/v6/policy", "/gateway/v6/access/open", "/gateway/v6/access/service", "/v6/member/join", "/v6/member/cancel-join", "/v6/member/rotate", "/v6/member/leave", "/v6/member/connect", "/v6/member/invitation-exchange", "/v6/member/update-endpoints"}
	if len(spec.Paths) != len(expected) {
		t.Fatal("OpenAPI contains unexpected routes")
	}
	for _, route := range expected {
		if _, ok := spec.Paths[route]; !ok {
			t.Errorf("missing route %s", route)
		}
	}
	for _, retired := range []string{"gateway_proxy", "direct_url", "profile_write", "target_url", "cookie_jar", "runtime-operations"} {
		if strings.Contains(string(raw), retired) {
			t.Errorf("retired contract remains: %s", retired)
		}
	}
}
