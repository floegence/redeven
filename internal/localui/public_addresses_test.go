package localui

import (
	"errors"
	"fmt"
	"net"
	"net/netip"
	"reflect"
	"syscall"
	"testing"
	"time"
)

type closingListener struct {
	authorityTestListener
	closed bool
}

func (l *closingListener) Close() error { l.closed = true; return nil }

func TestPublicWildcardListenersReachBothLoopbackFamilies(t *testing.T) {
	for _, family := range []struct{ network, host string }{{"tcp4", "0.0.0.0"}, {"tcp6", "::"}} {
		t.Run(family.network, func(t *testing.T) {
			probe, err := net.Listen(family.network, net.JoinHostPort(family.host, "0"))
			if unavailableAddressFamily(err) {
				t.Skip("address family unavailable")
			}
			if err != nil {
				t.Fatal(err)
			}
			bind, err := ParseBind(probe.Addr().String())
			probe.Close()
			if err != nil {
				t.Fatal(err)
			}
			listeners, err := listenPublicAddresses(bind, net.Listen)
			if err != nil {
				t.Fatal(err)
			}
			defer closeNetworkListeners(listeners)
			for _, listener := range listeners {
				address := listener.Addr().(*net.TCPAddr)
				host := "::1"
				if address.IP.To4() != nil {
					host = "127.0.0.1"
				}
				conn, err := net.DialTimeout("tcp", net.JoinHostPort(host, fmt.Sprint(bind.Port())), time.Second)
				if err != nil {
					t.Fatal(err)
				}
				conn.Close()
			}
		})
	}
}

func TestPublicListenersUseExplicitFamiliesAndFailOnOccupiedSupplement(t *testing.T) {
	for _, tc := range []struct{ bind, primary, supplement string }{
		{"0.0.0.0:23998", "tcp4 0.0.0.0:23998", "tcp6 [::1]:23998"},
		{"[::]:23998", "tcp6 [::]:23998", "tcp4 127.0.0.1:23998"},
	} {
		for _, failure := range []error{nil, syscall.EAFNOSUPPORT, syscall.EADDRNOTAVAIL, syscall.EADDRINUSE} {
			bind, _ := ParseBind(tc.bind)
			first := &closingListener{}
			var calls []string
			listeners, err := listenPublicAddresses(bind, func(network, address string) (net.Listener, error) {
				calls = append(calls, network+" "+address)
				if len(calls) == 1 {
					return first, nil
				}
				if failure != nil {
					return nil, &net.OpError{Op: "listen", Err: failure}
				}
				return &closingListener{}, nil
			})
			if !reflect.DeepEqual(calls, []string{tc.primary, tc.supplement}) {
				t.Fatalf("calls = %v", calls)
			}
			if failure == syscall.EADDRINUSE {
				if !errors.Is(err, failure) || !first.closed || len(listeners) != 0 {
					t.Fatalf("occupied port not rejected atomically: %v, %v", listeners, err)
				}
			} else {
				want := 2
				if failure != nil {
					want = 1
				}
				if err != nil || len(listeners) != want || first.closed {
					t.Fatalf("listeners = %v, %v", listeners, err)
				}
				closeNetworkListeners(listeners)
			}
		}
	}
}

func TestPublicAddressPreflightMatchesAvailableFamilies(t *testing.T) {
	bind, _ := ParseBind("0.0.0.0:23998")
	resolve := func(BindSpec) ([]netip.Addr, error) { return nil, nil }
	for _, unsupported := range []bool{false, true} {
		probe := &closingListener{}
		hosts, err := preflightPublicHosts(bind, func(network, address string) (net.Listener, error) {
			if network != "tcp6" || address != "[::1]:0" {
				t.Fatalf("preflight probed configured port: %s %s", network, address)
			}
			if unsupported {
				return nil, syscall.EAFNOSUPPORT
			}
			return probe, nil
		}, resolve)
		want := []string{"localhost", "127.0.0.1"}
		if !unsupported {
			want = append(want, "::1")
		}
		if err != nil || !reflect.DeepEqual(hosts, want) || probe.closed == unsupported {
			t.Fatalf("preflight = %v, %v; closed=%v", hosts, err, probe.closed)
		}
	}
}

func TestPublicAddressesRejectMismatchedListeners(t *testing.T) {
	for _, tc := range []struct {
		bind, host string
		port       int
	}{
		{"0.0.0.0:23998", "::", 23998},
		{"0.0.0.0:23998", "::1", 23998},
		{"192.0.2.10:23998", "127.0.0.1", 23998},
		{"127.0.0.1:23998", "127.0.0.2", 23998},
		{"0.0.0.0:23998", "0.0.0.0", 23999},
	} {
		s := newTestServer(t, nil)
		s.bind, _ = ParseBind(tc.bind)
		listener := authorityTestListener{addr: &net.TCPAddr{IP: net.ParseIP(tc.host), Port: tc.port}}
		if err := s.configurePublicAuthorities([]net.Listener{listener}); err == nil {
			t.Fatalf("accepted %s:%d for %s", tc.host, tc.port, tc.bind)
		}
	}
}

func TestPublicAddressesFollowActualListeners(t *testing.T) {
	for _, tc := range []struct {
		name, bind, protocol string
		bound, network, urls []string
	}{
		{"ipv4", "0.0.0.0:23998", "http", []string{"0.0.0.0", "::1"}, []string{"192.0.2.10"}, []string{"http://192.0.2.10:23998/", "http://localhost:23998/", "http://127.0.0.1:23998/", "http://[::1]:23998/"}},
		{"ipv6", "[::]:23998", "https", []string{"::", "127.0.0.1"}, []string{"2001:db8::10"}, []string{"https://[2001:db8::10]:23998/", "https://localhost:23998/", "https://127.0.0.1:23998/", "https://[::1]:23998/"}},
		{"no_network", "0.0.0.0:23998", "http", []string{"0.0.0.0", "::1"}, nil, []string{"http://localhost:23998/", "http://127.0.0.1:23998/", "http://[::1]:23998/"}},
		{"no_ipv6", "0.0.0.0:80", "http", []string{"0.0.0.0"}, nil, []string{"http://localhost/", "http://127.0.0.1/"}},
		{"no_ipv4", "[::]:443", "https", []string{"::"}, nil, []string{"https://localhost/", "https://[::1]/"}},
		{"specific_network", "192.0.2.10:23998", "https", []string{"192.0.2.10"}, []string{"192.0.2.10"}, []string{"https://192.0.2.10:23998/"}},
		{"specific_loopback", "127.42.0.9:23998", "http", []string{"127.42.0.9"}, nil, []string{"http://127.42.0.9:23998/"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			bind, err := ParseBind(tc.bind)
			if err != nil {
				t.Fatal(err)
			}
			s := newTestServer(t, nil)
			s.bind, s.protocol = bind, tc.protocol
			s.resolveAccessHosts = func(BindSpec) ([]netip.Addr, error) {
				var hosts []netip.Addr
				for _, raw := range tc.network {
					hosts = append(hosts, netip.MustParseAddr(raw))
				}
				return hosts, nil
			}
			var listeners []net.Listener
			for _, raw := range tc.bound {
				listeners = append(listeners, authorityTestListener{addr: &net.TCPAddr{IP: net.ParseIP(raw), Port: bind.Port()}})
			}
			if err := s.configurePublicAuthorities(listeners); err != nil {
				t.Fatal(err)
			}
			if got := s.DisplayURLs(); !reflect.DeepEqual(got, tc.urls) {
				t.Fatalf("URLs = %v, want %v", got, tc.urls)
			}
			for _, raw := range tc.urls {
				authority := raw[len(tc.protocol)+3 : len(raw)-1]
				if !s.isAllowedPublicAuthority(authority) {
					t.Errorf("public URL rejected: %s", raw)
				}
			}
			for _, raw := range []string{"localhost.example:23998", "127.0.0.1:23999", "0.0.0.0:23998", "[::]:23998"} {
				if s.isAllowedPublicAuthority(raw) {
					t.Errorf("invalid authority allowed: %s", raw)
				}
			}
			if !bind.IsWildcard() && s.isAllowedPublicAuthority("localhost:23998") {
				t.Fatal("specific bind was widened")
			}
		})
	}
}
