package gatewaycloud

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/tls"
	"encoding/base64"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"

	gc "github.com/floegence/redeven/internal/gatewaycloud/protocol"
	"github.com/floegence/redeven/internal/gatewayegress"
	"github.com/floegence/redeven/internal/gatewayflow"
	"github.com/floegence/redeven/internal/gatewaymembership"
	"github.com/floegence/redeven/internal/gatewaystate"
	gp "github.com/floegence/redeven/internal/runtimegateway/protocol"
)

// GatewayConfig holds only the Cloud machine association and its last verified
// projection. Member identities, certificates and invitations belong to Store.
type GatewayConfig struct {
	SchemaVersion         int               `json:"schema_version"`
	CloudOrigin           string            `json:"cloud_origin"`
	GatewayPublicID       string            `json:"gateway_public_id"`
	NamespacePublicID     string            `json:"namespace_public_id"`
	PrivateKeyB64u        string            `json:"private_key_b64u"`
	PendingPrivateKeyB64u string            `json:"pending_private_key_b64u,omitempty"`
	KeyRotatedAtUnixMS    int64             `json:"key_rotated_at_unix_ms"`
	Status                *gc.GatewayStatus `json:"status,omitempty"`
	ClosureRoutes         []ClosureRoute    `json:"closure_routes,omitempty"`
}

func (GatewayConfig) String() string       { return "Gateway.CloudAssociation" }
func (GatewayConfig) GoString() string     { return "Gateway.CloudAssociation" }
func GatewayConfigPath(root string) string { return filepath.Join(root, "cloud-access.json") }

func directCloudClient(origin string) (*Client, error) {
	return NewClient(origin, &http.Transport{TLSClientConfig: &tls.Config{MinVersion: tls.VersionTLS13}, ForceAttemptHTTP2: true, TLSHandshakeTimeout: 10 * time.Second, IdleConnTimeout: 60 * time.Second})
}
func gatewayIdentity(config GatewayConfig) (Identity, error) {
	key, err := gc.DecodeKey(config.PrivateKeyB64u)
	if err != nil || len(key) != ed25519.PrivateKeySize {
		return Identity{}, ErrState
	}
	return Identity{PrivateKey: ed25519.PrivateKey(key), NamespacePublicID: config.NamespacePublicID, GatewayPublicID: config.GatewayPublicID}, nil
}

type Gateway struct {
	receiptSlots  chan struct{}
	opMu          sync.Mutex
	mu            sync.Mutex
	path          string
	config        GatewayConfig
	stable        gatewaymembership.GatewayIdentity
	members       *gatewaymembership.Store
	connections   *gatewaymembership.Connections
	records       []gatewaymembership.MemberRecord
	policy        gp.GatewayPolicy
	client        *Client
	status        *gc.GatewayStatus
	egress        *gatewayegress.Server
	budget        *gatewayflow.Budget
	log           *slog.Logger
	closureCursor string
}

// NewGateway uses the sole member store and shared flow budget. It never opens
// a listener or creates a second local enrollment authority.
func NewGateway(root string, stable gatewaymembership.GatewayIdentity, members *gatewaymembership.Store, connections *gatewaymembership.Connections, budget *gatewayflow.Budget, logger *slog.Logger) (*Gateway, error) {
	forwarding, err := gatewayegress.New(gatewayegress.Options{Budget: budget})
	if err != nil {
		return nil, err
	}
	g := &Gateway{receiptSlots: make(chan struct{}, 8), path: GatewayConfigPath(root), stable: stable, members: members, connections: connections, egress: forwarding, budget: budget, log: logger}
	if err := readGatewayConfig(g.path, &g.config); err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	if g.config.SchemaVersion != 0 {
		if g.config.SchemaVersion != 2 {
			return nil, ErrState
		}
		if _, err := gatewayIdentity(g.config); err != nil {
			return nil, err
		}
		g.client, err = directCloudClient(g.config.CloudOrigin)
		if err != nil {
			return nil, err
		}
		g.status = g.config.Status
	}
	return g, nil
}

// Apply runs in Store commit order and never calls back into Store.
func (g *Gateway) Apply(records []gatewaymembership.MemberRecord, policy gp.GatewayPolicy) {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.records, g.policy = records, policy
	g.applyPolicyOrDenyLocked()
}

func (g *Gateway) Configure(ctx context.Context, origin, version string, reauthorize bool) (*gc.Gateway, error) {
	if !gc.ValidOrigin(origin) {
		return nil, ErrState
	}
	g.opMu.Lock()
	defer g.opMu.Unlock()
	g.mu.Lock()
	next := g.config
	g.mu.Unlock()
	if next.CloudOrigin != "" && next.CloudOrigin != origin {
		if !reauthorize || next.GatewayPublicID == "" {
			return nil, errors.New("revoke the existing Cloud association before changing its origin")
		}
		previous, err := directCloudClient(next.CloudOrigin)
		if err != nil {
			return nil, err
		}
		identity, err := gatewayIdentity(next)
		if err != nil {
			previous.Close()
			return nil, err
		}
		status, statusErr := previous.GatewayStatus(ctx, identity)
		previous.Close()
		var cloudErr *CloudError
		expired := errors.As(statusErr, &cloudErr) && cloudErr.Code == "GATEWAY_AUTHORIZATION_EXPIRED"
		if !expired && (statusErr != nil || (status.Gateway.State != "revoked" && status.Gateway.State != "retired")) {
			return nil, errors.New("the previous Cloud must confirm revocation before its origin changes")
		}
		next.Status = status
	}
	client, err := directCloudClient(origin)
	if err != nil {
		return nil, err
	}
	defer client.Close()
	if next.GatewayPublicID != "" && !reauthorize {
		identity, err := gatewayIdentity(next)
		if err != nil {
			return nil, err
		}
		status, err := client.GatewayStatus(ctx, identity)
		if err != nil {
			return nil, err
		}
		if status.Gateway.PublicID != next.GatewayPublicID {
			return nil, ErrState
		}
		return &status.Gateway, nil
	}
	if reauthorize && next.CloudOrigin == origin && next.GatewayPublicID != "" {
		identity, err := gatewayIdentity(next)
		if err != nil {
			return nil, err
		}
		status, statusErr := client.GatewayStatus(ctx, identity)
		var cloudErr *CloudError
		expired := errors.As(statusErr, &cloudErr) && cloudErr.Code == "GATEWAY_AUTHORIZATION_EXPIRED"
		if statusErr != nil && !expired {
			return nil, statusErr
		}
		if !expired && status.Gateway.State != "revoked" && status.Gateway.State != "retired" {
			return nil, errors.New("revoke the current Cloud association before reauthorizing")
		}
		next.Status = status
	}
	if next.SchemaVersion == 0 || (reauthorize && next.GatewayPublicID != "") {
		routes, err := retireClosureRoute(next)
		if err != nil {
			return nil, err
		}
		_, key, err := ed25519.GenerateKey(rand.Reader)
		if err != nil {
			return nil, err
		}
		next = GatewayConfig{SchemaVersion: 2, CloudOrigin: origin, PrivateKeyB64u: base64.RawURLEncoding.EncodeToString(key), KeyRotatedAtUnixMS: time.Now().UnixMilli(), ClosureRoutes: routes}
		// Persist before registration so a lost response retries this same identity.
		if err := gatewaystate.Write(g.path, next); err != nil {
			return nil, err
		}
		g.mu.Lock()
		g.config, g.status = next, nil
		g.applyPolicyOrDenyLocked()
		g.mu.Unlock()
	}
	identity, err := gatewayIdentity(next)
	if err != nil {
		return nil, err
	}
	identity.GatewayPublicID, identity.NamespacePublicID, identity.GatewayKey = "", "", g.stable.PrivateKey
	registration := g.registration(version, identity)
	registered, err := client.Register(ctx, identity, registration)
	if err != nil {
		return nil, err
	}
	if registered.GatewayID != g.stable.ID {
		return nil, ErrState
	}
	next.GatewayPublicID, next.NamespacePublicID = registered.PublicID, registered.NamespacePublicID
	next.Status = nil
	if err := gatewaystate.Write(g.path, next); err != nil {
		return nil, err
	}
	liveClient, err := directCloudClient(origin)
	if err != nil {
		return nil, err
	}
	g.mu.Lock()
	if g.client != nil {
		g.client.Close()
	}
	g.config, g.client, g.status = next, liveClient, nil
	g.applyPolicyOrDenyLocked()
	g.mu.Unlock()
	return registered, nil
}

func (g *Gateway) Run(ctx context.Context) {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	defer g.egress.Close()
	defer func() {
		g.mu.Lock()
		if g.client != nil {
			g.client.Close()
		}
		g.mu.Unlock()
	}()
	lastObservation := time.Time{}
	for {
		_ = g.sync(ctx)
		if time.Since(lastObservation) >= 30*time.Second {
			g.observe(ctx)
			lastObservation = time.Now()
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (g *Gateway) sync(ctx context.Context) (resultErr error) {
	g.opMu.Lock()
	defer g.opMu.Unlock()
	g.mu.Lock()
	config, client := g.config, g.client
	g.mu.Unlock()
	if client == nil || config.GatewayPublicID == "" {
		return nil
	}
	start := time.Now()
	defer func() { gatewayflow.Observe(ctx, "cloud.sync", start, resultErr) }()
	identity, err := gatewayIdentity(config)
	if err != nil {
		return err
	}
	status, err := client.GatewayStatusPage(ctx, identity, g.closureCursor)
	if err != nil && config.PendingPrivateKeyB64u != "" {
		key, keyErr := gc.DecodeKey(config.PendingPrivateKeyB64u)
		if keyErr == nil && len(key) == ed25519.PrivateKeySize {
			staged := identity
			staged.PrivateKey = ed25519.PrivateKey(key)
			if recovered, recoveryErr := client.GatewayStatusPage(ctx, staged, g.closureCursor); recoveryErr == nil {
				config.PrivateKeyB64u, config.PendingPrivateKeyB64u, config.KeyRotatedAtUnixMS = config.PendingPrivateKeyB64u, "", time.Now().UnixMilli()
				status, identity, err = recovered, staged, nil
			}
		}
	}
	if err != nil {
		return err
	}
	if status.Gateway.PublicID == config.GatewayPublicID && status.Gateway.State == "rejoin_required" && status.Gateway.GatewayID == "" {
		// Retain the approved machine identity while replacing the retired local
		// listener. Both the saved Cloud key and stable Gateway key must prove it.
		registrationIdentity := identity
		registrationIdentity.NamespacePublicID, registrationIdentity.GatewayPublicID = "", ""
		registrationIdentity.GatewayKey = g.stable.PrivateKey
		registered, registerErr := client.Register(ctx, registrationIdentity, g.registration(status.Gateway.Version, registrationIdentity))
		if registerErr != nil {
			return registerErr
		}
		if registered.PublicID != config.GatewayPublicID || registered.GatewayID != g.stable.ID {
			return ErrState
		}
		status, err = client.GatewayStatusPage(ctx, identity, g.closureCursor)
		if err != nil {
			return err
		}
	}
	if status.Gateway.PublicID != config.GatewayPublicID || status.Gateway.GatewayID != g.stable.ID {
		return ErrState
	}
	namespace := status.Gateway.NamespacePublicID
	if status.Gateway.State != "active" {
		namespace = ""
	}
	// Changing Namespace invalidates and reevaluates grants before new egress is installed.
	if err := g.members.SetCloudNamespace(ctx, namespace); err != nil {
		return err
	}
	config.NamespacePublicID, config.Status = status.Gateway.NamespacePublicID, status
	if err := gatewaystate.Write(g.path, config); err != nil {
		return err
	}
	g.mu.Lock()
	g.config, g.status = config, status
	err = g.applyPolicyLocked()
	g.mu.Unlock()
	if err != nil {
		return err
	}
	identity.NamespacePublicID = config.NamespacePublicID
	g.closureCursor = status.NextClosureCursor
	for _, closure := range status.Closures {
		if g.egress.ActiveThrough(closure.MemberID, uint64(closure.Generation)) != 0 {
			continue
		}
		ack := identity
		ack.BindingPublicID, ack.BindingGeneration = closure.BindingPublicID, closure.Generation
		if _, err := client.Acknowledge(ctx, ack, gc.ClosureAck{ClosurePublicID: closure.PublicID, Generation: closure.Generation, Side: "gateway"}); err != nil {
			return err
		}
	}
	if status.Gateway.State != "active" {
		return nil
	}
	for _, command := range status.Commands {
		result, err := g.executeCommand(ctx, command)
		if err != nil {
			return err
		}
		if err := client.CompleteCommand(ctx, identity, result); err != nil {
			return err
		}
	}
	records, policy, _ := g.members.Snapshot()
	active := make([]gatewaymembership.MemberRecord, 0, len(records))
	removed := make([]gatewaymembership.MemberRecord, 0)
	for _, record := range records {
		if record.Member.State == "removed" {
			removed = append(removed, record)
		} else {
			active = append(active, record)
		}
	}
	revision := status.Gateway.DirectoryRevision
	syncBatch := func(batch []gatewaymembership.MemberRecord, full bool) error {
		members := make([]gc.DirectoryMember, 0, len(batch))
		for _, record := range batch {
			m := record.Member
			members = append(members, gc.DirectoryMember{MemberID: m.MemberID, MemberVersion: m.MemberVersion, Delegation: gc.MemberDelegation(record.Delegation), State: m.State, CloudPermission: string(m.CloudPermission), HookAllowed: record.HookCloudAllowed && record.HookPolicyRevision == policy.Revision, Reachable: g.connections.IsConnected(m.MemberID), Metadata: gc.RuntimeMetadata(m.Metadata)})
		}
		sort.Slice(members, func(i, j int) bool { return members[i].MemberID < members[j].MemberID })
		accepted, err := client.Directory(ctx, identity, gc.DirectorySync{ListenerURL: g.members.Endpoint().URL, BaseRevision: revision, Revision: revision + 1, Full: full, Policy: gc.GatewayPolicy{Revision: policy.Revision, DefaultCloudAllowed: policy.DefaultCloudAllowed, PublicationMode: string(policy.PublicationMode)}, Members: members})
		if err != nil {
			return err
		}
		if accepted.PublicID != config.GatewayPublicID || accepted.NamespacePublicID != config.NamespacePublicID || accepted.DirectoryRevision != revision+1 {
			return ErrState
		}
		revision++
		return g.members.AcknowledgeCloudDirectory(config.NamespacePublicID, policy.Revision, batch)
	}
	// Retire tombstones before a complete active snapshot so old members do not
	// consume the 1,024 active slots or make a reconnect exceed the wire limit.
	for len(removed) > 0 {
		count := min(len(removed), gc.MaxGatewayMembers)
		if err := syncBatch(removed[:count], false); err != nil {
			return err
		}
		removed = removed[count:]
	}
	if err := syncBatch(active, true); err != nil {
		return err
	}

	return g.rotateMachineKey(ctx, identity)
}

func (g *Gateway) executeCommand(ctx context.Context, command gc.GatewayCommand) (gc.GatewayCommandResult, error) {
	result := gc.GatewayCommandResult{CommandPublicID: command.PublicID}
	if command.ExpiresAtUnixMS <= time.Now().UnixMilli() {
		result.ErrorCode = "GATEWAY_COMMAND_EXPIRED"
		return result, nil
	}
	var err error
	switch command.Kind {
	case "invite":
		invitation, inviteErr := g.members.InviteForCommand(command.ActorPublicID, command.PublicID, time.UnixMilli(command.ExpiresAtUnixMS))
		err = inviteErr
		if err == nil {
			converted := gc.MemberInvitation(invitation)
			result.Invitation = &converted
		}
	case "remove_member", "reevaluate":
		result.ErrorCode, err = g.members.ApplyCloudCommand(ctx, gatewaymembership.CloudCommand{ID: command.PublicID, Kind: command.Kind, MemberID: command.MemberID, MemberVersion: command.MemberVersion, ExpiresAtUnixMS: command.ExpiresAtUnixMS})
		if err != nil {
			return result, err
		}
	default:
		err = gatewaymembership.ErrDenied
	}
	if err != nil {
		result.ErrorCode = "GATEWAY_COMMAND_FAILED"
	}
	return result, nil
}

func GatewayManagementURL(origin, namespace, gateway, fingerprint string) string {
	if namespace != "" {
		return origin + "/namespaces/" + url.PathEscape(namespace) + "/gateways?gateway=" + url.QueryEscape(gateway)
	}
	return fmt.Sprintf("%s/gateways/connect?gateway_id=%s&fingerprint=%s", origin, url.QueryEscape(gateway), url.QueryEscape(fingerprint))
}

func (g *Gateway) registration(version string, identity Identity) gc.GatewayRegistration {
	endpoint := g.members.Endpoint()
	return gc.GatewayRegistration{Identity: gc.GatewayMachineIdentity{GatewayID: g.stable.ID, PublicKeyB64u: base64.RawURLEncoding.EncodeToString(g.stable.PrivateKey.Public().(ed25519.PublicKey))}, PublicKeyB64u: base64.RawURLEncoding.EncodeToString(identity.PrivateKey.Public().(ed25519.PublicKey)), ListenerURL: endpoint.URL, TLSRootPEM: endpoint.RootPEM, Version: version}
}
