package localui

import (
	"crypto/tls"
	"errors"
	"fmt"
	"net"
	"net/http"
	"time"

	flowersec "github.com/floegence/flowersec/flowersec-go/v5"
	"github.com/floegence/redeven/internal/config"
)

func (s *Server) prepareNetwork(listeners []net.Listener) error {
	if s == nil {
		return errors.New("missing Local UI server")
	}
	if err := s.configurePublicAuthorities(listeners); err != nil {
		return err
	}
	if err := config.ValidateLocalUIProtocol(s.protocol); err != nil {
		return err
	}
	if s.protocol == config.LocalUIProtocolHTTP {
		return nil
	}
	ca := s.deviceCA
	if ca == nil {
		var err error
		ca, err = loadLocalUIDeviceCA(s.stateDir)
		if err != nil {
			return fmt.Errorf("load Local UI device CA: %w", err)
		}
	}
	hosts, err := s.secureCertificateHosts()
	if err != nil {
		return err
	}
	certificate, _, err := newLocalUIServerCertificate(ca, hosts)
	if err != nil {
		return fmt.Errorf("create ephemeral Local UI certificate: %w", err)
	}
	s.deviceCA = ca
	access := s.publicAccessSnapshot()
	access.certificate = &certificate
	s.publishPublicAccess(access)
	s.tlsConfig = &tls.Config{
		MinVersion:     tls.VersionTLS13,
		GetCertificate: s.currentAccessCertificate,
	}

	return nil
}

func (s *Server) secureCertificateHosts() ([]string, error) {
	hosts := uniqueCertificateHosts(s.publicAccessSnapshot().hosts)
	if len(hosts) == 0 {
		return nil, errors.New("missing Local UI certificate hosts")
	}
	return hosts, nil
}

// Public pages and direct sessions share the same configured listener. The
// Flowersec constructor owns the selected transport policy for its lifetime.
func (s *Server) createNetworkServers() error {
	if s.acceptor == nil || len(s.listeners) == 0 {
		return errors.New("local UI listener is not configured")
	}
	for range s.listeners {
		var server *flowersec.WebSocketHTTPServer
		var err error
		if s.protocol == config.LocalUIProtocolHTTP {
			handler, handlerErr := s.acceptor.HTTPDirectHandler(flowersec.HTTPDirectHandlerOptions{
				AuthorizeRequest: s.authorizePublicWebSocketRequest,
			})
			if handlerErr != nil {
				return handlerErr
			}
			server, err = flowersec.NewHTTPDirectServer(flowersec.HTTPDirectServerOptions{
				Handler: handler, ApplicationHandler: s.networkHandler(),
				ReadHeaderTimeout: 10 * time.Second, ReadTimeout: 2 * time.Minute,
				WriteTimeout: 30 * time.Minute, IdleTimeout: 2 * time.Minute,
			})
		} else {
			server, err = flowersec.NewWebSocketHTTPServer(flowersec.WebSocketHTTPServerOptions{
				Handler: s.acceptor.Handler(), ApplicationHandler: s.networkHandler(), TLSConfig: s.tlsConfig,
				AuthorizeWebSocketRequest: s.authorizePublicWebSocketRequest,
				ReadHeaderTimeout:         10 * time.Second, ReadTimeout: 2 * time.Minute,
				WriteTimeout: 30 * time.Minute, IdleTimeout: 2 * time.Minute,
			})
		}
		if err != nil {
			return fmt.Errorf("create Local UI %s server: %w", s.protocol, err)
		}
		s.networkServers = append(s.networkServers, server)
	}
	return nil
}

func (s *Server) authorizePublicWebSocketRequest(r *http.Request) bool {
	return r != nil && (s.isAllowedPublicAuthority(r.Host) || gatewayMemberOrigin(r) == "https://"+r.Host) && strictSameOriginWSRequest(r, true)
}

func (s *Server) serveNetwork() {
	for index, listener := range s.listeners {
		server := s.networkServers[index]
		go func() {
			if err := server.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) && !errors.Is(err, net.ErrClosed) {
				s.log.Error("Local UI server stopped", "protocol", s.protocol, "addr", listener.Addr().String(), "error", err)
			}
		}()
	}
}

func closeNetworkListeners(listeners []net.Listener) {
	for _, listener := range listeners {
		if listener != nil {
			_ = listener.Close()
		}
	}
}
