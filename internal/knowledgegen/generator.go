package knowledgegen

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/floegence/redeven-agent/internal/ai"
	"github.com/floegence/redeven-agent/internal/config"
	"github.com/floegence/redeven-agent/internal/knowledge"
	"github.com/floegence/redeven-agent/internal/session"
	"github.com/floegence/redeven-agent/internal/settings"
	"gopkg.in/yaml.v3"
)

type GenerateOptions struct {
	RedevenRoot           string
	KnowledgeRoot         string
	OutputRoot            string
	ModelID               string
	MaxParallel           int
	FailOnMissingEvidence bool
	ConfigPath            string
	SecretsPath           string
	StateDir              string
	PromptVersion         string
}

type sourceCardFrontmatter struct {
	ID      string   `yaml:"id"`
	Version int      `yaml:"version"`
	Title   string   `yaml:"title"`
	Status  string   `yaml:"status"`
	Owners  []string `yaml:"owners"`
	Tags    []string `yaml:"tags"`
}

type sourceCard struct {
	FilePath    string
	Markdown    string
	Frontmatter sourceCardFrontmatter
}

type generatedPayload struct {
	ID                string                  `json:"id"`
	Version           int                     `json:"version,omitempty"`
	Title             string                  `json:"title"`
	Status            string                  `json:"status,omitempty"`
	Owners            []string                `json:"owners,omitempty"`
	Tags              []string                `json:"tags,omitempty"`
	Summary           string                  `json:"summary"`
	Mechanism         string                  `json:"mechanism"`
	Boundaries        string                  `json:"boundaries"`
	InvalidConditions string                  `json:"invalid_conditions"`
	Evidence          []knowledge.EvidenceRef `json:"evidence"`
}

type promptTemplates struct {
	SystemPrompt string
	Generate     string
	Refine       string
	OutputSchema string
}

type generatedCardResult struct {
	Card       knowledge.Card
	Markdown   string
	Warnings   []string
	ReportItem knowledge.GenerationReportItem
}

func Generate(ctx context.Context, opts GenerateOptions) error {
	redevenRoot, knowledgeRoot, outputRoot, err := validatePaths(opts)
	if err != nil {
		return err
	}
	sourceCommit, err := gitCommit(redevenRoot)
	if err != nil {
		return err
	}
	cards, err := loadSourceCards(knowledgeRoot)
	if err != nil {
		return err
	}
	prompts, err := loadPromptTemplates(knowledgeRoot)
	if err != nil {
		return err
	}
	if strings.TrimSpace(opts.PromptVersion) == "" {
		opts.PromptVersion = "knowledge-prompts-v1"
	}

	cfgPath := strings.TrimSpace(opts.ConfigPath)
	if cfgPath == "" {
		cfgPath = config.DefaultConfigPath()
	}
	cfg, err := config.Load(cfgPath)
	if err != nil {
		return fmt.Errorf("load config failed: %w", err)
	}
	if cfg.AI == nil {
		return fmt.Errorf("ai config is not enabled")
	}

	modelID := strings.TrimSpace(opts.ModelID)
	if modelID == "" {
		resolved, ok := cfg.AI.ResolvedCurrentModelID()
		if !ok {
			return fmt.Errorf("missing current ai model")
		}
		modelID = resolved
	}
	if !cfg.AI.IsAllowedModelID(modelID) {
		return fmt.Errorf("model %q is not in ai allow list", modelID)
	}

	secretsPath := strings.TrimSpace(opts.SecretsPath)
	if secretsPath == "" {
		secretsPath = filepath.Join(filepath.Dir(filepath.Clean(cfgPath)), "secrets.json")
	}
	stateDir := strings.TrimSpace(opts.StateDir)
	if stateDir == "" {
		stateDir = filepath.Join(filepath.Dir(filepath.Clean(cfgPath)), "knowledge-gen-state")
	}
	if err := os.MkdirAll(stateDir, 0o700); err != nil {
		return err
	}
	secrets := settings.NewSecretsStore(secretsPath)

	svc, err := ai.NewService(ai.Options{
		StateDir: stateDir,
		FSRoot:   redevenRoot,
		Shell:    "bash",
		Config:   cfg.AI,
		ResolveProviderAPIKey: func(providerID string) (string, bool, error) {
			return secrets.GetAIProviderAPIKey(providerID)
		},
		ResolveWebSearchProviderAPIKey: func(providerID string) (string, bool, error) {
			return secrets.GetWebSearchProviderAPIKey(providerID)
		},
		RunMaxWallTime:      8 * time.Minute,
		RunIdleTimeout:      90 * time.Second,
		ToolApprovalTimeout: 30 * time.Second,
	})
	if err != nil {
		return fmt.Errorf("init ai service failed: %w", err)
	}
	defer func() { _ = svc.Close() }()

	meta := &session.Meta{
		EndpointID:        "env_knowledge_generator",
		NamespacePublicID: "ns_knowledge_generator",
		ChannelID:         "ch_knowledge_generator",
		UserPublicID:      "u_knowledge_generator",
		UserEmail:         "knowledge@local",
		CanRead:           true,
		CanWrite:          true,
		CanExecute:        true,
	}

	if err := cleanOutputRoot(outputRoot); err != nil {
		return err
	}

	results := make([]generatedCardResult, 0, len(cards))
	maxParallel := opts.MaxParallel
	if maxParallel <= 0 {
		maxParallel = 1
	}
	if maxParallel > len(cards) {
		maxParallel = len(cards)
	}
	if maxParallel <= 0 {
		maxParallel = 1
	}

	type job struct {
		Card sourceCard
	}
	type outcome struct {
		Result generatedCardResult
		Err    error
	}
	jobs := make(chan job)
	outcomes := make(chan outcome, len(cards))
	workerCtx, cancel := context.WithCancel(ctx)
	defer cancel()

	for i := 0; i < maxParallel; i++ {
		go func() {
			for item := range jobs {
				result, genErr := generateOneCard(workerCtx, svc, meta, modelID, redevenRoot, sourceCommit, opts, prompts, item.Card)
				outcomes <- outcome{Result: result, Err: genErr}
				if genErr != nil {
					cancel()
					return
				}
			}
		}()
	}
	go func() {
		defer close(jobs)
		for _, card := range cards {
			select {
			case <-workerCtx.Done():
				return
			case jobs <- job{Card: card}:
			}
		}
	}()

	for i := 0; i < len(cards); i++ {
		out := <-outcomes
		if out.Err != nil {
			return out.Err
		}
		results = append(results, out.Result)
	}
	sort.Slice(results, func(i, j int) bool { return results[i].Card.ID < results[j].Card.ID })

	if err := writeGeneratedArtifacts(outputRoot, knowledgeRoot, sourceCommit, modelID, opts.PromptVersion, results); err != nil {
		return err
	}
	return nil
}

func validatePaths(opts GenerateOptions) (string, string, string, error) {
	redevenRoot := filepath.Clean(strings.TrimSpace(opts.RedevenRoot))
	knowledgeRoot := filepath.Clean(strings.TrimSpace(opts.KnowledgeRoot))
	outputRoot := filepath.Clean(strings.TrimSpace(opts.OutputRoot))
	if redevenRoot == "" || !filepath.IsAbs(redevenRoot) {
		return "", "", "", fmt.Errorf("--redeven-root must be an absolute path")
	}
	if knowledgeRoot == "" || !filepath.IsAbs(knowledgeRoot) {
		return "", "", "", fmt.Errorf("--knowledge-root must be an absolute path")
	}
	if outputRoot == "" || !filepath.IsAbs(outputRoot) {
		return "", "", "", fmt.Errorf("--output-root must be an absolute path")
	}
	st, err := os.Stat(redevenRoot)
	if err != nil || !st.IsDir() {
		return "", "", "", fmt.Errorf("invalid redeven root: %s", redevenRoot)
	}
	st, err = os.Stat(knowledgeRoot)
	if err != nil || !st.IsDir() {
		return "", "", "", fmt.Errorf("invalid knowledge root: %s", knowledgeRoot)
	}
	return redevenRoot, knowledgeRoot, outputRoot, nil
}

func loadSourceCards(knowledgeRoot string) ([]sourceCard, error) {
	cardsDir := filepath.Join(knowledgeRoot, "cards")
	entries, err := os.ReadDir(cardsDir)
	if err != nil {
		return nil, err
	}
	cards := make([]sourceCard, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || strings.ToLower(filepath.Ext(entry.Name())) != ".md" {
			continue
		}
		path := filepath.Join(cardsDir, entry.Name())
		content, err := os.ReadFile(path)
		if err != nil {
			return nil, err
		}
		fmRaw, _, err := splitFrontmatter(string(content))
		if err != nil {
			return nil, fmt.Errorf("%s: %w", path, err)
		}
		var fm sourceCardFrontmatter
		if err := yaml.Unmarshal([]byte(fmRaw), &fm); err != nil {
			return nil, fmt.Errorf("%s: parse frontmatter failed: %w", path, err)
		}
		if strings.TrimSpace(fm.ID) == "" {
			return nil, fmt.Errorf("%s: missing id", path)
		}
		if fm.Version <= 0 {
			return nil, fmt.Errorf("%s: invalid version", path)
		}
		cards = append(cards, sourceCard{FilePath: path, Markdown: string(content), Frontmatter: fm})
	}
	if len(cards) == 0 {
		return nil, fmt.Errorf("no source cards found under %s", cardsDir)
	}
	sort.Slice(cards, func(i, j int) bool { return cards[i].Frontmatter.ID < cards[j].Frontmatter.ID })
	return cards, nil
}

func loadPromptTemplates(knowledgeRoot string) (promptTemplates, error) {
	read := func(rel string) (string, error) {
		path := filepath.Join(knowledgeRoot, rel)
		payload, err := os.ReadFile(path)
		if err != nil {
			return "", err
		}
		return strings.TrimSpace(string(payload)), nil
	}
	systemPrompt, err := read(filepath.Join("prompts", "generation_system.md"))
	if err != nil {
		return promptTemplates{}, err
	}
	generatePrompt, err := read(filepath.Join("prompts", "generation_user_template.md"))
	if err != nil {
		return promptTemplates{}, err
	}
	refinePrompt, err := read(filepath.Join("prompts", "refine_user_template.md"))
	if err != nil {
		return promptTemplates{}, err
	}
	outputSchema, err := read(filepath.Join("contracts", "output_schema.json"))
	if err != nil {
		return promptTemplates{}, err
	}
	return promptTemplates{SystemPrompt: systemPrompt, Generate: generatePrompt, Refine: refinePrompt, OutputSchema: outputSchema}, nil
}

func generateOneCard(
	ctx context.Context,
	svc *ai.Service,
	meta *session.Meta,
	modelID string,
	redevenRoot string,
	sourceCommit string,
	opts GenerateOptions,
	prompts promptTemplates,
	card sourceCard,
) (generatedCardResult, error) {
	thread, err := svc.CreateThread(ctx, meta, "knowledge-"+card.Frontmatter.ID, modelID, redevenRoot)
	if err != nil {
		return generatedCardResult{}, err
	}

	genPrompt := buildGeneratePrompt(prompts, card.Markdown)
	payload, warnings, err := runCardRound(ctx, svc, meta, modelID, thread.ThreadID, genPrompt, redevenRoot)
	if err != nil {
		return generatedCardResult{}, fmt.Errorf("card %s generation failed: %w", card.Frontmatter.ID, err)
	}

	payload, validationWarnings, validationErr := validateAndNormalizePayload(payload, card, redevenRoot)
	warnings = append(warnings, validationWarnings...)
	if validationErr != nil {
		refinePrompt := buildRefinePrompt(prompts, payload, []string{validationErr.Error()})
		refinedPayload, refineWarnings, refineErr := runCardRound(ctx, svc, meta, modelID, thread.ThreadID, refinePrompt, redevenRoot)
		warnings = append(warnings, refineWarnings...)
		if refineErr != nil {
			return generatedCardResult{}, fmt.Errorf("card %s refine failed: %w", card.Frontmatter.ID, refineErr)
		}
		payload = refinedPayload
		payload, validationWarnings, validationErr = validateAndNormalizePayload(payload, card, redevenRoot)
		warnings = append(warnings, validationWarnings...)
	}
	if validationErr != nil {
		if opts.FailOnMissingEvidence {
			return generatedCardResult{}, fmt.Errorf("card %s validation failed: %w", card.Frontmatter.ID, validationErr)
		}
		warnings = append(warnings, validationErr.Error())
	}

	cardOut := knowledge.Card{
		ID:                card.Frontmatter.ID,
		Version:           card.Frontmatter.Version,
		Title:             firstNonEmpty(payload.Title, card.Frontmatter.Title),
		Status:            firstNonEmpty(payload.Status, card.Frontmatter.Status),
		Owners:            fallbackStringList(payload.Owners, card.Frontmatter.Owners),
		Tags:              fallbackStringList(payload.Tags, card.Frontmatter.Tags),
		Summary:           strings.TrimSpace(payload.Summary),
		Mechanism:         strings.TrimSpace(payload.Mechanism),
		Boundaries:        strings.TrimSpace(payload.Boundaries),
		InvalidConditions: strings.TrimSpace(payload.InvalidConditions),
		Evidence:          payload.Evidence,
		SourceCardID:      card.Frontmatter.ID,
		SourceCommit:      sourceCommit,
	}
	markdown := renderGeneratedCardMarkdown(cardOut)
	report := knowledge.GenerationReportItem{CardID: cardOut.ID, Status: "generated", Warnings: normalizeStringList(warnings)}
	return generatedCardResult{Card: cardOut, Markdown: markdown, Warnings: normalizeStringList(warnings), ReportItem: report}, nil
}

func runCardRound(
	ctx context.Context,
	svc *ai.Service,
	meta *session.Meta,
	modelID string,
	threadID string,
	prompt string,
	redevenRoot string,
) (generatedPayload, []string, error) {
	runID, err := ai.NewRunID()
	if err != nil {
		return generatedPayload{}, nil, err
	}
	runCtx, cancel := context.WithTimeout(ctx, 6*time.Minute)
	defer cancel()
	err = svc.StartRun(runCtx, meta, runID, ai.RunStartRequest{
		ThreadID: threadID,
		Model:    modelID,
		Input:    ai.RunInput{Text: prompt},
		Options: ai.RunOptions{
			MaxSteps:        22,
			MaxNoToolRounds: 4,
			Mode:            config.AIModeAct,
			ResponseFormat:  "json_object",
		},
	}, nil)
	if err != nil {
		return generatedPayload{}, nil, err
	}
	assistantText := extractLatestAssistantText(runCtx, svc, meta, threadID)
	if strings.TrimSpace(assistantText) == "" {
		return generatedPayload{}, nil, fmt.Errorf("empty assistant response")
	}
	payload, parseErr := parseGeneratedPayload(assistantText)
	if parseErr != nil {
		return generatedPayload{}, nil, parseErr
	}
	if strings.TrimSpace(payload.ID) == "" {
		payload.ID = strings.TrimSpace(payload.Title)
	}
	return payload, nil, nil
}

func buildGeneratePrompt(prompts promptTemplates, cardMarkdown string) string {
	template := prompts.Generate
	if template == "" {
		template = "Generate a runtime knowledge card as a JSON object."
	}
	template = strings.ReplaceAll(template, "{{card_markdown}}", cardMarkdown)
	template = strings.ReplaceAll(template, "{{output_schema}}", prompts.OutputSchema)
	template = strings.ReplaceAll(template, "{{repo_root}}", "REDEVEN_REPO_ROOT")
	parts := []string{
		prompts.SystemPrompt,
		"You must use terminal.exec with readonly commands to verify evidence path:line when needed.",
		"Return JSON object only with keys: id,title,summary,mechanism,boundaries,invalid_conditions,evidence,tags,owners,status.",
		template,
	}
	return strings.TrimSpace(strings.Join(parts, "\n\n"))
}

func buildRefinePrompt(prompts promptTemplates, payload generatedPayload, validationErrors []string) string {
	raw, _ := json.Marshal(payload)
	template := prompts.Refine
	if template == "" {
		template = "Refine the draft and return a fixed JSON object."
	}
	template = strings.ReplaceAll(template, "{{draft_json}}", string(raw))
	template = strings.ReplaceAll(template, "{{validation_errors}}", strings.Join(validationErrors, "; "))
	template = strings.ReplaceAll(template, "{{repo_root}}", "REDEVEN_REPO_ROOT")
	parts := []string{
		prompts.SystemPrompt,
		"Fix every validation error and keep response as a JSON object.",
		template,
	}
	return strings.TrimSpace(strings.Join(parts, "\n\n"))
}

func validateAndNormalizePayload(payload generatedPayload, source sourceCard, redevenRoot string) (generatedPayload, []string, error) {
	warnings := make([]string, 0, 4)
	payload.ID = strings.TrimSpace(payload.ID)
	if payload.ID == "" {
		payload.ID = source.Frontmatter.ID
	}
	if payload.ID != source.Frontmatter.ID {
		return payload, warnings, fmt.Errorf("payload id mismatch: want %s got %s", source.Frontmatter.ID, payload.ID)
	}
	payload.Title = strings.TrimSpace(payload.Title)
	payload.Summary = strings.TrimSpace(payload.Summary)
	payload.Mechanism = strings.TrimSpace(payload.Mechanism)
	payload.Boundaries = strings.TrimSpace(payload.Boundaries)
	payload.InvalidConditions = strings.TrimSpace(payload.InvalidConditions)
	if payload.Title == "" || payload.Summary == "" || payload.Mechanism == "" || payload.Boundaries == "" || payload.InvalidConditions == "" {
		return payload, warnings, fmt.Errorf("payload missing required narrative fields")
	}

	cleanedEvidence := make([]knowledge.EvidenceRef, 0, len(payload.Evidence))
	for _, item := range payload.Evidence {
		rel := strings.TrimSpace(item.Path)
		if rel == "" || strings.HasPrefix(rel, "/") {
			warnings = append(warnings, fmt.Sprintf("ignored invalid evidence path: %s", rel))
			continue
		}
		if item.Line <= 0 {
			warnings = append(warnings, fmt.Sprintf("ignored invalid evidence line: %s:%d", rel, item.Line))
			continue
		}
		target := filepath.Join(redevenRoot, filepath.Clean(rel))
		if !strings.HasPrefix(filepath.Clean(target), filepath.Clean(redevenRoot)) {
			warnings = append(warnings, fmt.Sprintf("ignored evidence path outside repo: %s", rel))
			continue
		}
		content, err := os.ReadFile(target)
		if err != nil {
			warnings = append(warnings, fmt.Sprintf("ignored missing evidence path: %s", rel))
			continue
		}
		lineCount := strings.Count(string(content), "\n") + 1
		if item.Line > lineCount {
			warnings = append(warnings, fmt.Sprintf("ignored out-of-range evidence: %s:%d", rel, item.Line))
			continue
		}
		cleanedEvidence = append(cleanedEvidence, knowledge.EvidenceRef{Path: rel, Line: item.Line, Note: strings.TrimSpace(item.Note)})
	}
	payload.Evidence = cleanedEvidence
	if len(payload.Evidence) == 0 {
		return payload, warnings, fmt.Errorf("payload has no valid evidence entries")
	}
	payload.Tags = fallbackStringList(payload.Tags, source.Frontmatter.Tags)
	payload.Owners = fallbackStringList(payload.Owners, source.Frontmatter.Owners)
	payload.Status = firstNonEmpty(payload.Status, source.Frontmatter.Status)
	payload.Version = source.Frontmatter.Version
	return payload, warnings, nil
}

func parseGeneratedPayload(text string) (generatedPayload, error) {
	trimmed := strings.TrimSpace(text)
	if trimmed == "" {
		return generatedPayload{}, fmt.Errorf("empty response")
	}
	var payload generatedPayload
	if err := json.Unmarshal([]byte(trimmed), &payload); err == nil {
		return payload, nil
	}
	start := strings.Index(trimmed, "{")
	end := strings.LastIndex(trimmed, "}")
	if start >= 0 && end > start {
		candidate := trimmed[start : end+1]
		if err := json.Unmarshal([]byte(candidate), &payload); err == nil {
			return payload, nil
		}
	}
	return generatedPayload{}, fmt.Errorf("response is not valid json object")
}

func extractLatestAssistantText(ctx context.Context, svc *ai.Service, meta *session.Meta, threadID string) string {
	msgs, err := svc.ListThreadMessages(ctx, meta, threadID, 200, 0)
	if err != nil || msgs == nil || len(msgs.Messages) == 0 {
		return ""
	}
	for i := len(msgs.Messages) - 1; i >= 0; i-- {
		msg := toMessageMap(msgs.Messages[i])
		if len(msg) == 0 {
			continue
		}
		if strings.TrimSpace(strings.ToLower(anyToString(msg["role"]))) != "assistant" {
			continue
		}
		blocks, _ := msg["blocks"].([]any)
		parts := make([]string, 0, len(blocks))
		for _, raw := range blocks {
			block, _ := raw.(map[string]any)
			if strings.TrimSpace(strings.ToLower(anyToString(block["type"]))) != "markdown" {
				continue
			}
			content := strings.TrimSpace(anyToString(block["content"]))
			if content == "" {
				continue
			}
			parts = append(parts, content)
		}
		if len(parts) > 0 {
			return strings.Join(parts, "\n\n")
		}
	}
	return ""
}

func toMessageMap(v any) map[string]any {
	switch x := v.(type) {
	case map[string]any:
		return x
	case json.RawMessage:
		var out map[string]any
		if err := json.Unmarshal(x, &out); err == nil {
			return out
		}
	case []byte:
		var out map[string]any
		if err := json.Unmarshal(x, &out); err == nil {
			return out
		}
	}
	return nil
}

func anyToString(v any) string {
	switch x := v.(type) {
	case string:
		return x
	default:
		return ""
	}
}

func writeGeneratedArtifacts(
	outputRoot string,
	knowledgeRoot string,
	sourceCommit string,
	modelID string,
	promptVersion string,
	results []generatedCardResult,
) error {
	cardsDir := filepath.Join(outputRoot, "cards")
	indicesDir := filepath.Join(outputRoot, "indices")
	if err := os.MkdirAll(cardsDir, 0o755); err != nil {
		return err
	}
	if err := os.MkdirAll(indicesDir, 0o755); err != nil {
		return err
	}
	for _, result := range results {
		path := filepath.Join(cardsDir, result.Card.ID+".md")
		if err := os.WriteFile(path, []byte(result.Markdown), 0o644); err != nil {
			return err
		}
	}
	if err := copyFile(filepath.Join(knowledgeRoot, "indices", "topic_index.yaml"), filepath.Join(indicesDir, "topic_index.yaml")); err != nil {
		return err
	}
	if err := copyFile(filepath.Join(knowledgeRoot, "indices", "code_index.yaml"), filepath.Join(indicesDir, "code_index.yaml")); err != nil {
		return err
	}

	report := knowledge.GenerationReport{
		SchemaVersion: knowledge.SchemaVersion,
		GeneratedAt:   time.Now().UTC().Format(time.RFC3339),
		ModelID:       modelID,
		CardCount:     len(results),
		Items:         make([]knowledge.GenerationReportItem, 0, len(results)),
	}
	warningSet := make([]string, 0)
	for _, item := range results {
		report.Items = append(report.Items, item.ReportItem)
		warningSet = append(warningSet, item.Warnings...)
	}
	report.Warnings = normalizeStringList(warningSet)
	reportPath := filepath.Join(outputRoot, "generation_report.json")
	reportRaw, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(reportPath, reportRaw, 0o644); err != nil {
		return err
	}

	inputsHash, err := hashKnowledgeInputs(knowledgeRoot)
	if err != nil {
		return err
	}
	outputsHash, err := hashKnowledgeOutputs(outputRoot)
	if err != nil {
		return err
	}
	lock := knowledge.LockFile{
		SchemaVersion:       knowledge.SchemaVersion,
		RedevenSourceCommit: sourceCommit,
		GeneratedAt:         report.GeneratedAt,
		InputsSHA256:        inputsHash,
		OutputsSHA256:       outputsHash,
	}
	lock.Generator.Engine = "flower-local"
	lock.Generator.ModelID = modelID
	lock.Generator.PromptVersion = promptVersion
	lockRaw, err := json.MarshalIndent(lock, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(outputRoot, "knowledge_lock.json"), lockRaw, 0o644); err != nil {
		return err
	}
	return nil
}

func hashKnowledgeInputs(knowledgeRoot string) (string, error) {
	return hashTree(knowledgeRoot)
}

func hashKnowledgeOutputs(outputRoot string) (string, error) {
	return hashTree(outputRoot)
}

func hashTree(root string) (string, error) {
	entries := make([]string, 0, 64)
	err := filepath.WalkDir(root, func(path string, d os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if d.IsDir() {
			return nil
		}
		rel, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		entries = append(entries, filepath.ToSlash(rel))
		return nil
	})
	if err != nil {
		return "", err
	}
	sort.Strings(entries)
	h := sha256.New()
	for _, rel := range entries {
		payload, err := os.ReadFile(filepath.Join(root, rel))
		if err != nil {
			return "", err
		}
		_, _ = h.Write([]byte(rel))
		_, _ = h.Write([]byte("\n"))
		_, _ = h.Write(payload)
		_, _ = h.Write([]byte("\n"))
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

func cleanOutputRoot(outputRoot string) error {
	cardsDir := filepath.Join(outputRoot, "cards")
	indicesDir := filepath.Join(outputRoot, "indices")
	if err := os.MkdirAll(cardsDir, 0o755); err != nil {
		return err
	}
	if err := os.MkdirAll(indicesDir, 0o755); err != nil {
		return err
	}
	if err := removeMarkdownFiles(cardsDir); err != nil {
		return err
	}
	if err := removeAllFiles(indicesDir); err != nil {
		return err
	}
	_ = os.Remove(filepath.Join(outputRoot, "generation_report.json"))
	_ = os.Remove(filepath.Join(outputRoot, "knowledge_lock.json"))
	return nil
}

func removeMarkdownFiles(dir string) error {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		if strings.ToLower(filepath.Ext(entry.Name())) != ".md" {
			continue
		}
		if err := os.Remove(filepath.Join(dir, entry.Name())); err != nil {
			return err
		}
	}
	return nil
}

func removeAllFiles(dir string) error {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		if err := os.Remove(filepath.Join(dir, entry.Name())); err != nil {
			return err
		}
	}
	return nil
}

func copyFile(src string, dst string) error {
	payload, err := os.ReadFile(src)
	if err != nil {
		return err
	}
	return os.WriteFile(dst, payload, 0o644)
}

func renderGeneratedCardMarkdown(card knowledge.Card) string {
	evidenceLines := make([]string, 0, len(card.Evidence))
	for _, item := range card.Evidence {
		line := fmt.Sprintf("- %s:%d", item.Path, item.Line)
		if note := strings.TrimSpace(item.Note); note != "" {
			line += " - " + note
		}
		evidenceLines = append(evidenceLines, line)
	}
	owners := renderList(card.Owners)
	tags := renderList(card.Tags)
	status := firstNonEmpty(card.Status, "stable")
	return strings.TrimSpace(fmt.Sprintf(`---
id: %s
version: %d
title: %s
status: %s
owners:
%s
tags:
%s
source_card_id: %s
source_commit: %s
---

## Conclusion

%s

## Mechanism

%s

## Boundaries

%s

## Evidence

%s

## Invalid Conditions

%s
`, card.ID, card.Version, card.Title, status, owners, tags, card.SourceCardID, card.SourceCommit, card.Summary, card.Mechanism, card.Boundaries, strings.Join(evidenceLines, "\n"), card.InvalidConditions)) + "\n"
}

func renderList(items []string) string {
	normalized := normalizeStringList(items)
	if len(normalized) == 0 {
		return "  - unknown"
	}
	lines := make([]string, 0, len(normalized))
	for _, item := range normalized {
		lines = append(lines, "  - "+item)
	}
	return strings.Join(lines, "\n")
}

func fallbackStringList(primary []string, fallback []string) []string {
	candidate := normalizeStringList(primary)
	if len(candidate) > 0 {
		return candidate
	}
	return normalizeStringList(fallback)
}

func normalizeStringList(items []string) []string {
	if len(items) == 0 {
		return nil
	}
	seen := make(map[string]struct{}, len(items))
	out := make([]string, 0, len(items))
	for _, item := range items {
		v := strings.TrimSpace(item)
		if v == "" {
			continue
		}
		if _, exists := seen[v]; exists {
			continue
		}
		seen[v] = struct{}{}
		out = append(out, v)
	}
	sort.Strings(out)
	if len(out) == 0 {
		return nil
	}
	return out
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		v = strings.TrimSpace(v)
		if v != "" {
			return v
		}
	}
	return ""
}

func splitFrontmatter(content string) (string, string, error) {
	normalized := strings.ReplaceAll(content, "\r\n", "\n")
	if !strings.HasPrefix(normalized, "---\n") {
		return "", "", fmt.Errorf("missing frontmatter start")
	}
	rest := normalized[len("---\n"):]
	idx := strings.Index(rest, "\n---\n")
	if idx < 0 {
		return "", "", fmt.Errorf("missing frontmatter end")
	}
	return rest[:idx], rest[idx+len("\n---\n"):], nil
}

func gitCommit(root string) (string, error) {
	cmd := exec.Command("git", "-C", root, "rev-parse", "HEAD")
	payload, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("resolve redeven source commit failed: %w", err)
	}
	return strings.TrimSpace(string(payload)), nil
}
