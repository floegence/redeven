package main

import (
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/floegence/redeven-agent/internal/knowledge"
)

func knowledgeCmd(args []string) {
	if len(args) == 0 {
		printKnowledgeUsage()
		os.Exit(2)
	}
	switch strings.TrimSpace(strings.ToLower(args[0])) {
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
  redeven knowledge bundle [flags]

Commands:
  bundle      Build or verify dist knowledge bundle assets from source files.

`)
}

func knowledgeBundleCmd(args []string) {
	fs := flag.NewFlagSet("knowledge bundle", flag.ExitOnError)
	sourceRoot := fs.String("source-root", cleanAbs(filepath.Join("internal", "knowledge", "source")), "Knowledge source root")
	distRoot := fs.String("dist-root", cleanAbs(filepath.Join("internal", "knowledge", "dist")), "Dist output root")
	verifyOnly := fs.Bool("verify-only", false, "Verify dist files without rewriting")
	validateSourceOnly := fs.Bool("validate-source-only", false, "Validate source files only without reading dist")
	_ = fs.Parse(args)

	result, err := knowledge.BuildFromSource(cleanAbs(*sourceRoot))
	if err != nil {
		fmt.Fprintf(os.Stderr, "knowledge bundle failed: %v\n", err)
		os.Exit(1)
	}
	if *validateSourceOnly {
		fmt.Printf("knowledge source validated: %s\n", cleanAbs(*sourceRoot))
		return
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
