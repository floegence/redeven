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

func TestWebFetch_AllowsStructuredTextMIMEs(t *testing.T) {
	t.Parallel()

	for _, tc := range []struct {
		name        string
		contentType string
		body        string
	}{
		{
			name:        "json",
			contentType: "application/json; charset=utf-8",
			body:        `{"ok":true}`,
		},
		{
			name:        "xml",
			contentType: "application/xml",
			body:        `<root>ok</root>`,
		},
	} {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			r := newWebFetchTestRun(fakeWebFetchResolver{"example.com": {"93.184.216.34"}}, func(req *http.Request) (*http.Response, error) {
				return webFetchResponse(http.StatusOK, tc.contentType, tc.body), nil
			})
			out, err := r.toolWebFetch(context.Background(), webFetchArgs{URL: "https://example.com/data", Format: "text"})
			if err != nil {
				t.Fatalf("toolWebFetch: %v", err)
			}
			if out.Output != tc.body || out.ContentType != tc.contentType {
				t.Fatalf("output=%q contentType=%q, want %q %q", out.Output, out.ContentType, tc.body, tc.contentType)
			}
		})
	}
}

func TestWebFetch_BlocksLocalAndPrivateTargets(t *testing.T) {
	t.Parallel()

	cases := []string{
		"http://localhost/private",
		"http://127.0.0.1/private",
		"http://foo.localhost/private",
		"http://[::1]/private",
		"http://[fe80::1%25en0]/private",
		"http://[::ffff:127.0.0.1]/private",
		"http://[fc00::1]/private",
		"http://[fe80::1]/private",
		"http://[64:ff9b::7f00:1]/private",
		"http://169.254.169.254/latest/meta-data",
		"http://10.0.0.1/private",
		"http://100.64.0.1/private",
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

func TestWebFetch_BlocksHostWithMixedPublicAndPrivateDNS(t *testing.T) {
	t.Parallel()

	r := newWebFetchTestRun(fakeWebFetchResolver{
		"mixed.example": {"93.184.216.34", "10.0.0.10"},
	}, func(req *http.Request) (*http.Response, error) {
		t.Fatalf("transport should not be called for mixed DNS host")
		return nil, nil
	})

	if _, err := r.toolWebFetch(context.Background(), webFetchArgs{URL: "https://mixed.example/page", Format: "text"}); err == nil {
		t.Fatalf("expected mixed public/private DNS host to be blocked")
	}
}

func TestWebFetch_BlocksRedirectToPrivateTarget(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name     string
		location string
		resolver fakeWebFetchResolver
	}{
		{
			name:     "literal private ip",
			location: "http://127.0.0.1/private",
			resolver: fakeWebFetchResolver{
				"example.com": {"93.184.216.34"},
			},
		},
		{
			name:     "private dns",
			location: "http://private.example/private",
			resolver: fakeWebFetchResolver{
				"example.com":     {"93.184.216.34"},
				"private.example": {"10.0.0.5"},
			},
		},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			r := newWebFetchTestRun(tc.resolver, func(req *http.Request) (*http.Response, error) {
				return &http.Response{
					StatusCode: http.StatusFound,
					Header:     http.Header{"Location": []string{tc.location}},
					Body:       io.NopCloser(strings.NewReader("")),
				}, nil
			})

			if _, err := r.toolWebFetch(context.Background(), webFetchArgs{URL: "https://example.com/redirect", Format: "text"}); err == nil {
				t.Fatalf("expected redirect to private target to be blocked")
			}
		})
	}
}

func TestWebFetch_BlocksTooManyRedirects(t *testing.T) {
	t.Parallel()

	requests := 0
	r := newWebFetchTestRun(fakeWebFetchResolver{"example.com": {"93.184.216.34"}}, func(req *http.Request) (*http.Response, error) {
		requests++
		return &http.Response{
			StatusCode: http.StatusFound,
			Header:     http.Header{"Location": []string{"/redirect"}},
			Body:       io.NopCloser(strings.NewReader("")),
		}, nil
	})

	if _, err := r.toolWebFetch(context.Background(), webFetchArgs{URL: "https://example.com/redirect", Format: "text"}); err == nil || !strings.Contains(err.Error(), "too many redirects") {
		t.Fatalf("toolWebFetch error=%v, want too many redirects", err)
	}
	if requests != webFetchMaxRedirects+1 {
		t.Fatalf("requests=%d, want %d", requests, webFetchMaxRedirects+1)
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

	t.Run("streamed oversized with unknown length", func(t *testing.T) {
		t.Parallel()
		r := newWebFetchTestRun(fakeWebFetchResolver{"example.com": {"93.184.216.34"}}, func(req *http.Request) (*http.Response, error) {
			resp := webFetchResponse(http.StatusOK, "text/plain", strings.Repeat("x", int(webFetchMaxBodyBytes)+1))
			resp.ContentLength = -1
			return resp, nil
		})
		if _, err := r.toolWebFetch(context.Background(), webFetchArgs{URL: "https://example.com/unknown-large", Format: "text"}); err == nil {
			t.Fatalf("expected streamed oversized body with unknown length to fail")
		}
	})

	t.Run("streamed oversized with understated length", func(t *testing.T) {
		t.Parallel()
		r := newWebFetchTestRun(fakeWebFetchResolver{"example.com": {"93.184.216.34"}}, func(req *http.Request) (*http.Response, error) {
			resp := webFetchResponse(http.StatusOK, "text/plain", strings.Repeat("x", int(webFetchMaxBodyBytes)+1))
			resp.ContentLength = 5
			return resp, nil
		})
		if _, err := r.toolWebFetch(context.Background(), webFetchArgs{URL: "https://example.com/understated-large", Format: "text"}); err == nil {
			t.Fatalf("expected streamed oversized body with understated length to fail")
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

	t.Run("unsupported charset", func(t *testing.T) {
		t.Parallel()
		r := newWebFetchTestRun(fakeWebFetchResolver{"example.com": {"93.184.216.34"}}, func(req *http.Request) (*http.Response, error) {
			return webFetchResponse(http.StatusOK, "text/plain; charset=iso-8859-1", "hello"), nil
		})
		if _, err := r.toolWebFetch(context.Background(), webFetchArgs{URL: "https://example.com/latin1", Format: "text"}); err == nil || !strings.Contains(err.Error(), "unsupported charset") {
			t.Fatalf("toolWebFetch error=%v, want unsupported charset", err)
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
