package gatewaycloud

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math/big"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"

	gc "github.com/floegence/redeven/internal/gatewaycloud/protocol"
	"github.com/floegence/redeven/internal/gatewayegress"
	"github.com/floegence/redeven/internal/lockfile"
)

type GatewayConfig struct {
	PendingPrivateKeyB64u string                 `json:"pending_private_key_b64u,omitempty"`
	KeyRotatedAtUnixMS    int64                  `json:"key_rotated_at_unix_ms"`
	SchemaVersion         int                    `json:"schema_version"`
	CloudOrigin           string                 `json:"cloud_origin"`
	GatewayPublicID       string                 `json:"gateway_public_id"`
	NamespacePublicID     string                 `json:"namespace_public_id"`
	ListenerURL           string                 `json:"listener_url"`
	ListenAddress         string                 `json:"listen_address"`
	PrivateKeyB64u        string                 `json:"private_key_b64u"`
	RootPEM               string                 `json:"root_pem"`
	RootKeyPEM            string                 `json:"root_key_pem"`
	ServerCertificatePEM  string                 `json:"server_certificate_pem"`
	ServerKeyPEM          string                 `json:"server_key_pem"`
	Members               map[string]LocalMember `json:"members"`
}

func (GatewayConfig) String() string   { return "GatewayCloud.Config" }
func (GatewayConfig) GoString() string { return "GatewayCloud.Config" }

type LocalMember struct {
	PendingCSRHash         string `json:"pending_csr_hash,omitempty"`
	PendingCertificatePEM  string `json:"pending_certificate_pem,omitempty"`
	PendingFingerprint     string `json:"pending_fingerprint,omitempty"`
	PendingExpiresAtUnixMS int64  `json:"pending_expires_at_unix_ms,omitempty"`
	RequestPublicID        string `json:"request_public_id"`
	RuntimePublicID        string `json:"runtime_public_id"`
	CSRHash                string `json:"csr_hash"`
	CertificatePEM         string `json:"certificate_pem"`
	Fingerprint            string `json:"fingerprint"`
	ExpiresAtUnixMS        int64  `json:"expires_at_unix_ms"`
	TokenSHA256            string `json:"token_sha256"`
}

func GatewayConfigPath(stateRoot string) string { return filepath.Join(stateRoot, "cloud-access.json") }

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

// ConfigureGateway stores only machine identity. User approval happens in Cloud.
func ConfigureGateway(ctx context.Context, stateRoot, cloudOrigin, listenerURL, listenAddress, version string) (*gc.Gateway, error) {
	return configureGateway(ctx, stateRoot, cloudOrigin, listenerURL, listenAddress, version, false)
}

// ReauthorizeGateway registers a new machine identity after access was revoked
// or expired. It never silently resumes the previous Namespace approval.
func ReauthorizeGateway(ctx context.Context, stateRoot, cloudOrigin, listenerURL, listenAddress, version string) (*gc.Gateway, error) {
	return configureGateway(ctx, stateRoot, cloudOrigin, listenerURL, listenAddress, version, true)
}

func configureGateway(ctx context.Context, stateRoot, cloudOrigin, listenerURL, listenAddress, version string, reauthorize bool) (*gc.Gateway, error) {
	if !gc.ValidOrigin(cloudOrigin) || !gc.ValidOrigin(listenerURL) {
		return nil, ErrState
	}
	if _, _, err := net.SplitHostPort(listenAddress); err != nil {
		return nil, ErrState
	}
	if err := os.MkdirAll(stateRoot, 0700); err != nil {
		return nil, ErrState
	}
	stateLock, err := lockfile.Acquire(filepath.Join(stateRoot, "gateway-cloud.lock"))
	if err != nil {
		return nil, errors.New("stop this Gateway before changing Cloud configuration")
	}
	defer func() { _ = stateLock.Release() }()
	path := GatewayConfigPath(stateRoot)
	var config GatewayConfig
	err = ReadState(path, &config)
	if err == nil {
		if config.CloudOrigin != cloudOrigin {
			return nil, errors.New("use a separate Gateway instance for another Cloud origin")
		}
		if config.ListenerURL != listenerURL || config.ListenAddress != listenAddress {
			config.ListenerURL, config.ListenAddress = listenerURL, listenAddress
			config.ServerCertificatePEM = ""
			if err := renewServerCertificate(&config); err != nil {
				return nil, err
			}
			if err := WriteState(path, config); err != nil {
				return nil, err
			}
		}
	} else if errors.Is(err, os.ErrNotExist) {
		_, key, err := ed25519.GenerateKey(rand.Reader)
		if err != nil {
			return nil, err
		}
		config = GatewayConfig{SchemaVersion: 1, KeyRotatedAtUnixMS: time.Now().UnixMilli(), CloudOrigin: cloudOrigin, ListenerURL: listenerURL, ListenAddress: listenAddress, PrivateKeyB64u: base64.RawURLEncoding.EncodeToString(key), Members: map[string]LocalMember{}}
		if err := createGatewayTLS(&config); err != nil {
			return nil, err
		}
		if err := WriteState(path, config); err != nil {
			return nil, err
		}
	} else {
		return nil, err
	}
	client, err := directCloudClient(config.CloudOrigin)
	if err != nil {
		return nil, err
	}
	defer client.Close()
	identity, err := gatewayIdentity(config)
	if err != nil {
		return nil, err
	}
	if config.GatewayPublicID != "" {
		status, statusErr := client.GatewayStatus(ctx, identity)
		if !reauthorize {
			if statusErr != nil {
				return nil, statusErr
			}
			return &status.Gateway, nil
		}
		if statusErr == nil && status.Gateway.State == "pending" {
			return &status.Gateway, nil
		}
		var cloudErr *CloudError
		expired := errors.As(statusErr, &cloudErr) && (cloudErr.Code == "GATEWAY_AUTHORIZATION_EXPIRED" || cloudErr.Code == "GATEWAY_PROOF_INVALID")
		if !expired && (statusErr != nil || status.Gateway.State != "revoked") {
			return nil, errors.New("revoke the current Gateway in Cloud before authorizing a new identity")
		}
		_, key, err := ed25519.GenerateKey(rand.Reader)
		if err != nil {
			return nil, err
		}
		config.PrivateKeyB64u = base64.RawURLEncoding.EncodeToString(key)
		config.GatewayPublicID, config.NamespacePublicID, config.PendingPrivateKeyB64u = "", "", ""
		config.KeyRotatedAtUnixMS = time.Now().UnixMilli()
		config.Members = map[string]LocalMember{}
		if err := createGatewayTLS(&config); err != nil {
			return nil, err
		}
		if err := WriteState(path, config); err != nil {
			return nil, err
		}
		identity, err = gatewayIdentity(config)
		if err != nil {
			return nil, err
		}
	}
	gateway, err := client.Register(ctx, identity, gc.GatewayRegistration{PublicKeyB64u: base64.RawURLEncoding.EncodeToString(identity.PrivateKey.Public().(ed25519.PublicKey)), ListenerURL: config.ListenerURL, TLSRootPEM: config.RootPEM, Version: version})
	if err != nil {
		return nil, err
	}
	config.GatewayPublicID = gateway.PublicID
	if err := WriteState(path, config); err != nil {
		return nil, err
	}
	return gateway, nil
}

func createGatewayTLS(config *GatewayConfig) error {
	_, caKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return err
	}
	serial, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
	if err != nil {
		return err
	}
	now := time.Now().UTC()
	ca := &x509.Certificate{SerialNumber: serial, Subject: pkix.Name{CommonName: "Redeven Gateway local trust"}, NotBefore: now.Add(-time.Minute), NotAfter: now.AddDate(10, 0, 0), IsCA: true, BasicConstraintsValid: true, KeyUsage: x509.KeyUsageCertSign}
	root, err := x509.CreateCertificate(rand.Reader, ca, ca, caKey.Public(), caKey)
	if err != nil {
		return err
	}
	ca, err = x509.ParseCertificate(root)
	if err != nil {
		return err
	}
	config.RootPEM = string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: root}))
	config.RootKeyPEM, err = privateKeyPEM(caKey)
	if err != nil {
		return err
	}
	_, serverKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return err
	}
	serial, err = rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
	if err != nil {
		return err
	}
	server := &x509.Certificate{SerialNumber: serial, NotBefore: ca.NotBefore, NotAfter: now.Add(90 * 24 * time.Hour), KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}}
	u, _ := url.Parse(config.ListenerURL)
	if ip := net.ParseIP(u.Hostname()); ip != nil {
		server.IPAddresses = []net.IP{ip}
	} else {
		server.DNSNames = []string{u.Hostname()}
	}
	leaf, err := x509.CreateCertificate(rand.Reader, server, ca, serverKey.Public(), caKey)
	if err != nil {
		return err
	}
	config.ServerCertificatePEM = string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: leaf}))
	config.ServerKeyPEM, err = privateKeyPEM(serverKey)
	return err
}

func privateKeyPEM(key ed25519.PrivateKey) (string, error) {
	raw, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		return "", err
	}
	return string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: raw})), nil
}

type Gateway struct {
	closureCursor string
	mu            sync.Mutex
	path          string
	config        GatewayConfig
	client        *Client
	egress        *gatewayegress.Server
	status        *gc.GatewayStatus
	log           *slog.Logger
}

func StartGateway(ctx context.Context, stateRoot string, logger *slog.Logger) error {
	return startGateway(ctx, stateRoot, logger, gatewayegress.Options{})
}

func startGateway(ctx context.Context, stateRoot string, logger *slog.Logger, options gatewayegress.Options) error {
	path := GatewayConfigPath(stateRoot)
	var config GatewayConfig
	if err := ReadState(path, &config); errors.Is(err, os.ErrNotExist) {
		return nil
	} else if err != nil {
		return err
	}
	stateLock, err := lockfile.Acquire(filepath.Join(stateRoot, "gateway-cloud.lock"))
	if err != nil {
		return err
	}
	started := false
	defer func() {
		if !started {
			_ = stateLock.Release()
		}
	}()
	if err := ReadState(path, &config); err != nil {
		return err
	}
	if config.SchemaVersion != 1 || config.GatewayPublicID == "" {
		return ErrState
	}
	if _, err := gatewayIdentity(config); err != nil {
		return err
	}
	_, err = tls.X509KeyPair([]byte(config.ServerCertificatePEM), []byte(config.ServerKeyPEM))
	if err != nil {
		return ErrState
	}
	roots := x509.NewCertPool()
	if !roots.AppendCertsFromPEM([]byte(config.RootPEM)) {
		return ErrState
	}
	client, err := directCloudClient(config.CloudOrigin)
	if err != nil {
		return err
	}
	egress, err := gatewayegress.New(options)
	if err != nil {
		return err
	}
	g := &Gateway{path: path, config: config, client: client, egress: egress, log: logger}
	listener, err := net.Listen("tcp", config.ListenAddress)
	if err != nil {
		return err
	}
	// Enrollment uses one-time bootstrap material; CONNECT still requires a
	// verified client certificate on every request inside the egress handler.
	server := &http.Server{Handler: g, ReadHeaderTimeout: 10 * time.Second, MaxHeaderBytes: 16 << 10, IdleTimeout: 30 * time.Second, TLSConfig: &tls.Config{GetCertificate: g.serverCertificate, ClientCAs: roots, ClientAuth: tls.VerifyClientCertIfGiven, MinVersion: tls.VersionTLS13, NextProtos: []string{"http/1.1"}, SessionTicketsDisabled: true}}
	ctx, cancel := context.WithCancel(ctx)
	go func() { <-ctx.Done(); _ = egress.Close(); _ = server.Close() }()
	go func() {
		defer cancel()
		_ = server.Serve(tls.NewListener(listener, server.TLSConfig))
		_ = egress.Close()
	}()
	started = true
	go func() { defer func() { _ = stateLock.Release() }(); g.run(ctx) }()
	return nil
}

func (g *Gateway) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodConnect {
		g.egress.ServeHTTP(w, r)
		return
	}
	if r.Method == http.MethodPost && r.URL.Path == "/gateway/cloud/v1/renew" {
		g.handleRenewCertificate(w, r)
		return
	}
	if r.Method != http.MethodPost || r.URL.Path != "/gateway/cloud/v1/enroll" {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	r.Body = http.MaxBytesReader(w, r.Body, 32<<10)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	var request gc.LocalEnrollment
	if decoder.Decode(&request) != nil {
		http.Error(w, "Invalid enrollment", http.StatusBadRequest)
		return
	}
	if err := decoder.Decode(new(any)); !errors.Is(err, io.EOF) {
		http.Error(w, "Invalid enrollment", http.StatusBadRequest)
		return
	}
	response, err := g.enroll(request)
	if err != nil {
		http.Error(w, "Enrollment unavailable or unauthorized", http.StatusForbidden)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(gc.Response[gc.LocalEnrollmentResponse]{Success: true, Data: *response})
}

func digestBytes(raw []byte) string { sum := sha256.Sum256(raw); return hex.EncodeToString(sum[:]) }

func (g *Gateway) enroll(request gc.LocalEnrollment) (*gc.LocalEnrollmentResponse, error) {
	if request.RuntimePublicID == "" || len(request.RuntimePublicID) > 64 || len(request.EnrollmentToken) > 128 {
		return nil, ErrState
	}
	block, rest := pem.Decode([]byte(request.CSRPEM))
	if block == nil || block.Type != "CERTIFICATE REQUEST" || len(rest) != 0 {
		return nil, ErrState
	}
	csr, err := x509.ParseCertificateRequest(block.Bytes)
	if err != nil || csr.CheckSignature() != nil {
		return nil, ErrState
	}
	if _, ok := csr.PublicKey.(ed25519.PublicKey); !ok {
		return nil, ErrState
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.status == nil || g.status.Gateway.State != "active" {
		return nil, ErrState
	}
	tokenHash := digestBytes([]byte(request.EnrollmentToken))
	csrHash := digestBytes(block.Bytes)
	authorized := false
	for _, permit := range g.status.JoinPermits {
		if permit.RequestPublicID == request.RequestPublicID && permit.TokenSHA256 == tokenHash && permit.ExpiresAtUnixMS > time.Now().UnixMilli() {
			authorized = true
		}
	}
	for _, member := range g.status.Members {
		if member.RequestPublicID == request.RequestPublicID && member.RuntimePublicID == request.RuntimePublicID {
			authorized = true
		}
	}
	if !authorized {
		return nil, ErrState
	}
	if existing, ok := g.config.Members[request.RequestPublicID]; ok {
		if existing.TokenSHA256 != tokenHash || existing.CSRHash != csrHash || existing.RuntimePublicID != request.RuntimePublicID || existing.ExpiresAtUnixMS <= time.Now().UnixMilli() {
			return nil, ErrState
		}
		return &gc.LocalEnrollmentResponse{ClientCertificatePEM: existing.CertificatePEM, ExpiresAtUnixMS: existing.ExpiresAtUnixMS}, nil
	}
	allowed := false
	for _, permit := range g.status.JoinPermits {
		if permit.RequestPublicID == request.RequestPublicID && permit.TokenSHA256 == tokenHash && permit.ExpiresAtUnixMS > time.Now().UnixMilli() {
			allowed = true
			break
		}
	}
	if !allowed || len(g.config.Members) >= gc.MaxGatewayMembers {
		return nil, ErrState
	}
	for _, member := range g.config.Members {
		if member.RuntimePublicID != request.RuntimePublicID {
			continue
		}
		for _, active := range g.status.Members {
			if active.RequestPublicID == member.RequestPublicID {
				return nil, ErrState
			}
		}
		for _, permit := range g.status.JoinPermits {
			if permit.RequestPublicID == member.RequestPublicID && permit.ExpiresAtUnixMS > time.Now().UnixMilli() {
				return nil, ErrState
			}
		}
	}
	issued, err := issueLocalCertificate(g.config, request.RuntimePublicID, csr)
	if err != nil {
		return nil, err
	}
	block, _ = pem.Decode([]byte(issued.ClientCertificatePEM))
	member := LocalMember{RequestPublicID: request.RequestPublicID, RuntimePublicID: request.RuntimePublicID, CSRHash: csrHash, CertificatePEM: issued.ClientCertificatePEM, Fingerprint: digestBytes(block.Bytes), ExpiresAtUnixMS: issued.ExpiresAtUnixMS, TokenSHA256: tokenHash}
	g.config.Members[request.RequestPublicID] = member
	if err := WriteState(g.path, g.config); err != nil {
		delete(g.config.Members, request.RequestPublicID)
		return nil, err
	}
	if err := g.applyPolicy(); err != nil {
		return nil, err
	}
	return &gc.LocalEnrollmentResponse{ClientCertificatePEM: member.CertificatePEM, ExpiresAtUnixMS: member.ExpiresAtUnixMS}, nil
}

// applyPolicy keeps enrollment targets distinct from published data targets.
func (g *Gateway) applyPolicy() error {
	members := []gatewayegress.Member{}
	if g.status != nil && g.status.Gateway.State == "active" {
		for _, local := range g.config.Members {
			if local.ExpiresAtUnixMS <= time.Now().UnixMilli() {
				continue
			}
			var targets []string
			generation := int64(1)
			for _, remote := range g.status.Members {
				if remote.RequestPublicID == local.RequestPublicID && remote.RuntimePublicID == local.RuntimePublicID && remote.ClientCertificateSHA256 == local.Fingerprint {
					targets = remote.Destinations
					generation = remote.Generation
					break
				}
			}
			if len(targets) == 0 {
				for _, permit := range g.status.JoinPermits {
					if permit.RequestPublicID == local.RequestPublicID && permit.TokenSHA256 == local.TokenSHA256 && permit.ExpiresAtUnixMS > time.Now().UnixMilli() {
						targets = g.status.EnrollmentDestinations
						break
					}
				}
			}
			if len(targets) > 0 && generation > 0 {
				members = append(members, gatewayegress.Member{ID: local.RuntimePublicID, Generation: uint64(generation), CertificateSHA256: local.Fingerprint, Destinations: targets})
			}
		}
	}
	if g.status != nil {
		existing := map[string]bool{}
		for _, member := range members {
			existing[member.ID] = true
		}
		for _, remote := range g.status.ManagementMembers {
			local, ok := g.config.Members[remote.RequestPublicID]
			if !ok || existing[remote.RuntimePublicID] || local.RuntimePublicID != remote.RuntimePublicID || local.Fingerprint != remote.ClientCertificateSHA256 || local.ExpiresAtUnixMS <= time.Now().UnixMilli() {
				continue
			}
			members = append(members, gatewayegress.Member{ID: remote.RuntimePublicID, Generation: uint64(remote.Generation), CertificateSHA256: remote.ClientCertificateSHA256, Destinations: remote.Destinations})
			existing[remote.RuntimePublicID] = true
		}
	}
	return g.egress.ReplaceMembers(members)
}

func (g *Gateway) run(ctx context.Context) {
	timer := time.NewTicker(5 * time.Second)
	defer timer.Stop()
	defer g.client.Close()
	lastMetrics := time.Time{}
	for {
		if err := g.sync(ctx); err != nil && ctx.Err() == nil && g.log != nil {
			g.log.Warn("Gateway Cloud synchronization failed", "error", err)
		}
		if g.log != nil && time.Since(lastMetrics) >= 30*time.Second {
			stats := g.egress.Statistics()
			g.mu.Lock()
			pending, directoryAge := int64(0), int64(-1)
			if g.status != nil {
				pending = g.status.PendingClosureCount
				if g.status.Gateway.DirectorySyncedAtUnixMS > 0 {
					directoryAge = time.Now().UnixMilli() - g.status.Gateway.DirectorySyncedAtUnixMS
				}
			}
			g.mu.Unlock()
			g.log.Info("gateway_cloud_metrics", "active_connections", stats.ActiveConnections, "buffer_budget_bytes", stats.BufferBudgetBytes, "connect_accepted_total", stats.Accepted, "connect_rejected_total", stats.Rejected, "completed_upload_bytes_total", stats.CompletedUploadBytes, "completed_download_bytes_total", stats.CompletedDownloadBytes, "directory_age_ms", directoryAge, "pending_closures", pending)
			lastMetrics = time.Now()
		}
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
		}
	}
}

func (g *Gateway) sync(ctx context.Context) error {
	g.mu.Lock()
	identity, err := gatewayIdentity(g.config)
	g.mu.Unlock()
	if err != nil {
		return err
	}
	status, err := g.client.GatewayStatusPage(ctx, identity, g.closureCursor)
	if err != nil {
		g.mu.Lock()
		pending := g.config.PendingPrivateKeyB64u
		g.mu.Unlock()
		key, keyErr := gc.DecodeKey(pending)
		if keyErr != nil || len(key) != ed25519.PrivateKeySize {
			return err
		}
		staged := identity
		staged.PrivateKey = ed25519.PrivateKey(key)
		recovered, recoveryErr := g.client.GatewayStatusPage(ctx, staged, g.closureCursor)
		if recoveryErr != nil {
			return err
		}
		g.mu.Lock()
		g.config.PrivateKeyB64u = pending
		g.config.PendingPrivateKeyB64u = ""
		g.config.KeyRotatedAtUnixMS = time.Now().UnixMilli()
		saveErr := WriteState(g.path, g.config)
		g.mu.Unlock()
		if saveErr != nil {
			return saveErr
		}
		status = recovered
		identity = staged
	}
	g.mu.Lock()
	g.status = status
	pruneGatewayMembers(&g.config, status)
	for id, local := range g.config.Members {
		if local.PendingFingerprint == "" {
			continue
		}
		for _, remote := range status.Members {
			if remote.RequestPublicID == id && remote.ClientCertificateSHA256 == local.PendingFingerprint {
				local.CSRHash = local.PendingCSRHash
				local.PendingCSRHash = ""
				local.CertificatePEM = local.PendingCertificatePEM
				local.Fingerprint = local.PendingFingerprint
				local.ExpiresAtUnixMS = local.PendingExpiresAtUnixMS
				local.PendingCertificatePEM = ""
				local.PendingFingerprint = ""
				local.PendingExpiresAtUnixMS = 0
				g.config.Members[id] = local
			}
		}
	}
	g.config.NamespacePublicID = status.Gateway.NamespacePublicID
	identity.NamespacePublicID = status.Gateway.NamespacePublicID
	if err = WriteState(g.path, g.config); err == nil {
		err = g.applyPolicy()
	}
	active := g.egress.ActiveMembers()
	members := []gc.DirectoryMember{}
	for _, member := range g.config.Members {
		members = append(members, gc.DirectoryMember{RequestPublicID: member.RequestPublicID, RuntimePublicID: member.RuntimePublicID, ClientCertificateSHA256: member.Fingerprint, Reachable: active[member.RuntimePublicID] > 0})
	}
	g.mu.Unlock()
	if err != nil {
		return err
	}
	g.closureCursor = status.NextClosureCursor
	for _, closure := range status.Closures {
		if g.egress.ActiveThrough(closure.RuntimePublicID, uint64(closure.Generation)) != 0 {
			continue
		}
		ackIdentity := identity
		ackIdentity.BindingPublicID, ackIdentity.BindingGeneration = closure.BindingPublicID, closure.Generation
		if _, err := g.client.Acknowledge(ctx, ackIdentity, gc.ClosureAck{ClosurePublicID: closure.PublicID, Generation: closure.Generation, Side: "gateway"}); err != nil {
			return err
		}
	}
	if status.Gateway.State != "active" {
		return nil
	}
	if err := g.rotateMachineKey(ctx, identity); err != nil {
		return err
	}
	g.mu.Lock()
	identity, err = gatewayIdentity(g.config)
	listenerURL := g.config.ListenerURL
	g.mu.Unlock()
	if err != nil {
		return err
	}
	sort.Slice(members, func(i, j int) bool { return members[i].RequestPublicID < members[j].RequestPublicID })
	_, err = g.client.Directory(ctx, identity, gc.DirectorySync{ListenerURL: listenerURL, BaseRevision: status.Gateway.DirectoryRevision, Revision: status.Gateway.DirectoryRevision + 1, Full: true, Members: members})
	return err
}

func GatewayManagementURL(cloudOrigin, namespaceID, gatewayID, fingerprint string) string {
	if namespaceID != "" {
		return cloudOrigin + "/namespaces/" + url.PathEscape(namespaceID) + "/gateways?gateway=" + url.QueryEscape(gatewayID)
	}
	return fmt.Sprintf("%s/gateways/connect?gateway_id=%s&fingerprint=%s", cloudOrigin, url.QueryEscape(gatewayID), url.QueryEscape(fingerprint))
}

func issueLocalCertificate(config GatewayConfig, runtimeID string, csr *x509.CertificateRequest) (*gc.LocalEnrollmentResponse, error) {
	rootBlock, _ := pem.Decode([]byte(config.RootPEM))
	keyBlock, _ := pem.Decode([]byte(config.RootKeyPEM))
	if rootBlock == nil || keyBlock == nil {
		return nil, ErrState
	}
	root, err := x509.ParseCertificate(rootBlock.Bytes)
	if err != nil {
		return nil, ErrState
	}
	key, err := x509.ParsePKCS8PrivateKey(keyBlock.Bytes)
	if err != nil {
		return nil, ErrState
	}
	serial, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
	if err != nil {
		return nil, err
	}
	now := time.Now().UTC()
	expires := now.Add(90 * 24 * time.Hour)
	if expires.After(root.NotAfter) {
		expires = root.NotAfter
	}
	if !expires.After(now) {
		return nil, ErrState
	}
	leaf := &x509.Certificate{SerialNumber: serial, Subject: pkix.Name{CommonName: runtimeID}, NotBefore: now.Add(-time.Minute), NotAfter: expires, KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth}}
	der, err := x509.CreateCertificate(rand.Reader, leaf, root, csr.PublicKey, key)
	if err != nil {
		return nil, err
	}
	return &gc.LocalEnrollmentResponse{ClientCertificatePEM: string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})), ExpiresAtUnixMS: expires.UnixMilli()}, nil
}

func (g *Gateway) handleRenewCertificate(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if r.TLS == nil || len(r.TLS.VerifiedChains) == 0 || len(r.TLS.PeerCertificates) == 0 {
		http.Error(w, "Client identity required", http.StatusUnauthorized)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 32<<10)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	var request gc.LocalCertificateRenewal
	if dec.Decode(&request) != nil || dec.Decode(new(any)) != io.EOF {
		http.Error(w, "Invalid renewal", 400)
		return
	}
	block, rest := pem.Decode([]byte(request.CSRPEM))
	if block == nil || len(rest) != 0 {
		http.Error(w, "Invalid renewal", 400)
		return
	}
	csr, err := x509.ParseCertificateRequest(block.Bytes)
	if err != nil || csr.CheckSignature() != nil {
		http.Error(w, "Invalid renewal", 400)
		return
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	local, ok := g.config.Members[request.RequestPublicID]
	leaf := r.TLS.PeerCertificates[0]
	if !ok || g.status == nil || g.status.Gateway.State != "active" || local.Fingerprint != digestBytes(leaf.Raw) || !time.Now().Before(leaf.NotAfter) {
		http.Error(w, "Renewal rejected", http.StatusForbidden)
		return
	}
	authorized := false
	for _, remote := range g.status.Members {
		if remote.RequestPublicID == local.RequestPublicID && remote.ClientCertificateSHA256 == local.Fingerprint {
			authorized = true
		}
	}
	if !authorized {
		http.Error(w, "Renewal rejected", http.StatusForbidden)
		return
	}
	if local.PendingCertificatePEM != "" && local.PendingExpiresAtUnixMS > time.Now().UnixMilli() && local.PendingCSRHash != digestBytes(block.Bytes) {
		http.Error(w, "Another certificate renewal is pending", http.StatusConflict)
		return
	}
	if local.PendingCertificatePEM == "" || local.PendingExpiresAtUnixMS <= time.Now().UnixMilli() {
		issued, err := issueLocalCertificate(g.config, local.RuntimePublicID, csr)
		if err != nil {
			http.Error(w, "Renewal unavailable", http.StatusServiceUnavailable)
			return
		}
		cert, _ := pem.Decode([]byte(issued.ClientCertificatePEM))
		local.PendingCSRHash = digestBytes(block.Bytes)
		local.PendingCertificatePEM = issued.ClientCertificatePEM
		local.PendingFingerprint = digestBytes(cert.Bytes)
		local.PendingExpiresAtUnixMS = issued.ExpiresAtUnixMS
		previous := g.config.Members[local.RequestPublicID]
		g.config.Members[local.RequestPublicID] = local
		if WriteState(g.path, g.config) != nil {
			g.config.Members[local.RequestPublicID] = previous
			http.Error(w, "Renewal unavailable", http.StatusServiceUnavailable)
			return
		}
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(gc.Response[gc.LocalEnrollmentResponse]{Success: true, Data: gc.LocalEnrollmentResponse{ClientCertificatePEM: local.PendingCertificatePEM, ExpiresAtUnixMS: local.PendingExpiresAtUnixMS}})
}

func (g *Gateway) rotateMachineKey(ctx context.Context, identity Identity) error {
	g.mu.Lock()
	if g.config.PendingPrivateKeyB64u == "" && g.config.KeyRotatedAtUnixMS > time.Now().Add(-30*24*time.Hour).UnixMilli() {
		g.mu.Unlock()
		return nil
	}
	if g.config.PendingPrivateKeyB64u == "" {
		_, key, err := ed25519.GenerateKey(rand.Reader)
		if err != nil {
			g.mu.Unlock()
			return err
		}
		g.config.PendingPrivateKeyB64u = base64.RawURLEncoding.EncodeToString(key)
		if err := WriteState(g.path, g.config); err != nil {
			g.mu.Unlock()
			return err
		}
	}
	pending := g.config.PendingPrivateKeyB64u
	g.mu.Unlock()
	key, err := gc.DecodeKey(pending)
	if err != nil || len(key) != ed25519.PrivateKeySize {
		return ErrState
	}
	if err := g.client.RotateKey(ctx, identity, ed25519.PrivateKey(key)); err != nil {
		return err
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	g.config.PrivateKeyB64u = pending
	g.config.PendingPrivateKeyB64u = ""
	g.config.KeyRotatedAtUnixMS = time.Now().UnixMilli()
	return WriteState(g.path, g.config)
}

// Pruning uses a complete authoritative policy, never a failed fetch or a directory observation.
// Receipt-only members remain until acknowledgement or identity expiry.
func pruneGatewayMembers(config *GatewayConfig, status *gc.GatewayStatus) {
	retained := make(map[string]bool, len(status.Members)+len(status.ManagementMembers)+len(status.JoinPermits))
	for _, member := range status.Members {
		retained[member.RequestPublicID] = true
	}
	for _, member := range status.ManagementMembers {
		retained[member.RequestPublicID] = true
	}
	for _, permit := range status.JoinPermits {
		retained[permit.RequestPublicID] = true
	}
	for id := range config.Members {
		if !retained[id] {
			delete(config.Members, id)
		}
	}
}
