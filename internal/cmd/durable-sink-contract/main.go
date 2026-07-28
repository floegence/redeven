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
		existing := boundarycontract.Registry{Version: boundarycontract.RegistryVersion}
		if loaded, loadErr := boundarycontract.LoadRegistry(registryPath); loadErr == nil {
			existing = loaded
		} else if !os.IsNotExist(loadErr) {
			fmt.Fprintln(os.Stderr, loadErr)
			os.Exit(1)
		}
		registry := boundarycontract.RefreshRegistry(existing, findings)
		if err := boundarycontract.WriteRegistry(registryPath, registry); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		issues := boundarycontract.Validate(registry, findings)
		fmt.Printf("wrote %d durable sink entries\n", len(registry.Entries))
		for _, issue := range issues {
			fmt.Fprintf(os.Stderr, "[ERROR] %s\n", issue)
		}
		if len(issues) > 0 {
			os.Exit(1)
		}
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
