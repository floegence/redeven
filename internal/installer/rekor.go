package installer

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
)

// rekorInputTransport narrows the general-purpose upstream client's input to
// this product's detached X.509 hashedrekord contract. The upstream SDK still
// verifies every signature, inclusion proof, log key and authenticated time.
// Other Rekor types can invoke legacy OpenPGP parsers in the general SDK; never
// pass those types to it, even if returned by the fixed HTTPS log origin.
// This is format admission only, not a second cryptographic verifier.
type rekorInputTransport struct{ base http.RoundTripper }

func (t rekorInputTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	if req.URL.Scheme != "https" || req.URL.Host != "rekor.sigstore.dev" || req.URL.Path != "/api/v1/log/entries/retrieve" || req.Method != http.MethodPost {
		return nil, errors.New("unexpected transparency log operation")
	}
	response, err := t.base.RoundTrip(req)
	if err != nil {
		return nil, err
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, (8<<20)+1))
	response.Body.Close()
	if err != nil || len(data) > 8<<20 {
		return nil, errors.New("transparency log response is unreadable or exceeds its size limit")
	}
	if response.StatusCode == http.StatusOK {
		if err := admitRekorResponse(data); err != nil {
			return nil, err
		}
	}
	response.Body = io.NopCloser(bytes.NewReader(data))
	response.ContentLength = int64(len(data))
	return response, nil
}

func admitRekorResponse(data []byte) error {
	var results []map[string]struct {
		Body string `json:"body"`
	}
	if err := json.Unmarshal(data, &results); err != nil || len(results) == 0 || len(results) > 64 {
		return errors.New("invalid or oversized transparency search result inventory")
	}
	count := 0
	for _, result := range results {
		for _, record := range result {
			count++
			if count > 64 {
				return errors.New("too many transparency search entries")
			}
			body, err := base64.StdEncoding.Strict().DecodeString(record.Body)
			if err != nil || len(body) == 0 || len(body) > 1<<20 {
				return errors.New("invalid or oversized transparency entry body")
			}
			var entry struct {
				Kind       string `json:"kind"`
				APIVersion string `json:"apiVersion"`
			}
			if err := json.Unmarshal(body, &entry); err != nil || entry.Kind != "hashedrekord" || entry.APIVersion != "0.0.1" {
				return errors.New("transparency entry is outside the detached X.509 hashedrekord contract")
			}
		}
	}
	if count == 0 {
		return errors.New("transparency search returned no entries")
	}
	return nil
}
