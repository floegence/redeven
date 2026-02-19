package knowledge

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"sync"
)

type SearchRequest struct {
	Query      string
	MaxResults int
	Tags       []string
}

type SearchMatch struct {
	CardID      string   `json:"card_id"`
	Title       string   `json:"title"`
	Summary     string   `json:"summary"`
	Score       int      `json:"score"`
	Tags        []string `json:"tags,omitempty"`
	SourceRepos []string `json:"source_repos,omitempty"`
}

type SearchResult struct {
	Query      string        `json:"query"`
	TotalCards int           `json:"total_cards"`
	Matches    []SearchMatch `json:"matches"`
}

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
	matches := make([]SearchMatch, 0, len(bundle.Cards))
	for _, card := range bundle.Cards {
		if len(tagSet) > 0 && !hasAnyTag(card.Tags, tagSet) {
			continue
		}
		score := scoreCard(card, terms)
		if len(terms) > 0 && score <= 0 {
			continue
		}
		matches = append(matches, SearchMatch{
			CardID:      card.ID,
			Title:       card.Title,
			Summary:     card.Summary,
			Score:       score,
			Tags:        append([]string(nil), card.Tags...),
			SourceRepos: collectSourceRepos(card.Evidence),
		})
	}

	sort.Slice(matches, func(i, j int) bool {
		if matches[i].Score == matches[j].Score {
			return matches[i].CardID < matches[j].CardID
		}
		return matches[i].Score > matches[j].Score
	})
	if len(matches) > maxResults {
		matches = matches[:maxResults]
	}

	return SearchResult{
		Query:      query,
		TotalCards: len(bundle.Cards),
		Matches:    matches,
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

func scoreCard(card Card, terms []string) int {
	if len(terms) == 0 {
		return 1
	}
	title := strings.ToLower(card.Title)
	summary := strings.ToLower(card.Summary)
	mechanism := strings.ToLower(card.Mechanism)
	boundaries := strings.ToLower(card.Boundaries)
	status := strings.ToLower(card.Status)
	score := 0
	for _, term := range terms {
		if strings.Contains(title, term) {
			score += 6
		}
		if strings.Contains(summary, term) {
			score += 4
		}
		if strings.Contains(mechanism, term) {
			score += 2
		}
		if strings.Contains(boundaries, term) {
			score += 1
		}
		if strings.Contains(status, term) {
			score += 1
		}
		for _, tag := range card.Tags {
			if strings.Contains(strings.ToLower(tag), term) {
				score += 3
				break
			}
		}
	}
	return score
}

func collectSourceRepos(evidence []EvidenceRef) []string {
	if len(evidence) == 0 {
		return nil
	}
	seen := make(map[string]struct{}, len(evidence))
	out := make([]string, 0, len(evidence))
	for _, item := range evidence {
		repo := strings.TrimSpace(item.Repo)
		if repo == "" {
			continue
		}
		if _, ok := seen[repo]; ok {
			continue
		}
		seen[repo] = struct{}{}
		out = append(out, repo)
	}
	sort.Strings(out)
	if len(out) == 0 {
		return nil
	}
	return out
}
