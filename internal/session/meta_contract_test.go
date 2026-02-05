package session

import (
	"reflect"
	"strings"
	"testing"
)

func TestMetaJSONContract(t *testing.T) {
	t.Parallel()

	expected := map[string]string{
		"ChannelID":         "channel_id",
		"EndpointID":        "endpoint_id",
		"FloeApp":           "floe_app",
		"CodeSpaceID":       "code_space_id",
		"SessionKind":       "session_kind",
		"UserPublicID":      "user_public_id",
		"UserEmail":         "user_email",
		"NamespacePublicID": "namespace_public_id",
		"CanRead":           "can_read",
		"CanWrite":          "can_write",
		"CanExecute":        "can_execute",
		"CanAdmin":          "can_admin",
		"CreatedAtUnixMs":   "created_at_unix_ms",
	}

	typ := reflect.TypeOf(Meta{})
	seen := make(map[string]struct{}, typ.NumField())
	for i := 0; i < typ.NumField(); i++ {
		f := typ.Field(i)
		gotTag := strings.TrimSpace(f.Tag.Get("json"))
		gotName := strings.TrimSpace(strings.Split(gotTag, ",")[0])

		wantName, ok := expected[f.Name]
		if !ok {
			t.Fatalf("unexpected field in Meta: %s (json=%q)", f.Name, gotTag)
		}
		if gotName != wantName {
			t.Fatalf("Meta.%s json tag mismatch: got=%q want=%q (full tag=%q)", f.Name, gotName, wantName, gotTag)
		}

		if (f.Name == "CodeSpaceID" || f.Name == "SessionKind") && !strings.Contains(gotTag, "omitempty") {
			t.Fatalf("Meta.%s must be omitempty (full tag=%q)", f.Name, gotTag)
		}

		seen[f.Name] = struct{}{}
	}

	for name := range expected {
		if _, ok := seen[name]; !ok {
			t.Fatalf("missing field in Meta: %s", name)
		}
	}
}
