package localui

import (
	"crypto/tls"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"strconv"
	"strings"
	"time"

	flowersec "github.com/floegence/flowersec/flowersec-go/v5"
)

func (s *Server) prepareSecureNetwork(listeners []net.Listener) error {
	if s == nil {
		return errors.New("missing Local UI server")
	}
	if err := s.configureNetworkAuthorities(listeners); err != nil {
		return err
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
	s.tlsConfig = &tls.Config{
		MinVersion:   tls.VersionTLS13,
		Certificates: []tls.Certificate{certificate},
	}
	directListeners, err := s.listenForDirectWebSockets(listeners)
	if err != nil {
		return err
	}
	s.directListeners = directListeners
	if err := s.configureDirectAuthorities(listeners, directListeners); err != nil {
		s.closePreparedDirectListeners()
		return err
	}
	return nil
}

func (s *Server) secureCertificateHosts() ([]string, error) {
	s.authorityMu.RLock()
	authorities := make([]string, 0, len(s.networkAuthorities))
	for authority := range s.networkAuthorities {
		authorities = append(authorities, authority)
	}
	s.authorityMu.RUnlock()
	hosts := make([]string, 0, len(authorities))
	for _, authority := range authorities {
		host, _, err := net.SplitHostPort(authority)
		if err != nil {
			return nil, fmt.Errorf("invalid Local UI certificate authority")
		}
		hosts = append(hosts, host)
	}
	hosts = uniqueCertificateHosts(hosts)
	if len(hosts) == 0 {
		return nil, errors.New("missing Local UI certificate hosts")
	}
	return hosts, nil
}

func (s *Server) listenForDirectWebSockets(uiListeners []net.Listener) ([]net.Listener, error) {
	directListeners := make([]net.Listener, 0, len(uiListeners))
	for _, uiListener := range uiListeners {
		addr, ok := uiListener.Addr().(*net.TCPAddr)
		if !ok || addr == nil || addr.IP == nil || addr.Port <= 0 {
			closeNetworkListeners(directListeners)
			return nil, errors.New("local UI listener must use a TCP address")
		}
		network := "tcp6"
		if addr.IP.To4() != nil {
			network = "tcp4"
		}
		directListener, err := net.Listen(network, net.JoinHostPort(addr.IP.String(), "0"))
		if err != nil {
			closeNetworkListeners(directListeners)
			return nil, fmt.Errorf("listen for Flowersec WSS next to %s: %w", addr, err)
		}
		directListeners = append(directListeners, directListener)
	}
	return directListeners, nil
}

func (s *Server) configureDirectAuthorities(uiListeners, directListeners []net.Listener) error {
	if len(uiListeners) == 0 || len(uiListeners) != len(directListeners) {
		return errors.New("flowersec WSS listeners do not match Local UI listeners")
	}
	type listenerPorts struct {
		uiPort     int
		directPort int
		ipv4       bool
		wildcard   bool
	}
	ports := make([]listenerPorts, 0, len(uiListeners))
	for index, uiListener := range uiListeners {
		uiAddr, uiOK := uiListener.Addr().(*net.TCPAddr)
		directAddr, directOK := directListeners[index].Addr().(*net.TCPAddr)
		if !uiOK || !directOK || uiAddr == nil || directAddr == nil || directAddr.Port <= 0 {
			return errors.New("invalid Flowersec WSS listener")
		}
		ports = append(ports, listenerPorts{
			uiPort:     uiAddr.Port,
			directPort: directAddr.Port,
			ipv4:       uiAddr.IP.To4() != nil,
			wildcard:   uiAddr.IP.IsUnspecified(),
		})
	}

	s.authorityMu.Lock()
	defer s.authorityMu.Unlock()
	mapping := make(map[string]string, len(s.networkAuthorities))
	for uiAuthority := range s.networkAuthorities {
		host, portText, err := net.SplitHostPort(uiAuthority)
		if err != nil {
			return errors.New("invalid Local UI authority")
		}
		uiPort, err := strconv.Atoi(portText)
		if err != nil {
			return errors.New("invalid Local UI authority port")
		}
		wantIPv4 := true
		if !strings.EqualFold(host, "localhost") {
			addr, parseErr := netip.ParseAddr(host)
			if parseErr != nil {
				return errors.New("invalid Local UI authority host")
			}
			wantIPv4 = addr.Is4()
		}
		matched := false
		for _, candidate := range ports {
			if candidate.uiPort != uiPort || (!candidate.wildcard && candidate.ipv4 != wantIPv4) {
				continue
			}
			mapping[uiAuthority] = net.JoinHostPort(host, strconv.Itoa(candidate.directPort))
			matched = true
			break
		}
		if !matched {
			return fmt.Errorf("missing Flowersec WSS listener for %s", uiAuthority)
		}
	}
	s.directAuthorities = mapping
	return nil
}

func (s *Server) createDirectServers() error {
	if s == nil || s.acceptor == nil || s.tlsConfig == nil || len(s.directListeners) == 0 {
		return errors.New("flowersec WSS server is not configured")
	}
	servers := make([]*flowersec.WebSocketHTTPServer, 0, len(s.directListeners))
	for range s.directListeners {
		server, err := flowersec.NewWebSocketHTTPServer(flowersec.WebSocketHTTPServerOptions{
			Handler:           s.acceptor.Handler(),
			TLSConfig:         s.tlsConfig,
			ReadHeaderTimeout: 10 * time.Second,
			ReadTimeout:       2 * time.Minute,
			WriteTimeout:      30 * time.Minute,
			IdleTimeout:       2 * time.Minute,
		})
		if err != nil {
			return fmt.Errorf("create Flowersec WSS server: %w", err)
		}
		servers = append(servers, server)
	}
	s.directServers = servers
	return nil
}

func (s *Server) serveSecureNetwork(server *http.Server, uiListeners []net.Listener) {
	for _, listener := range uiListeners {
		listener := listener
		go func() {
			tlsListener := tls.NewListener(listener, s.tlsConfig.Clone())
			if err := server.Serve(tlsListener); err != nil && !errors.Is(err, http.ErrServerClosed) {
				s.log.Error("local ui HTTPS server stopped", "addr", listener.Addr().String(), "error", err)
			}
		}()
	}
	for index, listener := range s.directListeners {
		listener := listener
		directServer := s.directServers[index]
		go func() {
			if err := directServer.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
				s.log.Error("Flowersec WSS server stopped", "addr", listener.Addr().String(), "error", err)
			}
		}()
	}
}

func (s *Server) closePreparedDirectListeners() {
	closeNetworkListeners(s.directListeners)
	s.directListeners = nil
	s.directAuthorities = make(map[string]string)
}

func closeNetworkListeners(listeners []net.Listener) {
	for _, listener := range listeners {
		if listener != nil {
			_ = listener.Close()
		}
	}
}
