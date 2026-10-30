package pluginorigin

import (
	"strings"
	"testing"
)

func TestChildOriginUsesProductRoutingNamespace(t *testing.T) {
	key := strings.Repeat("a", 48)
	for _, tc := range []struct{ parent, child string }{
		{"http://127.0.0.1:24000", "http://" + key + ".localhost:24000"},
		{"http://[::1]:24000", "http://" + key + ".localhost:24000"},
		{"http://localhost:24000", "http://" + key + ".localhost:24000"},
		{"https://env.example.test", "https://" + key + ".example.test"},
		{"https://env.example.test:8443", "https://" + key + ".example.test:8443"},
		{"https://r-" + strings.Repeat("b", 40) + ".redeven.invalid", "https://" + key + ".r-" + strings.Repeat("b", 40) + ".redeven.invalid"},
	} {
		got, err := Child(tc.parent, key)
		if err != nil || got != tc.child {
			t.Errorf("Child(%q) = %q, %v", tc.parent, got, err)
		}
		if !IsChild(tc.parent, tc.child) {
			t.Errorf("child not recognized for %s", tc.parent)
		}
		for _, wrong := range []string{tc.child + "/", tc.child + "?q=1", strings.Replace(tc.child, key, "x"+key, 1), strings.Replace(tc.child, key, strings.ToUpper(key), 1)} {
			if IsChild(tc.parent, wrong) {
				t.Errorf("accepted wrong origin %s", wrong)
			}
		}
	}
}

func TestChildOriginRejectsUnroutableParents(t *testing.T) {
	for _, parent := range []string{"", "http://192.168.0.1:24000", "http://env.example.test", "https://127.0.0.1", "https://example", "https://env.example.test/path", "https://user@env.example.test", "https://env.example.test?q=1", "http://127.1:24000", "https://env..test", "https://env.-example.test", "https://env.example-.test", "https://env.example_test", "https://env.example.test:", "https://env.example.test?", "https://env.example.test:443", "http://localhost:80", "https://env." + strings.Repeat("x", 64) + ".test"} {
		if got, err := Child(parent, strings.Repeat("a", 48)); err == nil {
			t.Errorf("accepted %s as %s", parent, got)
		}
	}
	for _, key := range []string{"", strings.Repeat("a", 47), strings.Repeat("A", 48), strings.Repeat("g", 48)} {
		if _, err := Child("http://127.0.0.1:24000", key); err == nil {
			t.Errorf("accepted key %q", key)
		}
	}
}
