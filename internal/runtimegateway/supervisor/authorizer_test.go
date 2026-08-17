package supervisor

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"testing"
	"time"

	gatewayauth "github.com/floegence/redeven/internal/runtimegateway/auth"
	gatewayprotocol "github.com/floegence/redeven/internal/runtimegateway/protocol"
)

func TestAuthorizerVerifiesProviderPermitWithPinnedPublicKey(t *testing.T) {
	bindings, err := OpenLocalBindingStore(t.TempDir(), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	binding := bindings.Binding()
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	if err := bindings.ConfigureProvider("rmb_provider", "https://portal.example", "ap_demo", "https://region.example", "env_demo", PermitVerificationKey{
		KeyID: "rpk_demo", Algorithm: "EdDSA", PublicKey: base64.RawURLEncoding.EncodeToString(publicKey),
	}, binding.TargetGeneration); err != nil {
		t.Fatal(err)
	}
	binding = bindings.Binding()
	request := gatewayprotocol.RuntimeOperationPrepareRequest{
		ProtocolVersion: gatewayprotocol.Version, OperationID: "rop_demo", AuthorizedClientKeyID: "gck_demo",
		GatewayEnvID: binding.GatewayEnvID, LifecycleTargetID: binding.LifecycleTargetID, TargetGeneration: binding.TargetGeneration,
		Operation:      gatewayprotocol.RuntimeOperationUpdate,
		DesiredRuntime: gatewayprotocol.DesiredRuntime{Version: "0.11.0", Platform: "linux", Architecture: "amd64", ArtifactPolicy: gatewayprotocol.ArtifactPolicyPublishedRelease},
		IdempotencyKey: "runtime-operation:rop_demo",
	}
	claims := runtimeOperationPermitClaims{
		Typ: runtimeOperationPermitType, ProtocolVersion: rcppProtocolVersion, Action: "prepare", Sub: "user_demo",
		ProviderOrigin: binding.ProviderOrigin, AccessPointID: binding.AccessPointID, EnvironmentPublicID: binding.EnvironmentPublicID,
		LifecycleTargetID: request.LifecycleTargetID, TargetGeneration: request.TargetGeneration,
		OperationID: request.OperationID, Operation: request.Operation, DesiredRuntimeVersion: request.DesiredRuntime.Version,
		ArtifactPolicy: request.DesiredRuntime.ArtifactPolicy, AuthorizedClientKeyID: request.AuthorizedClientKeyID,
		Audience: binding.BindingID, Grants: []gatewayprotocol.RuntimeGrant{gatewayprotocol.RuntimeGrantManage},
		Iat: time.Now().Add(-time.Second).Unix(), Exp: time.Now().Add(time.Minute).Unix(), JTI: "rop_jti_demo",
	}
	request.AuthorizationPermit = signTestPermit(t, privateKey, binding.PermitVerificationKey.KeyID, claims)
	authorizer, err := NewAuthorizer(bindings)
	if err != nil {
		t.Fatal(err)
	}
	authorization, err := authorizer.AuthorizePrepare(context.Background(), nil, gatewayauth.VerifiedRequest{ClientKeyID: "gck_demo"}, request)
	if err != nil {
		t.Fatalf("AuthorizePrepare() error = %v", err)
	}
	if authorization.Actor.Kind != "provider_user" || authorization.Actor.SubjectID != "user_demo" || authorization.PermitJTI != "rop_jti_demo" {
		t.Fatalf("authorization = %#v", authorization)
	}

	tests := []struct {
		name   string
		mutate func(*runtimeOperationPermitClaims)
	}{
		{name: "target", mutate: func(value *runtimeOperationPermitClaims) { value.LifecycleTargetID = "rlt_other" }},
		{name: "action", mutate: func(value *runtimeOperationPermitClaims) { value.Action = "reconcile" }},
		{name: "generation", mutate: func(value *runtimeOperationPermitClaims) { value.TargetGeneration++ }},
		{name: "operation", mutate: func(value *runtimeOperationPermitClaims) { value.Operation = gatewayprotocol.RuntimeOperationRestart }},
		{name: "version", mutate: func(value *runtimeOperationPermitClaims) { value.DesiredRuntimeVersion = "0.12.0" }},
		{name: "client", mutate: func(value *runtimeOperationPermitClaims) { value.AuthorizedClientKeyID = "gck_other" }},
		{name: "audience", mutate: func(value *runtimeOperationPermitClaims) { value.Audience = "rmb_other" }},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			changed := claims
			changed.Grants = append([]gatewayprotocol.RuntimeGrant(nil), claims.Grants...)
			tt.mutate(&changed)
			attempt := request
			attempt.AuthorizationPermit = signTestPermit(t, privateKey, binding.PermitVerificationKey.KeyID, changed)
			if _, err := authorizer.AuthorizePrepare(context.Background(), nil, gatewayauth.VerifiedRequest{ClientKeyID: "gck_demo"}, attempt); err == nil {
				t.Fatalf("AuthorizePrepare accepted mismatched %s permit scope", tt.name)
			}
		})
	}
}

func TestAuthorizerRequiresExplicitDirectManagementGrant(t *testing.T) {
	bindings, err := OpenLocalBindingStore(t.TempDir(), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	binding := bindings.Binding()
	request := gatewayprotocol.RuntimeOperationPrepareRequest{
		GatewayEnvID: binding.GatewayEnvID, LifecycleTargetID: binding.LifecycleTargetID,
		TargetGeneration: binding.TargetGeneration, AuthorizedClientKeyID: "gck_demo",
	}
	authorizer, _ := NewAuthorizer(bindings)
	if _, err := authorizer.AuthorizePrepare(context.Background(), nil, gatewayauth.VerifiedRequest{ClientKeyID: "gck_demo"}, request); err == nil {
		t.Fatal("AuthorizePrepare allowed a paired-only client")
	}
	if _, err := authorizer.AuthorizePrepare(context.Background(), nil, gatewayauth.VerifiedRequest{ClientKeyID: "gck_demo", ProfileWrite: true}, request); err == nil {
		t.Fatal("AuthorizePrepare inferred Runtime grants from profile write permission")
	}
	if _, err := authorizer.AuthorizePrepare(context.Background(), nil, gatewayauth.VerifiedRequest{
		ClientKeyID: "gck_demo", RuntimeGrants: []gatewayprotocol.RuntimeGrant{gatewayprotocol.RuntimeGrantManage},
	}, request); err != nil {
		t.Fatalf("AuthorizePrepare(explicit Runtime grant) error = %v", err)
	}
}

func TestAuthorizerVerifiesProviderReconcilePermit(t *testing.T) {
	bindings, err := OpenLocalBindingStore(t.TempDir(), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	binding := bindings.Binding()
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	if err := bindings.ConfigureProvider("rmb_provider", "https://portal.example", "ap_demo", "https://region.example", "env_demo", PermitVerificationKey{
		KeyID: "rpk_demo", Algorithm: "EdDSA", PublicKey: base64.RawURLEncoding.EncodeToString(publicKey),
	}, binding.TargetGeneration); err != nil {
		t.Fatal(err)
	}
	binding = bindings.Binding()
	operation := gatewayprotocol.RuntimeOperation{
		OperationID: "rop_reconcile", LifecycleTargetID: binding.LifecycleTargetID,
		TargetGeneration: binding.TargetGeneration, GatewayEnvID: binding.GatewayEnvID,
		AuthorizedClientKeyID: "gck_demo", RouteBindingID: binding.BindingID,
	}
	claims := runtimeOperationPermitClaims{
		Typ: runtimeOperationPermitType, ProtocolVersion: rcppProtocolVersion, Action: "reconcile", Sub: "user_demo",
		ProviderOrigin: binding.ProviderOrigin, AccessPointID: binding.AccessPointID, EnvironmentPublicID: binding.EnvironmentPublicID,
		LifecycleTargetID: operation.LifecycleTargetID, TargetGeneration: operation.TargetGeneration,
		OperationID: operation.OperationID, Operation: gatewayprotocol.RuntimeOperationReconcile,
		AuthorizedClientKeyID: "gck_recovery_admin", Audience: binding.BindingID,
		Grants: []gatewayprotocol.RuntimeGrant{gatewayprotocol.RuntimeGrantManageBinding},
		Iat:    time.Now().Add(-time.Second).Unix(), Exp: time.Now().Add(time.Minute).Unix(), JTI: "rop_reconcile_jti",
	}
	permit := signTestPermit(t, privateKey, binding.PermitVerificationKey.KeyID, claims)
	authorizer, _ := NewAuthorizer(bindings)
	if _, err := authorizer.AuthorizeReconcile(context.Background(), nil, gatewayauth.VerifiedRequest{
		ClientKeyID:   "gck_recovery_admin",
		RuntimeGrants: []gatewayprotocol.RuntimeGrant{gatewayprotocol.RuntimeGrantManageBinding},
	}, operation, ""); err == nil {
		t.Fatal("AuthorizeReconcile accepted binding permission without an exact recovery permit")
	}
	access, err := authorizer.AuthorizeReconcile(context.Background(), nil, gatewayauth.VerifiedRequest{ClientKeyID: "gck_recovery_admin"}, operation, permit)
	if err != nil {
		t.Fatalf("AuthorizeReconcile() error = %v", err)
	}
	if access.ClientKeyID != "gck_recovery_admin" || access.PermitJTI != claims.JTI || len(access.Grants) != 1 || access.Grants[0] != gatewayprotocol.RuntimeGrantManageBinding {
		t.Fatalf("reconcile access = %#v", access)
	}
	claims.Action = "prepare"
	if _, err := authorizer.AuthorizeReconcile(context.Background(), nil, gatewayauth.VerifiedRequest{ClientKeyID: "gck_recovery_admin"}, operation, signTestPermit(t, privateKey, binding.PermitVerificationKey.KeyID, claims)); err == nil {
		t.Fatal("AuthorizeReconcile accepted a prepare permit")
	}
}

func signTestPermit(t *testing.T, privateKey ed25519.PrivateKey, keyID string, claims runtimeOperationPermitClaims) string {
	t.Helper()
	header, _ := json.Marshal(map[string]string{"alg": "EdDSA", "kid": keyID, "typ": "JWT"})
	payload, _ := json.Marshal(claims)
	input := base64.RawURLEncoding.EncodeToString(header) + "." + base64.RawURLEncoding.EncodeToString(payload)
	return input + "." + base64.RawURLEncoding.EncodeToString(ed25519.Sign(privateKey, []byte(input)))
}
