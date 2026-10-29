package agentplugins

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"strings"
)

// CatalogConfig belongs to runtime configuration, not the installation registry.
type CatalogConfig struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	URL  string `json:"url"`
}

// ParseCatalogConfig is deliberately opt-in. An unset value performs no discovery.
func ParseCatalogConfig(raw string) ([]CatalogConfig, error) {
	if len(raw) > MaxConfigBytes {
		return nil, errors.New("invalid_catalog_config")
	}
	if strings.TrimSpace(raw) == "" {
		return nil, nil
	}
	var sources []CatalogConfig
	decoder := json.NewDecoder(bytes.NewBufferString(raw))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&sources) != nil || sources == nil || decoder.Decode(new(any)) != io.EOF {
		return nil, errors.New("invalid_catalog_config")
	}
	if _, err := configuredCatalogSources(sources); err != nil {
		return nil, err
	}
	return sources, nil
}

func configuredCatalogSources(config []CatalogConfig) ([]CatalogSource, error) {
	if len(config) > 16 {
		return nil, errors.New("invalid_catalog_config")
	}
	sources := make([]CatalogSource, 0, len(config))
	ids, urls := map[string]bool{}, map[string]bool{}
	for _, item := range config {
		address, err := catalogURL(item.URL)
		if err != nil || !pluginName.MatchString(item.ID) || len(item.ID) > 128 || ids[item.ID] || urls[address] || strings.TrimSpace(item.Name) == "" || !catalogText(item.Name, 128) {
			return nil, errors.New("invalid_catalog_config")
		}
		ids[item.ID], urls[address] = true, true
		sources = append(sources, CatalogSource{ID: "configured:" + item.ID, Name: item.Name, URL: address, Managed: true})
	}
	return sources, nil
}
