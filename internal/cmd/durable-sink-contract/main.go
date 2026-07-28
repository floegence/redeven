package main

import (
	"flag"
	"fmt"
	"os"
	"path/filepath"

	"github.com/floegence/redeven/internal/boundarycontract"
)

func main() {
	check := flag.Bool("check", false, "verify the reviewed durable sink closed set")
	write := flag.Bool("write-registry", false, "rewrite the registry after explicit review")
	root := flag.String("root", ".", "repository root")
	flag.Parse()
	if *check == *write {
		fmt.Fprintln(os.Stderr, "exactly one of --check or --write-registry is required")
		os.Exit(2)
	}
	findings, err := boundarycontract.Scan(*root)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	registryPath := filepath.Join(*root, "scripts", "contracts", "durable_sink_registry.json")
	if *write {
		registry := boundarycontract.Registry{Version: boundarycontract.RegistryVersion}
		for _, finding := range findings {
			registry.Entries = append(registry.Entries, boundarycontract.NewReviewedEntry(finding))
		}
		if err := boundarycontract.WriteRegistry(registryPath, registry); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		fmt.Printf("wrote %d reviewed durable sink entries\n", len(registry.Entries))
		return
	}
	registry, err := boundarycontract.LoadRegistry(registryPath)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	issues := boundarycontract.Validate(registry, findings)
	for _, issue := range issues {
		fmt.Fprintf(os.Stderr, "[ERROR] %s\n", issue)
	}
	if len(issues) > 0 {
		os.Exit(1)
	}
	fmt.Printf("[INFO] durable sink closed set checked (%d reviewed files)\n", len(findings))
}
