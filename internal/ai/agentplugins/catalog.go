package agentplugins

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/url"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
)

type CatalogEntry struct {
	ID      string          `json:"id"`
	Source  Source          `json:"source"`
	Display *CatalogDisplay `json:"display,omitempty"`
}

// CatalogDisplay is untrusted presentation metadata, never installation authority.
// Only this namespace accepts additive fields; they are discarded on decoding.
type CatalogDisplay struct {
	Name        string `json:"name,omitempty"`
	Description string `json:"description,omitempty"`
	Author      string `json:"author,omitempty"`
}

func (d *CatalogDisplay) UnmarshalJSON(data []byte) error {
	type display CatalogDisplay
	var value display
	if err := json.Unmarshal(data, &value); err != nil {
		return err
	}
	if !catalogText(value.Name, 128) || !catalogText(value.Description, 512) || !catalogText(value.Author, 128) {
		return errors.New("invalid_catalog_display")
	}
	*d = CatalogDisplay(value)
	return nil
}
func catalogText(value string, limit int) bool {
	return utf8.ValidString(value) && utf8.RuneCountInString(value) <= limit && !strings.ContainsAny(value, "\x00\r\n")
}

type Catalog struct {
	Schema  string         `json:"schema_version"`
	ID      string         `json:"id"`
	Plugins []CatalogEntry `json:"plugins"`
}

func DecodeCatalog(b []byte) (Catalog, error) {
	c := Catalog{}
	if len(b) > MaxConfigBytes {
		return c, errors.New("invalid_catalog")
	}
	d := json.NewDecoder(bytes.NewReader(b))
	d.DisallowUnknownFields()
	if e := d.Decode(&c); e != nil {
		return c, e
	}
	if d.Decode(new(any)) != io.EOF || c.Schema != "flower.agent_plugin_catalog.v1" || !pluginName.MatchString(c.ID) || c.Plugins == nil || len(c.Plugins) > 128 {
		return c, errors.New("invalid_catalog")
	}
	seen := map[string]bool{}
	for i, entry := range c.Plugins {
		if !pluginName.MatchString(entry.ID) || len(entry.ID) > 128 || seen[entry.ID] || entry.Source.Type != "github" {
			return c, errors.New("invalid_catalog_entry")
		}
		source, e := entry.Source.Normalize()
		if e != nil {
			return c, e
		}
		c.Plugins[i].Source = source
		seen[entry.ID] = true
	}
	return c, nil
}
func (m *Manager) Sources() ([]CatalogSource, int64) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.sourcesLocked(), m.state.Revision
}
func (m *Manager) sourcesLocked() []CatalogSource {
	sources := append([]CatalogSource{}, m.configuredSources...)
	urls := map[string]bool{}
	for _, source := range sources {
		urls[source.URL] = true
	}
	for _, source := range m.state.Sources {
		if !urls[source.URL] {
			sources = append(sources, source)
		}
	}
	return sources
}
func catalogURL(raw string) (string, error) {
	u, e := url.Parse(strings.TrimSpace(raw))
	if e != nil || u.Scheme != "https" || u.Hostname() == "" || u.User != nil || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" {
		return "", errors.New("invalid_catalog_url")
	}
	return u.String(), nil
}
func (m *Manager) AddSource(ctx context.Context, raw string, revision int64) (CatalogSource, error) {
	address, e := catalogURL(raw)
	if e != nil {
		return CatalogSource{}, e
	}
	b, e := get(ctx, m.http, address, MaxConfigBytes)
	if e != nil {
		return CatalogSource{}, e
	}
	catalog, e := DecodeCatalog(b)
	if e != nil {
		return CatalogSource{}, e
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.state.Revision != revision {
		return CatalogSource{}, ErrConflict
	}
	if len(m.state.Sources) >= 16 {
		return CatalogSource{}, errors.New("source_limit")
	}
	for _, s := range m.sourcesLocked() {
		if s.URL == address {
			return s, nil
		}
	}
	source := CatalogSource{ID: uuid.NewString(), URL: address, Name: catalog.ID}
	next := cloneState(m.state)
	next.Sources = append(next.Sources, source)
	return source, m.saveLocked(next)
}
func (m *Manager) RemoveSource(id string, revision int64) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, source := range m.configuredSources {
		if source.ID == id {
			return errors.New("catalog_source_managed")
		}
	}
	if m.state.Revision != revision {
		return ErrConflict
	}
	next := cloneState(m.state)
	for i, s := range next.Sources {
		if s.ID == id {
			next.Sources = append(next.Sources[:i], next.Sources[i+1:]...)
			return m.saveLocked(next)
		}
	}
	return ErrUnavailable
}
func (m *Manager) ReadCatalog(ctx context.Context, id string) (Catalog, error) {
	m.mu.Lock()
	raw := ""
	for _, s := range m.sourcesLocked() {
		if s.ID == id {
			raw = s.URL
		}
	}
	m.mu.Unlock()
	if raw == "" {
		return Catalog{}, ErrUnavailable
	}
	b, e := get(ctx, m.http, raw, MaxConfigBytes)
	if e != nil {
		return Catalog{}, e
	}
	return DecodeCatalog(b)
}
