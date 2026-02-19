package knowledge

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"gopkg.in/yaml.v3"
)

var evidenceLinePattern = regexp.MustCompile(`^-\s*([^:\n]+):(\d+)(?:\s*-\s*(.+))?$`)

type cardFrontmatter struct {
	ID           string   `yaml:"id"`
	Version      int      `yaml:"version"`
	Title        string   `yaml:"title"`
	Status       string   `yaml:"status"`
	Owners       []string `yaml:"owners"`
	Tags         []string `yaml:"tags"`
	SourceCardID string   `yaml:"source_card_id"`
	SourceCommit string   `yaml:"source_commit"`
}

type topicIndexFile struct {
	Topics map[string][]string `yaml:"topics"`
}

type codeIndexFile struct {
	Paths map[string][]string `yaml:"paths"`
}

func LoadGeneratedCards(generatedRoot string) ([]Card, error) {
	root := strings.TrimSpace(generatedRoot)
	if root == "" {
		return nil, fmt.Errorf("missing generated root")
	}
	cardsDir := filepath.Join(root, "cards")
	entries, err := os.ReadDir(cardsDir)
	if err != nil {
		return nil, err
	}

	cards := make([]Card, 0, len(entries))
	seen := make(map[string]struct{}, len(entries))
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		if strings.ToLower(filepath.Ext(entry.Name())) != ".md" {
			continue
		}
		path := filepath.Join(cardsDir, entry.Name())
		card, err := ParseGeneratedCardMarkdown(path)
		if err != nil {
			return nil, err
		}
		if card.ID == "" {
			return nil, fmt.Errorf("%s: missing card id", path)
		}
		if _, exists := seen[card.ID]; exists {
			return nil, fmt.Errorf("duplicate card id: %s", card.ID)
		}
		seen[card.ID] = struct{}{}
		cards = append(cards, card)
	}

	sort.Slice(cards, func(i, j int) bool { return cards[i].ID < cards[j].ID })
	if len(cards) == 0 {
		return nil, fmt.Errorf("no generated cards found under %s", cardsDir)
	}
	return cards, nil
}

func ParseGeneratedCardMarkdown(path string) (Card, error) {
	content, err := os.ReadFile(path)
	if err != nil {
		return Card{}, err
	}
	fmRaw, body, err := splitFrontmatter(string(content))
	if err != nil {
		return Card{}, fmt.Errorf("%s: %w", path, err)
	}

	var fm cardFrontmatter
	if err := yaml.Unmarshal([]byte(fmRaw), &fm); err != nil {
		return Card{}, fmt.Errorf("%s: invalid frontmatter: %w", path, err)
	}

	sections := parseSections(body)
	summary := strings.TrimSpace(strings.Join(sections["Conclusion"], "\n"))
	mechanism := strings.TrimSpace(strings.Join(sections["Mechanism"], "\n"))
	boundaries := strings.TrimSpace(strings.Join(sections["Boundaries"], "\n"))
	invalidConditions := strings.TrimSpace(strings.Join(sections["Invalid Conditions"], "\n"))
	evidence, err := parseEvidenceSection(sections["Evidence"], path)
	if err != nil {
		return Card{}, err
	}
	if summary == "" || mechanism == "" || boundaries == "" || invalidConditions == "" {
		return Card{}, fmt.Errorf("%s: missing required section content", path)
	}
	if len(evidence) == 0 {
		return Card{}, fmt.Errorf("%s: evidence section must contain at least one entry", path)
	}
	if strings.TrimSpace(fm.ID) == "" {
		return Card{}, fmt.Errorf("%s: missing id", path)
	}
	if strings.TrimSpace(fm.Title) == "" {
		return Card{}, fmt.Errorf("%s: missing title", path)
	}
	if fm.Version <= 0 {
		return Card{}, fmt.Errorf("%s: invalid version", path)
	}

	return Card{
		ID:                strings.TrimSpace(fm.ID),
		Version:           fm.Version,
		Title:             strings.TrimSpace(fm.Title),
		Status:            strings.TrimSpace(fm.Status),
		Owners:            normalizeStringList(fm.Owners),
		Tags:              normalizeStringList(fm.Tags),
		Summary:           summary,
		Mechanism:         mechanism,
		Boundaries:        boundaries,
		InvalidConditions: invalidConditions,
		Evidence:          evidence,
		SourceCardID:      strings.TrimSpace(fm.SourceCardID),
		SourceCommit:      strings.TrimSpace(fm.SourceCommit),
	}, nil
}

func LoadGeneratedIndices(generatedRoot string) (Indices, error) {
	root := strings.TrimSpace(generatedRoot)
	if root == "" {
		return Indices{}, fmt.Errorf("missing generated root")
	}
	topicPath := filepath.Join(root, "indices", "topic_index.yaml")
	codePath := filepath.Join(root, "indices", "code_index.yaml")

	topicRaw, err := os.ReadFile(topicPath)
	if err != nil {
		return Indices{}, err
	}
	codeRaw, err := os.ReadFile(codePath)
	if err != nil {
		return Indices{}, err
	}

	var topics topicIndexFile
	if err := yaml.Unmarshal(topicRaw, &topics); err != nil {
		return Indices{}, fmt.Errorf("parse %s failed: %w", topicPath, err)
	}
	var codes codeIndexFile
	if err := yaml.Unmarshal(codeRaw, &codes); err != nil {
		return Indices{}, fmt.Errorf("parse %s failed: %w", codePath, err)
	}

	out := Indices{
		Topics:    make(map[string][]string, len(topics.Topics)),
		CodePaths: make(map[string][]string, len(codes.Paths)),
	}
	for key, ids := range topics.Topics {
		normalizedKey := strings.TrimSpace(key)
		if normalizedKey == "" {
			continue
		}
		out.Topics[normalizedKey] = normalizeStringList(ids)
	}
	for key, ids := range codes.Paths {
		normalizedKey := strings.TrimSpace(key)
		if normalizedKey == "" {
			continue
		}
		out.CodePaths[normalizedKey] = normalizeStringList(ids)
	}
	return out, nil
}

func splitFrontmatter(content string) (string, string, error) {
	trimmed := strings.ReplaceAll(content, "\r\n", "\n")
	if !strings.HasPrefix(trimmed, "---\n") {
		return "", "", fmt.Errorf("missing frontmatter start")
	}
	rest := trimmed[len("---\n"):]
	idx := strings.Index(rest, "\n---\n")
	if idx < 0 {
		return "", "", fmt.Errorf("missing frontmatter end")
	}
	frontmatter := rest[:idx]
	body := rest[idx+len("\n---\n"):]
	return frontmatter, body, nil
}

func parseSections(body string) map[string][]string {
	lines := strings.Split(strings.ReplaceAll(body, "\r\n", "\n"), "\n")
	sections := make(map[string][]string)
	current := ""
	for _, line := range lines {
		if strings.HasPrefix(line, "## ") {
			current = strings.TrimSpace(strings.TrimPrefix(line, "## "))
			if current != "" {
				sections[current] = make([]string, 0, 8)
			}
			continue
		}
		if current == "" {
			continue
		}
		sections[current] = append(sections[current], line)
	}
	for key, values := range sections {
		sections[key] = trimEmptyLines(values)
	}
	return sections
}

func parseEvidenceSection(lines []string, sourcePath string) ([]EvidenceRef, error) {
	out := make([]EvidenceRef, 0, len(lines))
	for _, raw := range lines {
		line := strings.TrimSpace(raw)
		if line == "" {
			continue
		}
		matches := evidenceLinePattern.FindStringSubmatch(line)
		if len(matches) == 0 {
			return nil, fmt.Errorf("%s: invalid evidence entry: %s", sourcePath, line)
		}
		lineNo := 0
		if _, err := fmt.Sscanf(matches[2], "%d", &lineNo); err != nil || lineNo <= 0 {
			return nil, fmt.Errorf("%s: invalid evidence line: %s", sourcePath, line)
		}
		note := strings.TrimSpace(matches[3])
		out = append(out, EvidenceRef{Path: strings.TrimSpace(matches[1]), Line: lineNo, Note: note})
	}
	return out, nil
}

func trimEmptyLines(lines []string) []string {
	start := 0
	for start < len(lines) && strings.TrimSpace(lines[start]) == "" {
		start++
	}
	end := len(lines)
	for end > start && strings.TrimSpace(lines[end-1]) == "" {
		end--
	}
	if start >= end {
		return nil
	}
	out := make([]string, 0, end-start)
	for _, line := range lines[start:end] {
		out = append(out, strings.TrimRight(line, " \t"))
	}
	return out
}

func normalizeStringList(items []string) []string {
	if len(items) == 0 {
		return nil
	}
	seen := make(map[string]struct{}, len(items))
	out := make([]string, 0, len(items))
	for _, item := range items {
		value := strings.TrimSpace(item)
		if value == "" {
			continue
		}
		if _, exists := seen[value]; exists {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	sort.Strings(out)
	if len(out) == 0 {
		return nil
	}
	return out
}
