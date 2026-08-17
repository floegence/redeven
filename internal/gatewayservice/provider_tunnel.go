package gatewayservice

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	gatewayauth "github.com/floegence/redeven/internal/runtimegateway/auth"
	gatewaylifecycle "github.com/floegence/redeven/internal/runtimegateway/lifecycle"
	gatewayprotocol "github.com/floegence/redeven/internal/runtimegateway/protocol"
	gatewaysecurity "github.com/floegence/redeven/internal/runtimegateway/security"
)

const (
	providerTunnelClockSkew       = 5 * time.Minute
	providerTunnelMaxArtifactSize = int64(512 << 20)
)

type providerArtifactUpload struct {
	Path         string
	OperationID  string
	MetadataB64u string
	TotalSize    int64
	Offset       int64
}

type providerResponseRecorder struct {
	header http.Header
	status int
	body   bytes.Buffer
}

func (r *providerResponseRecorder) Header() http.Header {
	if r.header == nil {
		r.header = make(http.Header)
	}
	return r.header
}

func (r *providerResponseRecorder) WriteHeader(status int) {
	if r.status == 0 {
		r.status = status
	}
}

func (r *providerResponseRecorder) Write(body []byte) (int, error) {
	if r.status == 0 {
		r.status = http.StatusOK
	}
	return r.body.Write(body)
}

// ExecuteProviderRuntimeManagement processes one transient Provider transport
// request against the Gateway-owned lifecycle store. Transport loss does not
// cancel an operation that the store has already accepted.
func (s *Server) ExecuteProviderRuntimeManagement(ctx context.Context, forward gatewayprotocol.ProviderRuntimeManagementTunnelForwardRequest) gatewayprotocol.ProviderRuntimeManagementTunnelResponse {
	recorder := &providerResponseRecorder{}
	s.executeProviderRuntimeManagement(ctx, recorder, forward)
	status := recorder.status
	if status == 0 {
		status = http.StatusInternalServerError
	}
	return gatewayprotocol.ProviderRuntimeManagementTunnelResponse{
		ProtocolVersion: gatewayprotocol.ProviderRuntimeManagementProtocolVersion,
		StatusCode:      status,
		ContentType:     recorder.Header().Get("Content-Type"),
		BodyB64u:        base64.RawURLEncoding.EncodeToString(recorder.body.Bytes()),
	}
}

func (s *Server) executeProviderRuntimeManagement(ctx context.Context, w http.ResponseWriter, forward gatewayprotocol.ProviderRuntimeManagementTunnelForwardRequest) {
	request := forward.ProviderRuntimeManagementTunnelRequest
	decodedBody, verified, err := s.verifyProviderTunnelRequest(request, forward.RuntimeGrants)
	if err != nil {
		writeGatewayError(w, http.StatusUnauthorized, gatewayprotocol.GatewayErrorCodeUnauthorized, "Runtime management tunnel authorization was rejected.", false)
		return
	}
	if s.lifecycleAuthorizer == nil || s.lifecycle == nil {
		writeGatewayError(w, http.StatusServiceUnavailable, gatewayprotocol.GatewayErrorCodeCapabilityUnsupported, "Runtime management is unavailable.", true)
		return
	}
	if err := s.lifecycleAuthorizer.AuthorizeProviderTunnel(ctx, verified, gatewayprotocol.LifecycleTarget{
		LifecycleTargetID: request.LifecycleTargetID,
		TargetGeneration:  request.TargetGeneration,
	}, request.EnvPublicID); err != nil {
		writeLifecycleAuthorizationError(w, err)
		return
	}
	if !s.acceptProviderTunnelNonce(request.ClientKeyID, request.Nonce, request.TimestampUnixMS) {
		writeGatewayError(w, http.StatusUnauthorized, gatewayprotocol.GatewayErrorCodeUnauthorized, "Runtime management tunnel request was already used.", false)
		return
	}

	s.dispatchProviderRuntimeManagement(ctx, w, request, decodedBody, verified)
}

func (s *Server) verifyProviderTunnelRequest(request gatewayprotocol.ProviderRuntimeManagementTunnelRequest, grants []gatewayprotocol.RuntimeGrant) ([]byte, gatewayauth.VerifiedRequest, error) {
	now := time.Now()
	if request.ProtocolVersion != gatewayprotocol.ProviderRuntimeManagementProtocolVersion || strings.TrimSpace(request.EnvPublicID) == "" ||
		strings.TrimSpace(request.LifecycleTargetID) == "" || request.TargetGeneration <= 0 || strings.TrimSpace(request.ClientKeyID) == "" ||
		strings.TrimSpace(request.ClientPublicKey) == "" || strings.TrimSpace(request.Nonce) == "" || strings.TrimSpace(request.Signature) == "" ||
		request.TimestampUnixMS < now.Add(-providerTunnelClockSkew).UnixMilli() || request.TimestampUnixMS > now.Add(providerTunnelClockSkew).UnixMilli() ||
		!providerTunnelRouteAllowed(request.Method, request.Route) {
		return nil, gatewayauth.VerifiedRequest{}, errors.New("Provider Runtime management tunnel scope is invalid")
	}
	body, err := base64.RawURLEncoding.DecodeString(strings.TrimSpace(request.BodyB64u))
	if err != nil || len(body) > gatewayprotocol.ProviderRuntimeManagementMaxBodyBytes {
		return nil, gatewayauth.VerifiedRequest{}, errors.New("Provider Runtime management tunnel body is invalid")
	}
	bodyDigest := sha256.Sum256(body)
	if strings.ToLower(strings.TrimSpace(request.BodySHA256)) != hex.EncodeToString(bodyDigest[:]) {
		return nil, gatewayauth.VerifiedRequest{}, errors.New("Provider Runtime management tunnel body digest is invalid")
	}
	publicKey := strings.TrimSpace(request.ClientPublicKey)
	if gatewaysecurity.ClientKeyID(publicKey) != strings.TrimSpace(request.ClientKeyID) {
		return nil, gatewayauth.VerifiedRequest{}, errors.New("Provider Runtime management client key id is invalid")
	}
	payload, err := gatewayprotocol.CanonicalProviderRuntimeManagementTunnelPayload(request)
	if err != nil || !gatewaysecurity.VerifySignature(publicKey, string(payload), request.Signature) {
		return nil, gatewayauth.VerifiedRequest{}, errors.New("Provider Runtime management tunnel signature is invalid")
	}
	if upload := request.ArtifactUpload; upload != nil {
		if strings.ToUpper(strings.TrimSpace(request.Method)) != http.MethodPut || !strings.HasSuffix(strings.TrimSpace(request.Route), "/artifact") ||
			strings.TrimSpace(upload.UploadID) == "" || strings.TrimSpace(upload.MetadataB64u) == "" || upload.Offset < 0 ||
			upload.TotalSize <= 0 || upload.TotalSize > providerTunnelMaxArtifactSize || upload.Offset+int64(len(body)) > upload.TotalSize ||
			upload.Final != (upload.Offset+int64(len(body)) == upload.TotalSize) {
			return nil, gatewayauth.VerifiedRequest{}, errors.New("Provider Runtime artifact upload scope is invalid")
		}
	}
	return body, gatewayauth.VerifiedRequest{
		ClientKeyID:    strings.TrimSpace(request.ClientKeyID),
		RuntimeGrants:  append([]gatewayprotocol.RuntimeGrant(nil), grants...),
		ProviderTunnel: true,
	}, nil
}

func (s *Server) acceptProviderTunnelNonce(clientKeyID string, nonce string, timestampUnixMS int64) bool {
	key := strings.TrimSpace(clientKeyID) + "\x00" + strings.TrimSpace(nonce)
	now := time.Now().UnixMilli()
	s.providerTunnelMu.Lock()
	defer s.providerTunnelMu.Unlock()
	for existing, timestamp := range s.providerNonces {
		if timestamp < now-providerTunnelClockSkew.Milliseconds() {
			delete(s.providerNonces, existing)
		}
	}
	if _, exists := s.providerNonces[key]; exists {
		return false
	}
	s.providerNonces[key] = timestampUnixMS
	return true
}

func (s *Server) dispatchProviderRuntimeManagement(ctx context.Context, w http.ResponseWriter, request gatewayprotocol.ProviderRuntimeManagementTunnelRequest, body []byte, verified gatewayauth.VerifiedRequest) {
	route := strings.TrimSpace(request.Route)
	method := strings.ToUpper(strings.TrimSpace(request.Method))
	syntheticRequest, _ := http.NewRequestWithContext(ctx, method, "http://provider-tunnel.local"+route, bytes.NewReader(body))
	if route == "/gateway/v2/runtime-operations/prepare" {
		var prepare gatewayprotocol.RuntimeOperationPrepareRequest
		if !decodeJSONBytes(w, body, &prepare) {
			return
		}
		if strings.TrimSpace(prepare.AuthorizedClientKeyID) != verified.ClientKeyID {
			writeLifecycleError(w, &gatewaylifecycle.Error{Code: gatewaylifecycle.ErrorUnauthorized, Message: "The authorized Runtime operation client does not match the signed request."})
			return
		}
		authorization, err := s.lifecycleAuthorizer.AuthorizePrepare(ctx, syntheticRequest, verified, prepare)
		if err != nil {
			writeLifecycleAuthorizationError(w, err)
			return
		}
		response, err := s.lifecycle.Prepare(ctx, prepare, authorization)
		if err != nil {
			writeLifecycleError(w, err)
			return
		}
		writeGatewayData(w, http.StatusOK, response)
		return
	}
	if route == "/gateway/v2/runtime-operations/list" {
		var list gatewayprotocol.RuntimeOperationListRequest
		if !decodeJSONBytes(w, body, &list) {
			return
		}
		response, err := s.lifecycle.List(ctx, list, s.lifecycleAccess(syntheticRequest, verified))
		if err != nil {
			writeLifecycleError(w, err)
			return
		}
		writeGatewayData(w, http.StatusOK, response)
		return
	}
	operationID, action, ok := providerTunnelOperationRoute(route)
	if !ok {
		writeGatewayError(w, http.StatusBadRequest, gatewayprotocol.GatewayErrorCodeInvalidRequest, "Runtime management tunnel route is invalid.", false)
		return
	}
	access := s.lifecycleAccess(syntheticRequest, verified)
	switch action {
	case "get":
		operation, err := s.lifecycle.Get(ctx, operationID, access)
		writeProviderLifecycleResult(w, operation, err)
	case "events":
		response, err := s.lifecycle.Events(ctx, operationID, access)
		if err != nil {
			writeLifecycleError(w, err)
			return
		}
		writeGatewayData(w, http.StatusOK, response)
	case "confirm":
		var confirmation gatewayprotocol.RuntimeOperationConfirmationRequest
		if !decodeJSONBytes(w, body, &confirmation) {
			return
		}
		operation, err := s.lifecycle.Confirm(ctx, operationID, verified.ClientKeyID, confirmation)
		writeProviderLifecycleResult(w, operation, err)
	case "artifact":
		s.handleProviderArtifactChunk(ctx, w, operationID, request, body, verified.ClientKeyID)
	case "commit":
		operation, err := s.lifecycle.Commit(ctx, operationID, verified.ClientKeyID)
		writeProviderLifecycleResult(w, operation, err)
	case "cancel":
		operation, err := s.lifecycle.Cancel(ctx, operationID, access)
		writeProviderLifecycleResult(w, operation, err)
	case "renew-deadline":
		var renew gatewayprotocol.RuntimeOperationRenewRequest
		if !decodeJSONBytes(w, body, &renew) {
			return
		}
		operation, err := s.lifecycle.Renew(ctx, operationID, verified.ClientKeyID, renew.ExpiresAtUnixMS)
		writeProviderLifecycleResult(w, operation, err)
	case "reconcile":
		var reconcile gatewayprotocol.RuntimeOperationReconcileRequest
		if !decodeJSONBytes(w, body, &reconcile) {
			return
		}
		operation, err := s.lifecycle.OperationForAuthorization(operationID)
		if err != nil {
			writeLifecycleAuthorizationError(w, &gatewaylifecycle.Error{Code: gatewaylifecycle.ErrorUnauthorized, Message: "Runtime reconcile authorization is invalid."})
			return
		}
		access, err = s.lifecycleAuthorizer.AuthorizeReconcile(ctx, syntheticRequest, verified, operation, reconcile.AuthorizationPermit)
		if err != nil {
			writeLifecycleAuthorizationError(w, err)
			return
		}
		operation, err = s.lifecycle.Reconcile(ctx, operationID, access)
		writeProviderLifecycleResult(w, operation, err)
	default:
		writeGatewayError(w, http.StatusBadRequest, gatewayprotocol.GatewayErrorCodeInvalidRequest, "Runtime management tunnel route is invalid.", false)
	}
}

func (s *Server) handleProviderArtifactChunk(ctx context.Context, w http.ResponseWriter, operationID string, request gatewayprotocol.ProviderRuntimeManagementTunnelRequest, chunk []byte, clientKeyID string) {
	upload := request.ArtifactUpload
	if upload == nil {
		writeGatewayError(w, http.StatusBadRequest, gatewayprotocol.GatewayErrorCodeInvalidRequest, "Runtime artifact upload metadata is required.", false)
		return
	}
	uploadKey := clientKeyID + "\x00" + strings.TrimSpace(upload.UploadID)
	digest := sha256.Sum256([]byte(uploadKey))
	uploadPath := filepath.Join(s.stateRoot, "runtime-lifecycle", "provider-uploads", hex.EncodeToString(digest[:])+".partial")
	s.providerTunnelMu.Lock()
	state, exists := s.providerUploads[uploadKey]
	if upload.Offset == 0 {
		state = providerArtifactUpload{Path: uploadPath, OperationID: operationID, MetadataB64u: strings.TrimSpace(upload.MetadataB64u), TotalSize: upload.TotalSize}
		exists = true
		delete(s.providerUploads, uploadKey)
		_ = os.Remove(uploadPath)
	}
	if !exists || state.OperationID != operationID || state.MetadataB64u != strings.TrimSpace(upload.MetadataB64u) || state.TotalSize != upload.TotalSize || state.Offset != upload.Offset {
		s.providerTunnelMu.Unlock()
		writeGatewayError(w, http.StatusConflict, gatewayprotocol.GatewayErrorCodeInvalidRequest, "Runtime artifact upload offset or metadata changed.", false)
		return
	}
	if err := os.MkdirAll(filepath.Dir(uploadPath), 0o700); err != nil {
		s.providerTunnelMu.Unlock()
		writeGatewayError(w, http.StatusInternalServerError, gatewayprotocol.GatewayErrorCodeUnavailable, "Runtime artifact staging is unavailable.", true)
		return
	}
	file, err := os.OpenFile(uploadPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err == nil {
		_, err = file.Write(chunk)
	}
	if err == nil {
		err = file.Sync()
	}
	if file != nil {
		if closeErr := file.Close(); err == nil {
			err = closeErr
		}
	}
	if err != nil {
		delete(s.providerUploads, uploadKey)
		s.providerTunnelMu.Unlock()
		_ = os.Remove(uploadPath)
		writeGatewayError(w, http.StatusInternalServerError, gatewayprotocol.GatewayErrorCodeUnavailable, "Runtime artifact staging failed.", true)
		return
	}
	state.Offset += int64(len(chunk))
	if !upload.Final {
		s.providerUploads[uploadKey] = state
		s.providerTunnelMu.Unlock()
		writeGatewayData(w, http.StatusAccepted, map[string]any{"accepted_offset": state.Offset})
		return
	}
	delete(s.providerUploads, uploadKey)
	s.providerTunnelMu.Unlock()
	defer os.Remove(uploadPath)

	metadataJSON, err := base64.RawURLEncoding.DecodeString(state.MetadataB64u)
	var metadata gatewayprotocol.RuntimeArtifactMetadata
	if err != nil || !decodeProviderTunnelJSON(metadataJSON, &metadata) || metadata.SizeBytes != state.TotalSize {
		writeGatewayError(w, http.StatusBadRequest, gatewayprotocol.GatewayErrorCodeInvalidRequest, "Runtime artifact metadata is invalid.", false)
		return
	}
	artifact, err := os.Open(uploadPath)
	if err != nil {
		writeGatewayError(w, http.StatusInternalServerError, gatewayprotocol.GatewayErrorCodeUnavailable, "Runtime artifact staging failed.", true)
		return
	}
	defer artifact.Close()
	operation, err := s.lifecycle.StageArtifact(ctx, operationID, clientKeyID, metadata, artifact)
	writeProviderLifecycleResult(w, operation, err)
}

func providerTunnelRouteAllowed(method string, route string) bool {
	method = strings.ToUpper(strings.TrimSpace(method))
	route = strings.TrimSpace(route)
	if strings.ContainsAny(route, "?#") {
		return false
	}
	if route == "/gateway/v2/runtime-operations/prepare" || route == "/gateway/v2/runtime-operations/list" {
		return method == http.MethodPost
	}
	_, action, ok := providerTunnelOperationRoute(route)
	if !ok {
		return false
	}
	switch action {
	case "get", "events":
		return method == http.MethodGet
	case "artifact":
		return method == http.MethodPut
	default:
		return method == http.MethodPost
	}
}

func providerTunnelOperationRoute(route string) (string, string, bool) {
	const prefix = "/gateway/v2/runtime-operations/"
	if !strings.HasPrefix(route, prefix) {
		return "", "", false
	}
	parts := strings.Split(strings.TrimPrefix(route, prefix), "/")
	if len(parts) == 1 && strings.TrimSpace(parts[0]) != "" {
		return parts[0], "get", true
	}
	if len(parts) != 2 || strings.TrimSpace(parts[0]) == "" {
		return "", "", false
	}
	switch parts[1] {
	case "events", "artifact", "confirm", "commit", "cancel", "renew-deadline", "reconcile":
		return parts[0], parts[1], true
	default:
		return "", "", false
	}
}

func decodeProviderTunnelJSON(body []byte, out any) bool {
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(out); err != nil {
		return false
	}
	return decoder.Decode(&struct{}{}) == io.EOF
}

func writeProviderLifecycleResult(w http.ResponseWriter, operation gatewayprotocol.RuntimeOperation, err error) {
	if err != nil {
		writeLifecycleError(w, err)
		return
	}
	writeGatewayData(w, http.StatusOK, operation)
}
