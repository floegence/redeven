package okf

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"gopkg.in/yaml.v3"
)

type conceptFrontmatter struct {
	Type        string   `yaml:"type"`
	Title       string   `yaml:"title"`
	Description string   `yaml:"description"`
	Resource    string   `yaml:"resource"`
	Tags        []string `yaml:"tags"`
	Timestamp   string   `yaml:"timestamp"`
}

type rootIndexFrontmatter struct {
	OKFVersion string `yaml:"okf_version"`
}

func LoadSourceRoot(sourceRoot string) (string, []byte, error) {
	root := strings.TrimSpace(sourceRoot)
	if root == "" {
		return "", nil, fmt.Errorf("missing source root")
	}
	path := filepath.Join(root, "index.md")
	raw, err := os.ReadFile(path)
	if err != nil {
		return "", nil, err
	}
	return path, raw, nil
}

func LoadSourceBundle(sourceRoot string) (Bundle, []byte, error) {
	root := strings.TrimSpace(sourceRoot)
	if root == "" {
		return Bundle{}, nil, fmt.Errorf("missing source root")
	}

	rootPath, rootRaw, err := LoadSourceRoot(root)
	if err != nil {
		return Bundle{}, nil, err
	}
	rootIndex, err := parseRootIndex(rootPath, rootRaw)
	if err != nil {
		return Bundle{}, nil, err
	}

	concepts, err := loadConcepts(root)
	if err != nil {
		return Bundle{}, nil, err
	}

	sourceHash, err := hashTree(root)
	if err != nil {
		return Bundle{}, nil, err
	}

	bundle := Bundle{
		SchemaVersion: SchemaVersion,
		OKFVersion:    rootIndex.OKFVersion,
		RootIndex:     rootIndex,
		Concepts:      concepts,
		SourceSHA256:  sourceHash,
	}
	return bundle, rootRaw, nil
}

func parseRootIndex(path string, raw []byte) (RootIndex, error) {
	fmRaw, body, err := splitFrontmatter(string(raw))
	if err != nil {
		return RootIndex{}, fmt.Errorf("%s: %w", path, err)
	}
	var fm rootIndexFrontmatter
	if err := yaml.Unmarshal([]byte(fmRaw), &fm); err != nil {
		return RootIndex{}, fmt.Errorf("%s: invalid frontmatter: %w", path, err)
	}
	var frontmatter map[string]any
	if err := yaml.Unmarshal([]byte(fmRaw), &frontmatter); err != nil {
		return RootIndex{}, fmt.Errorf("%s: invalid frontmatter: %w", path, err)
	}
	if strings.TrimSpace(fm.OKFVersion) != OKFVersion {
		return RootIndex{}, fmt.Errorf("%s: okf_version must be %q", path, OKFVersion)
	}
	frontmatter["okf_version"] = OKFVersion
	return RootIndex{
		Path:        "index.md",
		OKFVersion:  OKFVersion,
		Frontmatter: frontmatter,
		Body:        strings.TrimSpace(body),
	}, nil
}

func loadConcepts(sourceRoot string) ([]Concept, error) {
	var concepts []Concept
	err := filepath.WalkDir(sourceRoot, func(path string, d os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if d.IsDir() {
			name := d.Name()
			if strings.HasPrefix(name, ".") && path != sourceRoot {
				return filepath.SkipDir
			}
			return nil
		}
		if strings.ToLower(filepath.Ext(d.Name())) != ".md" {
			return nil
		}
		if d.Name() == "index.md" || d.Name() == "log.md" {
			return nil
		}
		rel, err := filepath.Rel(sourceRoot, path)
		if err != nil {
			return err
		}
		rel = filepath.ToSlash(filepath.Clean(rel))
		joined, err := parseConcept(path, rel)
		if err != nil {
			return err
		}
		concepts = append(concepts, joined)
		return nil
	})
	if err != nil {
		return nil, err
	}
	if len(concepts) == 0 {
		return nil, fmt.Errorf("no OKF concepts found under %s", sourceRoot)
	}
	sort.Slice(concepts, func(i, j int) bool { return concepts[i].ConceptID < concepts[j].ConceptID })
	return concepts, nil
}

func parseConcept(path string, rel string) (Concept, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return Concept{}, err
	}
	fmRaw, body, err := splitFrontmatter(string(raw))
	if err != nil {
		return Concept{}, fmt.Errorf("%s: %w", path, err)
	}
	var fm conceptFrontmatter
	if err := yaml.Unmarshal([]byte(fmRaw), &fm); err != nil {
		return Concept{}, fmt.Errorf("%s: invalid frontmatter: %w", path, err)
	}
	var frontmatter map[string]any
	if err := yaml.Unmarshal([]byte(fmRaw), &frontmatter); err != nil {
		return Concept{}, fmt.Errorf("%s: invalid frontmatter: %w", path, err)
	}
	if strings.TrimSpace(fm.Type) == "" {
		return Concept{}, fmt.Errorf("%s: missing type", path)
	}
	title := strings.TrimSpace(fm.Title)
	if title == "" {
		title = titleFromFilename(rel)
	}
	if title == "" {
		return Concept{}, fmt.Errorf("%s: missing title", path)
	}
	body = strings.TrimSpace(body)
	snippet := buildSnippet(body)
	tags := normalizeStringList(fm.Tags)
	frontmatter["type"] = strings.TrimSpace(fm.Type)
	if title != "" {
		frontmatter["title"] = title
	}
	if description := strings.TrimSpace(fm.Description); description != "" {
		frontmatter["description"] = description
	} else {
		delete(frontmatter, "description")
	}
	if resource := strings.TrimSpace(fm.Resource); resource != "" {
		frontmatter["resource"] = resource
	} else {
		delete(frontmatter, "resource")
	}
	if len(tags) > 0 {
		frontmatter["tags"] = tags
	} else {
		delete(frontmatter, "tags")
	}
	if timestamp := strings.TrimSpace(fm.Timestamp); timestamp != "" {
		frontmatter["timestamp"] = timestamp
	} else {
		delete(frontmatter, "timestamp")
	}
	return Concept{
		Path:        filepath.ToSlash(filepath.Clean(rel)),
		ConceptID:   conceptIDFromPath(rel),
		Type:        strings.TrimSpace(fm.Type),
		Title:       title,
		Description: strings.TrimSpace(fm.Description),
		Resource:    strings.TrimSpace(fm.Resource),
		Tags:        tags,
		Timestamp:   strings.TrimSpace(fm.Timestamp),
		Frontmatter: frontmatter,
		Body:        body,
		Snippet:     snippet,
	}, nil
}

func conceptIDFromPath(rel string) string {
	rel = filepath.ToSlash(filepath.Clean(rel))
	rel = strings.TrimSuffix(rel, ".md")
	return strings.TrimPrefix(rel, "./")
}

func titleFromFilename(rel string) string {
	base := strings.TrimSuffix(filepath.Base(rel), filepath.Ext(rel))
	if base == "" {
		return ""
	}
	base = strings.ReplaceAll(base, "-", " ")
	base = strings.ReplaceAll(base, "_", " ")
	return strings.ToUpper(base[:1]) + base[1:]
}

func buildSnippet(body string) string {
	if body == "" {
		return ""
	}
	scanner := bufio.NewScanner(strings.NewReader(body))
	var parts []string
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") || strings.HasPrefix(line, "[") {
			continue
		}
		parts = append(parts, line)
		if len(strings.Join(parts, " ")) >= 220 {
			break
		}
	}
	snippet := strings.TrimSpace(strings.Join(parts, " "))
	if len(snippet) > 240 {
		snippet = snippet[:240]
	}
	return snippet
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
	return rest[:idx], rest[idx+len("\n---\n"):], nil
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
	return out
}
