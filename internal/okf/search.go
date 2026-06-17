package okf

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"sync"
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

func Search(req SearchRequest) (SearchResult, error) {
	bundle, err := LoadEmbeddedBundle()
	if err != nil {
		return SearchResult{}, err
	}
	query := strings.TrimSpace(req.Query)
	maxResults := req.MaxResults
	if maxResults <= 0 {
		maxResults = 3
	}
	if maxResults > 8 {
		maxResults = 8
	}
	tagSet := make(map[string]struct{}, len(req.Tags))
	for _, tag := range req.Tags {
		t := strings.ToLower(strings.TrimSpace(tag))
		if t == "" {
			continue
		}
		tagSet[t] = struct{}{}
	}

	terms := tokenize(query)
	matches := make([]SearchMatch, 0, len(bundle.Concepts))
	for _, concept := range bundle.Concepts {
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
			Snippet:     concept.Snippet,
			Score:       score,
		})
	}

	sort.Slice(matches, func(i, j int) bool {
		if matches[i].Score == matches[j].Score {
			return matches[i].ConceptID < matches[j].ConceptID
		}
		return matches[i].Score > matches[j].Score
	})
	if len(matches) > maxResults {
		matches = matches[:maxResults]
	}

	return SearchResult{
		Query:         query,
		TotalConcepts: len(bundle.Concepts),
		Matches:       matches,
	}, nil
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
