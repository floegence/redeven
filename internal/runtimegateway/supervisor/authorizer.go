package supervisor

import (
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"time"

	gatewayauth "github.com/floegence/redeven/internal/runtimegateway/auth"
	gatewaylifecycle "github.com/floegence/redeven/internal/runtimegateway/lifecycle"
	gatewayprotocol "github.com/floegence/redeven/internal/runtimegateway/protocol"
	gatewaysecurity "github.com/floegence/redeven/internal/runtimegateway/security"
)

const (
	rcppProtocolVersion           = "rcpp-v3"
	runtimeOperationPermitType    = "runtime_operation_permit"
	maximumRuntimePermitClockSkew = 30 * time.Second
)

type Authorizer struct {
	bindings *BindingStore
	now      func() time.Time
}

type runtimeOperationPermitClaims struct {
	Typ                   string                               `json:"typ"`
	ProtocolVersion       string                               `json:"protocol_version"`
	Action                string                               `json:"action"`
	Sub                   string                               `json:"sub"`
	ProviderOrigin        string                               `json:"provider_origin"`
	AccessPointID         string                               `json:"access_point_id"`
	EnvironmentPublicID   string                               `json:"env_public_id"`
	LifecycleTargetID     string                               `json:"lifecycle_target_id"`
	TargetGeneration      int64                                `json:"target_generation"`
	OperationID           string                               `json:"operation_id"`
	Operation             gatewayprotocol.RuntimeOperationKind `json:"operation"`
	DesiredRuntimeVersion string                               `json:"desired_runtime_version,omitempty"`
	ArtifactPolicy        gatewayprotocol.ArtifactPolicy       `json:"artifact_policy"`
	BuildInputsDigest     string                               `json:"build_inputs_digest,omitempty"`
	AuthorizedClientKeyID string                               `json:"authorized_client_key_id"`
	Audience              string                               `json:"aud"`
	Grants                []gatewayprotocol.RuntimeGrant       `json:"grants"`
	Iat                   int64                                `json:"iat"`
	Exp                   int64                                `json:"exp"`
	JTI                   string                               `json:"jti"`
}

func NewAuthorizer(bindings *BindingStore) (*Authorizer, error) {
	if bindings == nil {
		return nil, errors.New("Runtime target binding store is required")
	}
	return &Authorizer{bindings: bindings, now: time.Now}, nil
}

func (a *Authorizer) AuthorizePrepare(_ context.Context, _ *http.Request, verified gatewayauth.VerifiedRequest, request gatewayprotocol.RuntimeOperationPrepareRequest) (gatewaylifecycle.Authorization, error) {
	if a == nil || a.bindings == nil {
		return gatewaylifecycle.Authorization{}, &gatewaylifecycle.Error{Code: gatewaylifecycle.ErrorUnauthorized, Message: "Runtime management authorization is unavailable."}
	}
	if strings.TrimSpace(verified.ClientKeyID) == "" || verified.ClientKeyID != strings.TrimSpace(request.AuthorizedClientKeyID) {
		return gatewaylifecycle.Authorization{}, &gatewaylifecycle.Error{Code: gatewaylifecycle.ErrorUnauthorized, Message: "Runtime operation client identity does not match the signed request."}
	}
	if err := a.bindings.Validate(request.GatewayEnvID, gatewayprotocol.LifecycleTarget{LifecycleTargetID: request.LifecycleTargetID, TargetGeneration: request.TargetGeneration}); err != nil {
		return gatewaylifecycle.Authorization{}, &gatewaylifecycle.Error{Code: gatewaylifecycle.ErrorTargetChanged, Message: "Runtime lifecycle target changed before authorization."}
	}
	binding := a.bindings.Binding()
	if strings.TrimSpace(request.AuthorizationPermit) == "" {
		if verified.ProviderTunnel {
			return gatewaylifecycle.Authorization{}, &gatewaylifecycle.Error{Code: gatewaylifecycle.ErrorUnauthorized, Message: "Provider Runtime operations require a one-time authorization permit."}
		}
		grants := normalizePermitGrants(verified.RuntimeGrants)
		if !hasPermitGrant(grants, gatewayprotocol.RuntimeGrantManage) {
			return gatewaylifecycle.Authorization{}, &gatewaylifecycle.Error{Code: gatewaylifecycle.ErrorUnauthorized, Message: "Runtime management permission is required."}
		}
		return gatewaylifecycle.Authorization{
			Actor:          gatewayprotocol.RuntimeOperationActor{Kind: "gateway_client", SubjectID: verified.ClientKeyID},
			RouteBindingID: binding.BindingID,
			Grants:         grants,
		}, nil
	}
	claims, err := verifyRuntimeOperationPermit(request.AuthorizationPermit, binding, request, a.currentTime())
	if err != nil {
		return gatewaylifecycle.Authorization{}, &gatewaylifecycle.Error{Code: gatewaylifecycle.ErrorUnauthorized, Message: "Runtime operation authorization permit is invalid or does not match this operation."}
	}
	return gatewaylifecycle.Authorization{
		Actor:          gatewayprotocol.RuntimeOperationActor{Kind: "provider_user", SubjectID: claims.Sub},
		RouteBindingID: binding.BindingID,
		Grants:         append([]gatewayprotocol.RuntimeGrant(nil), claims.Grants...),
		PermitJTI:      claims.JTI,
	}, nil
}

func (a *Authorizer) AuthorizeProviderTunnel(_ context.Context, verified gatewayauth.VerifiedRequest, target gatewayprotocol.LifecycleTarget, envPublicID string) error {
	if a == nil || a.bindings == nil || !verified.ProviderTunnel || strings.TrimSpace(verified.ClientKeyID) == "" {
		return &gatewaylifecycle.Error{Code: gatewaylifecycle.ErrorUnauthorized, Message: "Provider Runtime management tunnel is unauthorized."}
	}
	binding := a.bindings.Binding()
	if strings.TrimSpace(binding.EnvironmentPublicID) == "" || strings.TrimSpace(binding.EnvironmentPublicID) != strings.TrimSpace(envPublicID) ||
		binding.LifecycleTargetID != strings.TrimSpace(target.LifecycleTargetID) || binding.TargetGeneration != target.TargetGeneration {
		return &gatewaylifecycle.Error{Code: gatewaylifecycle.ErrorTargetChanged, Message: "Provider Runtime lifecycle target changed before routing."}
	}
	return nil
}

func (a *Authorizer) AuthorizeAccess(_ context.Context, _ *http.Request, verified gatewayauth.VerifiedRequest) (gatewaylifecycle.Access, error) {
	access := gatewaylifecycle.Access{ClientKeyID: strings.TrimSpace(verified.ClientKeyID), Grants: normalizePermitGrants(verified.RuntimeGrants)}
	if access.ClientKeyID == "" {
		return access, errors.New("Gateway client identity is missing")
	}
	return access, nil
}

func (a *Authorizer) AuthorizeReconcile(_ context.Context, _ *http.Request, verified gatewayauth.VerifiedRequest, operation gatewayprotocol.RuntimeOperation, permit string) (gatewaylifecycle.Access, error) {
	access := gatewaylifecycle.Access{ClientKeyID: strings.TrimSpace(verified.ClientKeyID)}
	if a == nil || a.bindings == nil || access.ClientKeyID == "" {
		return access, &gatewaylifecycle.Error{Code: gatewaylifecycle.ErrorUnauthorized, Message: "Runtime reconcile authorization is invalid."}
	}
	if err := a.bindings.Validate(operation.GatewayEnvID, gatewayprotocol.LifecycleTarget{LifecycleTargetID: operation.LifecycleTargetID, TargetGeneration: operation.TargetGeneration}); err != nil {
		return access, &gatewaylifecycle.Error{Code: gatewaylifecycle.ErrorTargetChanged, Message: "Runtime lifecycle target changed before reconcile authorization."}
	}
	if strings.TrimSpace(permit) == "" {
		return gatewaylifecycle.Access{}, &gatewaylifecycle.Error{Code: gatewaylifecycle.ErrorUnauthorized, Message: "An exact Runtime recovery authorization permit is required."}
	}
	claims, err := parseRuntimeOperationPermit(permit, a.bindings.Binding(), a.currentTime())
	if err != nil || claims.Action != "reconcile" || claims.Operation != gatewayprotocol.RuntimeOperationReconcile ||
		claims.LifecycleTargetID != operation.LifecycleTargetID || claims.TargetGeneration != operation.TargetGeneration ||
		claims.OperationID != operation.OperationID || claims.AuthorizedClientKeyID != access.ClientKeyID ||
		claims.Audience != operation.RouteBindingID || claims.DesiredRuntimeVersion != "" || claims.ArtifactPolicy != "" || claims.BuildInputsDigest != "" ||
		!hasPermitGrant(claims.Grants, gatewayprotocol.RuntimeGrantManageBinding) {
		return access, &gatewaylifecycle.Error{Code: gatewaylifecycle.ErrorUnauthorized, Message: "Runtime reconcile authorization permit is invalid or does not match this operation."}
	}
	access.Grants = append([]gatewayprotocol.RuntimeGrant(nil), claims.Grants...)
	access.PermitJTI = claims.JTI
	return access, nil
}

func (a *Authorizer) currentTime() time.Time {
	if a != nil && a.now != nil {
		return a.now()
	}
	return time.Now()
}

func verifyRuntimeOperationPermit(token string, binding TargetBinding, request gatewayprotocol.RuntimeOperationPrepareRequest, now time.Time) (runtimeOperationPermitClaims, error) {
	claims, err := parseRuntimeOperationPermit(token, binding, now)
	if err != nil {
		return runtimeOperationPermitClaims{}, err
	}
	if claims.Action != "prepare" {
		return runtimeOperationPermitClaims{}, errors.New("permit action does not match Runtime prepare")
	}
	if !hasPermitGrant(claims.Grants, gatewayprotocol.RuntimeGrantManage) {
		return runtimeOperationPermitClaims{}, errors.New("permit does not grant Runtime management")
	}
	if request.DesiredRuntime.ArtifactPolicy == gatewayprotocol.ArtifactPolicyCustomBuild && !hasPermitGrant(claims.Grants, gatewayprotocol.RuntimeGrantCustomBuild) {
		return runtimeOperationPermitClaims{}, errors.New("permit does not grant custom Runtime deployment")
	}
	buildInputsDigest, err := canonicalBuildInputsDigest(request.BuildInputs)
	if err != nil {
		return runtimeOperationPermitClaims{}, err
	}
	if claims.LifecycleTargetID != request.LifecycleTargetID || claims.TargetGeneration != request.TargetGeneration ||
		claims.OperationID != request.OperationID || claims.Operation != request.Operation ||
		normalizeVersion(claims.DesiredRuntimeVersion) != normalizeVersion(request.DesiredRuntime.Version) ||
		claims.ArtifactPolicy != request.DesiredRuntime.ArtifactPolicy || claims.BuildInputsDigest != buildInputsDigest ||
		claims.AuthorizedClientKeyID != request.AuthorizedClientKeyID {
		return runtimeOperationPermitClaims{}, errors.New("permit scope does not match Runtime operation")
	}
	return claims, nil
}

func parseRuntimeOperationPermit(token string, binding TargetBinding, now time.Time) (runtimeOperationPermitClaims, error) {
	key := binding.PermitVerificationKey
	if key.Algorithm != "EdDSA" || strings.TrimSpace(key.KeyID) == "" || strings.TrimSpace(key.PublicKey) == "" {
		return runtimeOperationPermitClaims{}, errors.New("Provider permit verification key is unavailable")
	}
	publicKey, err := base64.RawURLEncoding.DecodeString(key.PublicKey)
	if err != nil || len(publicKey) != ed25519.PublicKeySize {
		return runtimeOperationPermitClaims{}, errors.New("Provider permit verification key is invalid")
	}
	parts := strings.Split(strings.TrimSpace(token), ".")
	if len(parts) != 3 {
		return runtimeOperationPermitClaims{}, errors.New("permit format is invalid")
	}
	headerJSON, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return runtimeOperationPermitClaims{}, err
	}
	var header struct {
		Algorithm string `json:"alg"`
		KeyID     string `json:"kid"`
		Type      string `json:"typ"`
	}
	if err := json.Unmarshal(headerJSON, &header); err != nil || header.Algorithm != "EdDSA" || header.KeyID != key.KeyID || header.Type != "JWT" {
		return runtimeOperationPermitClaims{}, errors.New("permit header is invalid")
	}
	signature, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil || !ed25519.Verify(ed25519.PublicKey(publicKey), []byte(parts[0]+"."+parts[1]), signature) {
		return runtimeOperationPermitClaims{}, errors.New("permit signature is invalid")
	}
	payloadJSON, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return runtimeOperationPermitClaims{}, err
	}
	decoder := json.NewDecoder(strings.NewReader(string(payloadJSON)))
	decoder.DisallowUnknownFields()
	var claims runtimeOperationPermitClaims
	if err := decoder.Decode(&claims); err != nil {
		return runtimeOperationPermitClaims{}, err
	}
	claims.Action = strings.TrimSpace(claims.Action)
	if claims.Typ != runtimeOperationPermitType || claims.ProtocolVersion != rcppProtocolVersion ||
		(claims.Action != "prepare" && claims.Action != "reconcile") || strings.TrimSpace(claims.JTI) == "" ||
		claims.Iat <= 0 || claims.Exp <= claims.Iat || now.Unix() > claims.Exp || time.Unix(claims.Iat, 0).After(now.Add(maximumRuntimePermitClockSkew)) {
		return runtimeOperationPermitClaims{}, errors.New("permit time or type is invalid")
	}
	claims.Grants = normalizePermitGrants(claims.Grants)
	if claims.Sub == "" || claims.ProviderOrigin != binding.ProviderOrigin || claims.AccessPointID != binding.AccessPointID ||
		claims.EnvironmentPublicID != binding.EnvironmentPublicID || claims.Audience != binding.BindingID {
		return runtimeOperationPermitClaims{}, errors.New("permit scope does not match Runtime operation")
	}
	return claims, nil
}

func canonicalBuildInputsDigest(raw json.RawMessage) (string, error) {
	if len(raw) == 0 {
		return "", nil
	}
	digest, err := gatewaysecurity.CanonicalJSONDigestFromBytes(raw)
	if err != nil {
		return "", fmt.Errorf("canonicalize Runtime build inputs: %w", err)
	}
	return digest, nil
}

func normalizePermitGrants(values []gatewayprotocol.RuntimeGrant) []gatewayprotocol.RuntimeGrant {
	seen := make(map[gatewayprotocol.RuntimeGrant]struct{}, len(values))
	out := make([]gatewayprotocol.RuntimeGrant, 0, len(values))
	for _, value := range values {
		value = gatewayprotocol.RuntimeGrant(strings.TrimSpace(string(value)))
		switch value {
		case gatewayprotocol.RuntimeGrantManage, gatewayprotocol.RuntimeGrantCustomBuild, gatewayprotocol.RuntimeGrantManageBinding:
		default:
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	sort.Slice(out, func(i, j int) bool { return out[i] < out[j] })
	return out
}

func hasPermitGrant(values []gatewayprotocol.RuntimeGrant, expected gatewayprotocol.RuntimeGrant) bool {
	for _, value := range values {
		if value == expected {
			return true
		}
	}
	return false
}

func permitJTIHash(value string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(value)))
	return hex.EncodeToString(sum[:])
}
