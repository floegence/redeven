package websearch

import (
	"context"
	"errors"
	"fmt"
	"strings"
)

func Search(ctx context.Context, provider string, apiKey string, req SearchRequest) (SearchResult, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	provider = strings.TrimSpace(strings.ToLower(provider))
	if provider == "" {
		provider = ProviderBrave
	}

	apiKey = strings.TrimSpace(apiKey)
	if apiKey == "" {
		return SearchResult{}, errors.New("missing web search api key")
	}

	req = req.Normalize()
	if req.Query == "" {
		return SearchResult{}, errors.New("missing query")
	}

	switch provider {
	case ProviderBrave:
		return braveWebSearch(ctx, apiKey, req)
	default:
		return SearchResult{}, fmt.Errorf("unsupported web search provider %q", provider)
	}
}
