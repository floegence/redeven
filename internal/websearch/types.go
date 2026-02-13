package websearch

import "strings"

const (
	ProviderBrave = "brave"
)

type SearchRequest struct {
	Query string
	Count int
}

func (r SearchRequest) Normalize() SearchRequest {
	out := r
	out.Query = strings.TrimSpace(out.Query)
	if out.Count <= 0 {
		out.Count = 5
	}
	if out.Count > 10 {
		out.Count = 10
	}
	return out
}

type ResultItem struct {
	Title   string `json:"title"`
	URL     string `json:"url"`
	Snippet string `json:"snippet,omitempty"`
}

type SearchResult struct {
	Provider string       `json:"provider"`
	Query    string       `json:"query"`
	Results  []ResultItem `json:"results"`
	Sources  []ResultItem `json:"sources,omitempty"`
}
