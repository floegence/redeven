package protocol

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

func TestCatalogResponseUsesSnakeCaseWireNames(t *testing.T) {
	payload, err := json.Marshal(NewCatalogResponse([]Environment{{
		EnvPublicID: " env_demo ",
		Name:        " Demo ",
		State:       EnvironmentStateAvailable,
	}}))
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}
	body := string(payload)
	for _, want := range []string{"protocol_version", "env_public_id"} {
		if !strings.Contains(body, `"`+want+`"`) {
			t.Fatalf("JSON body %s does not contain %q", body, want)
		}
	}
	for _, forbidden := range []string{"EnvPublicID", "clientSessionID"} {
		if strings.Contains(body, forbidden) {
			t.Fatalf("JSON body %s contains non-wire field %q", body, forbidden)
		}
	}
}

func TestOpenSessionRequestValidation(t *testing.T) {
	if err := ValidateOpenSessionRequest(OpenSessionRequest{EnvPublicID: " env_demo "}); err != nil {
		t.Fatalf("ValidateOpenSessionRequest() error = %v", err)
	}
	if err := ValidateOpenSessionRequest(OpenSessionRequest{}); err != ErrMissingEnvPublicID {
		t.Fatalf("ValidateOpenSessionRequest() error = %v, want %v", err, ErrMissingEnvPublicID)
	}
}

func TestRuntimeGatewayWireContractsDoNotExposeSecrets(t *testing.T) {
	types := []reflect.Type{
		reflect.TypeOf(CatalogRequest{}),
		reflect.TypeOf(CatalogResponse{}),
		reflect.TypeOf(Environment{}),
		reflect.TypeOf(OpenSessionRequest{}),
		reflect.TypeOf(OpenSessionResponse{}),
	}
	for _, typ := range types {
		assertNoSecretWireFields(t, typ)
	}
}

func assertNoSecretWireFields(t *testing.T, typ reflect.Type) {
	t.Helper()
	for i := 0; i < typ.NumField(); i++ {
		field := typ.Field(i)
		tag := field.Tag.Get("json")
		wireName := strings.Split(tag, ",")[0]
		name := strings.ToLower(field.Name + " " + wireName)
		if strings.Contains(name, "token") || strings.Contains(name, "secret") {
			t.Fatalf("%s.%s exposes forbidden credential-shaped wire field %q", typ.Name(), field.Name, wireName)
		}
	}
}
