package agentplugins

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/url"
	"strings"

	"github.com/google/uuid"
)

type CatalogEntry struct {
	ID     string `json:"id"`
	Source Source `json:"source"`
}
type Catalog struct {
	Schema  string         `json:"schema_version"`
	ID      string         `json:"id"`
	Plugins []CatalogEntry `json:"plugins"`
}

func DecodeCatalog(b []byte) (Catalog, error) {
	c := Catalog{}
	d := json.NewDecoder(bytes.NewReader(b))
	d.DisallowUnknownFields()
	if e := d.Decode(&c); e != nil {
		return c, e
	}
	if d.Decode(new(any)) != io.EOF || c.Schema != "flower.agent_plugin_catalog.v1" || !pluginName.MatchString(c.ID) || c.Plugins == nil || len(c.Plugins) > 128 {
		return c, errors.New("invalid_catalog")
	}
	seen := map[string]bool{}
	for _, entry := range c.Plugins {
		if entry.ID == "" || len(entry.ID) > 128 || seen[entry.ID] || entry.Source.Type != "github" {
			return c, errors.New("invalid_catalog_entry")
		}
		if _, e := entry.Source.Normalize(); e != nil {
			return c, e
		}
		seen[entry.ID] = true
	}
	return c, nil
}
func (m *Manager) Sources() ([]CatalogSource, int64) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return append([]CatalogSource{}, m.state.Sources...), m.state.Revision
}
func (m *Manager) AddSource(ctx context.Context, raw string, revision int64) (CatalogSource, error) {
	u, e := url.Parse(strings.TrimSpace(raw))
	if e != nil || u.Scheme != "https" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return CatalogSource{}, errors.New("invalid_catalog_url")
	}
	b, e := get(ctx, m.http, u.String(), MaxConfigBytes)
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
	for _, s := range m.state.Sources {
		if s.URL == u.String() {
			return s, nil
		}
	}
	source := CatalogSource{ID: uuid.NewString(), URL: u.String(), Name: catalog.ID}
	next := cloneState(m.state)
	next.Sources = append(next.Sources, source)
	return source, m.saveLocked(next)
}
func (m *Manager) RemoveSource(id string, revision int64) error {
	m.mu.Lock()
	defer m.mu.Unlock()
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
	for _, s := range m.state.Sources {
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
