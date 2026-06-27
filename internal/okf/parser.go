package okf

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
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
	conceptsByPath := conceptsByPath(concepts)
	rootIndex.Sections = parseIndexSections(rootIndex.Body, conceptsByPath)
	rootIndex.Links = parseMarkdownLinks(rootIndex.Path, rootIndex.Body, conceptsByPath)
	attachConceptLinks(concepts, conceptsByPath)
	attachConceptBacklinks(concepts, rootIndex)

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
			if name == "dist" && path != sourceRoot {
				return filepath.SkipDir
			}
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

func conceptsByPath(concepts []Concept) map[string]Concept {
	out := make(map[string]Concept, len(concepts))
	for _, concept := range concepts {
		out[normalizeOKFPath(concept.Path)] = concept
	}
	return out
}

func attachConceptLinks(concepts []Concept, byPath map[string]Concept) {
	for i := range concepts {
		concepts[i].Links = parseMarkdownLinks(concepts[i].Path, concepts[i].Body, byPath)
	}
}

func attachConceptBacklinks(concepts []Concept, root RootIndex) {
	indexByPath := make(map[string]int, len(concepts))
	for i, concept := range concepts {
		indexByPath[normalizeOKFPath(concept.Path)] = i
	}
	rootTitle := "Redeven OKF Bundle"
	if title, ok := root.Frontmatter["title"].(string); ok && strings.TrimSpace(title) != "" {
		rootTitle = strings.TrimSpace(title)
	}
	rootBacklink := ConceptLink{
		Label: "Redeven OKF Bundle",
		Path:  root.Path,
		Title: rootTitle,
	}
	for _, link := range root.Links {
		if idx, ok := indexByPath[normalizeOKFPath(link.Path)]; ok {
			concepts[idx].Backlinks = appendUniqueConceptLink(concepts[idx].Backlinks, rootBacklink)
		}
	}
	for _, source := range concepts {
		backlink := ConceptLink{
			Label:     source.Title,
			Path:      source.Path,
			ConceptID: source.ConceptID,
			Title:     source.Title,
		}
		for _, link := range source.Links {
			if idx, ok := indexByPath[normalizeOKFPath(link.Path)]; ok {
				concepts[idx].Backlinks = appendUniqueConceptLink(concepts[idx].Backlinks, backlink)
			}
		}
	}
	for i := range concepts {
		sort.Slice(concepts[i].Backlinks, func(a, b int) bool {
			if concepts[i].Backlinks[a].Path == concepts[i].Backlinks[b].Path {
				return concepts[i].Backlinks[a].Label < concepts[i].Backlinks[b].Label
			}
			return concepts[i].Backlinks[a].Path < concepts[i].Backlinks[b].Path
		})
	}
}

func appendUniqueConceptLink(links []ConceptLink, link ConceptLink) []ConceptLink {
	key := link.Path + "\x00" + link.ConceptID + "\x00" + link.Label
	for _, existing := range links {
		existingKey := existing.Path + "\x00" + existing.ConceptID + "\x00" + existing.Label
		if existingKey == key {
			return links
		}
	}
	return append(links, link)
}

var markdownLinkPattern = regexp.MustCompile(`\[[^\]]+\]\([^\)]+\)`)

func parseIndexSections(body string, byPath map[string]Concept) []IndexSection {
	var sections []IndexSection
	var current *IndexSection
	scanner := bufio.NewScanner(strings.NewReader(body))
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if strings.HasPrefix(line, "## ") {
			section := IndexSection{
				Title: strings.TrimSpace(strings.TrimPrefix(line, "## ")),
			}
			section.Slug = slugify(section.Title)
			sections = append(sections, section)
			current = &sections[len(sections)-1]
			continue
		}
		if current == nil || !strings.HasPrefix(line, "- [") {
			continue
		}
		links := parseMarkdownLinks("index.md", line, byPath)
		if len(links) == 0 {
			continue
		}
		link := links[0]
		concept, ok := byPath[normalizeOKFPath(link.Path)]
		if !ok {
			continue
		}
		entry := IndexEntry{ConceptSummary: conceptSummary(concept)}
		if entry.Title == "" {
			entry.Title = link.Label
		}
		current.Entries = append(current.Entries, entry)
	}
	out := make([]IndexSection, 0, len(sections))
	for _, section := range sections {
		if len(section.Entries) == 0 {
			continue
		}
		out = append(out, section)
	}
	return out
}

func parseMarkdownLinks(sourcePath string, body string, byPath map[string]Concept) []ConceptLink {
	matches := markdownLinkPattern.FindAllString(body, -1)
	if len(matches) == 0 {
		return nil
	}
	seen := make(map[string]struct{}, len(matches))
	links := make([]ConceptLink, 0, len(matches))
	for _, match := range matches {
		closeLabel := strings.Index(match, "](")
		if closeLabel <= 1 || !strings.HasSuffix(match, ")") {
			continue
		}
		label := strings.TrimSpace(match[1:closeLabel])
		target := strings.TrimSpace(match[closeLabel+2 : len(match)-1])
		if label == "" || target == "" {
			continue
		}
		if strings.Contains(target, "://") || strings.HasPrefix(target, "mailto:") || strings.HasPrefix(target, "#") {
			continue
		}
		if hash := strings.Index(target, "#"); hash >= 0 {
			target = target[:hash]
		}
		if query := strings.Index(target, "?"); query >= 0 {
			target = target[:query]
		}
		if !strings.EqualFold(filepath.Ext(target), ".md") {
			continue
		}
		path := resolveOKFLinkPath(sourcePath, target)
		if path == "" || strings.HasPrefix(path, "dist/") {
			continue
		}
		concept, ok := byPath[path]
		if !ok {
			continue
		}
		key := path + "\x00" + label
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		links = append(links, ConceptLink{
			Label:     label,
			Path:      concept.Path,
			ConceptID: concept.ConceptID,
			Title:     concept.Title,
		})
	}
	sort.Slice(links, func(i, j int) bool {
		if links[i].Path == links[j].Path {
			return links[i].Label < links[j].Label
		}
		return links[i].Path < links[j].Path
	})
	return links
}

func resolveOKFLinkPath(sourcePath string, target string) string {
	target = strings.TrimSpace(target)
	if target == "" {
		return ""
	}
	if strings.HasPrefix(target, "/") {
		target = strings.TrimPrefix(target, "/")
	} else {
		base := filepath.Dir(normalizeOKFPath(sourcePath))
		if base == "." {
			base = ""
		}
		target = filepath.ToSlash(filepath.Join(base, target))
	}
	return normalizeOKFPath(target)
}

func normalizeOKFPath(path string) string {
	path = filepath.ToSlash(filepath.Clean(strings.TrimSpace(path)))
	path = strings.TrimPrefix(path, "./")
	if path == "." {
		return ""
	}
	return path
}

func slugify(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	if value == "" {
		return ""
	}
	var b strings.Builder
	prevDash := false
	for _, r := range value {
		keep := (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9')
		if keep {
			b.WriteRune(r)
			prevDash = false
			continue
		}
		if !prevDash {
			b.WriteByte('-')
			prevDash = true
		}
	}
	return strings.Trim(b.String(), "-")
}

func conceptSummary(concept Concept) ConceptSummary {
	return ConceptSummary{
		ConceptID:   concept.ConceptID,
		Path:        concept.Path,
		Type:        concept.Type,
		Title:       concept.Title,
		Description: concept.Description,
		Resource:    concept.Resource,
		Tags:        append([]string(nil), concept.Tags...),
	}
}

func conceptIDFromPath(rel string) string {
	rel = filepath.ToSlash(filepath.Clean(rel))
	rel = strings.TrimSuffix(rel, ".md")
	rel = strings.TrimPrefix(rel, "./")
	return strings.ReplaceAll(rel, "/", ".")
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
