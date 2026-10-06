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
	raw, err := os.ReadFile(filepath.Join(root, "spec/openapi/gateway-v4.yaml"))
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
		gp.InvitationRequest{}, gp.RemoveMemberRequest{}, gp.UpdatePolicyRequest{}, gp.UpdateMembersRequest{}, gp.PairingChallengeRequest{}, gp.PairingChallengeResponse{}, gp.PairingCompleteRequest{}, gp.PairingCompleteResponse{},
		gp.MemberInvitation{}, gp.MemberDelegation{}, gp.MemberService{}, gp.MemberMetadata{}, gp.MemberJoinRequest{}, gp.MemberJoinResponse{}, gp.MemberRotateRequest{}, gp.MemberRotateResponse{},
		gp.Member{}, gp.GatewayPolicy{}, gp.MemberPolicyUpdate{}, gp.MemberOperationResult{}, gp.HookInput{}, gp.HookResult{}, gatewaymembership.ConnectionOffer{},
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
	expected := []string{"/gateway/v4/identity", "/v4/member/cloud-closure", "/gateway/v4/cloud/configure", "/gateway/v4/cloud/status", "/gateway/v4/members/reevaluate", "/v4/member/cloud", "/gateway/v4/pairing/challenge", "/gateway/v4/pairing/complete", "/gateway/v4/catalog", "/gateway/v4/invitations", "/gateway/v4/members/remove", "/gateway/v4/members/policy", "/gateway/v4/policy", "/gateway/v4/access/open", "/gateway/v4/access/service", "/gateway/v4/migration/dismiss", "/v4/member/join", "/v4/member/cancel-join", "/v4/member/rotate", "/v4/member/leave", "/v4/member/connect"}
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
