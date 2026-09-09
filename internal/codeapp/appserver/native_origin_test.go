package appserver

import "testing"

func TestNativeCodeSpaceOrigin(t *testing.T) {
	for _, raw := range []string{"http://127.0.0.1:43123", "http://cs-0123456789012345678901234567890123456789.localhost:43123"} {
		if _, ok := NativeCodeSpaceOrigin(raw); !ok {
			t.Errorf("reject loopback origin %q", raw)
		}
	}
	for _, raw := range []string{"http://evil.example:43123", "http://localhost:43123", "http://cs-short.localhost:43123", "http://cs-0123456789012345678901234567890123456789.localhost.evil:43123", "https://127.0.0.1:43123", "http://user@127.0.0.1:43123", "http://127.0.0.1:43123/", "http://127.0.0.1:43123?x=1", "http://127.0.0.1:0", "http://127.0.0.1:65536", "http://127.0.0.1"} {
		if _, ok := NativeCodeSpaceOrigin(raw); ok {
			t.Errorf("accept invalid origin %q", raw)
		}
	}
}
