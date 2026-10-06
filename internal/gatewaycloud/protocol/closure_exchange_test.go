package gatewaycloud

import (
	"encoding/json"
	"os"
	"testing"
	"time"
)

func TestRuntimeClosureSharedFixture(t *testing.T) {
	raw, err := os.ReadFile("testdata/closure-v2.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Public  string                        `json:"public_key_b64u"`
		Request RuntimeClosureExchangeRequest `json:"request"`
	}
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatal(err)
	}
	now := time.UnixMilli(fixture.Request.IssuedAtUnixMS).Add(24 * time.Hour)
	if err := fixture.Request.Verify(fixture.Public, now); err != nil {
		t.Fatal(err)
	}
	mutations := []func(*RuntimeClosureExchangeRequest){
		func(r *RuntimeClosureExchangeRequest) { r.CloudOrigin = "https://other.example" },
		func(r *RuntimeClosureExchangeRequest) { r.Binding.Generation++ },
		func(r *RuntimeClosureExchangeRequest) { r.Binding.NamespacePublicID = "other" },
		func(r *RuntimeClosureExchangeRequest) { r.Binding.GatewayPublicID = "other" },
		func(r *RuntimeClosureExchangeRequest) { r.Binding.RuntimePublicID = "other" },
		func(r *RuntimeClosureExchangeRequest) { r.Binding.PublicID = "other" },
		func(r *RuntimeClosureExchangeRequest) { r.Closed = false },
		func(r *RuntimeClosureExchangeRequest) { r.IssuedAtUnixMS++ },
	}
	for i, mutate := range mutations {
		request := fixture.Request
		mutate(&request)
		if request.Verify(fixture.Public, now) == nil {
			t.Fatalf("accepted mutated receipt %d", i)
		}
	}
}
