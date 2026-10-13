package agent

import (
	"context"
	"crypto/sha256"
	"crypto/tls"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"time"

	"github.com/floegence/redeven/internal/config"
	rc "github.com/floegence/redeven/internal/runtimecloud/protocol"
)

func routeOperationIDValid(value string) bool {
	raw, err := base64.RawURLEncoding.DecodeString(value)
	return err == nil && len(raw) == 32 && base64.RawURLEncoding.EncodeToString(raw) == value
}

// The target admitted by preflight must still have the same trust and address
// coordinates at commit, including when it was not the old selected member.
func routePreflightFingerprint(cfg *config.Config, selection config.CloudRoute) (string, error) {
	probe := *cfg
	probe.CloudRoute = &selection
	if err := probe.ValidateCloudRoute(); err != nil {
		return "", err
	}
	coordinates := []any{cfg.CloudAssociation.CloudID, cfg.CloudAssociation.CloudOrigin, cfg.CloudAssociation.RegionOrigin, selection}
	if member := probe.CloudRouteMember(); member != nil {
		coordinates = append(coordinates, member.GatewayID, member.MemberID, member.MemberVersion, member.GatewayPublicKey, member.GatewayTLSRootPEM, member.ConnectionEndpoints(), member.ClientCertificatePEM)
	}
	raw, err := json.Marshal(coordinates)
	if err != nil {
		return "", err
	}
	digest := sha256.Sum256(raw)
	return base64.RawURLEncoding.EncodeToString(digest[:]), nil
}
func findRouteOperation(cfg *config.Config, id string) (*rc.RouteOperation, error) {
	for _, operation := range cfg.CloudRouteOperations {
		if operation.OperationID == id {
			copy := operation
			return &copy, nil
		}
	}
	return nil, errors.New("cloud route operation was not found")
}

func (a *Agent) CloudRouteOperation(id string) (*rc.RouteOperation, error) {
	cfg, err := config.Load(a.configPath)
	if err != nil {
		return nil, err
	}
	return findRouteOperation(cfg, id)
}

// Preflight never alters the running route. Persisting a bounded operation
// result lets a caller query an interrupted request using its original ID.
func (a *Agent) PreflightCloudRoute(ctx context.Context, request rc.RoutePreflightRequest) (*rc.RouteOperation, error) {
	if !routeOperationIDValid(request.OperationID) {
		return nil, errors.New("invalid Cloud route operation ID")
	}
	cfg := a.remoteConfigSnapshot()
	if cfg == nil || cfg.CloudAssociation == nil || cfg.CloudRoute == nil || cfg.CloudRoute.Revision != request.ExpectedRouteRevision || request.ExpectedRouteRevision == 1<<63-1 {
		return nil, config.ErrCloudRouteConflict
	}
	if existing, err := findRouteOperation(cfg, request.OperationID); err == nil {
		if existing.ExpectedRouteRevision != request.ExpectedRouteRevision || existing.Selection != request.Selection {
			return nil, config.ErrCloudRouteConflict
		}
		return existing, nil
	}
	selection := config.CloudRoute{Kind: config.CloudRouteKind(request.Selection.Kind), MemberID: request.Selection.MemberID, Revision: request.ExpectedRouteRevision + 1}
	probe := *cfg
	probe.CloudRoute = &selection
	if err := probe.ValidateCloudRoute(); err != nil {
		return nil, err
	}
	fingerprint, err := routePreflightFingerprint(cfg, selection)
	if err != nil {
		return nil, err
	}
	proxy, err := probe.CloudProxy()
	if err != nil {
		return nil, err
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.TLSClientConfig = &tls.Config{MinVersion: tls.VersionTLS12, RootCAs: a.controlTrustRoots}
	if proxy != nil {
		transport = proxy.HTTPTransport()
		transport.TLSClientConfig = &tls.Config{MinVersion: tls.VersionTLS12, RootCAs: a.controlTrustRoots}
	}
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport, Timeout: 10 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, cfg.CloudAssociation.CloudOrigin+"/.well-known/redeven-cloud.json", nil)
	if err != nil {
		return nil, err
	}
	response, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(response.Body, 65537))
	if err != nil || len(raw) > 65536 || response.StatusCode != http.StatusOK {
		return nil, errors.New("cloud route preflight failed")
	}
	var discovery struct {
		ProtocolVersion string `json:"protocol_version"`
		CloudID         string `json:"cloud_id"`
	}
	if json.Unmarshal(raw, &discovery) != nil || discovery.ProtocolVersion != rc.ProtocolVersion || discovery.CloudID != cfg.CloudAssociation.CloudID {
		return nil, errors.New("cloud route preflight returned a different Cloud identity or protocol")
	}
	if ctx.Err() != nil {
		return nil, ctx.Err()
	}
	operation := rc.RouteOperation{RouteFingerprint: fingerprint, OperationID: request.OperationID, ExpectedRouteRevision: request.ExpectedRouteRevision, AssociationRevision: cfg.CloudAssociation.Revision, Selection: request.Selection, State: "awaiting_confirmation", ExpiresAtUnixMS: time.Now().Add(2 * time.Minute).UnixMilli()}
	_, err = config.Update(a.configPath, func(current *config.Config) error {
		if !sameCloudRouteOwner(cfg, current) {
			return config.ErrCloudRouteConflict
		}
		currentFingerprint, err := routePreflightFingerprint(current, selection)
		if err != nil || currentFingerprint != fingerprint {
			return config.ErrCloudRouteConflict
		}
		if previous, err := findRouteOperation(current, request.OperationID); err == nil {
			if previous.ExpectedRouteRevision != request.ExpectedRouteRevision || previous.Selection != request.Selection {
				return config.ErrCloudRouteConflict
			}
			operation = *previous
			return nil
		}
		if len(current.CloudRouteOperations) >= 32 {
			current.CloudRouteOperations = current.CloudRouteOperations[len(current.CloudRouteOperations)-31:]
		}
		current.CloudRouteOperations = append(current.CloudRouteOperations, operation)
		return nil
	})
	return &operation, err
}

// CommitCloudRoute owns the ordered save -> cancel -> close -> restart edge.
// Once saved, cancellation cannot roll back the selected route or its result.
func (a *Agent) CommitCloudRoute(ctx context.Context, request rc.RouteCommitRequest) (*rc.RouteOperation, error) {
	if !request.Confirmed {
		return nil, errors.New("confirm the Cloud route change before committing")
	}
	a.cloudLinkMu.Lock()
	defer a.cloudLinkMu.Unlock()
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	before := a.remoteConfigSnapshot()
	var operation rc.RouteOperation
	next, err := config.Update(a.configPath, func(current *config.Config) error {
		found, err := findRouteOperation(current, request.OperationID)
		if err != nil {
			return err
		}
		operation = *found
		if operation.State == "committed" {
			return nil
		}
		if operation.State != "awaiting_confirmation" || operation.ExpiresAtUnixMS <= time.Now().UnixMilli() || current.CloudAssociation == nil || current.CloudAssociation.Revision != operation.AssociationRevision || current.CloudRoute == nil || current.CloudRoute.Revision != operation.ExpectedRouteRevision || operation.ExpectedRouteRevision == 1<<63-1 {
			return config.ErrCloudRouteConflict
		}
		selection := config.CloudRoute{Kind: config.CloudRouteKind(operation.Selection.Kind), MemberID: operation.Selection.MemberID, Revision: operation.ExpectedRouteRevision + 1}
		fingerprint, err := routePreflightFingerprint(current, selection)
		if err != nil || fingerprint != operation.RouteFingerprint {
			return config.ErrCloudRouteConflict
		}
		current.CloudRoute = &selection
		if err := current.ValidateCloudRoute(); err != nil {
			return err
		}
		operation.State, operation.CommittedRouteRevision = "committed", selection.Revision
		for i := range current.CloudRouteOperations {
			if current.CloudRouteOperations[i].OperationID == operation.OperationID {
				current.CloudRouteOperations[i] = operation
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	if before.CloudRoute != nil && next.CloudRoute.Revision == before.CloudRoute.Revision {
		return &operation, nil
	}
	a.mu.Lock()
	a.setRemoteConfigLocked(next)
	running := a.runCtx != nil
	a.mu.Unlock()
	a.stopControlChannel()
	if before.CloudRoute != nil {
		a.closeCloudRouteSessions(before.CloudRoute.Revision)
	}
	if running {
		a.startOrRestartControlChannel()
	}
	return &operation, nil
}

func (a *Agent) CancelCloudRoute(id string) (*rc.RouteOperation, error) {
	a.cloudLinkMu.Lock()
	defer a.cloudLinkMu.Unlock()
	var result rc.RouteOperation
	_, err := config.Update(a.configPath, func(current *config.Config) error {
		operation, err := findRouteOperation(current, id)
		if err != nil {
			return err
		}
		result = *operation
		if result.State == "awaiting_confirmation" {
			result.State = "cancelled"
			for i := range current.CloudRouteOperations {
				if current.CloudRouteOperations[i].OperationID == id {
					current.CloudRouteOperations[i] = result
				}
			}
		}
		return nil
	})
	return &result, err
}

func (a *Agent) closeCloudRouteSessions(revision int64) {
	a.mu.Lock()
	var cancels []context.CancelFunc
	for _, session := range a.sessions {
		if session != nil && session.cloudRouteRevision == revision && session.cancel != nil {
			cancels = append(cancels, session.cancel)
		}
	}
	a.mu.Unlock()
	for _, cancel := range cancels {
		cancel()
	}
}
