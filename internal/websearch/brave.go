package websearch

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const (
	braveWebSearchEndpoint = "https://api.search.brave.com/res/v1/web/search"
	braveMaxBodyBytes      = 2 << 20 // 2 MiB (defensive)
)

type braveWebSearchResponse struct {
	Web struct {
		Results []struct {
			Title       string `json:"title"`
			URL         string `json:"url"`
			Description string `json:"description"`
		} `json:"results"`
	} `json:"web"`
}

func braveWebSearch(ctx context.Context, apiKey string, req SearchRequest) (SearchResult, error) {
	req = req.Normalize()
	if req.Query == "" {
		return SearchResult{}, errors.New("missing query")
	}

	endpoint, err := url.Parse(braveWebSearchEndpoint)
	if err != nil || endpoint == nil {
		return SearchResult{}, errors.New("invalid brave search endpoint")
	}
	q := endpoint.Query()
	q.Set("q", req.Query)
	q.Set("count", strconv.Itoa(req.Count))
	endpoint.RawQuery = q.Encode()

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint.String(), nil)
	if err != nil {
		return SearchResult{}, err
	}
	httpReq.Header.Set("Accept", "application/json")
	httpReq.Header.Set("X-Subscription-Token", strings.TrimSpace(apiKey))

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(httpReq)
	if err != nil {
		return SearchResult{}, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, braveMaxBodyBytes))
	if err != nil {
		return SearchResult{}, err
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		msg := strings.TrimSpace(string(body))
		if msg == "" {
			msg = fmt.Sprintf("brave web search failed (status %d)", resp.StatusCode)
		}
		return SearchResult{}, errors.New(msg)
	}

	var decoded braveWebSearchResponse
	if err := json.Unmarshal(body, &decoded); err != nil {
		return SearchResult{}, errors.New("invalid brave web search response")
	}

	results := make([]ResultItem, 0, len(decoded.Web.Results))
	for _, item := range decoded.Web.Results {
		u := strings.TrimSpace(item.URL)
		if u == "" {
			continue
		}
		title := strings.TrimSpace(item.Title)
		if title == "" {
			title = u
		}
		results = append(results, ResultItem{
			Title:   title,
			URL:     u,
			Snippet: strings.TrimSpace(item.Description),
		})
	}

	return SearchResult{
		Provider: ProviderBrave,
		Query:    req.Query,
		Results:  results,
		Sources:  append([]ResultItem(nil), results...),
	}, nil
}
