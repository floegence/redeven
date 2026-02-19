package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/floegence/redeven-agent/internal/knowledge"
	"github.com/floegence/redeven-agent/internal/knowledgegen"
)

func knowledgeCmd(args []string) {
	if len(args) == 0 {
		printKnowledgeUsage()
		os.Exit(2)
	}
	switch strings.TrimSpace(strings.ToLower(args[0])) {
	case "generate":
		knowledgeGenerateCmd(args[1:])
	case "bundle":
		knowledgeBundleCmd(args[1:])
	default:
		printKnowledgeUsage()
		os.Exit(2)
	}
}

func printKnowledgeUsage() {
	fmt.Fprintf(os.Stderr, `redeven knowledge

Usage:
  redeven knowledge generate [flags]
  redeven knowledge bundle [flags]

Commands:
  generate    Generate runtime knowledge cards by using the local Flower runtime.
  bundle      Build or verify dist knowledge bundle assets from generated files.

`)
}

func knowledgeGenerateCmd(args []string) {
	fs := flag.NewFlagSet("knowledge generate", flag.ExitOnError)
	redevenRoot := fs.String("redeven-root", "", "Absolute path to redeven repository root")
	knowledgeRoot := fs.String("knowledge-root", "", "Absolute path to redeven .knowledge root")
	outputRoot := fs.String("output-root", "", "Absolute path to generated output root (for example: <agent>/internal/knowledge/generated)")
	modelID := fs.String("model-id", "", "Model id override (format: <provider>/<model>)")
	maxParallel := fs.Int("max-parallel", 1, "Maximum parallel generation workers")
	failOnMissingEvidence := fs.Bool("fail-on-missing-evidence", false, "Fail when generated cards have missing/invalid evidence")
	configPath := fs.String("config-path", "", "Config path (default: ~/.redeven/config.json)")
	secretsPath := fs.String("secrets-path", "", "Secrets path (default: <config dir>/secrets.json)")
	stateDir := fs.String("state-dir", "", "Knowledge generation state dir (default: <config dir>/knowledge-gen-state)")
	promptVersion := fs.String("prompt-version", "knowledge-prompts-v1", "Prompt version recorded into knowledge_lock.json")
	_ = fs.Parse(args)

	if strings.TrimSpace(*redevenRoot) == "" || strings.TrimSpace(*knowledgeRoot) == "" || strings.TrimSpace(*outputRoot) == "" {
		fs.Usage()
		os.Exit(2)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Minute)
	defer cancel()

	err := knowledgegen.Generate(ctx, knowledgegen.GenerateOptions{
		RedevenRoot:           cleanAbs(*redevenRoot),
		KnowledgeRoot:         cleanAbs(*knowledgeRoot),
		OutputRoot:            cleanAbs(*outputRoot),
		ModelID:               strings.TrimSpace(*modelID),
		MaxParallel:           *maxParallel,
		FailOnMissingEvidence: *failOnMissingEvidence,
		ConfigPath:            strings.TrimSpace(*configPath),
		SecretsPath:           strings.TrimSpace(*secretsPath),
		StateDir:              strings.TrimSpace(*stateDir),
		PromptVersion:         strings.TrimSpace(*promptVersion),
	})
	if err != nil {
		fmt.Fprintf(os.Stderr, "knowledge generate failed: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("knowledge generated under %s\n", cleanAbs(*outputRoot))
}

func knowledgeBundleCmd(args []string) {
	fs := flag.NewFlagSet("knowledge bundle", flag.ExitOnError)
	generatedRoot := fs.String("generated-root", cleanAbs(filepath.Join("internal", "knowledge", "generated")), "Generated knowledge root")
	distRoot := fs.String("dist-root", cleanAbs(filepath.Join("internal", "knowledge", "dist")), "Dist output root")
	verifyOnly := fs.Bool("verify-only", false, "Verify dist files without rewriting")
	_ = fs.Parse(args)

	result, err := knowledge.BuildFromGenerated(cleanAbs(*generatedRoot))
	if err != nil {
		fmt.Fprintf(os.Stderr, "knowledge bundle failed: %v\n", err)
		os.Exit(1)
	}

	if *verifyOnly {
		if err := knowledge.VerifyDistFiles(cleanAbs(*distRoot), result); err != nil {
			fmt.Fprintf(os.Stderr, "knowledge bundle verify failed: %v\n", err)
			os.Exit(1)
		}
		fmt.Printf("knowledge bundle verified: %s\n", cleanAbs(*distRoot))
		return
	}

	if err := knowledge.WriteDistFiles(cleanAbs(*distRoot), result); err != nil {
		fmt.Fprintf(os.Stderr, "knowledge bundle write failed: %v\n", err)
		os.Exit(1)
	}
	fmt.Printf("knowledge bundle updated: %s\n", cleanAbs(*distRoot))
}

func cleanAbs(path string) string {
	trimmed := strings.TrimSpace(path)
	if trimmed == "" {
		return ""
	}
	if filepath.IsAbs(trimmed) {
		return filepath.Clean(trimmed)
	}
	abs, err := filepath.Abs(trimmed)
	if err != nil {
		return filepath.Clean(trimmed)
	}
	return filepath.Clean(abs)
}
