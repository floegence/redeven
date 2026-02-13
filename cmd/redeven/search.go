package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/floegence/redeven-agent/internal/config"
	"github.com/floegence/redeven-agent/internal/settings"
	"github.com/floegence/redeven-agent/internal/websearch"
)

func searchCmd(args []string) {
	fs := flag.NewFlagSet("search", flag.ExitOnError)

	provider := fs.String("provider", websearch.ProviderBrave, "Web search provider (default: brave)")
	count := fs.Int("count", 5, "Number of results to return (default: 5, max: 10)")
	format := fs.String("format", "json", "Output format: json|text (default: json)")
	configPath := fs.String("config-path", "", "Config path (default: ~/.redeven/config.json)")
	secretsPath := fs.String("secrets-path", "", "Secrets path (default: <config dir>/secrets.json)")
	timeout := fs.Duration("timeout", 15*time.Second, "Search timeout")

	_ = fs.Parse(args)

	query := strings.TrimSpace(strings.Join(fs.Args(), " "))
	if query == "" {
		fs.Usage()
		os.Exit(2)
	}

	cfgPath := strings.TrimSpace(*configPath)
	if cfgPath == "" {
		cfgPath = config.DefaultConfigPath()
	}
	secrets := strings.TrimSpace(*secretsPath)
	if secrets == "" {
		secrets = filepath.Join(filepath.Dir(filepath.Clean(cfgPath)), "secrets.json")
	}

	providerID := strings.TrimSpace(strings.ToLower(*provider))
	if providerID == "" {
		providerID = websearch.ProviderBrave
	}

	key := ""
	if providerID == websearch.ProviderBrave {
		key = strings.TrimSpace(os.Getenv("REDEVEN_BRAVE_API_KEY"))
		if key == "" {
			key = strings.TrimSpace(os.Getenv("BRAVE_API_KEY"))
		}
	}
	if key == "" {
		store := settings.NewSecretsStore(secrets)
		v, ok, err := store.GetWebSearchProviderAPIKey(providerID)
		if err != nil {
			fmt.Fprintf(os.Stderr, "failed to load secrets: %v\n", err)
			os.Exit(1)
		}
		if ok {
			key = v
		}
	}
	if strings.TrimSpace(key) == "" {
		fmt.Fprintf(os.Stderr, "missing web search api key for provider %q\n", providerID)
		fmt.Fprintf(os.Stderr, "Hint: set REDEVEN_BRAVE_API_KEY (or BRAVE_API_KEY), or configure it in the agent Settings.\n")
		os.Exit(1)
	}

	ctx, cancel := context.WithTimeout(context.Background(), *timeout)
	defer cancel()

	result, err := websearch.Search(ctx, providerID, key, websearch.SearchRequest{Query: query, Count: *count})
	if err != nil {
		fmt.Fprintf(os.Stderr, "search failed: %v\n", err)
		os.Exit(1)
	}

	switch strings.TrimSpace(strings.ToLower(*format)) {
	case "", "json":
		b, err := json.MarshalIndent(result, "", "  ")
		if err != nil {
			fmt.Fprintf(os.Stderr, "failed to encode result: %v\n", err)
			os.Exit(1)
		}
		fmt.Printf("%s\n", string(b))
	case "text":
		for i, item := range result.Results {
			url := strings.TrimSpace(item.URL)
			if url == "" {
				continue
			}
			title := strings.TrimSpace(item.Title)
			if title == "" {
				title = url
			}
			if snippet := strings.TrimSpace(item.Snippet); snippet != "" {
				fmt.Printf("%d. %s\n   %s\n   %s\n\n", i+1, title, url, snippet)
			} else {
				fmt.Printf("%d. %s\n   %s\n\n", i+1, title, url)
			}
		}
	default:
		fmt.Fprintf(os.Stderr, "invalid --format: %q (want json|text)\n", strings.TrimSpace(*format))
		os.Exit(2)
	}
}
