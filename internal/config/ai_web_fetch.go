package config

import (
	"fmt"
	"strings"
)

// AIProviderWebFetch overrides the product connection's default page reader.
type AIProviderWebFetch struct {
	Source string `json:"source"`
}

func (p AIProvider) WebFetchSource() string {
	if p.WebFetch == nil {
		if policy := ResolveAIWebSearchPolicy(p); policy.Enabled {
			return policy.DefaultFetchSource
		}
		return "direct"
	}
	return p.WebFetch.Source
}
func (p AIProvider) validateWebFetch() error {
	if p.WebFetch == nil {
		return nil
	}
	switch p.WebFetch.Source {
	case "direct":
		return nil
	case "deepseek":
		if strings.EqualFold(strings.TrimSpace(p.Type), "deepseek") {
			return nil
		}
	}
	return fmt.Errorf("invalid web_fetch.source %q for %s", p.WebFetch.Source, p.Type)
}
