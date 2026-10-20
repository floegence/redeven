package installer

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
)

func rekorResponseFixture(t *testing.T, kind, version string) []byte {
	t.Helper()
	body, err := json.Marshal(map[string]string{"kind": kind, "apiVersion": version})
	if err != nil {
		t.Fatal(err)
	}
	response, err := json.Marshal([]map[string]any{{"entry-id": map[string]string{"body": base64.StdEncoding.EncodeToString(body)}}})
	if err != nil {
		t.Fatal(err)
	}
	return response
}

func TestRekorFormatAdmissionRejectsLegacyAlgorithms(t *testing.T) {
	if err := admitRekorResponse(rekorResponseFixture(t, "hashedrekord", "0.0.1")); err != nil {
		t.Fatal(err)
	}
	for _, kind := range []string{"rekord", "rpm", "intoto", "dsse", "pgp", ""} {
		if err := admitRekorResponse(rekorResponseFixture(t, kind, "0.0.1")); err == nil {
			t.Fatal("unreviewed algorithm contract was passed to the upstream general parser:", kind)
		}
	}
	for _, data := range [][]byte{nil, []byte(`[]`), []byte(`[{}]`), []byte(`[null]`), []byte(`[{}] {}`), rekorResponseFixture(t, "hashedrekord", "0.0.2")} {
		if err := admitRekorResponse(data); err == nil {
			t.Fatal("unsupported log response was accepted")
		}
	}
}

type fixtureRoundTripper func(*http.Request) (*http.Response, error)

func (f fixtureRoundTripper) RoundTrip(req *http.Request) (*http.Response, error) { return f(req) }

func TestRekorInputTransportPreservesOriginalEvidenceAndBounds(t *testing.T) {
	valid := rekorResponseFixture(t, "hashedrekord", "0.0.1")
	for _, data := range [][]byte{valid, []byte(strings.Repeat("x", (8<<20)+1)), rekorResponseFixture(t, "rekord", "0.0.1")} {
		transport := rekorInputTransport{fixtureRoundTripper(func(*http.Request) (*http.Response, error) {
			return &http.Response{StatusCode: 200, Body: io.NopCloser(bytes.NewReader(data))}, nil
		})}
		req, _ := http.NewRequest(http.MethodPost, "https://rekor.sigstore.dev/api/v1/log/entries/retrieve", nil)
		response, err := transport.RoundTrip(req)
		if !bytes.Equal(data, valid) {
			if err == nil {
				t.Fatal("unsupported response was passed to the SDK")
			}
			continue
		}
		if err != nil {
			t.Fatal(err)
		}
		actual, _ := io.ReadAll(response.Body)
		response.Body.Close()
		if !bytes.Equal(actual, valid) {
			t.Fatal("format admission rewrote cryptographic evidence")
		}
		req.URL.Scheme = "http"
		if _, err := transport.RoundTrip(req); err == nil {
			t.Fatal("non-HTTPS log operation was accepted")
		}
	}
}
