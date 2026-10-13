package config

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/floegence/redeven/internal/runtimecloud"
	rc "github.com/floegence/redeven/internal/runtimecloud/protocol"

	flowersec "github.com/floegence/flowersec/flowersec-go/v5"
	"github.com/floegence/redeven/internal/gatewaymembership"
)

type BootstrapArgs struct {
	CloudOrigin       string
	CloudID           string
	EnvironmentID     string
	RuntimeLinkTicket string
	RuntimeVersion    string

	StateRoot string

	AgentHomeDir string
	Shell        string
	LogFormat    string
	LogLevel     string
	// HTTPClient optionally supplies custom TLS trust roots while HTTPS and redirect policy remain enforced.
	HTTPClient *http.Client

	// PermissionPolicyPreset is an optional preset used to write permission_policy into the config.
	// If empty, bootstrap preserves the existing permission_policy when possible, otherwise uses defaults.
	PermissionPolicyPreset string
}

type CloudLinkBootstrapArgs struct {
	ConfigPath                string
	ExpectedBindingGeneration int64

	CloudOrigin            string
	CloudID                string
	EnvironmentID          string
	RuntimeLinkTicket      string
	RuntimeVersion         string
	PermissionPolicyPreset string
	AgentHomeDir           string
	Shell                  string
	LogFormat              string
	LogLevel               string
	// HTTPClient optionally supplies custom TLS trust roots while HTTPS and redirect policy remain enforced.
	HTTPClient *http.Client

	RuntimeHostname string
	RuntimeGOOS     string
	RuntimeGOARCH   string

	PreservePermissionPolicy bool
}

type cloudLinkResolveArgs struct {
	ExpectedBindingGeneration int64
	ConfigPath                string

	CloudOrigin            string
	CloudID                string
	EnvironmentID          string
	Credential             string
	RuntimeVersion         string
	PermissionPolicyPreset string
	AgentHomeDir           string
	Shell                  string
	LogFormat              string
	LogLevel               string
	HTTPClient             *http.Client

	RuntimeHostname string
	RuntimeGOOS     string
	RuntimeGOARCH   string

	PreservePermissionPolicy bool
}

type bootstrapControlArtifactPoolEntry struct {
	ArtifactJSON      json.RawMessage `json:"artifact_json"`
	ArtifactChannelID string          `json:"artifact_channel_id"`
	BindingGeneration int64           `json:"binding_generation"`
	ArtifactSequence  uint64          `json:"artifact_sequence"`
	ExpiresAtUnixS    int64           `json:"expires_at_unix_s"`
}

type bootstrapControlArtifactPool struct {
	Version                       string                              `json:"version"`
	LogicalCloudBindingID         string                              `json:"logical_cloud_binding_id"`
	BindingGeneration             int64                               `json:"binding_generation"`
	TargetWaterline               int                                 `json:"target_waterline"`
	RefreshHorizonSeconds         int64                               `json:"refresh_horizon_seconds"`
	ServerHighestArtifactSequence uint64                              `json:"server_highest_artifact_sequence"`
	Entries                       []bootstrapControlArtifactPoolEntry `json:"entries"`
	ResponseDigestB64u            string                              `json:"response_digest_b64u"`
}

const bootstrapDeliveryAttemptVersion = 4

type bootstrapDeliveryAttempt struct {
	CloudID                        string      `json:"cloud_id"`
	DeliveryRequestID              string      `json:"delivery_request_id"`
	RecoveryOnly                   bool        `json:"recovery_only"`
	Suspended                      bool        `json:"suspended"`
	ExpectedAssociationRevision    int64       `json:"expected_association_revision"`
	ExpectedRouteRevision          int64       `json:"expected_route_revision"`
	PublicKeyB64u                  string      `json:"public_key_b64u"`
	PrivateKeyB64u                 string      `json:"private_key_b64u"`
	NamespacePublicID              string      `json:"namespace_public_id"`
	Metadata                       rc.Metadata `json:"metadata"`
	Version                        int         `json:"version"`
	CloudOrigin                    string      `json:"cloud_origin"`
	AccessPointOrigin              string      `json:"access_point_origin"`
	EnvPublicID                    string      `json:"env_public_id"`
	LocalEnvironmentPublicID       string      `json:"local_environment_public_id"`
	AgentInstanceID                string      `json:"agent_instance_id"`
	BootstrapDeliveryRequestIDB64u string      `json:"delivery_request_id_b64u"`
}

type bootstrapExchangeErrorResponse struct {
	Success bool                    `json:"success"`
	Error   *bootstrapExchangeError `json:"error"`
}

type bootstrapExchangeError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func BootstrapConfig(ctx context.Context, args BootstrapArgs) (writtenPath string, err error) {
	layout, err := resolveBootstrapStateLayout(args)
	if err != nil {
		return "", err
	}
	linkArgs := cloudLinkArgsFromBootstrapArgs(args)
	linkArgs.ConfigPath = layout.ConfigPath
	cfg, err := ResolveCloudLinkConfig(ctx, linkArgs)
	if err != nil {
		return "", err
	}
	if err := SaveCloudLinkConfig(layout.ConfigPath, cfg); err != nil {
		return "", err
	}
	return filepath.Clean(layout.ConfigPath), nil
}

func cloudLinkArgsFromBootstrapArgs(args BootstrapArgs) CloudLinkBootstrapArgs {
	return CloudLinkBootstrapArgs{
		CloudOrigin:              args.CloudOrigin,
		CloudID:                  args.CloudID,
		EnvironmentID:            args.EnvironmentID,
		RuntimeLinkTicket:        args.RuntimeLinkTicket,
		RuntimeVersion:           args.RuntimeVersion,
		PermissionPolicyPreset:   args.PermissionPolicyPreset,
		AgentHomeDir:             args.AgentHomeDir,
		Shell:                    args.Shell,
		LogFormat:                args.LogFormat,
		LogLevel:                 args.LogLevel,
		HTTPClient:               args.HTTPClient,
		RuntimeHostname:          hostnameBestEffort(),
		RuntimeGOOS:              runtime.GOOS,
		RuntimeGOARCH:            runtime.GOARCH,
		PreservePermissionPolicy: strings.TrimSpace(args.PermissionPolicyPreset) == "",
	}
}

func BootstrapCloudLink(ctx context.Context, args CloudLinkBootstrapArgs) (*Config, error) {
	cfgPath := strings.TrimSpace(args.ConfigPath)
	if cfgPath == "" {
		return nil, errors.New("missing config path")
	}
	cfg, err := ResolveCloudLinkConfig(ctx, args)
	if err != nil {
		return nil, err
	}
	if err := SaveCloudLinkConfig(cfgPath, cfg); err != nil {
		return nil, err
	}
	return cfg, nil
}

func ResolveCloudLinkConfig(ctx context.Context, args CloudLinkBootstrapArgs) (*Config, error) {
	return resolveCloudLinkConfig(ctx, cloudLinkResolveArgs{
		ExpectedBindingGeneration: args.ExpectedBindingGeneration,
		ConfigPath:                args.ConfigPath, CloudOrigin: args.CloudOrigin,
		CloudID: args.CloudID, EnvironmentID: args.EnvironmentID,
		Credential: args.RuntimeLinkTicket, RuntimeVersion: args.RuntimeVersion, PermissionPolicyPreset: args.PermissionPolicyPreset,
		AgentHomeDir: args.AgentHomeDir, Shell: args.Shell, LogFormat: args.LogFormat, LogLevel: args.LogLevel,
		HTTPClient: args.HTTPClient, RuntimeHostname: args.RuntimeHostname, RuntimeGOOS: args.RuntimeGOOS, RuntimeGOARCH: args.RuntimeGOARCH,
		PreservePermissionPolicy: args.PreservePermissionPolicy,
	})
}

type runtimeLinkAssignment struct {
	NamespacePublicID string `json:"namespace_public_id"`
	ProtocolVersion   string `json:"protocol_version"`
	CloudID           string `json:"cloud_id"`
	CloudOrigin       string `json:"cloud_origin"`
	EnvPublicID       string `json:"env_public_id"`
	AccessPointID     string `json:"access_point_id"`
	AccessPointOrigin string `json:"access_point_origin"`
	ExpiresAtUnixMS   int64  `json:"expires_at_unix_ms"`
}

func resolveCloudAccessPoint(ctx context.Context, client *http.Client, cloudOrigin, envID, ticket string) (*runtimeLinkAssignment, error) {
	origin, err := url.Parse(cloudOrigin)
	if err != nil {
		return nil, err
	}
	endpoint := *origin
	endpoint.Path = "/api/rcpp/v5/runtime-link/resolve"
	payload, err := json.Marshal(struct {
		ProtocolVersion string `json:"protocol_version"`
		EnvPublicID     string `json:"env_public_id"`
	}{"rcpp-v5", envID})
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint.String(), bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+ticket)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	resp, err := secureBootstrapHTTPClient(client, origin).Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	const maxAssignmentBytes = 16 * 1024
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxAssignmentBytes+1))
	if err != nil {
		return nil, err
	}
	if len(body) > maxAssignmentBytes {
		return nil, errors.New("cloud assignment exceeds exact byte bound")
	}
	if resp.StatusCode != http.StatusOK {
		failure := &RuntimeLinkExchangeError{StatusCode: resp.StatusCode}
		var response bootstrapExchangeErrorResponse
		if decodeExactBootstrapExchangeError(body, &response) == nil {
			failure.Code = response.Error.Code
		}
		return nil, failure
	}
	var assignment runtimeLinkAssignment
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&assignment); err != nil {
		return nil, fmt.Errorf("invalid Cloud assignment: %w", err)
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		return nil, errors.New("cloud assignment contains multiple JSON values")
	}
	accessOrigin, err := normalizeAccessPointOrigin(assignment.AccessPointOrigin)
	if err != nil || accessOrigin != assignment.AccessPointOrigin || assignment.ProtocolVersion != "rcpp-v5" ||
		assignment.CloudOrigin != cloudOrigin || assignment.EnvPublicID != envID ||
		strings.TrimSpace(assignment.CloudID) == "" || assignment.CloudID != strings.TrimSpace(assignment.CloudID) ||
		strings.TrimSpace(assignment.AccessPointID) == "" || assignment.AccessPointID != strings.TrimSpace(assignment.AccessPointID) ||
		assignment.ExpiresAtUnixMS <= time.Now().UnixMilli() {
		return nil, errors.New("cloud assignment identity, origin, expiry or protocol mismatch")
	}
	return &assignment, nil
}

func resolveCloudLinkConfig(ctx context.Context, args cloudLinkResolveArgs) (*Config, error) {
	baseURL := ""
	cloudOrigin := strings.TrimSpace(args.CloudOrigin)
	envID := strings.TrimSpace(args.EnvironmentID)
	credential := normalizeBearerToken(args.Credential)
	cfgPath := strings.TrimSpace(args.ConfigPath)
	if cfgPath == "" {
		return nil, errors.New("missing config path")
	}
	if cloudOrigin == "" || envID == "" {
		return nil, errors.New("missing cloud/env-id")
	}
	cloudOrigin, err := normalizeAccessPointOrigin(cloudOrigin)
	if err != nil {
		return nil, fmt.Errorf("invalid Cloud origin: %w", err)
	}
	var prev *Config
	if c, loadErr := Load(cfgPath); loadErr == nil {
		prev = c
	} else if !errors.Is(loadErr, os.ErrNotExist) {
		return nil, fmt.Errorf("load existing runtime configuration: %w", loadErr)
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	if args.HTTPClient != nil && args.HTTPClient.Transport != nil {
		selected, ok := args.HTTPClient.Transport.(*http.Transport)
		if !ok {
			return nil, errors.New("cloud enrollment requires an HTTP transport")
		}
		transport = selected.Clone()
	}
	if prev != nil && prev.CloudRoute != nil && prev.CloudRoute.Kind == CloudRouteGateway {
		proxy, err := prev.CloudProxy()
		if err != nil {
			return nil, err
		}
		// Both discovery and enrollment use the selected route. Preserve the
		// independent inner Cloud TLS trust when installing the proxy dialer.
		proxied := proxy.HTTPTransport()
		proxied.TLSClientConfig = transport.TLSClientConfig
		transport = proxied
	}
	defer transport.CloseIdleConnections()
	assignmentClient := &http.Client{Transport: transport, Timeout: 15 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	var assignment *runtimeLinkAssignment
	journalPath := filepath.Clean(cfgPath) + ".cloud-enrollment-v5.json"
	if raw, readErr := os.ReadFile(journalPath); readErr == nil {
		var pending bootstrapDeliveryAttempt
		if err := decodeExactBootstrapDeliveryAttempt(raw, &pending); err != nil {
			return nil, fmt.Errorf("read pending Cloud enrollment: %w; inspect the journal before registering again", err)
		}
		if pending.Suspended {
			return nil, errors.New("cloud enrollment is cancelled locally; use cloud enrollment resume with the original operation ID")
		}
		if pending.CloudOrigin != cloudOrigin || pending.EnvPublicID != envID {
			return nil, errors.New("pending Cloud enrollment belongs to another environment; inspect the original operation")
		}
		assignment = &runtimeLinkAssignment{CloudID: pending.CloudID, CloudOrigin: pending.CloudOrigin, EnvPublicID: pending.EnvPublicID, NamespacePublicID: pending.NamespacePublicID, AccessPointOrigin: pending.AccessPointOrigin}
	} else if !errors.Is(readErr, os.ErrNotExist) {
		return nil, readErr
	} else {
		if credential == "" {
			return nil, errors.New("missing Runtime link ticket; inspect cloud enrollment status to resume an existing operation")
		}
		assignment, err = resolveCloudAccessPoint(ctx, assignmentClient, cloudOrigin, envID, credential)
	}
	if err != nil {
		return nil, err
	}
	baseURL = assignment.AccessPointOrigin
	if args.CloudID != "" && args.CloudID != assignment.CloudID {
		return nil, errors.New("cloud identity mismatch")
	}
	args.CloudID = assignment.CloudID
	if args.ExpectedBindingGeneration > 0 && (prev == nil || prev.CloudAssociation == nil || prev.CloudAssociation.CloudOrigin != cloudOrigin || prev.CloudAssociation.Binding == nil || prev.CloudAssociation.Binding.EnvPublicID != envID || prev.CloudAssociation.Binding.Generation != args.ExpectedBindingGeneration) {
		return nil, &RuntimeLinkExchangeError{StatusCode: http.StatusConflict, Code: "RUNTIME_LINK_BINDING_STALE"}
	}
	if assignment.NamespacePublicID == "" {
		return nil, errors.New("cloud assignment is missing its Namespace")
	}
	attempt, attemptPath, err := prepareRuntimeCloudEnrollment(cfgPath, assignment, prev, args)
	if err != nil {
		return nil, err
	}
	if credential == "" {
		attempt.RecoveryOnly = true
	}
	// A saved success with a failed journal unlink is already complete. Never
	// replay its old reserve over spent entries, a newer generation or settings.
	if prev != nil && prev.CloudAssociation != nil && prev.CloudAssociation.EnrollmentOperationID == attempt.BootstrapDeliveryRequestIDB64u && prev.CloudAssociation.Revision >= attempt.ExpectedAssociationRevision+1 {
		prev.bootstrapDeliveryAttemptPath = attemptPath
		prev.bootstrapDeliveryRequestIDB64u = attempt.BootstrapDeliveryRequestIDB64u
		prev.cloudEnrollmentExpectedAssociationRevision = attempt.ExpectedAssociationRevision
		prev.cloudEnrollmentExpectedRouteRevision = attempt.ExpectedRouteRevision
		return prev, nil
	}
	keyRaw, err := base64.RawURLEncoding.DecodeString(attempt.PrivateKeyB64u)
	if err != nil || len(keyRaw) != ed25519.PrivateKeySize {
		return nil, errors.New("invalid pending Cloud enrollment identity")
	}
	client, err := runtimecloud.NewClient(cloudOrigin, transport)
	if err != nil {
		return nil, err
	}
	defer client.Close()
	var enrolled *rc.RecoverResponse
	if !attempt.RecoveryOnly {
		enrolled, err = client.Enroll(ctx, assignment.NamespacePublicID, ed25519.PrivateKey(keyRaw), nil, rc.EnrollRequest{OperationID: attempt.BootstrapDeliveryRequestIDB64u, RuntimePublicID: attempt.LocalEnvironmentPublicID, PublicKeyB64u: attempt.PublicKeyB64u, Authorization: rc.EnrollmentAuthorization{RuntimeLinkTicket: credential, EnvPublicID: envID}, Metadata: attempt.Metadata})
	}
	var remote *runtimecloud.Error
	if runtimecloud.DeliveryExpired(err) {
		attempt.DeliveryRequestID, err = runtimecloud.NewOperationID()
		if err != nil {
			return nil, err
		}
		attempt.RecoveryOnly = true
		if err := updateBootstrapDeliveryAttempt(attemptPath, attempt); err != nil {
			return nil, err
		}
	}
	if attempt.RecoveryOnly || errors.As(err, &remote) && remote.Code == "INVALID_RUNTIME_LINK_TICKET" {
		enrolled, err = client.Recover(ctx, assignment.NamespacePublicID, attempt.LocalEnvironmentPublicID, "", ed25519.PrivateKey(keyRaw), rc.RecoverRequest{RuntimePublicID: attempt.LocalEnvironmentPublicID, DeliveryRequestID: attempt.DeliveryRequestID, EnrollmentOperationID: attempt.BootstrapDeliveryRequestIDB64u})
	}
	if runtimecloud.DeliveryExpired(err) {
		attempt.DeliveryRequestID, err = runtimecloud.NewOperationID()
		if err != nil {
			return nil, err
		}
		attempt.RecoveryOnly = true
		if err := updateBootstrapDeliveryAttempt(attemptPath, attempt); err != nil {
			return nil, err
		}
		return nil, errors.New("cloud delivery expired; retry the original enrollment to recover its credentials")
	}
	if err != nil {
		return nil, err
	}
	if enrolled.State != rc.ApprovalApproved || enrolled.Delivery == nil || enrolled.Binding.EnvPublicID != envID || enrolled.Binding.CloudID != assignment.CloudID || enrolled.Delivery.CloudOrigin != cloudOrigin || enrolled.Delivery.RegionOrigin != baseURL || enrolled.Delivery.DeliveryRequestID != attempt.DeliveryRequestID {
		return nil, errors.New("cloud enrollment did not approve the selected environment")
	}
	binding := enrolled.Binding
	agentInstanceID, localEnvironmentPublicID := attempt.AgentInstanceID, attempt.LocalEnvironmentPublicID
	cloudID := assignment.CloudID
	association := &CloudAssociation{Revision: 1, Enabled: true, CloudID: cloudID, CloudOrigin: cloudOrigin, NamespacePublicID: assignment.NamespacePublicID, RegionOrigin: baseURL, RuntimePublicID: localEnvironmentPublicID, PublicKeyB64u: attempt.PublicKeyB64u, PrivateKeyB64u: attempt.PrivateKeyB64u, Binding: binding, ApprovalState: rc.ApprovalApproved, EnrollmentSubmitted: true, DeliveryRequestID: attempt.DeliveryRequestID, EnrollmentOperationID: attempt.BootstrapDeliveryRequestIDB64u}
	route := &CloudRoute{Kind: CloudRouteDirect, Revision: 1}
	if prev != nil && prev.CloudAssociation != nil {
		association.Revision = attempt.ExpectedAssociationRevision + 1
	}
	if prev != nil && prev.CloudRoute != nil {
		copy := *prev.CloudRoute
		route = &copy
	}
	deliveryConfig := &Config{CloudAssociation: association, CloudRoute: route}
	if err := deliveryConfig.ApplyCloudDelivery(enrolled.Delivery); err != nil {
		return nil, err
	}
	association = deliveryConfig.CloudAssociation
	controlPool := deliveryConfig.ControlArtifactPool

	agentHomeDir := strings.TrimSpace(args.AgentHomeDir)
	if agentHomeDir == "" && prev != nil {
		agentHomeDir = strings.TrimSpace(prev.AgentHomeDir)
	}

	shell := strings.TrimSpace(args.Shell)
	if shell == "" && prev != nil {
		shell = strings.TrimSpace(prev.Shell)
	}

	logFormat := strings.TrimSpace(args.LogFormat)
	if logFormat == "" && prev != nil {
		logFormat = strings.TrimSpace(prev.LogFormat)
	}

	logLevel := strings.TrimSpace(args.LogLevel)
	if logLevel == "" && prev != nil {
		logLevel = strings.TrimSpace(prev.LogLevel)
	}

	cfg := &Config{
		CloudAssociation: association, CloudRoute: route,
		cloudEnrollmentExpectedAssociationRevision: attempt.ExpectedAssociationRevision,
		cloudEnrollmentExpectedRouteRevision:       attempt.ExpectedRouteRevision,
		CloudOrigin:                                cloudOrigin,
		AccessPointOrigin:                          baseURL,
		CloudID:                                    cloudID,
		EnvironmentID:                              envID,
		LocalEnvironmentPublicID:                   localEnvironmentPublicID,
		BindingGeneration:                          binding.Generation,
		AgentInstanceID:                            agentInstanceID,
		ControlArtifactPool:                        controlPool,
		AI:                                         nil,
		PermissionPolicy:                           nil,
		AgentHomeDir:                               agentHomeDir,
		Shell:                                      shell,
		LogFormat:                                  logFormat,
		LogLevel:                                   logLevel,
		bootstrapDeliveryAttemptPath:               attemptPath,
		bootstrapDeliveryRequestIDB64u:             attempt.BootstrapDeliveryRequestIDB64u,
	}

	// Write permission_policy explicitly so users can audit what is enabled locally.
	// If the flag is not provided, keep the previous policy when possible.
	if strings.TrimSpace(args.PermissionPolicyPreset) != "" {
		p, err := ParsePermissionPolicyPreset(args.PermissionPolicyPreset)
		if err != nil {
			return nil, err
		}
		cfg.PermissionPolicy = p
	} else if args.PreservePermissionPolicy && prev != nil && prev.PermissionPolicy != nil {
		cfg.PermissionPolicy = prev.PermissionPolicy
	} else {
		cfg.PermissionPolicy = defaultPermissionPolicy()
	}

	// Preserve AI config when bootstrapping, so users don't accidentally lose their local model/provider setup.
	if prev != nil && prev.AI != nil {
		cfg.AI = prev.AI
	}

	// Preserve Code App port range tweaks (Settings UI).
	if prev != nil {
		cfg.Gateways = prev.CloneGateways()
		cfg.GatewayRemovalOutbox = append([]gatewaymembership.RemovalDelivery(nil), prev.GatewayRemovalOutbox...)
		cfg.CodeServerPortMin = prev.CodeServerPortMin
		cfg.CodeServerPortMax = prev.CodeServerPortMax
	}
	return cfg, nil
}

type RuntimeLinkExchangeError struct {
	StatusCode int
	Code       string
}

func (e *RuntimeLinkExchangeError) Error() string {
	return fmt.Sprintf("runtime link exchange failed with HTTP %d/%s", e.StatusCode, e.Code)
}

func resolveBootstrapStateLayout(args BootstrapArgs) (StateLayout, error) {
	return LocalEnvironmentStateLayout(args.StateRoot)
}

func decodeExactBootstrapExchangeError(raw []byte, response *bootstrapExchangeErrorResponse) error {
	if response == nil {
		return errors.New("nil bootstrap error response")
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(response); err != nil {
		return err
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		return errors.New("bootstrap error response contains multiple JSON values")
	}
	if response.Success || response.Error == nil || strings.TrimSpace(response.Error.Code) == "" || strings.TrimSpace(response.Error.Message) == "" {
		return errors.New("invalid bootstrap error response")
	}
	return nil
}

// SaveCloudLinkConfig commits the resolved configuration before retiring the
// persisted bootstrap delivery attempt. A failed unlink preserves the attempt;
// an unlink directory-sync failure is completion-safe because a crash can only
// restore the same idempotent request ID after the configuration is committed.
func SaveCloudLinkConfig(path string, cfg *Config) error {
	unlock := lockConfig(path)
	defer unlock()
	if err := saveEnrollmentConnectionConfig(path, cfg, true); err != nil {
		return err
	}
	return completeBootstrapDeliveryAttempt(cfg)
}

// SaveCloudLinkConnectionConfig commits an online Cloud exchange without
// replacing local settings saved while the exchange was in flight.
func SaveCloudLinkConnectionConfig(path string, cfg *Config) error {
	unlock := lockConfig(path)
	defer unlock()
	if err := saveEnrollmentConnectionConfig(path, cfg, false); err != nil {
		return err
	}
	return completeBootstrapDeliveryAttempt(cfg)
}

func decodeExactBootstrapDeliveryAttempt(raw []byte, attempt *bootstrapDeliveryAttempt) error {
	if attempt == nil {
		return errors.New("nil bootstrap delivery attempt")
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(attempt); err != nil {
		return err
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		return errors.New("bootstrap delivery attempt contains multiple JSON values")
	}
	if attempt.Version != bootstrapDeliveryAttemptVersion || strings.TrimSpace(attempt.CloudOrigin) == "" ||
		strings.TrimSpace(attempt.AccessPointOrigin) == "" || strings.TrimSpace(attempt.EnvPublicID) == "" ||
		strings.TrimSpace(attempt.LocalEnvironmentPublicID) == "" || strings.TrimSpace(attempt.AgentInstanceID) == "" ||
		!validCanonicalBase64URL32(attempt.BootstrapDeliveryRequestIDB64u) || !validCanonicalBase64URL32(attempt.DeliveryRequestID) || attempt.CloudID == "" || attempt.NamespacePublicID == "" || !rc.ValidPublicKey(attempt.PublicKeyB64u) {
		return errors.New("invalid bootstrap delivery attempt fields")
	}
	identity := CloudAssociation{PublicKeyB64u: attempt.PublicKeyB64u, PrivateKeyB64u: attempt.PrivateKeyB64u}
	if _, err := identity.Identity(); err != nil {
		return err
	}
	for _, origin := range []string{attempt.CloudOrigin, attempt.AccessPointOrigin} {
		normalized, err := normalizeAccessPointOrigin(origin)
		if err != nil || normalized != origin {
			return errors.New("invalid pending Cloud enrollment origin")
		}
	}
	if attempt.ExpectedAssociationRevision < 0 || attempt.ExpectedAssociationRevision == math.MaxInt64 || attempt.ExpectedRouteRevision < 0 || attempt.ExpectedRouteRevision == math.MaxInt64 {
		return errors.New("invalid pending Cloud enrollment revision")
	}
	return nil
}

func writeBootstrapDeliveryAttemptAtomic(path string, attempt bootstrapDeliveryAttempt) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	raw, err := json.Marshal(attempt)
	if err != nil {
		return err
	}
	raw = append(raw, '\n')
	tmp, err := os.CreateTemp(dir, ".bootstrap-delivery-*.tmp")
	if err != nil {
		return err
	}
	tmpPath := tmp.Name()
	defer func() { _ = os.Remove(tmpPath) }()
	if err := tmp.Chmod(0o600); err != nil {
		_ = tmp.Close()
		return err
	}
	if _, err := tmp.Write(raw); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Rename(tmpPath, path); err != nil {
		return err
	}
	return syncDirectory(dir)
}

func completeBootstrapDeliveryAttempt(cfg *Config) error {
	if cfg == nil || strings.TrimSpace(cfg.bootstrapDeliveryAttemptPath) == "" {
		return nil
	}
	raw, err := os.ReadFile(cfg.bootstrapDeliveryAttemptPath)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	var attempt bootstrapDeliveryAttempt
	if err := decodeExactBootstrapDeliveryAttempt(raw, &attempt); err != nil {
		return err
	}
	if attempt.BootstrapDeliveryRequestIDB64u != cfg.bootstrapDeliveryRequestIDB64u {
		return errors.New("bootstrap delivery attempt changed before completion")
	}
	path := cfg.bootstrapDeliveryAttemptPath
	if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	// The config is already durable. If this sync fails, either the unlink is
	// retained or a crash restores the same sidecar and therefore the same
	// Portal idempotency key; neither outcome can create a second delivery.
	_ = syncDirectory(filepath.Dir(path))
	cfg.bootstrapDeliveryAttemptPath = ""
	cfg.bootstrapDeliveryRequestIDB64u = ""
	return nil
}

func syncDirectory(path string) error {
	dir, err := os.Open(path)
	if err != nil {
		return err
	}
	defer dir.Close()
	return dir.Sync()
}

func newBootstrapDeliveryRequestID() (string, error) {
	bytes := make([]byte, 32)
	if _, err := io.ReadFull(rand.Reader, bytes); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(bytes), nil
}

func validCanonicalBase64URL32(value string) bool {
	decoded, err := base64.RawURLEncoding.DecodeString(strings.TrimSpace(value))
	return err == nil && len(decoded) == 32 && base64.RawURLEncoding.EncodeToString(decoded) == value
}

func controlArtifactPoolFromBootstrap(delivery bootstrapControlArtifactPool, generation int64, now time.Time) (*ControlArtifactPool, error) {
	return controlArtifactPoolFromDelivery(delivery, generation, now, true)
}

func controlArtifactPoolFromDelivery(delivery bootstrapControlArtifactPool, generation int64, now time.Time, initial bool) (*ControlArtifactPool, error) {
	if delivery.Version != ControlArtifactPoolContractVersion || delivery.BindingGeneration != generation ||
		strings.TrimSpace(delivery.LogicalCloudBindingID) == "" ||
		delivery.TargetWaterline != ControlArtifactTargetWaterline ||
		delivery.RefreshHorizonSeconds != ControlArtifactRefreshHorizonS ||
		delivery.ServerHighestArtifactSequence == 0 || delivery.ServerHighestArtifactSequence > math.MaxInt64 ||
		len(delivery.Entries) < delivery.TargetWaterline || len(delivery.Entries) > ControlArtifactMaxOutstanding {
		return nil, errors.New("control artifact pool contract mismatch")
	}
	digestBytes, err := base64.RawURLEncoding.DecodeString(strings.TrimSpace(delivery.ResponseDigestB64u))
	if err != nil || len(digestBytes) != sha256.Size {
		return nil, errors.New("invalid control artifact pool response digest")
	}
	unsigned := delivery
	unsigned.ResponseDigestB64u = ""
	encoded, err := json.Marshal(unsigned)
	if err != nil {
		return nil, err
	}
	computedResponseDigest := sha256.Sum256(encoded)
	if !bytes.Equal(computedResponseDigest[:], digestBytes) {
		return nil, errors.New("control artifact pool response digest mismatch")
	}
	pool := NewControlArtifactPool(generation)
	pool.LogicalBindingID = strings.TrimSpace(delivery.LogicalCloudBindingID)
	pool.TargetWaterline = delivery.TargetWaterline
	pool.RefreshHorizonSeconds = delivery.RefreshHorizonSeconds
	pool.RecoveryState = ControlArtifactRecoveryReady
	var previous uint64
	for index, delivered := range delivery.Entries {
		if delivered.BindingGeneration != generation || delivered.ArtifactSequence == 0 ||
			(initial && index == 0 && delivered.ArtifactSequence != 1) ||
			(previous != 0 && delivered.ArtifactSequence != previous+1) ||
			strings.TrimSpace(delivered.ArtifactChannelID) == "" || len(delivered.ArtifactJSON) == 0 ||
			len(delivered.ArtifactJSON) > ControlArtifactMaxJSONBytes ||
			delivered.ExpiresAtUnixS <= now.Unix()+ControlArtifactRefreshHorizonS ||
			delivered.ExpiresAtUnixS > now.Add(5*time.Minute).Unix() {
			return nil, errors.New("invalid control artifact pool entry")
		}
		normalizedArtifact, err := NormalizeControlArtifactJSON(delivered.ArtifactJSON)
		if err != nil {
			return nil, errors.New("invalid control artifact pool artifact JSON")
		}
		if _, err := flowersec.ParseArtifact(normalizedArtifact); err != nil {
			return nil, fmt.Errorf("invalid control artifact pool artifact: %w", err)
		}
		digest := sha256.Sum256(normalizedArtifact)
		pool.Entries = append(pool.Entries, ControlArtifactEntry{
			Sequence:       delivered.ArtifactSequence,
			ArtifactJSON:   normalizedArtifact,
			ArtifactDigest: base64.RawURLEncoding.EncodeToString(digest[:]),
			ChannelID:      strings.TrimSpace(delivered.ArtifactChannelID),
			ExpiresAtUnixS: delivered.ExpiresAtUnixS,
		})
		previous = delivered.ArtifactSequence
	}
	if previous != delivery.ServerHighestArtifactSequence {
		return nil, errors.New("control artifact pool server waterline mismatch")
	}
	if err := pool.Validate(now.Unix()); err != nil {
		return nil, err
	}
	return pool, nil
}

func secureBootstrapHTTPClient(base *http.Client, origin *url.URL) *http.Client {
	client := &http.Client{}
	if base != nil {
		*client = *base
	}
	client.Timeout = 20 * time.Second
	previousRedirect := client.CheckRedirect
	client.CheckRedirect = func(req *http.Request, via []*http.Request) error {
		if req == nil || req.URL == nil || origin == nil || !sameHTTPSOrigin(req.URL, origin) {
			return errors.New("bootstrap redirect changed origin")
		}
		if previousRedirect != nil {
			return previousRedirect(req, via)
		}
		if len(via) >= 10 {
			return errors.New("stopped after 10 redirects")
		}
		return nil
	}
	return client
}

func sameHTTPSOrigin(a, b *url.URL) bool {
	if a == nil || b == nil || !strings.EqualFold(a.Scheme, "https") || !strings.EqualFold(b.Scheme, "https") {
		return false
	}
	return strings.EqualFold(a.Hostname(), b.Hostname()) && effectiveHTTPSPort(a) == effectiveHTTPSPort(b)
}

func effectiveHTTPSPort(u *url.URL) string {
	if u == nil {
		return ""
	}
	if port := u.Port(); port != "" {
		return port
	}
	return "443"
}

func newAgentInstanceID() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	// Prefix keeps the value self-descriptive in logs and debugging tools.
	return "ai_" + base64.RawURLEncoding.EncodeToString(b), nil
}

func newLocalEnvironmentPublicID() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return "le_" + base64.RawURLEncoding.EncodeToString(b), nil
}

func hostnameBestEffort() string {
	hostname, err := os.Hostname()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(hostname)
}

func normalizeBearerToken(raw string) string {
	s := strings.TrimSpace(raw)
	if s == "" {
		return ""
	}
	parts := strings.Fields(s)
	if len(parts) == 2 && strings.EqualFold(parts[0], "bearer") {
		return strings.TrimSpace(parts[1])
	}
	return s
}
