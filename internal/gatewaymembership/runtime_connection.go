package gatewaymembership

import (
	"context"
	"crypto/tls"
	"errors"
	"net"
	"net/http"
	"sync"
	"time"

	flowersec "github.com/floegence/flowersec/flowersec-go/v5"
	gp "github.com/floegence/redeven/internal/runtimegateway/protocol"
)

// RuntimeConnection uses the SDK controller for all reconnection. Configuration
// callbacks are bound to one locally approved member; a Gateway change creates
// a new owner only after the old owner has been closed.
type RuntimeConnection struct {
	controller *flowersec.ConnectionController
	source     *runtimeSource
}

// RuntimeApplication carries the public HTTP and Flowersec boundaries together.
// The SDK owns the TLS server, including upgraded connection shutdown.
type RuntimeApplication struct {
	Handler                   http.Handler
	WebSocketHandler          http.Handler
	AuthorizeWebSocketRequest func(*http.Request) bool
}

type runtimeSource struct {
	mu       sync.Mutex
	current  func() *RuntimeConfig
	persist  func(*RuntimeConfig) error
	memberID string
}

func (s *runtimeSource) Acquire(ctx context.Context) (flowersec.ArtifactLease, *flowersec.ArtifactSourceError) {
	s.mu.Lock()
	defer s.mu.Unlock()
	r := s.current()
	if r == nil || r.MemberID != s.memberID {
		return flowersec.ArtifactLease{}, flowersec.NewTerminalArtifactSourceError(ErrDenied)
	}
	if r.Leaving {
		if err := r.Leave(ctx); err != nil {
			return flowersec.ArtifactLease{}, memberSourceError(err)
		}
		if err := s.persist(nil); err != nil {
			return flowersec.ArtifactLease{}, memberSourceError(err)
		}
		return flowersec.ArtifactLease{}, flowersec.NewTerminalArtifactSourceError(ErrDenied)
	}
	if r.PendingJoin != nil {
		if err := r.Enroll(ctx, s.persist); err != nil {
			return flowersec.ArtifactLease{}, memberSourceError(err)
		}
	}
	if r.PendingRotation != nil || time.Until(time.UnixMilli(r.ClientExpiresAtUnixMS)) < 30*24*time.Hour || time.Until(time.UnixMilli(r.Service.ExpiresAtUnixMS)) < 30*24*time.Hour {
		if err := r.Rotate(ctx, s.persist); err != nil {
			return flowersec.ArtifactLease{}, memberSourceError(err)
		}
	}
	var offer ConnectionOffer
	if err := r.Request(ctx, "/v4/member/connect", gp.CatalogRequest{ProtocolVersion: gp.Version}, &offer, true); err != nil {
		return flowersec.ArtifactLease{}, memberSourceError(err)
	}
	if offer.ProtocolVersion != gp.Version || offer.MemberID != r.MemberID || offer.MemberVersion != r.MemberVersion || offer.ChannelID == "" || offer.ChannelID == r.LastSpentChannelID || offer.Generation == 0 {
		return flowersec.ArtifactLease{}, flowersec.NewTerminalArtifactSourceError(ErrInvalidProof)
	}
	artifact, err := flowersec.ParseArtifact(offer.Artifact)
	if err != nil {
		return flowersec.ArtifactLease{}, flowersec.NewTerminalArtifactSourceError(err)
	}
	lease, err := flowersec.NewArtifactLease(artifact, func(context.Context) error {
		s.mu.Lock()
		defer s.mu.Unlock()
		next := s.current()
		if next == nil || next.MemberID != r.MemberID || next.MemberVersion != r.MemberVersion || next.LastSpentChannelID == offer.ChannelID {
			return ErrDenied
		}
		next.LastSpentChannelID = offer.ChannelID
		return s.persist(next)
	})
	if err != nil {
		return flowersec.ArtifactLease{}, flowersec.NewTerminalArtifactSourceError(err)
	}
	return lease, nil
}

func memberSourceError(err error) *flowersec.ArtifactSourceError {
	if errors.Is(err, ErrDenied) || errors.Is(err, ErrInvalidProof) || errors.Is(err, ErrState) {
		return flowersec.NewTerminalArtifactSourceError(err)
	}
	return flowersec.NewRetryableArtifactSourceError(err)
}

// Credential renewal is independent of session lifetime. It changes credentials
// for future requests without interrupting existing LAN or Cloud data streams.
func (s *runtimeSource) renew(ctx context.Context) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	r := s.current()
	if r == nil || r.MemberID != s.memberID {
		return ErrDenied
	}
	if r.PendingJoin != nil || r.Leaving {
		return nil
	}
	if r.PendingRotation != nil || time.Until(time.UnixMilli(r.ClientExpiresAtUnixMS)) < 30*24*time.Hour || time.Until(time.UnixMilli(r.Service.ExpiresAtUnixMS)) < 30*24*time.Hour {
		return r.Rotate(ctx, s.persist)
	}
	return nil
}

func NewRuntimeConnection(current func() *RuntimeConfig, persist func(*RuntimeConfig) error) (*RuntimeConnection, error) {
	if current == nil || persist == nil {
		return nil, ErrState
	}
	r := current()
	if r == nil {
		return nil, ErrState
	}
	trust, err := r.TLSConfig(false)
	if err != nil {
		return nil, err
	}
	source := &runtimeSource{current: current, persist: persist, memberID: r.MemberID}
	controller, err := flowersec.NewConnectionController(source, flowersec.ConnectionControllerOptions{Connector: flowersec.ConnectorOptions{TrustRoots: trust.RootCAs, Origin: r.GatewayURL}})
	if err != nil {
		return nil, err
	}
	return &RuntimeConnection{controller: controller, source: source}, nil
}

func (r *RuntimeConnection) Snapshot() flowersec.ConnectionSnapshot { return r.controller.Snapshot() }
func (r *RuntimeConnection) RetryNow() bool                         { return r.controller.RetryNow() }

// Run serves only the original public application chain supplied by Local UI.
// The callback must not be the trusted Desktop/private management handler.
func (r *RuntimeConnection) Run(ctx context.Context, application func(string) RuntimeApplication) error {
	if application == nil {
		return ErrState
	}
	ctx, cancel := context.WithCancel(ctx)
	var workers sync.WaitGroup
	defer func() { cancel(); workers.Wait() }()
	workers.Add(1)
	go func() {
		defer workers.Done()
		ticker := time.NewTicker(time.Hour)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				// The connection controller diagnoses authorization on its next
				// connection attempt; a transient renewal failure is not a lease.
				_ = r.source.renew(ctx)
			}
		}
	}()
	r.controller.Start(ctx)
	defer func() {
		closeCtx, closeCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer closeCancel()
		_ = r.controller.Close(closeCtx)
	}()
	var served flowersec.Session
	var sessionCancel context.CancelFunc
	defer func() {
		if sessionCancel != nil {
			sessionCancel()
		}
	}()
	snapshot := r.controller.Snapshot()
	for {
		if current := r.controller.CurrentSession(); current != served {
			if sessionCancel != nil {
				sessionCancel()
			}
			served = current
			if current != nil {
				sessionCtx, cancelSession := context.WithCancel(ctx)
				sessionCancel = cancelSession
				workers.Add(1)
				go func() { defer workers.Done(); defer cancelSession(); _ = r.serve(sessionCtx, current, application) }()
			}
		}
		if snapshot.State == flowersec.ConnectionClosed || snapshot.State == flowersec.ConnectionFailed {
			return ErrDenied
		}
		var err error
		snapshot, err = r.controller.WaitForSnapshotChange(ctx, snapshot)
		if err != nil {
			return err
		}
	}
}

func (r *RuntimeConnection) serve(ctx context.Context, session flowersec.Session, application func(string) RuntimeApplication) error {
	handlers, err := flowersec.NewStreamHandlers(flowersec.StreamHandlerOptions{MaxConcurrentStreams: gp.MaxMemberConnections})
	if err != nil {
		return err
	}
	if err := handlers.HandleStream(gp.MemberConnectionStream, func(ctx context.Context, incoming flowersec.IncomingStream) error {
		if len(incoming.Metadata.Values()) != 0 {
			return ErrDenied
		}
		config := r.source.current()
		if config == nil || config.MemberID != r.source.memberID {
			return ErrDenied
		}
		pair, err := tls.X509KeyPair([]byte(config.Service.CertificatePEM), []byte(config.ServicePrivateKeyPEM))
		if err != nil {
			return err
		}
		listener, err := flowersec.NewByteStreamListener(ctx, incoming.Stream)
		if err != nil {
			return err
		}
		defer listener.Close()
		app := application(config.Service.Origin)
		server, err := flowersec.NewWebSocketHTTPServer(flowersec.WebSocketHTTPServerOptions{
			Handler: app.WebSocketHandler, ApplicationHandler: app.Handler,
			AuthorizeWebSocketRequest: app.AuthorizeWebSocketRequest,
			ReadHeaderTimeout:         10 * time.Second, IdleTimeout: 2 * time.Minute,
			TLSConfig: &tls.Config{Certificates: []tls.Certificate{pair}, MinVersion: tls.VersionTLS13, NextProtos: []string{"http/1.1"}},
		})
		if err != nil {
			return err
		}
		defer server.Close()
		err = server.Serve(listener)

		if errors.Is(err, http.ErrServerClosed) || errors.Is(err, net.ErrClosed) {
			return nil
		}
		return err
	}); err != nil {
		return err
	}
	return handlers.Serve(ctx, session)
}
