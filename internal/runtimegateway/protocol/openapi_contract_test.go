package protocol_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"testing"

	gc "github.com/floegence/redeven/internal/gatewaycloud/protocol"
	"github.com/floegence/redeven/internal/gatewaymembership"
	gp "github.com/floegence/redeven/internal/runtimegateway/protocol"
)

func TestMembershipOpenAPIContainsOnlyCurrentContract(t *testing.T) {
	_, file, _, _ := runtime.Caller(0)
	root := filepath.Join(filepath.Dir(file), "../../..")
	raw, err := os.ReadFile(filepath.Join(root, "spec/openapi/gateway-v5.yaml"))
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
		gc.RuntimeClosureExchangeRequest{}, gc.RuntimeClosureExchangeResponse{}, gc.BindingFence{}, gc.Closure{}, gp.IdentityRequest{}, gp.IdentityResponse{}, gp.ConfigureCloudRequest{}, gp.MemberCloudContext{}, gp.GatewayPermissions{}, gp.GatewayMetadata{}, gp.CatalogRequest{}, gp.CatalogResponse{}, gp.OpenSessionRequest{}, gp.MemberServiceRequest{}, gp.MemberServiceResponse{},
		gp.ClientAccessCodeRequest{}, gp.ClientAccessCodeResponse{}, gp.ClientListRequest{}, gp.ClientListResponse{}, gp.ClientRevokeRequest{}, gp.GatewayClientRecord{}, gp.InvitationRequest{}, gp.RemoveMemberRequest{}, gp.UpdatePolicyRequest{}, gp.UpdateMembersRequest{}, gp.PairingChallengeRequest{}, gp.PairingChallengeResponse{}, gp.PairingCompleteRequest{}, gp.PairingCompleteResponse{},
		gp.MemberInvitation{}, gp.MemberDelegation{}, gp.MemberService{}, gp.MemberMetadata{}, gp.MemberJoinRequest{}, gp.MemberJoinResponse{}, gp.MemberRotateRequest{}, gp.MemberRotateResponse{}, gp.GatewayEndpoint{}, gp.EndpointUpdateRequest{}, gp.EndpointUpdateResponse{},
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
	expected := []string{"/gateway/v5/clients/access-codes", "/gateway/v5/clients/list", "/gateway/v5/clients/revoke", "/gateway/v5/identity", "/v5/member/cloud-closure", "/gateway/v5/cloud/configure", "/gateway/v5/cloud/status", "/gateway/v5/members/reevaluate", "/v5/member/cloud", "/gateway/v5/pairing/challenge", "/gateway/v5/pairing/complete", "/gateway/v5/catalog", "/gateway/v5/invitations", "/gateway/v5/endpoints", "/gateway/v5/members/remove", "/gateway/v5/members/policy", "/gateway/v5/policy", "/gateway/v5/access/open", "/gateway/v5/access/service", "/gateway/v5/migration/dismiss", "/v5/member/join", "/v5/member/cancel-join", "/v5/member/rotate", "/v5/member/leave", "/v5/member/connect"}
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
