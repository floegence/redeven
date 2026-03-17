package localui

import "testing"

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

func TestParseBind_IPv4Specific(t *testing.T) {
	t.Parallel()

	bind, err := ParseBind("192.168.1.11:12345")
	if err != nil {
		t.Fatalf("ParseBind() error = %v", err)
	}
	if bind.IsLoopbackOnly() {
		t.Fatalf("expected non-loopback bind")
	}
	if bind.ListenLabel() != "192.168.1.11:12345" {
		t.Fatalf("ListenLabel() = %q, want %q", bind.ListenLabel(), "192.168.1.11:12345")
	}
	urls := bind.DisplayURLs()
	if len(urls) != 1 || urls[0] != "http://192.168.1.11:12345/" {
		t.Fatalf("DisplayURLs() = %#v", urls)
	}
}

func TestParseBind_Wildcard(t *testing.T) {
	t.Parallel()

	bind, err := ParseBind("0.0.0.0:12345")
	if err != nil {
		t.Fatalf("ParseBind() error = %v", err)
	}
	if !bind.IsWildcard() {
		t.Fatalf("expected wildcard bind")
	}
	if bind.IsLoopbackOnly() {
		t.Fatalf("expected wildcard bind to be non-loopback")
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
