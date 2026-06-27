package okf

import (
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"
)

const (
	defaultSearchResults = 3
	maxSearchResults     = 8
	defaultBodyLimit     = 12000
	maxBodyLimit         = 20000
	minBodyLimit         = 1000
)

var (
	bundleOnce sync.Once
	bundleData Bundle
	bundleErr  error
)

func LoadEmbeddedBundle() (Bundle, error) {
	bundleOnce.Do(func() {
		payload, err := embeddedBundleBytes()
		if err != nil {
			bundleErr = err
			return
		}
		var bundle Bundle
		if err := json.Unmarshal(payload, &bundle); err != nil {
			bundleErr = fmt.Errorf("parse embedded bundle failed: %w", err)
			return
		}
		bundleData = bundle
	})
	if bundleErr != nil {
		return Bundle{}, bundleErr
	}
	return bundleData, nil
}

func Index(req IndexRequest) (IndexResult, error) {
	bundle, err := LoadEmbeddedBundle()
	if err != nil {
		return IndexResult{}, err
	}
	return IndexBundle(bundle, req), nil
}

func IndexBundle(bundle Bundle, req IndexRequest) IndexResult {
	sectionFilter := slugify(req.Section)
	sections := make([]IndexSection, 0, len(bundle.RootIndex.Sections))
	for _, section := range bundle.RootIndex.Sections {
		if sectionFilter != "" && slugify(section.Title) != sectionFilter && slugify(section.Slug) != sectionFilter {
			continue
		}
		sections = append(sections, cloneIndexSection(section))
	}
	return IndexResult{
		OKFVersion:    bundle.OKFVersion,
		TotalSections: len(bundle.RootIndex.Sections),
		Sections:      sections,
		Truncated:     false,
	}
}

func Search(req SearchRequest) (SearchResult, error) {
	bundle, err := LoadEmbeddedBundle()
	if err != nil {
		return SearchResult{}, err
	}
	return SearchBundle(bundle, req), nil
}

func SearchBundle(bundle Bundle, req SearchRequest) SearchResult {
	query := strings.TrimSpace(req.Query)
	maxResults := req.MaxResults
	if maxResults <= 0 {
		maxResults = defaultSearchResults
	}
	if maxResults > maxSearchResults {
		maxResults = maxSearchResults
	}
	typeFilter := strings.TrimSpace(req.Type)
	tagSet, normalizedTags := normalizeTagFilter(req.Tags)

	terms := tokenize(query)
	matches := make([]SearchMatch, 0, len(bundle.Concepts))
	for _, concept := range bundle.Concepts {
		if typeFilter != "" && !strings.EqualFold(strings.TrimSpace(concept.Type), typeFilter) {
			continue
		}
		if len(tagSet) > 0 && !hasAnyTag(concept.Tags, tagSet) {
			continue
		}
		score := scoreConcept(concept, terms)
		if len(terms) > 0 && score <= 0 {
			continue
		}
		matches = append(matches, SearchMatch{
			ConceptID:   concept.ConceptID,
			Path:        concept.Path,
			Type:        concept.Type,
			Title:       concept.Title,
			Description: concept.Description,
			Resource:    concept.Resource,
			Tags:        append([]string(nil), concept.Tags...),
			Snippet:     capText(concept.Snippet, 240),
			Score:       score,
		})
	}

	sort.Slice(matches, func(i, j int) bool {
		if matches[i].Score == matches[j].Score {
			return matches[i].ConceptID < matches[j].ConceptID
		}
		return matches[i].Score > matches[j].Score
	})
	truncated := len(matches) > maxResults
	if truncated {
		matches = matches[:maxResults]
	}

	return SearchResult{
		Query: query,
		Filters: SearchFilters{
			Type: typeFilter,
			Tags: normalizedTags,
		},
		TotalConcepts: len(bundle.Concepts),
		MatchCount:    len(matches),
		Matches:       matches,
		Truncated:     truncated,
	}
}

func Open(req OpenRequest) (OpenResult, error) {
	bundle, err := LoadEmbeddedBundle()
	if err != nil {
		return OpenResult{}, err
	}
	return OpenBundle(bundle, req)
}

func OpenBundle(bundle Bundle, req OpenRequest) (OpenResult, error) {
	conceptID := strings.TrimSpace(req.ConceptID)
	path := normalizeOKFPath(req.Path)
	if (conceptID == "" && path == "") || (conceptID != "" && path != "") {
		return OpenResult{}, errors.New("exactly one of concept_id or path is required")
	}
	concept, ok := findConcept(bundle, conceptID, path)
	if !ok {
		return OpenResult{}, errors.New("OKF concept not found")
	}
	body, offset, returned, truncated := bodyWindow(concept.Body, req.BodyOffset, req.BodyLimit)
	return OpenResult{
		Concept:            conceptSummary(concept),
		Body:               body,
		BodyOffset:         offset,
		BodyLength:         len([]rune(concept.Body)),
		ReturnedBodyLength: returned,
		Truncated:          truncated,
		Links:              append([]ConceptLink(nil), concept.Links...),
		Backlinks:          append([]ConceptLink(nil), concept.Backlinks...),
	}, nil
}

func findConcept(bundle Bundle, conceptID string, path string) (Concept, bool) {
	normalizedConceptID := strings.ReplaceAll(strings.TrimSpace(conceptID), "/", ".")
	for _, concept := range bundle.Concepts {
		if normalizedConceptID != "" && strings.EqualFold(strings.TrimSpace(concept.ConceptID), normalizedConceptID) {
			return concept, true
		}
		if path != "" && normalizeOKFPath(concept.Path) == path {
			return concept, true
		}
	}
	return Concept{}, false
}

func bodyWindow(body string, offset int, limit int) (string, int, int, bool) {
	runes := []rune(body)
	if offset < 0 {
		offset = 0
	}
	if offset > len(runes) {
		offset = len(runes)
	}
	if limit <= 0 {
		limit = defaultBodyLimit
	}
	if limit < minBodyLimit {
		limit = minBodyLimit
	}
	if limit > maxBodyLimit {
		limit = maxBodyLimit
	}
	end := offset + limit
	if end > len(runes) {
		end = len(runes)
	}
	out := string(runes[offset:end])
	return out, offset, len([]rune(out)), end < len(runes)
}

func normalizeTagFilter(tags []string) (map[string]struct{}, []string) {
	tagSet := make(map[string]struct{}, len(tags))
	out := make([]string, 0, len(tags))
	for _, tag := range tags {
		t := strings.ToLower(strings.TrimSpace(tag))
		if t == "" {
			continue
		}
		if _, exists := tagSet[t]; exists {
			continue
		}
		tagSet[t] = struct{}{}
		out = append(out, t)
	}
	sort.Strings(out)
	return tagSet, out
}

func cloneIndexSection(section IndexSection) IndexSection {
	out := IndexSection{
		Title:   section.Title,
		Slug:    section.Slug,
		Entries: make([]IndexEntry, 0, len(section.Entries)),
	}
	for _, entry := range section.Entries {
		cloned := entry
		cloned.Tags = append([]string(nil), entry.Tags...)
		out.Entries = append(out.Entries, cloned)
	}
	return out
}

func tokenize(input string) []string {
	input = strings.ToLower(strings.TrimSpace(input))
	if input == "" {
		return nil
	}
	parts := strings.FieldsFunc(input, func(r rune) bool {
		return !(r == '_' || r == '-' || (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9'))
	})
	out := make([]string, 0, len(parts))
	seen := make(map[string]struct{}, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		if _, exists := seen[part]; exists {
			continue
		}
		seen[part] = struct{}{}
		out = append(out, part)
	}
	return out
}

func hasAnyTag(tags []string, wanted map[string]struct{}) bool {
	for _, tag := range tags {
		if _, ok := wanted[strings.ToLower(strings.TrimSpace(tag))]; ok {
			return true
		}
	}
	return false
}

func scoreConcept(concept Concept, terms []string) int {
	if len(terms) == 0 {
		return 1
	}
	title := strings.ToLower(concept.Title)
	description := strings.ToLower(concept.Description)
	body := strings.ToLower(concept.Body)
	resource := strings.ToLower(concept.Resource)
	typ := strings.ToLower(concept.Type)
	score := 0
	for _, term := range terms {
		if strings.Contains(title, term) {
			score += 6
		}
		if strings.Contains(description, term) {
			score += 4
		}
		if strings.Contains(body, term) {
			score += 2
		}
		if strings.Contains(resource, term) {
			score += 2
		}
		if strings.Contains(typ, term) {
			score += 2
		}
		for _, tag := range concept.Tags {
			if strings.Contains(strings.ToLower(tag), term) {
				score += 3
				break
			}
		}
	}
	return score
}

func capText(value string, limit int) string {
	value = strings.TrimSpace(value)
	if limit <= 0 {
		return value
	}
	runes := []rune(value)
	if len(runes) <= limit {
		return value
	}
	return strings.TrimSpace(string(runes[:limit]))
}
