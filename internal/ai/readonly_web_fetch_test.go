package ai

import (
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"strings"
	"testing"
)

type fakeWebFetchResolver map[string][]string

func (r fakeWebFetchResolver) LookupIPAddr(ctx context.Context, host string) ([]net.IPAddr, error) {
	values, ok := r[host]
	if !ok {
		return nil, errors.New("host not found")
	}
	out := make([]net.IPAddr, 0, len(values))
	for _, value := range values {
		ip := net.ParseIP(value)
		if ip == nil {
			return nil, errors.New("invalid fake ip")
		}
		out = append(out, net.IPAddr{IP: ip})
	}
	return out, nil
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req)
}

func newWebFetchTestRun(resolver fakeWebFetchResolver, rt roundTripFunc) *run {
	return &run{
		webFetchResolver: resolver,
		webFetchHTTPClient: &http.Client{
			Transport: rt,
			CheckRedirect: func(req *http.Request, via []*http.Request) error {
				return http.ErrUseLastResponse
			},
		},
	}
}

func webFetchResponse(status int, contentType string, body string) *http.Response {
	return &http.Response{
		StatusCode:    status,
		Header:        http.Header{"Content-Type": []string{contentType}},
		Body:          io.NopCloser(strings.NewReader(body)),
		ContentLength: int64(len(body)),
	}
}

func TestWebFetch_AllowsPublicTextAndStripsHTMLActiveContent(t *testing.T) {
	t.Parallel()

	var gotAcceptEncoding string
	r := newWebFetchTestRun(fakeWebFetchResolver{"example.com": {"93.184.216.34"}}, func(req *http.Request) (*http.Response, error) {
		gotAcceptEncoding = req.Header.Get("Accept-Encoding")
		if proxy := req.Header.Get("Proxy-Authorization"); proxy != "" {
			t.Fatalf("unexpected proxy auth header %q", proxy)
		}
		return webFetchResponse(http.StatusOK, "text/html; charset=utf-8", "<h1>Hello</h1><script>bad()</script><p>world</p>"), nil
	})

	out, err := r.toolWebFetch(context.Background(), webFetchArgs{URL: "https://example.com/page", Format: "text"})
	if err != nil {
		t.Fatalf("toolWebFetch: %v", err)
	}
	if out.FinalURL != "https://example.com/page" || out.ContentType != "text/html; charset=utf-8" {
		t.Fatalf("metadata=%+v", out)
	}
	if strings.Contains(out.Output, "bad") || !strings.Contains(out.Output, "Hello") || !strings.Contains(out.Output, "world") {
		t.Fatalf("output=%q, want safe visible text", out.Output)
	}
	if gotAcceptEncoding != "identity" {
		t.Fatalf("Accept-Encoding=%q, want identity", gotAcceptEncoding)
	}
}

func TestWebFetch_BlocksLocalAndPrivateTargets(t *testing.T) {
	t.Parallel()

	cases := []string{
		"http://localhost/private",
		"http://127.0.0.1/private",
		"http://[::1]/private",
		"http://[::ffff:127.0.0.1]/private",
		"http://169.254.169.254/latest/meta-data",
		"http://10.0.0.1/private",
		"http://2130706433/private",
		"http://0177.0.0.1/private",
		"http://0x7f000001/private",
	}
	for _, rawURL := range cases {
		rawURL := rawURL
		t.Run(rawURL, func(t *testing.T) {
			t.Parallel()
			r := newWebFetchTestRun(fakeWebFetchResolver{}, func(req *http.Request) (*http.Response, error) {
				t.Fatalf("transport should not be called for %s", rawURL)
				return nil, nil
			})
			if _, err := r.toolWebFetch(context.Background(), webFetchArgs{URL: rawURL, Format: "text"}); err == nil {
				t.Fatalf("expected %s to be blocked", rawURL)
			}
		})
	}
}

func TestWebFetch_BlocksRedirectToPrivateTarget(t *testing.T) {
	t.Parallel()

	r := newWebFetchTestRun(fakeWebFetchResolver{
		"example.com": {"93.184.216.34"},
	}, func(req *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusFound,
			Header:     http.Header{"Location": []string{"http://127.0.0.1/private"}},
			Body:       io.NopCloser(strings.NewReader("")),
		}, nil
	})

	if _, err := r.toolWebFetch(context.Background(), webFetchArgs{URL: "https://example.com/redirect", Format: "text"}); err == nil {
		t.Fatalf("expected redirect to private target to be blocked")
	}
}

func TestWebFetch_RejectsOversizedAndNonTextBodies(t *testing.T) {
	t.Parallel()

	t.Run("declared oversized", func(t *testing.T) {
		t.Parallel()
		r := newWebFetchTestRun(fakeWebFetchResolver{"example.com": {"93.184.216.34"}}, func(req *http.Request) (*http.Response, error) {
			resp := webFetchResponse(http.StatusOK, "text/plain", "small")
			resp.ContentLength = webFetchMaxBodyBytes + 1
			return resp, nil
		})
		if _, err := r.toolWebFetch(context.Background(), webFetchArgs{URL: "https://example.com/large", Format: "text"}); err == nil {
			t.Fatalf("expected declared oversized body to fail")
		}
	})

	t.Run("non text", func(t *testing.T) {
		t.Parallel()
		r := newWebFetchTestRun(fakeWebFetchResolver{"example.com": {"93.184.216.34"}}, func(req *http.Request) (*http.Response, error) {
			return webFetchResponse(http.StatusOK, "application/pdf", "%PDF"), nil
		})
		if _, err := r.toolWebFetch(context.Background(), webFetchArgs{URL: "https://example.com/file.pdf", Format: "text"}); err == nil {
			t.Fatalf("expected non-text MIME to fail")
		}
	})
}

func TestWebFetch_RejectsBadSchemesUserinfoAndPortsBeforeTransport(t *testing.T) {
	t.Parallel()

	cases := []string{
		"file:///etc/passwd",
		"https://user:pass@example.com/",
		"https://example.com:8443/",
	}
	for _, rawURL := range cases {
		rawURL := rawURL
		t.Run(rawURL, func(t *testing.T) {
			t.Parallel()
			r := newWebFetchTestRun(fakeWebFetchResolver{"example.com": {"93.184.216.34"}}, func(req *http.Request) (*http.Response, error) {
				t.Fatalf("transport should not be called for %s", rawURL)
				return nil, nil
			})
			if _, err := r.toolWebFetch(context.Background(), webFetchArgs{URL: rawURL, Format: "text"}); err == nil {
				t.Fatalf("expected %s to fail", rawURL)
			}
		})
	}
}
