package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/settings"
	"github.com/floegence/redeven/internal/websearch"
)

func (c *cli) searchCmd(args []string) int {
	fs := newCLIFlagSet("search")

	provider := fs.String("provider", websearch.ProviderBrave, "Web search provider (default: brave)")
	count := fs.Int("count", 5, "Number of results to return (default: 5, max: 10)")
	format := fs.String("format", "json", "Output format: json|text (default: json)")
	stateRoot := fs.String("state-root", "", "State root override (default: $REDEVEN_STATE_ROOT or ~/.redeven)")
	configPath := fs.String("config-path", "", "Config path override")
	secretsPath := fs.String("secrets-path", "", "Secrets path (default: <config dir>/secrets.json)")
	timeout := fs.Duration("timeout", 15*time.Second, "Search timeout")

	if err := parseCommandFlags(fs, args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			writeText(c.stdout, searchHelpText())
			return 0
		}
		message, details := translateFlagParseError("search", err)
		writeErrorWithHelp(c.stderr, message, details, searchHelpText())
		return 2
	}

	query := strings.TrimSpace(strings.Join(fs.Args(), " "))
	if query == "" {
		writeErrorWithHelp(
			c.stderr,
			"missing search query for `redeven search`",
			[]string{"Example: redeven search \"redeven local ui bind\""},
			searchHelpText(),
		)
		return 2
	}

	if err := validateStateLayoutSelection(*configPath, *stateRoot); err != nil {
		writeErrorWithHelp(c.stderr, err.Error(), nil, searchHelpText())
		return 2
	}

	stateLayout, err := resolveSearchStateLayout(*configPath, *stateRoot)
	if err != nil {
		if errors.Is(err, config.ErrHomeDirUnavailable) {
			writeErrorWithHelp(
				c.stderr,
				fmt.Sprintf("failed to resolve search config path: %v", err),
				[]string{"Hint: export HOME before running `redeven search`, or pass --config-path <path>."},
				searchHelpText(),
			)
			return 1
		}
		fmt.Fprintf(c.stderr, "failed to resolve search config path: %v\n", err)
		return 1
	}
	secrets := strings.TrimSpace(*secretsPath)
	if secrets == "" {
		secrets = filepath.Join(stateLayout.StateDir, "secrets.json")
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
			fmt.Fprintf(c.stderr, "failed to load secrets: %v\n", err)
			return 1
		}
		if ok {
			key = v
		}
	}
	if strings.TrimSpace(key) == "" {
		fmt.Fprintf(c.stderr, "missing web search api key for provider %q\n", providerID)
		fmt.Fprintf(c.stderr, "Hint: set REDEVEN_BRAVE_API_KEY (or BRAVE_API_KEY), or configure it in Runtime Settings.\n")
		return 1
	}

	ctx, cancel := context.WithTimeout(context.Background(), *timeout)
	defer cancel()

	result, err := websearch.Search(ctx, providerID, key, websearch.SearchRequest{Query: query, Count: *count})
	if err != nil {
		fmt.Fprintf(c.stderr, "search failed: %v\n", err)
		return 1
	}

	switch strings.TrimSpace(strings.ToLower(*format)) {
	case "", "json":
		b, err := json.MarshalIndent(result, "", "  ")
		if err != nil {
			fmt.Fprintf(c.stderr, "failed to encode result: %v\n", err)
			return 1
		}
		fmt.Fprintf(c.stdout, "%s\n", string(b))
		return 0
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
				fmt.Fprintf(c.stdout, "%d. %s\n   %s\n   %s\n\n", i+1, title, url, snippet)
			} else {
				fmt.Fprintf(c.stdout, "%d. %s\n   %s\n\n", i+1, title, url)
			}
		}
		return 0
	default:
		writeErrorWithHelp(
			c.stderr,
			fmt.Sprintf("invalid value for `--format`: %s", strings.TrimSpace(*format)),
			[]string{"Allowed values: json, text.", "Example: redeven search --format text \"golang flag help\""},
			searchHelpText(),
		)
		return 2
	}
}

func resolveSearchStateLayout(configPath string, stateRoot string) (config.StateLayout, error) {
	cleanPath := strings.TrimSpace(configPath)
	if cleanPath == "" {
		return config.MachineStateLayout(stateRoot)
	}
	return config.StateLayoutForConfigPath(cleanPath)
}
