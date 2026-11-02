package security

import "testing"

func TestCanonicalJSONMatchesNodeNestedPermissionObject(t *testing.T) {
	type permissions struct {
		Access            bool `json:"access"`
		ManageAttachments bool `json:"manage_attachments"`
		ManageNetwork     bool `json:"manage_network"`
	}
	actual, err := CanonicalJSON(map[string]any{"permissions": permissions{true, true, true}, "binding_audience": "https://gateway.example/?a=1&b=2"})
	if err != nil {
		t.Fatal(err)
	}
	const want = `{"binding_audience":"https://gateway.example/?a=1&b=2","permissions":{"access":true,"manage_attachments":true,"manage_network":true}}`
	if actual != want {
		t.Fatalf("Node signature input mismatch: %s", actual)
	}
}

func TestCanonicalJSONDigestRejectsTrailingContent(t *testing.T) {
	for _, body := range []string{`{} {}`, `{} garbage`} {
		if _, err := CanonicalJSONDigestFromBytes([]byte(body)); err == nil {
			t.Fatal("accepted trailing JSON content")
		}
	}
	if _, err := CanonicalJSONDigestFromBytes([]byte("{} \n")); err != nil {
		t.Fatal(err)
	}
}
