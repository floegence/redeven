package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"github.com/floegence/redevplugin/pkg/capabilitycontract"
)

func main() {
	if len(os.Args) != 3 {
		fatal(errors.New("usage: redevplugin_candidate_client <contract.json> <client.ts>"))
	}
	raw, err := os.ReadFile(os.Args[1])
	if err != nil {
		fatal(err)
	}
	var contract capabilitycontract.Contract
	if err := json.Unmarshal(raw, &contract); err != nil {
		fatal(fmt.Errorf("decode capability contract: %w", err))
	}
	client, err := capabilitycontract.GenerateTypeScript(contract)
	if err != nil {
		fatal(fmt.Errorf("generate capability client: %w", err))
	}
	if err := os.MkdirAll(filepath.Dir(os.Args[2]), 0o755); err != nil {
		fatal(err)
	}
	if err := os.WriteFile(os.Args[2], client, 0o644); err != nil {
		fatal(err)
	}
}

func fatal(err error) {
	fmt.Fprintln(os.Stderr, err)
	os.Exit(1)
}
