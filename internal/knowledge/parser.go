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

var evidenceLinePattern = regexp.MustCompile(`^-\s*([a-z0-9][a-z0-9_.-]*):([^:\n]+):(\d+)(?:\s*-\s*(.+))?$`)

type cardFrontmatter struct {
	ID           string   `yaml:"id"`
	Version      int      `yaml:"version"`
	Title        string   `yaml:"title"`
	Status       string   `yaml:"status"`
	Owners       []string `yaml:"owners"`
	Tags         []string `yaml:"tags"`
	SourceCardID string   `yaml:"source_card_id"`
}

type topicIndexFile struct {
	Topics map[string][]string `yaml:"topics"`
}

type codeIndexFile struct {
	Paths map[string][]string `yaml:"paths"`
}

func LoadSourceManifest(sourceRoot string) (SourceManifest, []byte, error) {
	root := strings.TrimSpace(sourceRoot)
	if root == "" {
		return SourceManifest{}, nil, fmt.Errorf("missing source root")
	}
	path := filepath.Join(root, "manifest.yaml")
	raw, err := os.ReadFile(path)
	if err != nil {
		return SourceManifest{}, nil, err
	}
	var manifest SourceManifest
	if err := yaml.Unmarshal(raw, &manifest); err != nil {
		return SourceManifest{}, nil, fmt.Errorf("parse %s failed: %w", path, err)
	}
	if manifest.SchemaVersion != SchemaVersion {
		return SourceManifest{}, nil, fmt.Errorf("manifest schema_version must be %d", SchemaVersion)
	}
	manifest.KnowledgeID = strings.TrimSpace(manifest.KnowledgeID)
	manifest.KnowledgeName = strings.TrimSpace(manifest.KnowledgeName)
	manifest.UpdatedAt = strings.TrimSpace(manifest.UpdatedAt)
	if manifest.KnowledgeID == "" || manifest.KnowledgeName == "" {
		return SourceManifest{}, nil, fmt.Errorf("manifest requires knowledge_id and knowledge_name")
	}
	if manifest.UpdatedAt == "" {
		return SourceManifest{}, nil, fmt.Errorf("manifest requires updated_at")
	}
	manifest.AllowedRepos = normalizeStringList(manifest.AllowedRepos)
	if len(manifest.AllowedRepos) == 0 {
		return SourceManifest{}, nil, fmt.Errorf("manifest requires allowed_repos")
	}
	for _, repo := range manifest.AllowedRepos {
		if strings.EqualFold(repo, "redeven") {
			return SourceManifest{}, nil, fmt.Errorf("allowed_repos must not contain redeven")
		}
	}
	if len(manifest.SourceRefs) > 0 {
		next := make(map[string]string, len(manifest.SourceRefs))
		for repo, ref := range manifest.SourceRefs {
			repo = strings.TrimSpace(repo)
			ref = strings.TrimSpace(ref)
			if repo == "" || ref == "" {
				continue
			}
			next[repo] = ref
		}
		manifest.SourceRefs = next
	}
	return manifest, raw, nil
}

func LoadSourceCards(sourceRoot string, allowedRepos map[string]struct{}) ([]Card, error) {
	root := strings.TrimSpace(sourceRoot)
	if root == "" {
		return nil, fmt.Errorf("missing source root")
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
		card, err := ParseSourceCardMarkdown(path, allowedRepos)
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
		return nil, fmt.Errorf("no source cards found under %s", cardsDir)
	}
	return cards, nil
}

func ParseSourceCardMarkdown(path string, allowedRepos map[string]struct{}) (Card, error) {
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
	evidence, err := parseEvidenceSection(sections["Evidence"], path, allowedRepos)
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
	}, nil
}

func LoadSourceIndices(sourceRoot string, allowedRepos map[string]struct{}) (Indices, error) {
	root := strings.TrimSpace(sourceRoot)
	if root == "" {
		return Indices{}, fmt.Errorf("missing source root")
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
		repo, _, err := splitRepoPath(normalizedKey)
		if err != nil {
			return Indices{}, fmt.Errorf("invalid code index key %q: %w", normalizedKey, err)
		}
		if _, ok := allowedRepos[repo]; !ok {
			return Indices{}, fmt.Errorf("invalid code index repo %q", repo)
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

func parseEvidenceSection(lines []string, sourcePath string, allowedRepos map[string]struct{}) ([]EvidenceRef, error) {
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
		if _, err := fmt.Sscanf(matches[3], "%d", &lineNo); err != nil || lineNo <= 0 {
			return nil, fmt.Errorf("%s: invalid evidence line: %s", sourcePath, line)
		}
		repo := strings.TrimSpace(matches[1])
		if _, ok := allowedRepos[repo]; !ok {
			return nil, fmt.Errorf("%s: evidence repo not allowed: %s", sourcePath, repo)
		}
		normalizedPath, err := normalizeEvidencePath(matches[2])
		if err != nil {
			return nil, fmt.Errorf("%s: %w", sourcePath, err)
		}
		note := strings.TrimSpace(matches[4])
		out = append(out, EvidenceRef{
			Repo: repo,
			Path: normalizedPath,
			Line: lineNo,
			Note: note,
		})
	}
	return out, nil
}

func normalizeEvidencePath(raw string) (string, error) {
	path := filepath.ToSlash(filepath.Clean(strings.TrimSpace(raw)))
	if path == "" || path == "." || strings.HasPrefix(path, "/") {
		return "", fmt.Errorf("invalid evidence path: %s", raw)
	}
	if path == ".." || strings.HasPrefix(path, "../") {
		return "", fmt.Errorf("invalid evidence path: %s", raw)
	}
	return path, nil
}

func splitRepoPath(raw string) (string, string, error) {
	value := filepath.ToSlash(filepath.Clean(strings.TrimSpace(raw)))
	if value == "" || value == "." || strings.HasPrefix(value, "/") {
		return "", "", fmt.Errorf("path must be <repo>/<path>")
	}
	parts := strings.SplitN(value, "/", 2)
	if len(parts) != 2 || strings.TrimSpace(parts[0]) == "" || strings.TrimSpace(parts[1]) == "" {
		return "", "", fmt.Errorf("path must be <repo>/<path>")
	}
	if parts[1] == "." || parts[1] == ".." || strings.HasPrefix(parts[1], "../") {
		return "", "", fmt.Errorf("path must be <repo>/<path>")
	}
	return parts[0], parts[1], nil
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
