package webbinding

import "testing"

func TestApplicationOriginPinsExactParentKindAndResource(t *testing.T) {
	origin, err := ApplicationOrigin("https://env.example.com:8443", "cs", "space-a")
	if err != nil || origin == "https://env.example.com:8443" {
		t.Fatal(origin, err)
	}
	for _, target := range []struct{ parent, kind, id string }{
		{"https://other.example.com:8443", "cs", "space-a"},
		{"https://env.example.com:8443", "pf", "space-a"},
		{"https://env.example.com:8443", "cs", "space-b"},
	} {
		next, err := ApplicationOrigin(target.parent, target.kind, target.id)
		if err != nil || next == origin {
			t.Fatal("application identity collided", next, err)
		}
	}
	for _, id := range []string{"../space", "space/child", "", "space%2fchild"} {
		if _, err = ApplicationOrigin("https://env.example.com", "cs", id); err == nil {
			t.Fatal("invalid resource accepted", id)
		}
	}
	if _, err = ApplicationOrigin("https://env.example.com", "env", "space-a"); err == nil {
		t.Fatal("Env scope accepted")
	}
}
