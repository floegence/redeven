package localui

import (
	"net/netip"
	"reflect"
	"testing"
)

func TestParseBind_Localhost(t *testing.T) {
	t.Parallel()

	bind, err := ParseBind("localhost:12345")
	if err != nil {
		t.Fatalf("ParseBind() error = %v", err)
	}
	if !bind.IsLoopbackOnly() {
		t.Fatalf("expected localhost bind to be loopback only")
	}
	addrs := bind.ListenAddrs()
	if len(addrs) != 2 {
		t.Fatalf("len(ListenAddrs()) = %d, want 2", len(addrs))
	}
}

func TestParseBind_IPv4LoopbackRange(t *testing.T) {
	t.Parallel()

	bind, err := ParseBind("127.42.0.9:12345")
	if err != nil {
		t.Fatalf("ParseBind() error = %v", err)
	}
	if !bind.IsLoopbackOnly() {
		t.Fatalf("expected loopback bind")
	}
	if bind.ListenLabel() != "127.42.0.9:12345" {
		t.Fatalf("ListenLabel() = %q, want %q", bind.ListenLabel(), "127.42.0.9:12345")
	}
	urls := bind.DisplayURLs()
	if len(urls) != 1 || urls[0] != "http://127.42.0.9:12345/" {
		t.Fatalf("DisplayURLs() = %#v", urls)
	}
}

func TestParseBind_AllowsNetworkAndWildcardWithFixedPort(t *testing.T) {
	t.Parallel()

	for _, raw := range []string{"0.0.0.0:12345", "192.168.1.11:12345", "[::]:12345", "[2001:db8::1]:12345"} {
		bind, err := ParseBind(raw)
		if err != nil {
			t.Fatalf("ParseBind(%q) error = %v", raw, err)
		}
		if !bind.IsNetworkExposure() {
			t.Fatalf("ParseBind(%q) did not produce network exposure", raw)
		}
	}
}

func TestParseBind_RejectsUnsafeNetworkAddressesAndDynamicPorts(t *testing.T) {
	t.Parallel()

	for _, raw := range []string{
		"0.0.0.0:0",
		"192.168.1.11:0",
		"[::]:0",
		"[2001:db8::1]:0",
		"[::ffff:127.0.0.1]:12345",
		"[fe80::1]:12345",
		"224.0.0.1:12345",
		"255.255.255.255:12345",
	} {
		if _, err := ParseBind(raw); err == nil {
			t.Fatalf("ParseBind(%q) error = nil, want rejection", raw)
		}
	}
}

func TestParseBind_IPv6Loopback(t *testing.T) {
	t.Parallel()

	bind, err := ParseBind("[::1]:12345")
	if err != nil {
		t.Fatalf("ParseBind() error = %v", err)
	}
	if !bind.IsLoopbackOnly() || bind.ListenLabel() != "[::1]:12345" {
		t.Fatalf("unexpected IPv6 loopback bind: %#v", bind)
	}
}

func TestParseBind_AllowsDynamicLoopbackPortOnExplicitIP(t *testing.T) {
	t.Parallel()

	bind, err := ParseBind("127.0.0.1:0")
	if err != nil {
		t.Fatalf("ParseBind() error = %v", err)
	}
	if bind.Port() != 0 {
		t.Fatalf("Port() = %d, want 0", bind.Port())
	}
	if !bind.IsLoopbackOnly() {
		t.Fatalf("expected loopback bind")
	}
}

func TestParseBind_RejectsLocalhostDynamicPort(t *testing.T) {
	t.Parallel()

	if _, err := ParseBind("localhost:0"); err == nil {
		t.Fatalf("expected localhost:0 to fail")
	}
}

func TestParseBind_RejectsHostname(t *testing.T) {
	t.Parallel()

	if _, err := ParseBind("example.com:12345"); err == nil {
		t.Fatalf("expected hostname bind to fail")
	}
}

func TestSelectNetworkAccessHostsFiltersAndSorts(t *testing.T) {
	t.Parallel()

	bind, err := ParseBind("0.0.0.0:23998")
	if err != nil {
		t.Fatal(err)
	}
	candidates := []interfaceAddress{
		{addr: netip.MustParseAddr("192.168.20.8"), up: true},
		{addr: netip.MustParseAddr("10.0.0.5"), up: true},
		{addr: netip.MustParseAddr("10.0.0.5"), up: true},
		{addr: netip.MustParseAddr("127.0.0.1"), up: true, loopback: true},
		{addr: netip.MustParseAddr("169.254.1.2"), up: true},
		{addr: netip.MustParseAddr("172.16.1.4"), up: false},
		{addr: netip.MustParseAddr("2001:db8::1"), up: true},
	}
	want := []netip.Addr{netip.MustParseAddr("10.0.0.5"), netip.MustParseAddr("192.168.20.8")}
	if got := selectNetworkAccessHosts(bind, candidates); !reflect.DeepEqual(got, want) {
		t.Fatalf("selectNetworkAccessHosts() = %#v, want %#v", got, want)
	}
}
